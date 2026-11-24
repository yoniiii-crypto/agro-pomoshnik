// Сервер Alqap (Cloudflare Worker): ИИ-посредник, общая база хозяйств и «Агрономы онлайн».
//
// 1. ИИ-посредник. Ключ Gemini нельзя класть в код сайта — он публичный. Ключ
//    хранится только в настройках этого сервера (секрет GEMINI_KEY), а сайт
//    отправляет запрос сюда без ключа. Сервер принимает запросы только со
//    страниц сайта, проверяет модель и размер запроса и пересылает его в Google.
//
// 2. Общая база (адреса /sync/...). Одно хозяйство на нескольких телефонах.
//    Хозяйство хранится одной зашифрованной строкой: шифрует и расшифровывает
//    приложение на телефоне, ключ шифрования на сервер не попадает. Сервер
//    проверяет токен доступа и принимает новую версию, только если у телефона
//    была последняя: так два телефона не затирают записи друг друга.
//    Токенов два: полный (читать и менять) и только для просмотра — для
//    банка, страховой или наблюдателя. С токеном просмотра запись запрещена.
//    Фото к записям тоже общие: каждое фото шифруется на телефоне и хранится
//    отдельной строкой. Фото не меняются, поэтому версии для них не нужны.
//
// Как запустить ИИ: dash.cloudflare.com → Workers & Pages → Create → Worker →
// вставить этот файл → Deploy → Settings → Variables and Secrets → добавить
// Secret с именем GEMINI_KEY и ключом из aistudio.google.com.
//
// Как включить общую базу: Storage & databases → D1 SQL database → Create,
// имя agro. Затем в этом воркере: Settings → Bindings → Add → D1 database,
// Variable name AGRO_DB, выбрать базу agro → Deploy. Таблицу сервер создаст сам.
// Без этой привязки ИИ работает как раньше, а общая база в приложении скрыта.
//
// «Агрономы онлайн» используют ту же базу AGRO_DB. Чтобы проверять анкеты и отмечать
// оплату, добавьте Secret AGRO_ADMIN — длинный пароль администратора (его вводят в
// приложении: «Агрономы онлайн» → «Для администратора»). Комиссия по умолчанию 10 %,
// другую можно задать переменной AGRO_FEE_PCT.

const ALLOWED_ORIGINS = [
  'https://yoniiii-crypto.github.io', // сайт приложения
];
const MODEL_RE = /^gemini-[a-z0-9.\-]{1,40}$/;
const MAX_BYTES = 6 * 1024 * 1024; // до трёх сжатых фото

// Мягкий лимит: не больше 60 запросов к ИИ в минуту с одного адреса, чтобы чужие
// скрипты не выбрали бесплатную квоту ключа. 60, а не меньше: на выставке или
// хакатоне многие сидят в одной Wi-Fi-сети с общим адресом. Счётчики живут в памяти сервера.
const PER_MINUTE = 60;
const hits = new Map();
function tooMany(counter, key, limit, windowMs = 60000) {
  const now = Date.now();
  const list = (counter.get(key) || []).filter((t) => now - t < windowMs);
  list.push(now);
  counter.set(key, list);
  if (counter.size > 5000) counter.clear();
  return list.length > limit;
}

// ===== Общая база =====
const SYNC_MAX = 1800000;     // символов в зашифрованном хозяйстве (строка D1 — до 2 МБ)
const SYNC_PER_MINUTE = 120;  // запросов общей базы в минуту с одного адреса
const SYNC_NEW_PER_DAY = 20;  // новых общих хозяйств в сутки с одного адреса
const SYNC_MAX_FARMS = 3000;  // всего хозяйств: чужие скрипты не заполнят базу
const ID_RE = /^[0-9a-f]{16}$/;
const AUTH_RE = /^[0-9a-f]{64}$/;
const TAG_RE = /^[0-9a-f]{16}$/;
const PID_RE = /^[0-9A-Za-z_-]{1,40}$/;
const PHOTO_MAX = 900000;        // символов в одном зашифрованном фото
const PHOTOS_PER_FARM = 300;     // фото у одного хозяйства
const PHOTO_TOTAL = 300000000;   // символов фото на всём сервере: бесплатная база D1 — до 500 МБ
const syncHits = new Map();
const newHits = new Map();
let schemaReady = false;

