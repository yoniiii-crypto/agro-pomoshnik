// Профиль хозяйства для банка и страховой.
// Нужен Playwright. Запуск: NODE_PATH=$(npm root -g) node tests/ui-bank.test.js
const { chromium } = require('playwright'); const fs = require('fs'), http = require('http'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const web = http.createServer((rq, rs) => { const f = path.join(ROOT, decodeURIComponent(new URL(rq.url, 'http://x').pathname)); if (!f.startsWith(ROOT + '/') || !fs.existsSync(f)) { rs.writeHead(404); return rs.end(); } rs.writeHead(200, { 'Content-Type': f.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/javascript' }); fs.createReadStream(f).pipe(rs); });
let fails = 0; const ok = (n, c, x) => { if (!c) fails++; console.log((c ? 'ok  ' : 'FAIL') + ' ' + n + (!c && x !== undefined ? ' | ' + JSON.stringify(x) : '')); };
(async () => {
  await new Promise((r) => web.listen(0, '127.0.0.1', r)); const APP = 'http://127.0.0.1:' + web.address().port + '/index.html';
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 900, height: 1200 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
  await ctx.route(/open-meteo|workers\.dev/, (r) => r.abort());
  await ctx.addInitScript(() => { if (localStorage.getItem('agro_onb_v1') == null) localStorage.setItem('agro_onb_v1', '1'); window.print = () => { window.__printed = (window.__printed || 0) + 1; }; });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(APP + '?demo=1'); await p.waitForFunction(() => typeof FARMS != 'undefined' && FARMS.cur === 'demo' && D.length > 10, null, { timeout: 15000 });
  await p.waitForTimeout(2000); await p.evaluate(() => { if (TOUR && TOUR.on) tourEnd(); });
  const st = await p.evaluate(() => { const B = bankStats(); return { years: B.years, crops: B.C.map((c) => [c.k, c.n, Math.round(c.mean * 10) / 10, c.cv == null ? null : Math.round(c.cv * 100)]), nYears: B.nYears }; });
  console.log(JSON.stringify(st));
  ok('статистика: 5 лет, культуры со средней урожайностью', st.years.length === 5 && st.crops.length > 0 && st.crops.some((c) => c[1] >= 3 && c[2] > 5 && c[2] < 60 && c[3] != null));
  await p.evaluate(() => { PLAN = 'farm'; }); await p.evaluate(() => tab('M')); await p.click('#menu [data-go="bank"]'); await p.waitForTimeout(300);
  ok('пункт меню печатает профиль', await p.evaluate(() => window.__printed === 1 && /Профиль хозяйства для банка и страховой/.test(document.getElementById('printArea').textContent)));
  const txt = await p.textContent('#printArea');
  ok('в профиле есть урожайность, учёт по годам и происхождение данных', /Урожайность по культурам/.test(txt) && /Как ведётся учёт/.test(txt) && /на месте они не проверялись/.test(txt) && !/NaN|undefined/.test(txt), txt.slice(0, 300));
  await p.emulateMedia({ media: 'print' }); await p.screenshot({ path: require('os').tmpdir() + '/shot_bank.png', fullPage: true }); await p.emulateMedia({ media: 'screen' });
  // наблюдатель (банк): кнопка на «Сводке», без тарифа
  await p.evaluate(() => { PLAN = 'free'; localStorage.setItem(syncMetaKey(FARMS.cur), JSON.stringify({ v: 1, code: 'ABCDEFGHJKMNPQRSTVWX', id: '0123456789abcdef', ro: 1, h: {}, s: {}, d: {}, tag: '0123456789abcdef', last: Date.now() })); tab('H'); });
  await p.waitForSelector('#htBank'); await p.click('#htBank'); await p.waitForTimeout(200);
  ok('наблюдатель открывает профиль со «Сводки» без тарифа', await p.evaluate(() => window.__printed === 2 && /коду «только просмотр»/.test(document.getElementById('printArea').textContent)));
  await p.evaluate(() => { localStorage.setItem('agro_lang_v1', 'kk'); }); await p.reload(); await p.waitForTimeout(500); await p.evaluate(() => tab('M'));
  ok('пункт меню по-казахски', /Банк пен сақтандыруға арналған профиль/.test(await p.textContent('#menu')));
  ok('ошибок нет', errs.length === 0, errs);
  console.log(fails ? 'FAILED ' + fails : 'ALL OK'); await b.close(); web.close();
})();
