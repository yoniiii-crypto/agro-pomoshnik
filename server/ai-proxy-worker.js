// Сервер «Агро-помощника» (Cloudflare Worker): ИИ-посредник и общая база хозяйств.
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
    if (url.pathname.startsWith('/sync/')) return handleSync(request, env, url.pathname, ip, reply, json);

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