async function sha256hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function newTag() {
  const a = new Uint8Array(8);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Запрос общей базы: JSON { id, auth, ... }.
//   id   — номер хозяйства, auth — токен доступа; оба телефон получает из кода хозяйства.
//   rauth — токен «только просмотр», задаётся при создании хозяйства.
//   data — хозяйство, зашифрованное на телефоне. Сервер его не читает.
//   tag  — метка версии: запись (put) проходит, только если base совпадает с текущей меткой.
//   pid  — номер фото (pput, pget), pids — список номеров для удаления (pdel).
async function handleSync(request, env, path, ip, reply, json) {
  if (path === '/sync/hello') return json(200, { ok: true, sync: !!env.AGRO_DB, v: 1, max: SYNC_MAX });
  if (!env.AGRO_DB) return reply(501, 'Sync is not set up on the server');
  if (tooMany(syncHits, ip, SYNC_PER_MINUTE)) return reply(429, 'Too many requests, wait a minute');

  const raw = await request.text();
  if (raw.length > SYNC_MAX + 4096) return reply(413, 'Farm data is too large');
  let q = null;
  try { q = JSON.parse(raw); } catch (e) { return reply(400, 'Bad JSON'); }
  if (!q || !ID_RE.test(q.id || '') || !AUTH_RE.test(q.auth || '')) return reply(400, 'Bad id or auth');
  const hasData = typeof q.data === 'string' && q.data.length > 0;
  if (hasData && q.data.length > (path === '/sync/pput' ? PHOTO_MAX : SYNC_MAX)) return reply(413, path === '/sync/pput' ? 'Photo is too large' : 'Farm data is too large');

  const db = env.AGRO_DB;
  try {
    if (!schemaReady) {
      await db.prepare('CREATE TABLE IF NOT EXISTS farms (id TEXT PRIMARY KEY, ah TEXT NOT NULL, rh TEXT NOT NULL, tag TEXT NOT NULL, data TEXT NOT NULL, mt INTEGER NOT NULL, ct INTEGER NOT NULL)').run();
      // sz стоит перед data: сумма размеров считается без чтения самих фото
      await db.prepare('CREATE TABLE IF NOT EXISTS photos (fid TEXT NOT NULL, pid TEXT NOT NULL, sz INTEGER NOT NULL, ct INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (fid, pid))').run();
      schemaReady = true;
    }
    const ah = await sha256hex(q.auth); // на сервере лежит только хеш токена
    const now = Date.now();

    if (path === '/sync/create') {
      if (!hasData) return reply(400, 'No data');
      if (!AUTH_RE.test(q.rauth || '') || q.rauth === q.auth) return reply(400, 'Bad view token');
      if (tooMany(newHits, ip, SYNC_NEW_PER_DAY, 86400000)) return reply(429, 'Too many new farms today');
      const count = await db.prepare('SELECT COUNT(*) AS n FROM farms').first();
      if (count && count.n >= SYNC_MAX_FARMS) return reply(507, 'The shared database is full');
      const tag = newTag();
      const made = await db.prepare('INSERT OR IGNORE INTO farms (id, ah, rh, tag, data, mt, ct) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)')
        .bind(q.id, ah, await sha256hex(q.rauth), tag, q.data, now).run();
      if (!made.meta.changes) return reply(409, 'exists');
      return json(200, { ok: true, tag });
    }

    const cols = path === '/sync/get' ? 'ah, rh, tag, mt, data' : 'ah, rh, tag, mt';
    const row = await db.prepare('SELECT ' + cols + ' FROM farms WHERE id = ?1').bind(q.id).first();
    if (!row) return reply(404, 'No such farm');
    const role = row.ah === ah ? 'w' : row.rh === ah ? 'r' : ''; // w — полный доступ, r — только просмотр
    if (!role) return reply(403, 'Wrong access code');

    if (path === '/sync/head') return json(200, { ok: true, role, tag: row.tag, mt: row.mt });
    if (path === '/sync/get') return json(200, { ok: true, role, tag: row.tag, mt: row.mt, data: row.data });
    if (path === '/sync/pget') {
      if (!PID_RE.test(q.pid || '')) return reply(400, 'Bad photo id');
      const ph = await db.prepare('SELECT data FROM photos WHERE fid = ?1 AND pid = ?2').bind(q.id, q.pid).first();
      if (!ph) return reply(404, 'No such photo');
      return json(200, { ok: true, data: ph.data });
    }
    if (path === '/sync/plist') {
      const all = await db.prepare('SELECT pid, ct FROM photos WHERE fid = ?1').bind(q.id).all();
      return json(200, { ok: true, list: (all.results || []).map((r) => [r.pid, r.ct]) });
    }
    if (role !== 'w') return reply(403, 'Read-only access');
    if (path === '/sync/put') {
      if (!hasData) return reply(400, 'No data');
      if (!TAG_RE.test(q.base || '')) return reply(400, 'Bad base tag');
      const tag = newTag();
      const done = await db.prepare('UPDATE farms SET data = ?1, tag = ?2, mt = ?3 WHERE id = ?4 AND tag = ?5')
        .bind(q.data, tag, now, q.id, q.base).run();
      if (done.meta.changes) return json(200, { ok: true, tag });
      const cur = await db.prepare('SELECT tag FROM farms WHERE id = ?1').bind(q.id).first();
      return json(409, { error: { code: 409, message: 'conflict' }, tag: cur ? cur.tag : '' });
    }
    if (path === '/sync/pput') {
      if (!PID_RE.test(q.pid || '')) return reply(400, 'Bad photo id');
      if (!hasData) return reply(400, 'No data');
      const has = await db.prepare('SELECT 1 AS x FROM photos WHERE fid = ?1 AND pid = ?2').bind(q.id, q.pid).first();
      if (has) return json(200, { ok: true }); // фото не меняются: второй раз то же самое не пишем
      const mine = await db.prepare('SELECT COUNT(*) AS n FROM photos WHERE fid = ?1').bind(q.id).first();
      if (mine && mine.n >= PHOTOS_PER_FARM) return reply(507, 'Photo limit for this farm');
      const total = await db.prepare('SELECT COALESCE(SUM(sz), 0) AS s FROM photos').first();
      if (total && total.s + q.data.length > PHOTO_TOTAL) return reply(507, 'The photo storage is full');
      await db.prepare('INSERT OR IGNORE INTO photos (fid, pid, sz, ct, data) VALUES (?1, ?2, ?3, ?4, ?5)')
        .bind(q.id, q.pid, q.data.length, now, q.data).run();
      return json(200, { ok: true });
    }
    if (path === '/sync/pdel') {
      const pids = Array.isArray(q.pids) ? q.pids.filter((x) => PID_RE.test(String(x))).slice(0, 100) : [];
      for (const pid of pids) await db.prepare('DELETE FROM photos WHERE fid = ?1 AND pid = ?2').bind(q.id, pid).run();
      return json(200, { ok: true, n: pids.length });
    }
    if (path === '/sync/delete') {
      await db.prepare('DELETE FROM farms WHERE id = ?1 AND ah = ?2').bind(q.id, ah).run();
      await db.prepare('DELETE FROM photos WHERE fid = ?1').bind(q.id).run();
      return json(200, { ok: true });
    }
    return reply(404, 'Unknown sync route');
  } catch (e) {
    schemaReady = false; // если базу пересоздали, следующая попытка создаст таблицу заново
    return reply(503, 'Database is not available');
  }
}

// ===== Агрономы онлайн (адреса /agro/...) =====
// Каталог агрономов и платные консультации. Фермер платит Alqap, Alqap оставляет себе
// комиссию (по умолчанию 10 % от цены агронома) и переводит остальное агроному.
// Пока платёжная система не подключена, оплату отмечает администратор вручную: он
// выставляет фермеру счёт (Kaspi и т. п.), получает деньги и нажимает «Оплачено».
//   Анкета агронома → проверка администратором → агроном в каталоге.
//   Заказ фермера (статус pay) → оплата (paid) → ответ агронома (done) → выплата агроному (po=1).
// Агроном видит вопрос и данные поля только после оплаты, а телефон фермера не видит никогда:
// так консультация идёт через Alqap. У агронома и у заказа свои секретные коды; на сервере
// лежат только их хеши. Ключ администратора — секрет AGRO_ADMIN в настройках воркера,
// в коде его нет. Комиссию можно поменять переменной AGRO_FEE_PCT.
const AGRO_PER_MINUTE = 60;          // запросов /agro в минуту с одного адреса
const AGRO_APPS_PER_DAY = 5;         // анкет агрономов в сутки с одного адреса
const AGRO_ORDERS_PER_DAY = 30;      // заказов в сутки с одного адреса
const AGRO_MAX_AGROS = 2000;
const AGRO_MAX_ORDERS = 50000;
const AGRO_PRICE_MIN = 500, AGRO_PRICE_MAX = 1000000; // тенге за консультацию
const PHONE_RE = /^\+?[0-9][0-9 ()-]{6,19}$/;
const agroHits = new Map(), agroApps = new Map(), agroOrders = new Map();
let agroSchemaReady = false;

function agroFee(env) {
  const p = Number(env.AGRO_FEE_PCT);
  return Number.isFinite(p) && p >= 0 && p <= 50 ? p : 10;
}
function cut(v, n) { return String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, n); }
function newKey(bytes) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
}
// Сравнение ключа администратора без раннего выхода по первому несовпавшему символу
function sameText(a, b) {
  a = String(a || ''); b = String(b || '');
  let d = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return d === 0 && a.length > 0;
}
const pubAgro = (r) => ({ id: r.id, name: r.name, region: r.region, crops: r.crops, exp: r.exp, price: r.price, fmt: r.fmt, about: r.about, rate: r.rn ? Math.round(r.rs / r.rn * 10) / 10 : null, rn: r.rn });

