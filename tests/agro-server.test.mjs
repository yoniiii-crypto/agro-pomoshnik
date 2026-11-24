// «Агрономы онлайн» на сервере: анкета → проверка → каталог → заказ → оплата → ответ → оценка → выплата.
// Запуск: node tests/agro-server.test.mjs
import worker from '../server/ai-proxy-worker.js';
import { fakeD1 } from './fake-d1.mjs';
const site = 'https://yoniiii-crypto.github.io';
const db = fakeD1();
const ADMIN = 'admin-secret-for-tests-only';
const env = { GEMINI_KEY: 'K', AGRO_DB: db, AGRO_ADMIN: ADMIN };
let ipn = 0; const newIp = () => '10.1.' + (++ipn >> 8) + '.' + (ipn & 255);
const call = async (path, body, o = {}) => {
  const r = await worker.fetch(new Request('https://agro-ai.example.workers.dev' + path, {
    method: 'POST', headers: { Origin: site, 'Content-Type': 'application/json', 'CF-Connecting-IP': o.ip || newIp() },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }), o.env || env);
  let j = null; try { j = await r.json(); } catch (e) {}
  return { s: r.status, j };
};
let fails = 0; const ok = (name, cond, extra) => { if (!cond) fails++; console.log((cond ? 'ok  ' : 'FAIL') + ' ' + name + (!cond && extra !== undefined ? ' | ' + JSON.stringify(extra) : '')); };

let r = await call('/agro/hello', {}, { env: { GEMINI_KEY: 'K' } });
ok('hello без базы: on=false, комиссия 10 %', r.s === 200 && r.j.on === false && r.j.fee === 10 && r.j.pay === 'manual', r.j);
r = await call('/agro/list', {}, { env: { GEMINI_KEY: 'K' } }); ok('без базы каталог → 501', r.s === 501);
r = await call('/agro/hello', {}, { env: { ...env, AGRO_FEE_PCT: '15' } }); ok('комиссию можно поменять переменной', r.j.fee === 15 && r.j.on === true && r.j.admin === true, r.j);

const APP = { name: 'Айгерим Агроном', region: 'Костанайская', crops: 'пшеница, ячмень, рапс', exp: 12, price: 15000, fmt: 'чат, звонок', about: 'Защита зерновых', phone: '+7 700 000 0000' };
r = await call('/agro/apply', { ...APP, phone: 'abc' }); ok('анкета с плохим телефоном → 400', r.s === 400);
r = await call('/agro/apply', { ...APP, price: 10 }); ok('анкета с ценой ниже минимума → 400', r.s === 400);
r = await call('/agro/apply', APP); ok('анкета принята, выданы номер и код агронома', r.s === 200 && /^[0-9a-f]{16}$/.test(r.j.id) && /^[0-9a-f]{64}$/.test(r.j.token), r.j);
const A = r.j;
const row = db._db.prepare('SELECT th, st FROM agros WHERE id = ?').get(A.id);
ok('на сервере хеш кода, а не сам код; статус «на проверке»', row.th !== A.token && row.th.length === 64 && row.st === 'wait', row);
r = await call('/agro/list', {}); ok('до проверки агронома нет в каталоге', r.s === 200 && r.j.list.length === 0);
r = await call('/agro/order', { aid: A.id, q: 'Что с пшеницей?', phone: '+77001112233' }); ok('заказ непроверенному агроному → 404', r.s === 404);

r = await call('/agro/admin/list', { key: 'wrong' }); ok('чужой ключ администратора → 403', r.s === 403);
r = await call('/agro/admin/list', { key: ADMIN }, { env: { GEMINI_KEY: 'K', AGRO_DB: db } }); ok('без секрета AGRO_ADMIN админка закрыта → 501', r.s === 501);
r = await call('/agro/admin/list', { key: ADMIN }); ok('админ видит анкету с телефоном', r.s === 200 && r.j.agros.length === 1 && r.j.agros[0].phone === APP.phone && r.j.agros[0].st === 'wait', r.j);
r = await call('/agro/admin/approve', { key: ADMIN, id: A.id }); ok('админ одобрил анкету', r.s === 200);
r = await call('/agro/list', {});
const card = r.j.list[0];
ok('в каталоге: имя, регион, цена; телефона нет', r.j.list.length === 1 && card.name === APP.name && card.price === 15000 && !('phone' in card) && !('th' in card), card);

r = await call('/agro/order', { aid: A.id, q: 'Ок', phone: '+77001112233' }); ok('слишком короткий вопрос → 400', r.s === 400);
r = await call('/agro/order', { aid: A.id, q: 'Пятна на листьях пшеницы, что это?', ctx: 'Поле 3: пшеница, 510 га', name: 'Фермер', phone: '+7 701 111 2233', lang: 'kk' });
ok('заказ создан: цена агронома и комиссия 10 % из неё', r.s === 200 && r.j.price === 15000 && r.j.fee === 1500 && r.j.st === 'pay' && /^[0-9a-f]{64}$/.test(r.j.token), r.j);
const O = r.j;
r = await call('/agro/me', { id: A.id, token: A.token });
ok('агроном не видит неоплаченный заказ', r.s === 200 && r.j.orders.length === 0 && r.j.me.st === 'ok', r.j);
r = await call('/agro/answer', { id: A.id, token: A.token, oid: O.id, text: 'Похоже на ржавчину' }); ok('ответить до оплаты нельзя → 409', r.s === 409);
r = await call('/agro/status', { id: O.id, token: O.token }); ok('фермер видит: ожидает оплаты, имя агронома', r.s === 200 && r.j.st === 'pay' && r.j.agro === APP.name && r.j.ans === '', r.j);
r = await call('/agro/status', { id: O.id, token: 'f'.repeat(64) }); ok('чужой код заказа → 403', r.s === 403);

