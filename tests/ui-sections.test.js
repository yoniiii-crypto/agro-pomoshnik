// Разделы экранов: сводка, калькуляторы, нормы, защита растений, тур.
// Нужен Playwright. Запуск: NODE_PATH=$(npm root -g) node tests/ui-sections.test.js
const { chromium } = require('playwright'); const fs = require('fs'), http = require('http'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const web = http.createServer((rq, rs) => { const f = path.join(ROOT, decodeURIComponent(new URL(rq.url, 'http://x').pathname)); if (!f.startsWith(ROOT + '/') || !fs.existsSync(f)) { rs.writeHead(404); return rs.end(); } rs.writeHead(200, { 'Content-Type': f.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/javascript' }); fs.createReadStream(f).pipe(rs); });
let fails = 0; const ok = (n, c, x) => { if (!c) fails++; console.log((c ? 'ok  ' : 'FAIL') + ' ' + n + (!c && x !== undefined ? ' | ' + JSON.stringify(x) : '')); };
(async () => {
  await new Promise((r) => web.listen(0, '127.0.0.1', r)); const APP = 'http://127.0.0.1:' + web.address().port + '/index.html';
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
  await ctx.route(/open-meteo|workers\.dev/, (r) => r.abort());
  await ctx.addInitScript(() => { if (localStorage.getItem('agro_onb_v1') == null) localStorage.setItem('agro_onb_v1', '1'); });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(APP + '?demo=1'); await p.waitForFunction(() => typeof FARMS != 'undefined' && FARMS.cur === 'demo' && D.length > 10, null, { timeout: 15000 });
  await p.waitForTimeout(2000); await p.evaluate(() => { if (TOUR && TOUR.on) tourEnd(); });
  const vis = (id) => p.evaluate((id) => { const e = document.getElementById(id); return !!e && !!e.offsetParent; }, id);
  // калькуляторы
  await p.evaluate(() => tab('Z')); await p.waitForTimeout(150);
  ok('калькуляторы: виден один, остальные спрятаны', await vis('zRoi') && !(await vis('zFert')) && !(await vis('zGps')));
  await p.click('#zSeg [data-sg="fert"]'); ok('нажал «Удобрения» — открыт калькулятор удобрений', await vis('zFert') && !(await vis('zRoi')) && (await p.getAttribute('#zSeg [data-sg="fert"]', 'aria-pressed')) === 'true');
  await p.evaluate(() => tab('H')); await p.evaluate(() => tab('Z', 'zGps')); await p.waitForTimeout(150); ok('ссылка на площадь по GPS открывает свой раздел', await vis('zGps') && !(await vis('zFert')));
  // защита растений
  await p.evaluate(() => tab('W')); ok('защита растений: по умолчанию учёт на площадках', await vis('wdQ') && !(await vis('lcP')) && !(await vis('wdB')));
  await p.click('#wSeg [data-sg="l"]'); ok('саранча — отдельный раздел', await vis('lcP') && !(await vis('wdQ')));
  await p.evaluate(() => tab('W', 'wdQ')); ok('быстрое действие «Учёт на площадках» открывает учёт', await vis('wdQ'));
  // нормы агронома: кнопка из «Закупок»
  await p.evaluate(() => { tab('K'); kSeg('b'); }); await p.click('#snNorms'); await p.waitForTimeout(150);
  ok('«Открыть нормы» ведёт сразу к нормам удобрений', await vis('nmF') && !(await vis('nmY')));
  // сводка
  await p.evaluate(() => { segGo('hSeg', 't'); tab('H'); }); await p.waitForTimeout(150);
  ok('сводка: «Сегодня» — погода, внимание, задачи', await vis('hWx') && await vis('hAtt') && await vis('hTask') && !(await vis('hProf')) && !(await vis('hCrop')));
  await p.click('#hSeg [data-sg="s"]'); ok('«Сезон» — показатели, посевы, прибыль, риск', await vis('hKpi') && await vis('hProf') && await vis('hRisk') && !(await vis('hWx')));
  await p.screenshot({ path: require('os').tmpdir() + '/shot_home_season.png' });
  // тур открывает нужный раздел
  await p.evaluate(() => { segGo('hSeg', 't'); tourStart(0); }); let seen = [];
  for (let i = 0; i < 12; i++) { const st = await p.evaluate(() => { const S = tourSteps(); const st = S[TOUR.i]; return st ? [st.el, !!document.getElementById(st.el) && !!document.getElementById(st.el).offsetParent || st.el == 'navAdd'] : null; }); if (!st) break; seen.push(st); await p.evaluate(() => { TOUR.i++; tourShow(); }); await p.waitForTimeout(80); if (!(await p.evaluate(() => TOUR.on))) break; }
  ok('тур показывает каждый шаг, раздел открывается сам', seen.length >= 8 && seen.every((x) => x[1]) && seen.some((x) => x[0] === 'hProf') && seen.some((x) => x[0] === 'zRoi'), seen);
  await p.evaluate(() => { if (TOUR.on) tourEnd(); });
  // запоминание раздела в пределах сеанса
  await p.evaluate(() => { tab('Z'); segGo('zSeg', 'tank'); }); await p.reload(); await p.waitForTimeout(2200); await p.evaluate(() => { if (TOUR && TOUR.on) tourEnd(); tab('Z'); });
  ok('выбранный раздел калькуляторов запоминается до закрытия вкладки', await vis('zTank'));
  // по-казахски
  await p.evaluate(() => localStorage.setItem('agro_lang_v1', 'kk')); await p.reload(); await p.waitForTimeout(2200); await p.evaluate(() => { if (TOUR && TOUR.on) tourEnd(); tab('Z'); });
  ok('подписи разделов по-казахски', /Тыңайтқыш/.test(await p.textContent('#zSeg')) && /Бүгін/.test(await p.textContent('#hSeg')));
  ok('ошибок нет', errs.length === 0, errs);
  console.log(fails ? 'FAILED ' + fails : 'ALL OK'); await b.close(); web.close();
})();
