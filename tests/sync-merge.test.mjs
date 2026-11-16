// Общая база: проверка слияния. Ядро берётся прямо из index.html (между метками SYNC-CORE-BEGIN и SYNC-CORE-END).
// Запуск: node tests/sync-merge.test.mjs
import { readFileSync } from 'node:fs';
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const a0 = html.indexOf('/* SYNC-CORE-BEGIN'), a1 = html.indexOf('/* SYNC-CORE-END */');
if (a0 < 0 || a1 < 0) { console.log('FAIL: ядро не найдено в index.html'); process.exit(1); }
const EXP = ';return {syncStamp,syncMerge,sCanon,syncAdopt,syncOut,syncNorm,syncFmt,sFlat,sUnflat,sHash,sWithU,SYNC_KEYS,SYNC_TOMBS}';
const C = new Function(html.slice(a0, a1) + EXP)();
let fails = 0; const ok = (name, cond, extra) => { if (!cond) fails++; console.log((cond ? 'ok  ' : 'FAIL') + ' ' + name + (extra !== undefined && !cond ? ' | ' + JSON.stringify(extra) : '')); };
const copy = (x) => JSON.parse(JSON.stringify(x));
const D = 'agro_diary_v1', TK = 'agro_tasks_v1', AR = 'agro_fields_v1', PR = 'agro_prices_v1', NM = 'agro_norms_v1', RG = 'agro_region_v1', LOC = 'agro_loc_v1';

// Модель: телефон = строки в памяти браузера + служебные метки; сервер = одна общая реплика
let T = 1000; // «настоящее» время
const dev = (name, skew = 0) => ({ raw: {}, name, meta: {}, skew });
const now = (d) => Math.max(T + d.skew, (d.meta.mx || 0) + 1);
const get = (d, k, def) => d.raw[k] == null ? def : JSON.parse(d.raw[k]);
const put = (d, k, v) => { d.raw[k] = JSON.stringify(v); T += 7; };
const add = (d, e, k = D) => { const a = get(d, k, []); a.push(e); put(d, k, a); };
const edit = (d, id, fn, k = D) => { const a = get(d, k, []); a.forEach((e) => { if (e.id === id) fn(e); }); put(d, k, a); };
const del = (d, id, k = D) => { put(d, k, get(d, k, []).filter((e) => e.id !== id)); };
const ids = (d, k = D) => get(d, k, []).map((e) => e.id).sort((x, y) => x - y).join(',');
const create = (d, srv) => { const st = C.syncStamp(d.raw, d.name, d.meta, now(d)); srv.blob = copy(st.rep); C.syncAdopt(d.meta, st.rep); };
const join = (d, srv) => { const R = copy(srv.blob); Object.assign(d.raw, C.syncOut(R)); d.name = R.n[0]; C.syncAdopt(d.meta, R); };
const sync = (d, srv, o = {}) => { // один шаг синхронизации телефона
  T += 3; const st = C.syncStamp(d.raw, d.name, d.meta, now(d)); const R = copy(o.stale || srv.blob); const M = C.syncMerge(st.rep, R);
  const toR = C.sCanon(M, true) !== C.sCanon(R, true), toL = st.fix || C.sCanon(M, false) !== C.sCanon(st.rep, false);
  if (toR && !o.noPush) srv.blob = copy(M);
  if (toL) { Object.assign(d.raw, C.syncOut(M)); d.name = M.n[0]; }
  C.syncAdopt(d.meta, M); return { toR, toL };
};
const same = (...ds) => ds.every((d) => C.sCanon(C.syncStamp(copy(d.raw), d.name, copy(d.meta), 1).rep, false) === C.sCanon(C.syncStamp(copy(ds[0].raw), ds[0].name, copy(ds[0].meta), 1).rep, false));