r = await call('/agro/admin/paid', { key: ADMIN, id: O.id }); ok('админ отметил оплату', r.s === 200);
r = await call('/agro/admin/paid', { key: ADMIN, id: O.id }); ok('повторная отметка оплаты → 409', r.s === 409);
r = await call('/agro/me', { id: A.id, token: A.token });
const inbox = r.j.orders;
ok('после оплаты агроном видит вопрос и данные поля, без телефона и имени фермера', inbox.length === 1 && inbox[0].q.includes('Пятна') && inbox[0].ctx.includes('Поле 3') && inbox[0].lang === 'kk' && !('phone' in inbox[0]) && !('name' in inbox[0]), inbox);
r = await call('/agro/me', { id: A.id, token: 'f'.repeat(64) }); ok('чужой код агронома → 403', r.s === 403);
r = await call('/agro/answer', { id: A.id, token: A.token, oid: O.id, text: 'Бурая ржавчина. Проверьте нижние листья, при поражении выше порога — фунгицид из Госреестра.' });
ok('агроном ответил', r.s === 200);
r = await call('/agro/status', { id: O.id, token: O.token }); ok('фермер видит ответ', r.j.st === 'done' && /ржавчина/.test(r.j.ans), r.j);
r = await call('/agro/rate', { id: O.id, token: O.token, stars: 5 }); ok('оценка 5', r.s === 200);
r = await call('/agro/rate', { id: O.id, token: O.token, stars: 1 }); ok('вторая оценка того же заказа → 409', r.s === 409);
r = await call('/agro/answer', { id: A.id, token: A.token, oid: O.id, text: 'Другой ответ после оценки' }); ok('поменять ответ после ответа нельзя → 409', r.s === 409);
r = await call('/agro/status', { id: O.id, token: O.token }); ok('у фермера остался первый ответ', /ржавчина/.test(r.j.ans), r.j);
r = await call('/agro/list', {}); ok('рейтинг агронома в каталоге', r.j.list[0].rate === 5 && r.j.list[0].rn === 1, r.j.list[0]);
r = await call('/agro/admin/payout', { key: ADMIN, id: O.id }); ok('админ отметил выплату агроному', r.s === 200);
r = await call('/agro/admin/list', { key: ADMIN });
const ao = r.j.orders[0];
ok('в админке у заказа: телефон фермера, комиссия, выплата', ao.phone === '+7 701 111 2233' && ao.fee === 1500 && ao.po === 1 && ao.st === 'done' && ao.an === APP.name, ao);

r = await call('/agro/update', { id: A.id, token: A.token, price: 20000, about: 'Новое описание', fmt: 'чат' }); ok('агроном поменял цену', r.s === 200);
r = await call('/agro/order', { aid: A.id, q: 'Когда сеять рапс?', phone: '+77001112233' });
ok('новый заказ по новой цене, старый не изменился', r.j.price === 20000 && r.j.fee === 2000, r.j);
r = await call('/agro/admin/cancel', { key: ADMIN, id: r.j.id }); ok('админ отменил неоплаченный заказ', r.s === 200);
r = await call('/agro/admin/reject', { key: ADMIN, id: A.id }); ok('админ снял агронома с каталога', r.s === 200);
r = await call('/agro/list', {}); ok('снятого агронома нет в каталоге', r.j.list.length === 0);

{ const aip = '10.201.0.1'; let a = null;
  for (let i = 0; i < 11; i++) a = await call('/agro/admin/list', { key: 'wrong-' + i }, { ip: aip });
  ok('подбор ключа администратора: после 10 неверных попыток → 429', a.s === 429, a);
  a = await call('/agro/admin/list', { key: ADMIN }, { ip: aip }); ok('и даже верный ключ с этого адреса ждёт час', a.s === 429);
  a = await call('/agro/admin/list', { key: 'short-key' }, { env: { GEMINI_KEY: 'K', AGRO_DB: db, AGRO_ADMIN: 'short-key' } }); ok('короткий ключ администратора на сервере не принимается → 501', a.s === 501); }
const ip = '10.200.0.1'; let last = null;
for (let i = 0; i < 6; i++) last = await call('/agro/apply', { ...APP, name: 'Агроном ' + i }, { ip });
ok('больше 5 анкет в сутки с одного адреса → 429', last.s === 429);
r = await call('/agro/nope', {}); ok('неизвестный адрес → 404', r.s === 404);
r = await call('/agro/apply', 'not json'); ok('битый JSON → 400', r.s === 400);
db._fail(true); r = await call('/agro/list', {}); db._fail(false); ok('база недоступна → 503', r.s === 503);
r = await call('/agro/list', {}); ok('после сбоя база снова работает', r.s === 200);

console.log(fails ? 'FAILED ' + fails : 'ALL OK');
process.exit(fails ? 1 : 0);
