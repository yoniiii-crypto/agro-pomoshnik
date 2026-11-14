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
const ID = 'a'.repeat(16), AUTH = 'b'.repeat(64), BAD = 'c'.repeat(64);

let r = await call('/sync/hello', {}, { env: { GEMINI_KEY: 'K' }, ip: newIp() }); ok('hello без базы: sync=false', r.s === 200 && r.j.sync === false, r.j);
r = await call('/sync/get', { id: ID, auth: AUTH }, { env: { GEMINI_KEY: 'K' }, ip: newIp() }); ok('без базы остальные маршруты → 501', r.s === 501);
r = await call('/sync/hello', {}, { ip: newIp() }); ok('hello с базой: sync=true', r.s === 200 && r.j.sync === true && r.j.max > 1e6, r.j);
r = await call('/sync/get', { id: ID, auth: AUTH }, { ip: newIp() }); ok('неизвестное хозяйство → 404', r.s === 404);
r = await call('/sync/create', { id: ID, auth: AUTH, data: 'ENC1' }, { ip: newIp() }); ok('создание', r.s === 200 && /^[0-9a-f]{16}$/.test(r.j.tag), r.j); const t1 = r.j.tag;
r = await call('/sync/create', { id: ID, auth: AUTH, data: 'ENC-X' }, { ip: newIp() }); ok('повторное создание → 409 exists', r.s === 409 && r.j.error.message === 'exists');
r = await call('/sync/get', { id: ID, auth: AUTH }, { ip: newIp() }); ok('чтение', r.s === 200 && r.j.data === 'ENC1' && r.j.tag === t1 && r.j.mt > 0);
r = await call('/sync/get', { id: ID, auth: BAD }, { ip: newIp() }); ok('чужой токен → 403, данных нет', r.s === 403 && !('data' in (r.j || {})));
r = await call('/sync/head', { id: ID, auth: AUTH }, { ip: newIp() }); ok('head: только метка', r.s === 200 && r.j.tag === t1 && !('data' in r.j));
r = await call('/sync/put', { id: ID, auth: AUTH, base: t1, data: 'ENC2' }, { ip: newIp() }); ok('запись с актуальной меткой', r.s === 200 && r.j.tag !== t1, r.j); const t2 = r.j.tag;
r = await call('/sync/put', { id: ID, auth: AUTH, base: t1, data: 'STALE' }, { ip: newIp() }); ok('запись с устаревшей меткой → 409 и текущая метка', r.s === 409 && r.j.tag === t2, r.j);
r = await call('/sync/get', { id: ID, auth: AUTH }, { ip: newIp() }); ok('устаревшая запись ничего не затёрла', r.j.data === 'ENC2' && r.j.tag === t2);
r = await call('/sync/put', { id: ID, auth: BAD, base: t2, data: 'HACK' }, { ip: newIp() }); ok('запись с чужим токеном → 403', r.s === 403);
const both = await Promise.all([call('/sync/put', { id: ID, auth: AUTH, base: t2, data: 'A' }, { ip: newIp() }), call('/sync/put', { id: ID, auth: AUTH, base: t2, data: 'B' }, { ip: newIp() })]);
ok('две одновременные записи: проходит ровно одна', both.filter((x) => x.s === 200).length === 1 && both.filter((x) => x.s === 409).length === 1, both.map((x) => x.s));
r = await call('/sync/put', { id: ID, auth: AUTH, base: 'zz', data: 'A' }, { ip: newIp() }); ok('кривая метка → 400', r.s === 400);
r = await call('/sync/put', { id: ID, auth: AUTH, base: t2 }, { ip: newIp() }); ok('запись без данных → 400', r.s === 400);
r = await call('/sync/create', { id: 'XYZ', auth: AUTH, data: 'x' }, { ip: newIp() }); ok('кривой id → 400', r.s === 400);
r = await call('/sync/get', '{oops', { ip: newIp() }); ok('кривой JSON → 400', r.s === 400);
r = await call('/sync/create', { id: 'd'.repeat(16), auth: AUTH, data: 'x'.repeat(1800001) }, { ip: newIp() }); ok('слишком большое хозяйство → 413', r.s === 413);
r = await call('/sync/create', { id: 'd'.repeat(16), auth: AUTH, data: 'x'.repeat(1800000) }, { ip: newIp() }); ok('ровно лимит проходит', r.s === 200);
r = await call('/sync/nope', { id: ID, auth: AUTH }, { ip: newIp() }); ok('неизвестный маршрут → 404', r.s === 404);
r = await call('/sync/get', { id: ID, auth: AUTH }, { origin: 'https://evil.example', ip: newIp() }); ok('чужой сайт → 403', r.s === 403 && r.j.error.message === 'Origin not allowed');
r = await call('/sync/get', null, { method: 'OPTIONS', ip: newIp() }); ok('preflight → 204', r.s === 204);
r = await call('/sync/delete', { id: ID, auth: BAD }, { ip: newIp() }); ok('удаление чужим токеном → 403', r.s === 403);
r = await call('/sync/get', { id: ID, auth: AUTH }, { ip: newIp() }); ok('после чужой попытки хозяйство на месте', r.s === 200);
r = await call('/sync/delete', { id: ID, auth: AUTH }, { ip: newIp() }); ok('удаление своим токеном', r.s === 200);
r = await call('/sync/get', { id: ID, auth: AUTH }, { ip: newIp() }); ok('после удаления → 404', r.s === 404);
// на сервере только хеш токена и зашифрованная строка
const rows = db._db.prepare('SELECT * FROM farms').all();
ok('в базе нет токена в открытом виде', rows.every((x) => x.ah !== AUTH && /^[0-9a-f]{64}$/.test(x.ah)), rows.map((x) => Object.keys(x).join(',')));
// лимиты
const ipA = newIp(); let codes = []; for (let i = 0; i < 125; i++) codes.push((await call('/sync/head', { id: 'd'.repeat(16), auth: AUTH }, { ip: ipA })).s);
ok('лимит 120 запросов в минуту с адреса', codes.filter((c) => c === 200).length === 120 && codes.filter((c) => c === 429).length === 5, [codes.filter((c) => c === 200).length, codes.filter((c) => c === 429).length]);
const ipB = newIp(); codes = []; for (let i = 0; i < 22; i++) codes.push((await call('/sync/create', { id: (i + 100).toString(16).padStart(16, '0'), auth: AUTH, data: 'x' }, { ip: ipB })).s);
ok('лимит 20 новых хозяйств в сутки с адреса', codes.filter((c) => c === 200).length === 20 && codes.slice(20).every((c) => c === 429), codes.slice(18));
// сбой базы
db._fail(true); r = await call('/sync/get', { id: 'd'.repeat(16), auth: AUTH }, { ip: newIp() }); ok('сбой базы → 503', r.s === 503); db._fail(false);
r = await call('/sync/get', { id: 'd'.repeat(16), auth: AUTH }, { ip: newIp() }); ok('после сбоя снова работает', r.s === 200);
// ИИ-посредник не сломан
let up = ''; globalThis.fetch = async (u, init) => { up = u + ' key=' + init.headers['x-goog-api-key']; return new Response('{"candidates":[]}', { status: 200, headers: { 'Content-Type': 'application/json' } }); };
r = await call('/?model=gemini-3.5-flash', { contents: [] }, { ip: newIp() }); ok('ИИ-посредник работает как раньше', r.s === 200 && /gemini-3\.5-flash:generateContent key=K$/.test(up), up);
console.log(fails ? 'FAILED ' + fails : 'ALL OK');
