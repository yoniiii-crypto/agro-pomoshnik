// Общая база на сервере: проверка адресов /sync/* на настоящем SQLite вместо D1.
// Запуск: node tests/sync-server.test.mjs
import worker from '../server/ai-proxy-worker.js';
import { fakeD1 } from './fake-d1.mjs';
const site = 'https://yoniiii-crypto.github.io';
const db = fakeD1();
const env = { GEMINI_KEY: 'K', AGRO_DB: db };
let ipn = 0; const newIp = () => '10.0.' + (++ipn >> 8) + '.' + (ipn & 255);
const call = async (path, body, o = {}) => {
  const r = await worker.fetch(new Request('https://agro-ai.example.workers.dev' + path, {
    method: o.method || 'POST', headers: { Origin: o.origin === undefined ? site : o.origin, 'Content-Type': 'application/json', 'CF-Connecting-IP': o.ip || '10.9.9.9' },
    body: o.method === 'OPTIONS' ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
  }), o.env || env);
  let j = null; try { j = await r.json(); } catch (e) {}
  return { s: r.status, j };
};
let fails = 0; const ok = (name, cond, extra) => { if (!cond) fails++; console.log((cond ? 'ok  ' : 'FAIL') + ' ' + name + (extra !== undefined ? ' | ' + JSON.stringify(extra) : '')); };
const ID = 'a'.repeat(16), AUTH = 'b'.repeat(64), BAD = 'c'.repeat(64), VIEW = 'e'.repeat(64);

