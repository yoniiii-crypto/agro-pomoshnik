// Кто правил запись, окна опрыскивания у задач, задачи консультанта из всех хозяйств.
// Нужен Playwright. Запуск: NODE_PATH=$(npm root -g) node tests/ui-tasks.test.js
const { chromium } = require('playwright'); const fs = require('fs'), http = require('http'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const web = http.createServer((rq, rs) => { const f = path.join(ROOT, decodeURIComponent(new URL(rq.url, 'http://x').pathname)); if (!f.startsWith(ROOT + '/') || !fs.existsSync(f)) { rs.writeHead(404); return rs.end(); } rs.writeHead(200, { 'Content-Type': f.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/javascript' }); fs.createReadStream(f).pipe(rs); });
let fails = 0; const ok = (n, c, x) => { if (!c) fails++; console.log((c ? 'ok  ' : 'FAIL') + ' ' + n + (!c && x !== undefined ? ' | ' + JSON.stringify(x) : '')); };
(async () => {
  await new Promise((r) => web.listen(0, '127.0.0.1', r)); const APP = 'http://127.0.0.1:' + web.address().port + '/index.html';
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
  await ctx.route(/open-meteo|workers\.dev/, (r) => r.abort());
  await ctx.addInitScript(() => { if (localStorage.getItem('agro_onb_v1') == null) { localStorage.setItem('agro_onb_v1', '1'); const now = Date.now(), meta = (id) => JSON.stringify({ v: 1, code: 'ABCDEFGHJKMNPQRSTVW' + id, id: '0123456789abcde' + id, ro: 0, h: { agro_diary_v1: { 1: 'x', 2: 'y' } }, s: {}, d: {}, tag: '0123456789abcdef', last: now });
    localStorage.setItem('agro_farms_v1', JSON.stringify({ list: [{ id: 'f1', name: 'КХ «Береке»' }, { id: 'f2', name: 'ТОО «Жер-Ана»' }], cur: 'f1' }));
    localStorage.setItem('agro_diary_v1', JSON.stringify([{ id: 1, f: 'Поле 7', d: '2026-11-14', o: 'Осмотр поля', cr: 'Пшеница', c: 0, y: 0, p: '', n: 'бурые пятна', by: 'Фермер Ахмет' }, { id: 2, f: 'Поле 8', d: '2026-11-14', o: 'Осмотр поля', cr: 'Рапс', c: 0, y: 0, p: '', n: 'без замечаний', by: 'Фермер Ахмет' }]));
    localStorage.setItem('agro_sync_v1', meta('1')); localStorage.setItem('agro_sync_v1@f2', meta('2')); localStorage.setItem('agro_me_v1', 'Агроном Ерлан');
    localStorage.setItem('agro_tasks_v1@f2', JSON.stringify([{ id: 77, d: '2026-11-20', o: 'Осмотр поля', f: 'Поле 9', n: 'Осмотреть озимые', done: 0, to: 'агроном ерлан', by: 'Фермер Болат' }])); } });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(APP); await p.waitForTimeout(500);
  // 1. кто правил запись
  await p.evaluate(() => tab('D')); await p.click('.edt[data-ed="1"]'); await p.waitForTimeout(250); await p.fill('#dNote', 'бурые пятна, септориоз подтверждён'); await p.click('#dAdd'); await p.waitForTimeout(200);
  await p.click('.edt[data-ed="2"]'); await p.waitForTimeout(250); await p.click('#dAdd'); await p.waitForTimeout(200);
  const ed = await p.evaluate(() => D.map((e) => [e.id, e.by, e.eb || '', !!e.et]));
  ok('правка подписана редактором, автор записи сохранён; сохранение без изменений не подписывается', ed[0][1] === 'Фермер Ахмет' && ed[0][2] === 'Агроном Ерлан' && ed[0][3] && ed[1][2] === '', ed);
  ok('в дневнике видно правку', /правка: Агроном Ерлан, \d\d\.\d\d\.\d{4} \d\d:\d\d/.test(await p.textContent('#dList')));
  // 2. окна опрыскивания у задачи
  await p.evaluate(() => { const d1 = iso(new Date(Date.now() + DD)), d2 = iso(new Date(Date.now() + 2 * DD)), h = { time: [], wind_speed_10m: [], temperature_2m: [], relative_humidity_2m: [], precipitation: [] };
    [d1, d2].forEach((d, k) => { for (let i = 0; i < 24; i++) { h.time.push(d + 'T' + String(i).padStart(2, '0') + ':00'); const good = k === 0 && i >= 6 && i <= 10; h.wind_speed_10m.push(good ? 2 : 8); h.temperature_2m.push(15); h.relative_humidity_2m.push(60); h.precipitation.push(0); } });
    WX = Object.assign({}, WX || {}, { h }); TK.push({ id: 501, d: d1, o: 'Защита растений', f: 'Поле 7', n: 'Фунгицид по септориозу', done: 0 }, { id: 502, d: d2, o: 'Защита растений', f: 'Поле 8', n: 'Гербицид', done: 0 }); saveTK(); tab('K'); });
  const cal = await p.textContent('#calL');
  ok('у задачи опрыскивания — окна по прогнозу, у другой — предупреждение', /Окна для опрыскивания: 06:00–11:00/.test(cal) && /окон для опрыскивания нет/.test(cal), cal.slice(0, 500));
  await p.evaluate(() => tab('H')); await p.waitForTimeout(200); ok('и на «Сводке» в задачах недели', /Окна для опрыскивания: 06:00–11:00/.test(await p.textContent('#hTask')));
  // 3. задачи консультанта из всех хозяйств
  const hf = await p.textContent('#hFarms');
  ok('в «Моих хозяйствах» задача из другого хозяйства', /Задачи для вас во всех хозяйствах/.test(hf) && /Осмотреть озимые/.test(hf) && /ТОО «Жер-Ана»/.test(hf) && /автор: Фермер Болат/.test(hf), hf);
  await (await p.$('#hFarms')).screenshot({ path: require('os').tmpdir() + '/shot_hft.png' });
  await p.click('#hFarms [data-hft="0"]'); await p.waitForTimeout(400);
  const f2 = await p.evaluate(() => ({ t: lsJ('agro_tasks_v1', 'f2', [])[0], d: lsJ('agro_diary_v1', 'f2', []) }));
  ok('отмечено выполненным в том хозяйстве: кто выполнил и запись в его дневнике', f2.t.done > 0 && f2.t.dby === 'Агроном Ерлан' && f2.d.length === 1 && f2.d[0].f === 'Поле 9' && f2.d[0].by === 'Агроном Ерлан' && FARMS_cur_ok(), f2);
  function FARMS_cur_ok() { return true; }
  ok('текущее хозяйство не переключилось, список обновился', await p.evaluate(() => FARMS.cur === 'f1') && !/Осмотреть озимые/.test(await p.textContent('#hFarms')) && /Готово: «Осмотреть озимые» \(ТОО «Жер-Ана»\)/.test(await p.textContent('#toastT')));
  ok('ошибок нет', errs.length === 0, errs);
  console.log(fails ? 'FAILED ' + fails : 'ALL OK'); await b.close(); web.close();
})();
