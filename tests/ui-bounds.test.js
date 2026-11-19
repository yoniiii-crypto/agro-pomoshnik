// Граница поля: замер по GPS сохраняет контур, страница поля показывает его и координаты для карты.
// Нужен Playwright. Запуск: NODE_PATH=$(npm root -g) node tests/ui-bounds.test.js
const { chromium } = require('playwright'); const fs = require('fs'), http = require('http'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const web = http.createServer((rq, rs) => { const f = path.join(ROOT, decodeURIComponent(new URL(rq.url, 'http://x').pathname)); if (!f.startsWith(ROOT + path.sep) || !fs.existsSync(f) || !fs.statSync(f).isFile()) { rs.writeHead(404); return rs.end(); } rs.writeHead(200, { 'Content-Type': f.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/javascript' }); fs.createReadStream(f).pipe(rs); });
let fails = 0; const ok = (n, c, x) => { if (!c) fails++; console.log((c ? 'ok  ' : 'FAIL') + ' ' + n + (!c && x !== undefined ? ' | ' + JSON.stringify(x) : '')); };
(async () => {
  await new Promise((r) => web.listen(0, '127.0.0.1', r)); const APP = 'http://127.0.0.1:' + web.address().port + '/index.html';
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
  await ctx.route(/open-meteo|workers\.dev/, (r) => r.abort());
  await ctx.addInitScript(() => { if (localStorage.getItem('agro_onb_v1') == null) { localStorage.setItem('agro_onb_v1', '1');
    localStorage.setItem('agro_diary_v1', JSON.stringify([{ id: 1, f: 'Поле 1', d: '2026-05-10', o: 'Сев или посадка', cr: 'Яровая пшеница', c: 0, y: 0, p: '', n: '' }, { id: 2, f: 'Поле 2', d: '2026-05-11', o: 'Сев или посадка', cr: 'Ячмень', c: 0, y: 0, p: '', n: '' }])); } });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(APP); await p.waitForTimeout(400);
  await p.evaluate(() => { CURF = 'Поле 1'; tab('G'); gSeg('o'); });
  ok('без границы — подсказка и кнопка «Замерить границу»', /Обойдите поле по краю/.test(await p.textContent('#gMap')) && !!(await p.$('#gMapGo')));
  await p.click('#gMapGo'); await p.waitForTimeout(150);
  await p.evaluate(() => { CZ.gp = [[52.7, 63.6], [52.702, 63.6], [52.702, 63.603], [52.7, 63.603]]; renderGps(); });
  ok('кнопка ведёт к замеру по GPS, поле уже выбрано', await p.evaluate(() => CUR === 'Z' && !!document.getElementById('zGps').offsetParent && document.getElementById('zgF').value === 'Поле 1'));
  await p.selectOption('#zgF', 'Поле 1'); await p.click('#zgSave'); await p.waitForTimeout(100);
  const st = await p.evaluate(() => ({ a: AR['Поле 1'], b: BND['Поле 1'], ls: JSON.parse(localStorage.getItem(FK('agro_bounds_v1')))['Поле 1'].length }));
  ok('замер сохранил площадь и границу', st.a > 4 && st.a < 5 && st.b.length === 4 && st.ls === 4, st);
  await p.evaluate(() => { CURF = 'Поле 1'; tab('G'); gSeg('o'); }); await p.waitForTimeout(100);
  const gm = await p.textContent('#gMap');
  ok('на странице поля контур, площадь по границе, периметр и центр', !!(await p.$('#gMap svg polygon')) && /га по границе/.test(gm) && /периметр [\d\s]+ м/.test(gm) && /центр 52\.70100,63\.60150/.test(gm), gm);
  await (await p.$('#gMap')).screenshot({ path: require('os').tmpdir() + '/shot_bounds.png' });
  await p.click('#gMapSh'); await p.waitForTimeout(300); ok('координаты отправляются ссылкой на карту', /Поле 1, [\d,]+ га: https:\/\/www\.google\.com\/maps\?q=52\.70100,63\.60150/.test(await p.inputValue('#gMapOut')));
  await p.fill('#gNm', 'Поле 1 · Северное'); await p.click('#gNmS'); await p.waitForTimeout(100); if (await p.isVisible('#dlgOk')) { await p.click('#dlgOk'); await p.waitForTimeout(100); }
  ok('при переименовании поля граница переезжает', await p.evaluate(() => !BND['Поле 1'] && BND['Поле 1 · Северное'] && BND['Поле 1 · Северное'].length === 4));
  await p.evaluate(() => { tab('Z', 'zGps'); CZ.gp = [[52.71, 63.61], [52.712, 63.61], [52.712, 63.613], [52.71, 63.613]]; renderGps(); }); await p.selectOption('#zgF', 'Поле 2'); await p.click('#zgSave'); await p.waitForTimeout(100);
  await p.click('#toastB'); ok('«Вернуть» отменяет и площадь, и границу', await p.evaluate(() => !AR['Поле 2'] && !BND['Поле 2']));
  ok('ошибок нет', errs.length === 0, errs);
  console.log(fails ? 'FAILED ' + fails : 'ALL OK'); await b.close(); web.close();
})();