async function handleAgro(request, env, path, ip, reply, json) {
  const fee = agroFee(env);
  if (path === '/agro/hello') return json(200, { ok: true, on: !!env.AGRO_DB, fee, pay: 'manual', admin: !!env.AGRO_ADMIN });
  if (!env.AGRO_DB) return reply(501, 'Agronomists are not set up on the server');
  if (tooMany(agroHits, ip, AGRO_PER_MINUTE)) return reply(429, 'Too many requests, wait a minute');
  const raw = await request.text();
  if (raw.length > 20000) return reply(413, 'Request is too large');
  let q = null;
  try { q = JSON.parse(raw || '{}'); } catch (e) { return reply(400, 'Bad JSON'); }
  if (!q || typeof q !== 'object') return reply(400, 'Bad JSON');
  const db = env.AGRO_DB, now = Date.now();
  try {
    if (!agroSchemaReady) {
      await db.prepare('CREATE TABLE IF NOT EXISTS agros (id TEXT PRIMARY KEY, th TEXT NOT NULL, st TEXT NOT NULL, name TEXT, region TEXT, crops TEXT, exp INTEGER, price INTEGER, fmt TEXT, about TEXT, phone TEXT, rs INTEGER NOT NULL DEFAULT 0, rn INTEGER NOT NULL DEFAULT 0, ct INTEGER, mt INTEGER)').run();
      await db.prepare('CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, th TEXT NOT NULL, aid TEXT NOT NULL, st TEXT NOT NULL, price INTEGER, fee INTEGER, q TEXT, ctx TEXT, name TEXT, phone TEXT, lang TEXT, ans TEXT, stars INTEGER, po INTEGER NOT NULL DEFAULT 0, ct INTEGER, mt INTEGER)').run();
      agroSchemaReady = true;
    }
    // каталог: только проверенные агрономы, без телефонов
    if (path === '/agro/list') {
      const all = await db.prepare("SELECT * FROM agros WHERE st = 'ok' ORDER BY rn DESC, ct ASC LIMIT 200").all();
      return json(200, { ok: true, fee, list: (all.results || []).map(pubAgro) });
    }
    // анкета агронома
    if (path === '/agro/apply') {
      const a = { name: cut(q.name, 80), region: cut(q.region, 60), crops: cut(q.crops, 200), fmt: cut(q.fmt, 100), about: cut(q.about, 1000), phone: cut(q.phone, 20) };
      const price = Math.round(Number(q.price)), exp = Math.round(Number(q.exp));
      if (a.name.length < 2 || !a.region || !a.crops) return reply(400, 'Fill in name, region and crops');
      if (!PHONE_RE.test(a.phone)) return reply(400, 'Bad phone');
      if (!(price >= AGRO_PRICE_MIN && price <= AGRO_PRICE_MAX)) return reply(400, 'Bad price');
      if (!(exp >= 0 && exp <= 60)) return reply(400, 'Bad experience');
      if (tooMany(agroApps, ip, AGRO_APPS_PER_DAY, 86400000)) return reply(429, 'Too many applications today');
      const n = await db.prepare('SELECT COUNT(*) AS n FROM agros').first();
      if (n && n.n >= AGRO_MAX_AGROS) return reply(507, 'The catalogue is full');
      const id = newKey(8), token = newKey(32);
      await db.prepare("INSERT INTO agros (id, th, st, name, region, crops, exp, price, fmt, about, phone, ct, mt) VALUES (?1, ?2, 'wait', ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)")
        .bind(id, await sha256hex(token), a.name, a.region, a.crops, exp, price, a.fmt, a.about, a.phone, now).run();
      return json(200, { ok: true, id, token });
    }
    // кабинет агронома: его анкета и оплаченные заказы
    if (path === '/agro/me' || path === '/agro/answer' || path === '/agro/update') {
      if (!ID_RE.test(q.id || '') || !AUTH_RE.test(q.token || '')) return reply(400, 'Bad id or token');
      const me = await db.prepare('SELECT * FROM agros WHERE id = ?1').bind(q.id).first();
      if (!me || me.th !== await sha256hex(q.token)) return reply(403, 'Wrong agronomist code');
      if (path === '/agro/me') {
        const all = await db.prepare("SELECT id, st, price, fee, q, ctx, lang, ans, stars, po, ct, mt FROM orders WHERE aid = ?1 AND st IN ('paid', 'done') ORDER BY ct DESC LIMIT 200").bind(q.id).all();
        return json(200, { ok: true, fee, me: { ...pubAgro(me), st: me.st, phone: me.phone }, orders: all.results || [] });
      }
      if (path === '/agro/update') {
        const price = Math.round(Number(q.price));
        if (!(price >= AGRO_PRICE_MIN && price <= AGRO_PRICE_MAX)) return reply(400, 'Bad price');
        await db.prepare('UPDATE agros SET price = ?1, about = ?2, fmt = ?3, mt = ?4 WHERE id = ?5').bind(price, cut(q.about, 1000), cut(q.fmt, 100), now, q.id).run();
        return json(200, { ok: true });
      }
      // ответ на оплаченный заказ
      const text = cut(q.text, 4000);
      if (!ID_RE.test(q.oid || '') || text.length < 2) return reply(400, 'Bad order or empty answer');
      const done = await db.prepare("UPDATE orders SET ans = ?1, st = 'done', mt = ?2 WHERE id = ?3 AND aid = ?4 AND st IN ('paid', 'done')").bind(text, now, q.oid, q.id).run();
      if (!done.meta.changes) return reply(409, 'Order is not paid yet or not yours');
      return json(200, { ok: true });
    }
    // заказ консультации
    if (path === '/agro/order') {
      if (!ID_RE.test(q.aid || '')) return reply(400, 'Bad agronomist');
      const a = await db.prepare("SELECT id, price, name FROM agros WHERE id = ?1 AND st = 'ok'").bind(q.aid).first();
      if (!a) return reply(404, 'No such agronomist');
      const text = cut(q.q, 2000), phone = cut(q.phone, 20);
      if (text.length < 5) return reply(400, 'Write the question');
      if (!PHONE_RE.test(phone)) return reply(400, 'Bad phone');
      if (tooMany(agroOrders, ip, AGRO_ORDERS_PER_DAY, 86400000)) return reply(429, 'Too many orders today');
      const n = await db.prepare('SELECT COUNT(*) AS n FROM orders').first();
      if (n && n.n >= AGRO_MAX_ORDERS) return reply(507, 'Order storage is full');
      const id = newKey(8), token = newKey(32), f = Math.round(a.price * fee / 100);
      await db.prepare("INSERT INTO orders (id, th, aid, st, price, fee, q, ctx, name, phone, lang, ct, mt) VALUES (?1, ?2, ?3, 'pay', ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)")
        .bind(id, await sha256hex(token), a.id, a.price, f, text, cut(q.ctx, 8000), cut(q.name, 80), phone, q.lang === 'kk' ? 'kk' : 'ru', now).run();
      return json(200, { ok: true, id, token, price: a.price, fee: f, st: 'pay' });
    }
    // фермер смотрит свой заказ и ставит оценку
    if (path === '/agro/status' || path === '/agro/rate') {
      if (!ID_RE.test(q.id || '') || !AUTH_RE.test(q.token || '')) return reply(400, 'Bad id or token');
      const o = await db.prepare('SELECT o.*, a.name AS an FROM orders o LEFT JOIN agros a ON a.id = o.aid WHERE o.id = ?1').bind(q.id).first();
      if (!o || o.th !== await sha256hex(q.token)) return reply(403, 'Wrong order code');
      if (path === '/agro/rate') {
        const s = Math.round(Number(q.stars));
        if (!(s >= 1 && s <= 5)) return reply(400, 'Bad stars');
        if (o.st !== 'done') return reply(409, 'No answer yet');
        if (o.stars) return reply(409, 'Already rated');
        await db.prepare('UPDATE orders SET stars = ?1, mt = ?2 WHERE id = ?3').bind(s, now, o.id).run();
        await db.prepare('UPDATE agros SET rs = rs + ?1, rn = rn + 1 WHERE id = ?2').bind(s, o.aid).run();
        return json(200, { ok: true });
      }
      return json(200, { ok: true, st: o.st, price: o.price, fee: o.fee, agro: o.an, aid: o.aid, ans: o.st === 'done' ? o.ans : '', stars: o.stars || 0, ct: o.ct, mt: o.mt });
    }
    // администратор Alqap: проверка анкет, отметка оплаты и выплаты агроному
    if (path.startsWith('/agro/admin/')) {
      if (!env.AGRO_ADMIN) return reply(501, 'Admin key is not set on the server');
      if (!sameText(q.key, env.AGRO_ADMIN)) return reply(403, 'Wrong admin key');
      if (path === '/agro/admin/list') {
        const ag = await db.prepare('SELECT id, st, name, region, crops, exp, price, fmt, about, phone, rs, rn, ct FROM agros ORDER BY ct DESC LIMIT 500').all();
        const or = await db.prepare('SELECT o.id, o.aid, o.st, o.price, o.fee, o.q, o.name, o.phone, o.lang, o.stars, o.po, o.ct, o.mt, a.name AS an FROM orders o LEFT JOIN agros a ON a.id = o.aid ORDER BY o.ct DESC LIMIT 500').all();
        return json(200, { ok: true, fee, agros: ag.results || [], orders: or.results || [] });
      }
      if (!ID_RE.test(q.id || '')) return reply(400, 'Bad id');
      const set = {
        '/agro/admin/approve': ["UPDATE agros SET st = 'ok', mt = ?2 WHERE id = ?1", 'agros'],
        '/agro/admin/reject': ["UPDATE agros SET st = 'no', mt = ?2 WHERE id = ?1", 'agros'],
        '/agro/admin/paid': ["UPDATE orders SET st = 'paid', mt = ?2 WHERE id = ?1 AND st = 'pay'", 'orders'],
        '/agro/admin/cancel': ["UPDATE orders SET st = 'cancel', mt = ?2 WHERE id = ?1 AND st IN ('pay', 'paid')", 'orders'],
        '/agro/admin/payout': ["UPDATE orders SET po = 1, mt = ?2 WHERE id = ?1 AND st = 'done'", 'orders'],
      }[path];
      if (!set) return reply(404, 'Unknown admin route');
      const r = await db.prepare(set[0]).bind(q.id, now).run();
      if (!r.meta.changes) return reply(409, 'Nothing changed: wrong id or status');
      return json(200, { ok: true });
    }
    return reply(404, 'Unknown agro route');
  } catch (e) {
    agroSchemaReady = false;
    return reply(503, 'Database is not available');
  }
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = ALLOWED_ORIGINS.includes(origin);
    const cors = {
      'Access-Control-Allow-Origin': allowed ? origin : ALLOWED_ORIGINS[0],
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '3600',
      'Vary': 'Origin',
    };
    const json = (status, body) => new Response(JSON.stringify(body), {
      status, headers: { ...cors, 'Content-Type': 'application/json' },
    });
    const reply = (status, text) => json(status, { error: { code: status, message: text } });

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') return reply(405, 'Only POST');
    if (!allowed) return reply(403, 'Origin not allowed');

    const url = new URL(request.url);
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    // Слишком большой запрос отклоняем до чтения тела, чтобы не тратить память сервера
    if (Number(request.headers.get('Content-Length') || 0) > MAX_BYTES) return reply(413, 'Request too large');
    if (url.pathname.startsWith('/sync/')) return handleSync(request, env, url.pathname, ip, reply, json);
    if (url.pathname.startsWith('/agro/')) return handleAgro(request, env, url.pathname, ip, reply, json);

    if (!env.GEMINI_KEY) return reply(500, 'GEMINI_KEY is not set on the server');
    if (tooMany(hits, ip, PER_MINUTE)) return reply(429, 'Too many requests, wait a minute');

    const params = url.searchParams;
    const model = params.get('model') || 'gemini-3.5-flash';
    // stream=1: ответ идёт потоком, и текст появляется в приложении по мере написания
    const method = params.get('stream') === '1' ? 'streamGenerateContent?alt=sse' : 'generateContent';
    if (!MODEL_RE.test(model)) return reply(400, 'Bad model');

    const body = await request.arrayBuffer();
    if (body.byteLength > MAX_BYTES) return reply(413, 'Request too large');

    let upstream;
    try {
      upstream = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':' + method,
        { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_KEY }, body },
      );
    } catch (e) {
      return reply(502, 'Google is not reachable');
    }
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { ...cors, 'Content-Type': upstream.headers.get('Content-Type') || 'application/json' },
    });
  },
};