// 1. Создание и подключение
{ const A = dev('КХ Береке'), B = dev('Общее хозяйство'), S = {};
  put(A, D, [{ id: 1, f: 'Поле 1', o: 'Сев', c: 100 }, { id: 2, f: 'Поле 2', o: 'Уборка', y: 50 }]); put(A, AR, { 'Поле 1': 420 }); A.raw[LOC] = 'Костанайская'; put(A, RG, { o: 'Костанайская', lat: 52.7 });
  create(A, S); join(B, S);
  ok('подключённый телефон получает записи, поля, регион и название', ids(B) === '1,2' && get(B, AR, {})['Поле 1'] === 420 && B.raw[LOC] === 'Костанайская' && get(B, RG).lat === 52.7 && B.name === 'КХ Береке');
  // 2. Правки с двух сторон
  add(B, { id: 3, f: 'Поле 1', o: 'Осмотр' }); edit(A, 1, (e) => { e.c = 250; });
  sync(A, S); sync(B, S); sync(A, S);
  ok('запись с одного телефона и правка с другого сходятся', ids(A) === '1,2,3' && ids(B) === '1,2,3' && get(B, D).find((e) => e.id === 1).c === 250 && same(A, B));
  const r = sync(A, S); ok('повторная синхронизация ничего не меняет', !r.toR && !r.toL);
  // 3. Удаление и правка разных записей
  del(A, 2); edit(B, 3, (e) => { e.n = 'ржавчина'; }); sync(B, S); sync(A, S); sync(B, S);
  ok('удаление приходит на другой телефон, чужая правка цела', ids(A) === '1,3' && ids(B) === '1,3' && get(A, D).find((e) => e.id === 3).n === 'ржавчина');
  // 4. Удаление против правки одной записи: побеждает более позднее
  del(A, 1); T += 1000; edit(B, 1, (e) => { e.c = 999; }); sync(A, S); sync(B, S); sync(A, S);
  ok('правка позже удаления: запись остаётся с правкой', ids(A) === '1,3' && get(A, D).find((e) => e.id === 1).c === 999 && same(A, B));
  edit(B, 3, (e) => { e.n = 'x'; }); T += 1000; del(A, 3); sync(B, S); sync(A, S); sync(B, S);
  ok('удаление позже правки: запись удалена у всех', ids(A) === '1' && ids(B) === '1');
  // 5. Одновременная правка одной записи: у обоих один и тот же итог, побеждает более поздняя
  edit(A, 1, (e) => { e.n = 'от A'; }); T += 500; edit(B, 1, (e) => { e.n = 'от B'; }); sync(A, S); sync(B, S); sync(A, S);
  ok('одновременная правка: побеждает более поздняя, итог одинаковый', get(A, D)[0].n === 'от B' && get(B, D)[0].n === 'от B');
  // 6. Отмена удаления (та же запись возвращается с тем же номером)
  const keep = get(A, D)[0]; del(A, 1); sync(A, S); sync(B, S); ok('удалили — у второго тоже нет', ids(B) === '');
  add(A, keep); sync(A, S); sync(B, S); ok('вернули запись с тем же номером — она снова у всех', ids(A) === '1' && ids(B) === '1');
}
// 7. Словари и значения
{ const A = dev('Х'), B = dev('Х'), S = {}; put(A, AR, { p1: 100, p2: 200 }); put(A, PR, { пшеница: 90000 }); put(A, NM, { y: { пшеница: 14 }, r: {}, n: {}, m: {}, pt: {} }); create(A, S); join(B, S);
  const ar = get(A, AR); ar.p1 = 150; delete ar.p2; put(A, AR, ar); const pr = get(B, PR); pr.ячмень = 72000; put(B, PR, pr);
  const na = get(A, NM); na.y.ячмень = 12; put(A, NM, na); const nb = get(B, NM); nb.y.горох = 15; nb.pt = { клоп: { t: 2, u: 'm2' } }; put(B, NM, nb);
  put(A, RG, { o: 'Акмолинская' }); T += 100; B.raw[LOC] = 'Туркестанская'; T += 5;
  sync(A, S); sync(B, S); sync(A, S);
  ok('площади: правка и удаление ключа доходят', get(B, AR).p1 === 150 && !('p2' in get(B, AR)));
  ok('цены с другого телефона доходят', get(A, PR).ячмень === 72000 && get(A, PR).пшеница === 90000);
  ok('нормы агронома: правки разных культур не затирают друг друга', get(A, NM).y.ячмень === 12 && get(A, NM).y.горох === 15 && get(A, NM).y.пшеница === 14 && get(A, NM).pt.клоп.t === 2 && same(A, B));
  ok('регион и область саранчи доходят', get(B, RG).o === 'Акмолинская' && A.raw[LOC] === 'Туркестанская');
  A.name = 'КХ «Новое имя»'; T += 10; sync(A, S); sync(B, S); ok('переименование хозяйства доходит', B.name === 'КХ «Новое имя»');
}
// 8. Потерянная запись на сервер не удаляет данные: телефон B затёр версию A устаревшей
{ const A = dev('Х'), B = dev('Х'), S = {}; put(A, D, [{ id: 1 }]); create(A, S); join(B, S);
  const stale = copy(S.blob); add(A, { id: 2, n: 'от A' }); sync(A, S); add(B, { id: 3, n: 'от B' }); sync(B, S, { stale }); // B не видел версию A и записал поверх
  ok('после затирания на сервере нет записи A', !S.blob.l[D].i.some((e) => e.id === 2));
  sync(A, S); ok('телефон A свою запись не потерял и вернул её на сервер', ids(A) === '1,2,3' && S.blob.l[D].i.some((e) => e.id === 2));
  sync(B, S); ok('после этого у всех все записи', ids(B) === '1,2,3' && same(A, B));
}
// 9. Отстающие часы: правка после увиденной чужой правки всё равно новее
{ const A = dev('Х'), B = dev('Х', -3600000), S = {}; put(A, D, [{ id: 1, n: 'a' }]); create(A, S); join(B, S);
  edit(A, 1, (e) => { e.n = 'A позже'; }); sync(A, S); sync(B, S); edit(B, 1, (e) => { e.n = 'B ещё позже'; }); sync(B, S); sync(A, S);
  ok('часы телефона отстают на час, но его более поздняя правка побеждает', get(A, D)[0].n === 'B ещё позже');
}
// 10. Одинаковые номера записей на телефоне: ни одна запись не теряется
{ const A = dev('Х'), B = dev('Х'), S = {}; put(A, D, [{ id: 5, n: 'первая' }, { id: 5, n: 'вторая' }, { id: 7 }]); create(A, S); sync(A, S); join(B, S);
  ok('дубликат номера получил новый номер, записей три', get(A, D).length === 3 && new Set(get(A, D).map((e) => e.id)).size === 3 && get(B, D).length === 3 && get(B, D).some((e) => e.n === 'вторая'), get(A, D));
  const r = sync(A, S); ok('после исправления дубликата телефон спокоен', !r.toL && !r.toR);
}
// 11. Свойства слияния: порядок не важен, повтор ничего не меняет
{ const rnd = (() => { let s = 42; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
  const mk = () => { const d = dev('n' + Math.floor(rnd() * 3)); const n = 3 + Math.floor(rnd() * 6); put(d, D, [...Array(n)].map(() => ({ id: 1 + Math.floor(rnd() * 8), v: Math.floor(rnd() * 5) })).filter((e, i, a) => a.findIndex((x) => x.id === e.id) === i));
    put(d, AR, Object.fromEntries([...Array(4)].map(() => ['p' + Math.floor(rnd() * 5), Math.floor(rnd() * 9)]))); if (rnd() < .6) put(d, RG, { o: 'r' + Math.floor(rnd() * 3) });
    const rep = C.syncStamp(d.raw, d.name, d.meta, 1 + Math.floor(rnd() * 5)).rep; if (rnd() < .5) rep.l[D].d[String(1 + Math.floor(rnd() * 8))] = 1 + Math.floor(rnd() * 5); return copy(rep); };
  let comm = true, idem = true, assoc = true;
  for (let i = 0; i < 400; i++) { const a = mk(), b = mk(), c = mk();
    if (C.sCanon(C.syncMerge(a, b), true) !== C.sCanon(C.syncMerge(b, a), true)) comm = false;
    if (C.sCanon(C.syncMerge(a, a), true) !== C.sCanon(C.syncMerge(C.syncMerge(a, a), a), true)) idem = false;
    if (C.sCanon(C.syncMerge(C.syncMerge(a, b), c), true) !== C.sCanon(C.syncMerge(a, C.syncMerge(b, c)), true)) assoc = false; }
  ok('слияние не зависит от порядка (400 случайных пар)', comm); ok('повторное слияние ничего не меняет', idem); ok('слияние трёх реплик в любом порядке даёт одно и то же', assoc);
}
// 12. Случайная работа трёх телефонов с разными часами: все приходят к одному состоянию, ничего не пропадает само
{ const rnd = (() => { let s = 7; return () => (s = (s * 48271) % 2147483647) / 2147483647; })(); let bad = 0, lost = 0, ghosts = 0;
  for (let run = 0; run < 25; run++) { const S = {}, ds = [dev('Х'), dev('Х', -90000), dev('Х', 40000)]; let nid = 100; const added = new Set(), deleted = new Set();
    put(ds[0], D, [{ id: 1, v: 0 }, { id: 2, v: 0 }]); added.add(1).add(2); put(ds[0], AR, { p1: 1 }); create(ds[0], S); join(ds[1], S); join(ds[2], S);
    for (let op = 0; op < 160; op++) { const d = ds[Math.floor(rnd() * 3)], x = rnd(); T += Math.floor(rnd() * 50);
      if (x < .22) { const id = ++nid; add(d, { id, v: op }, rnd() < .8 ? D : TK); added.add(id); }
      else if (x < .40) { const a = get(d, D, []); if (a.length) edit(d, a[Math.floor(rnd() * a.length)].id, (e) => { e.v = 'e' + op; }); }
      else if (x < .52) { const a = get(d, D, []); if (a.length) { const id = a[Math.floor(rnd() * a.length)].id; del(d, id); deleted.add(id); } }
      else if (x < .60) { const m = get(d, AR, {}); m['p' + Math.floor(rnd() * 6)] = op; put(d, AR, m); }
      else if (x < .64) { const m = get(d, AR, {}); delete m['p' + Math.floor(rnd() * 6)]; put(d, AR, m); }
      else if (x < .68) put(d, RG, { o: 'r' + op });
      else if (x < .70) { d.name = 'имя ' + op; T += 3; }
      else sync(d, S, rnd() < .08 ? { stale: copy(S.blob), noPush: false } : {}); }
    for (let k = 0; k < 3; k++) ds.forEach((d) => sync(d, S));
    if (!same(...ds) || ds.some((d) => sync(d, S).toR)) bad++;
    const fin = new Set([...get(ds[0], D, []), ...get(ds[0], TK, [])].map((e) => e.id));
    added.forEach((id) => { if (!fin.has(id) && !deleted.has(id)) lost++; }); fin.forEach((id) => { if (!added.has(id)) ghosts++; });
    if (process.env.DEBUG && run < 3) console.log('   прогон', run, 'добавлено', added.size, 'удаляли', deleted.size, 'осталось', fin.size, 'полей', Object.keys(get(ds[0], AR, {})).length, 'отметок удаления', Object.keys(S.blob.l[D].d).length); }
  ok('25 прогонов по 160 случайных действий: все телефоны сошлись', bad === 0, { bad });
  ok('ни одна запись не пропала без удаления', lost === 0, { lost }); ok('не появилось записей из ниоткуда', ghosts === 0, { ghosts });
}
// 13. Отметки удаления не растут бесконечно
{ const d = {}; for (let i = 0; i < C.SYNC_TOMBS + 300; i++) d['x' + i] = i; const a = { v: 1, n: ['Х', 1], l: { [D]: { i: [], s: {}, d } }, m: {}, x: {} };
  const M = C.syncMerge(a, copy(a)); ok('хранится не больше ' + C.SYNC_TOMBS + ' отметок удаления, самые свежие', Object.keys(M.l[D].d).length === C.SYNC_TOMBS && M.l[D].d['x' + (C.SYNC_TOMBS + 299)] != null && M.l[D].d.x0 == null);
}
// 14. Код хозяйства
ok('код: дефисы, пробелы, строчные буквы и похожие знаки', C.syncNorm('abcd-efgh jkmn-pqrs-tvwx') === 'ABCDEFGHJKMNPQRSTVWX' && C.syncNorm('O0Il-1234-5678-9ABC-DEFG') === '0011123456789ABCDEFG');
ok('код: неверная длина и чужие знаки отклоняются', C.syncNorm('ABCD') === '' && C.syncNorm('ABCD-EFGH-JKMN-PQRS-TVW!') === '' && C.syncNorm('ABCD-EFGH-JKMN-PQRS-TVWU') === '');
ok('код показывается группами по четыре', C.syncFmt('ABCDEFGHJKMNPQRSTVWX') === 'ABCD-EFGH-JKMN-PQRS-TVWX');
ok('вложенный словарь разворачивается и собирается обратно', JSON.stringify(C.sUnflat(C.sFlat({ y: { a: 1, b: 2 }, r: {}, z: 5 }, 2))) === JSON.stringify({ y: { a: 1, b: 2 }, z: 5 }));
// Совместимость с будущими версиями: новая версия (N) добавила свои данные — ещё один список и значение; старая (O) их не знает, но не теряет
{ const src = html.slice(a0, a1);
  const src2 = src.replace("var SYNC_LISTS=[", "var SYNC_LISTS=['agro_xlist_v1',").replace("var SYNC_VALS={agro_region_v1:'j',agro_loc_v1:'s'};", "var SYNC_VALS={agro_region_v1:'j',agro_loc_v1:'s',agro_future_v1:'s'};");
  ok('модель новой версии собрана', src2 !== src && src2.includes('agro_xlist_v1') && src2.includes('agro_future_v1'));
  const C2 = new Function(src2 + EXP)(), CM = 'agro_xlist_v1', FV = 'agro_future_v1';
  const step = (K, d, srv, o = {}) => { T += 3; const st = K.syncStamp(d.raw, d.name, d.meta, now(d)); K.sWithU(st.rep, d.meta); const R = copy(srv.blob);
    if (o.quick) { srv.blob = copy(st.rep); K.syncAdopt(d.meta, st.rep); return { toR: true, toL: false }; } /* быстрая отправка: на сервере та же версия, что видел телефон */
    const M = K.syncMerge(st.rep, R), toR = K.sCanon(M, true) !== K.sCanon(R, true), toL = st.fix || K.sCanon(M, false) !== K.sCanon(st.rep, false);
    if (toR) srv.blob = copy(M); if (toL) { Object.assign(d.raw, K.syncOut(M)); d.name = M.n[0]; } K.syncAdopt(d.meta, M); return { toR, toL }; };
  const N = dev('КХ Новое'), O = dev('Старое'), S = {}, cms = () => (S.blob.l[CM] ? S.blob.l[CM].i.map((c) => c.t).sort().join('|') : '');
  put(N, D, [{ id: 1, f: 'Поле 1', o: 'Осмотр' }]); put(N, CM, [{ id: 11, e: 1, t: 'это септориоз' }]); N.raw[FV] = 'v1';
  { const st = C2.syncStamp(N.raw, N.name, N.meta, now(N)); S.blob = copy(st.rep); C2.syncAdopt(N.meta, st.rep); }
  { const R = copy(S.blob); Object.assign(O.raw, C.syncOut(R)); O.name = R.n[0]; C.syncAdopt(O.meta, R); }
  ok('старая версия хранит чужие данные в метках, а не в памяти браузера', !(CM in O.raw) && !(FV in O.raw) && !!O.meta.u && O.meta.u.l[CM].i.length === 1 && O.meta.u.x[FV][0] === 'v1');
  add(O, { id: 2, f: 'Поле 2', o: 'Сев' }); step(C, O, S, { quick: true });
  ok('быстрая отправка старой версии не стирает данные новой', cms() === 'это септориоз' && S.blob.x[FV][0] === 'v1' && S.blob.l[D].i.length === 2);
  add(N, { id: 12, e: 1, t: 'обработать фунгицидом' }, CM); N.raw[FV] = 'v2'; T += 7; step(C2, N, S);
  edit(O, 2, (e) => { e.c = 500; }); step(C, O, S);
  ok('слияние в старой версии сохраняет новые комментарии и значение', cms() === 'обработать фунгицидом|это септориоз' && S.blob.x[FV][0] === 'v2' && S.blob.l[D].i.filter((e) => e.c === 500).length === 1);
  const idle = step(C, O, S); ok('без правок старая версия ничего не отправляет и не перезаписывает', !idle.toR && !idle.toL, idle);
  del(N, 11, CM); step(C2, N, S); step(C, O, S); edit(O, 1, (e) => { e.n = 'смотрели вместе'; }); step(C, O, S, { quick: true });
  ok('удаление комментария в новой версии не воскрешает старая', cms() === 'обработать фунгицидом');
  step(C2, N, S); ok('новая версия получила правки старой, у обеих одни и те же записи', ids(N) === ids(O) && get(N, D, []).some((e) => e.n === 'смотрели вместе') && get(N, CM, []).length === 1 && N.raw[FV] === 'v2');
}
console.log(fails ? 'FAILED ' + fails : 'ALL OK');
process.exit(fails ? 1 : 0);
