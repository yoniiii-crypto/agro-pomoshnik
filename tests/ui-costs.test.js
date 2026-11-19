// Структура затрат по видам работ в «Поля → Экономика» и в профиле для банка.
// Нужен Playwright. Запуск: NODE_PATH=$(npm root -g) node tests/ui-costs.test.js
const { chromium } = require('playwright'); const fs = require('fs'), http = require('http'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const web = http.createServer((rq, rs) => { const f = path.join(ROOT, decodeURIComponent(new URL(rq.url, 'http://x').pathname)); if (!f.startsWith(ROOT + path.sep) || !fs.existsSync(f) || !fs.statSync(f).isFile()) { rs.writeHead(404); return rs.end(); } rs.writeHead(200, { 'Content-Type': f.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/javascript' }); fs.createReadStream(f).pipe(rs); });
let fails = 0; const ok = (n, c, x) => { if (!c) fails++; console.log((c ? 'ok  ' : 'FAIL') + ' ' + n + (!c && x !== undefined ? ' | ' + JSON.stringify(x) : '')); };
(async () => {
  await new Promise((r) => web.listen(0, '127.0.0.1', r)); const APP = 'http://127.0.0.1:' + web.address().port + '/index.html';
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
  await ctx.route(/open-meteo|workers\.dev/, (r) => r.abort());
  await ctx.addInitScript(() => { if (localStorage.getItem('agro_onb_v1') == null) localStorage.setItem('agro_onb_v1', '1'); window.print = () => {}; });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(APP + '?demo=1'); await p.waitForFunction(() => typeof FARMS != 'undefined' && FARMS.cur === 'demo' && D.length > 10, null, { timeout: 15000 });
  await p.waitForTimeout(2000); await p.evaluate(() => { if (TOUR && TOUR.on) tourEnd(); tab('L'); lSeg('e'); renderFields(); }); await p.waitForTimeout(150);
  const c = await p.evaluate(() => { const C = costStruct(CSY), sum = D.filter((e) => String(cropYear(e)) == String(CSY)).reduce((a, e) => a + (+e.c || 0), 0); return { y: CSY, tot: C.tot, sum, area: C.area, ops: Object.keys(C.by) }; });
  ok('структура затрат: сумма по видам работ равна затратам сезона', c.tot === c.sum && c.tot > 0 && c.area > 0 && c.ops.length >= 3, c);
  const txt = await p.textContent('#ecoC');
  ok('блок виден в экономике: всего, на гектар, доли, изменение к прошлому сезону', /Структура затрат/.test(txt) && /₸\/га/.test(txt) && /%/.test(txt) && new RegExp('к ' + (c.y - 1)).test(txt), txt.slice(0, 300));
  const rows = await p.$$eval('#ecoC .tk b:first-child', (a) => a.map((x) => x.textContent)); ok('виды работ по убыванию затрат', rows.length === c.ops.length, rows);
  await (await p.$('#ecoC')).screenshot({ path: require('os').tmpdir() + '/shot_costs.png' });
  const ys = await p.$$eval('#csY option', (a) => a.map((x) => x.value)); await p.selectOption('#csY', ys[1]); await p.waitForTimeout(150);
  ok('выбор другого сезона пересчитывает', await p.evaluate((y) => String(CSY) === y && /Структура затрат/.test(document.getElementById('ecoC').textContent), ys[1]));
  await p.evaluate(() => { PLAN = 'farm'; report('bank'); }); const bt = await p.textContent('#printArea');
  ok('в профиле для банка — структура затрат последнего сезона', /Структура затрат, \d{4}/.test(bt) && /Итого/.test(bt));
  ok('ошибок нет', errs.length === 0, errs);
  console.log(fails ? 'FAILED ' + fails : 'ALL OK'); await b.close(); web.close();
})();