let r = await call('/sync/hello', {}, { env: { GEMINI_KEY: 'K' }, ip: newIp() }); ok('hello без базы: sync=false', r.s === 200 && r.j.sync === false, r.j);
r = await call('/sync/get', { id: ID, auth: AUTH }, { env: { GEMINI_KEY: 'K' }, ip: newIp() }); ok('без базы остальные маршруты → 501', r.s === 501);
r = await call('/sync/hello', {}, { ip: newIp() }); ok('hello с базой: sync=true', r.s === 200 && r.j.sync === true && r.j.max > 1e6, r.j);
r = await call('/sync/get', { id: ID, auth: AUTH }, { ip: newIp() }); ok('неизвестное хозяйство → 404', r.s === 404);
r = await call('/sync/create', { id: ID, auth: AUTH, rauth: VIEW, data: 'ENC1' }, { ip: newIp() }); ok('создание', r.s === 200 && /^[0-9a-f]{16}$/.test(r.j.tag), r.j); const t1 = r.j.tag;
r = await call('/sync/create', { id: ID, auth: AUTH, rauth: VIEW, data: 'ENC-X' }, { ip: newIp() }); ok('повторное создание → 409 exists', r.s === 409 && r.j.error.message === 'exists');
r = await call('/sync/get', { id: ID, auth: AUTH }, { ip: newIp() }); ok('чтение', r.s === 200 && r.j.data === 'ENC1' && r.j.tag === t1 && r.j.mt > 0);
r = await call('/sync/get', { id: ID, auth: BAD }, { ip: newIp() }); ok('чужой токен → 403, данных нет', r.s === 403 && !('data' in (r.j || {})));
r = await call('/sync/head', { id: ID, auth: AUTH }, { ip: newIp() }); ok('head: только метка', r.s === 200 && r.j.tag === t1 && !('data' in r.j));
r = await call('/sync/put', { id: ID, auth: AUTH, base: t1, data: 'ENC2' }, { ip: newIp() }); ok('запись с актуальной меткой', r.s === 200 && r.j.tag !== t1, r.j); const t2 = r.j.tag;
r = await call('/sync/put', { id: ID, auth: AUTH, base: t1, data: 'STALE' }, { ip: newIp() }); ok('запись с устаревшей меткой → 409 и текущая метка', r.s === 409 && r.j.tag === t2, r.j);
r = await call('/sync/get', { id: ID, auth: AUTH }, { ip: newIp() }); ok('устаревшая запись ничего не затёрла', r.j.data === 'ENC2' && r.j.tag === t2);
r = await call('/sync/put', { id: ID, auth: BAD, base: t2, data: 'HACK' }, { ip: newIp() }); ok('запись с чужим токеном → 403', r.s === 403);
r = await call('/sync/get', { id: ID, auth: VIEW }, { ip: newIp() }); ok('токен просмотра: читать можно, роль r', r.s === 200 && r.j.role === 'r' && r.j.data === 'ENC2');
r = await call('/sync/head', { id: ID, auth: VIEW }, { ip: newIp() }); ok('токен просмотра: метка версии доступна', r.s === 200 && r.j.role === 'r' && r.j.tag === t2);
r = await call('/sync/put', { id: ID, auth: VIEW, base: t2, data: 'VIEWER-WRITE' }, { ip: newIp() }); ok('токен просмотра: запись запрещена', r.s === 403 && r.j.error.message === 'Read-only access');
r = await call('/sync/delete', { id: ID, auth: VIEW }, { ip: newIp() }); ok('токен просмотра: удаление запрещено', r.s === 403);
r = await call('/sync/get', { id: ID, auth: AUTH }, { ip: newIp() }); ok('после попыток просмотрщика данные те же, роль владельца w', r.j.data === 'ENC2' && r.j.role === 'w');
r = await call('/sync/create', { id: 'f'.repeat(16), auth: AUTH, data: 'x' }, { ip: newIp() }); ok('создание без токена просмотра → 400', r.s === 400);
r = await call('/sync/create', { id: 'f'.repeat(16), auth: AUTH, rauth: AUTH, data: 'x' }, { ip: newIp() }); ok('токен просмотра не может совпадать с полным', r.s === 400);
const both = await Promise.all([call('/sync/put', { id: ID, auth: AUTH, base: t2, data: 'A' }, { ip: newIp() }), call('/sync/put', { id: ID, auth: AUTH, base: t2, data: 'B' }, { ip: newIp() })]);
ok('две одновременные записи: проходит ровно одна', both.filter((x) => x.s === 200).length === 1 && both.filter((x) => x.s === 409).length === 1, both.map((x) => x.s));
r = await call('/sync/put', { id: ID, auth: AUTH, base: 'zz', data: 'A' }, { ip: newIp() }); ok('кривая метка → 400', r.s === 400);
r = await call('/sync/put', { id: ID, auth: AUTH, base: t2 }, { ip: newIp() }); ok('запись без данных → 400', r.s === 400);
r = await call('/sync/create', { id: 'XYZ', auth: AUTH, rauth: VIEW, data: 'x' }, { ip: newIp() }); ok('кривой id → 400', r.s === 400);
r = await call('/sync/get', '{oops', { ip: newIp() }); ok('кривой JSON → 400', r.s === 400);
r = await call('/sync/create', { id: 'd'.repeat(16), auth: AUTH, rauth: VIEW, data: 'x'.repeat(1800001) }, { ip: newIp() }); ok('слишком большое хозяйство → 413', r.s === 413);
r = await call('/sync/create', { id: 'd'.repeat(16), auth: AUTH, rauth: VIEW, data: 'x'.repeat(1800000) }, { ip: newIp() }); ok('ровно лимит проходит', r.s === 200);
r = await call('/sync/nope', { id: ID, auth: AUTH }, { ip: newIp() }); ok('неизвестный маршрут → 404', r.s === 404);
r = await call('/sync/get', { id: ID, auth: AUTH }, { origin: 'https://evil.example', ip: newIp() }); ok('чужой сайт → 403', r.s === 403 && r.j.error.message === 'Origin not allowed');
r = await call('/sync/get', null, { method: 'OPTIONS', ip: newIp() }); ok('preflight → 204', r.s === 204);
// фото
r = await call('/sync/pput', { id: ID, auth: AUTH, pid: 'p1', data: 'PH1' }, { ip: newIp() }); ok('фото: загрузка', r.s === 200, r.j);
r = await call('/sync/pput', { id: ID, auth: AUTH, pid: 'p1', data: 'OTHER' }, { ip: newIp() }); ok('фото не перезаписывается тем же номером', r.s === 200);
r = await call('/sync/pget', { id: ID, auth: AUTH, pid: 'p1' }, { ip: newIp() }); ok('фото: чтение', r.s === 200 && r.j.data === 'PH1', r.j);
r = await call('/sync/pget', { id: ID, auth: VIEW, pid: 'p1' }, { ip: newIp() }); ok('фото: просмотрщик может читать', r.s === 200 && r.j.data === 'PH1');
r = await call('/sync/pput', { id: ID, auth: VIEW, pid: 'p2', data: 'V' }, { ip: newIp() }); ok('фото: просмотрщик не может загружать', r.s === 403);
r = await call('/sync/pdel', { id: ID, auth: VIEW, pids: ['p1'] }, { ip: newIp() }); ok('фото: просмотрщик не может удалять', r.s === 403);
r = await call('/sync/pget', { id: ID, auth: BAD, pid: 'p1' }, { ip: newIp() }); ok('фото: чужой токен → 403', r.s === 403 && !('data' in (r.j || {})));
r = await call('/sync/pget', { id: ID, auth: AUTH, pid: 'nope' }, { ip: newIp() }); ok('фото: нет такого → 404', r.s === 404 && r.j.error.message === 'No such photo');
r = await call('/sync/pget', { id: ID, auth: AUTH, pid: '../x' }, { ip: newIp() }); ok('фото: кривой номер → 400', r.s === 400);
r = await call('/sync/pput', { id: ID, auth: AUTH, pid: 'pbig', data: 'x'.repeat(900001) }, { ip: newIp() }); ok('фото: больше лимита → 413', r.s === 413);
r = await call('/sync/pput', { id: ID, auth: AUTH, pid: 'p2', data: 'PH2' }, { ip: newIp() });
r = await call('/sync/plist', { id: ID, auth: VIEW }, { ip: newIp() }); ok('фото: список с датами', r.s === 200 && r.j.list.map((x) => x[0]).sort().join() === 'p1,p2' && r.j.list.every((x) => x[1] > 0), r.j);
r = await call('/sync/pget', { id: 'd'.repeat(16), auth: AUTH, pid: 'p1' }, { ip: newIp() }); ok('фото другого хозяйства не видно', r.s === 404);
r = await call('/sync/pdel', { id: ID, auth: AUTH, pids: ['p2', '../bad'] }, { ip: newIp() }); ok('фото: удаление', r.s === 200 && r.j.n === 1);
r = await call('/sync/plist', { id: ID, auth: AUTH }, { ip: newIp() }); ok('после удаления осталось одно фото', r.j.list.length === 1 && r.j.list[0][0] === 'p1');
{ const ins = db._db.prepare('INSERT INTO photos (fid, pid, sz, ct, data) VALUES (?, ?, 1, 1, ?)'); for (let i = 0; i < 299; i++) ins.run(ID, 'q' + i, 'x'); }
r = await call('/sync/pput', { id: ID, auth: AUTH, pid: 'over', data: 'x' }, { ip: newIp() }); ok('фото: не больше 300 на хозяйство → 507', r.s === 507 && /farm/.test(r.j.error.message), r.j);
db._db.prepare("DELETE FROM photos WHERE pid LIKE 'q%'").run(); db._db.prepare("INSERT INTO photos (fid, pid, sz, ct, data) VALUES ('0000000000000000', 'huge', 299999999, 1, 'x')").run();
r = await call('/sync/pput', { id: ID, auth: AUTH, pid: 'p3', data: 'xx' }, { ip: newIp() }); ok('фото: место на сервере кончилось → 507', r.s === 507 && /full/.test(r.j.error.message), r.j);
db._db.prepare("DELETE FROM photos WHERE pid = 'huge'").run();
r = await call('/sync/delete', { id: ID, auth: BAD }, { ip: newIp() }); ok('удаление чужим токеном → 403', r.s === 403);
r = await call('/sync/get', { id: ID, auth: AUTH }, { ip: newIp() }); ok('после чужой попытки хозяйство на месте', r.s === 200);
r = await call('/sync/delete', { id: ID, auth: AUTH }, { ip: newIp() }); ok('удаление своим токеном', r.s === 200);
r = await call('/sync/get', { id: ID, auth: AUTH }, { ip: newIp() }); ok('после удаления → 404', r.s === 404);
ok('вместе с хозяйством удалены и его фото', db._db.prepare('SELECT COUNT(*) AS n FROM photos WHERE fid = ?').get(ID).n === 0);
// на сервере только хеш токена и зашифрованная строка
const rows = db._db.prepare('SELECT * FROM farms').all();
ok('в базе нет токенов в открытом виде', rows.every((x) => x.ah !== AUTH && x.rh !== VIEW && /^[0-9a-f]{64}$/.test(x.ah) && /^[0-9a-f]{64}$/.test(x.rh)), rows.map((x) => Object.keys(x).join(',')));
// лимиты
const ipA = newIp(); let codes = []; for (let i = 0; i < 125; i++) codes.push((await call('/sync/head', { id: 'd'.repeat(16), auth: AUTH }, { ip: ipA })).s);
ok('лимит 120 запросов в минуту с адреса', codes.filter((c) => c === 200).length === 120 && codes.filter((c) => c === 429).length === 5, [codes.filter((c) => c === 200).length, codes.filter((c) => c === 429).length]);
const ipB = newIp(); codes = []; for (let i = 0; i < 22; i++) codes.push((await call('/sync/create', { id: (i + 100).toString(16).padStart(16, '0'), auth: AUTH, rauth: VIEW, data: 'x' }, { ip: ipB })).s);
ok('лимит 20 новых хозяйств в сутки с адреса', codes.filter((c) => c === 200).length === 20 && codes.slice(20).every((c) => c === 429), codes.slice(18));
// сбой базы
db._fail(true); r = await call('/sync/get', { id: 'd'.repeat(16), auth: AUTH }, { ip: newIp() }); ok('сбой базы → 503', r.s === 503); db._fail(false);
r = await call('/sync/get', { id: 'd'.repeat(16), auth: AUTH }, { ip: newIp() }); ok('после сбоя снова работает', r.s === 200);
// ИИ-посредник не сломан
let up = ''; globalThis.fetch = async (u, init) => { up = u + ' key=' + init.headers['x-goog-api-key']; return new Response('{"candidates":[]}', { status: 200, headers: { 'Content-Type': 'application/json' } }); };
r = await call('/?model=gemini-3.5-flash', { contents: [] }, { ip: newIp() }); ok('ИИ-посредник работает как раньше', r.s === 200 && /gemini-3\.5-flash:generateContent key=K$/.test(up), up);
console.log(fails ? 'FAILED ' + fails : 'ALL OK');
