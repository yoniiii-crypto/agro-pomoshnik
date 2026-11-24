// Телефон: экраны не шире экрана на 320 и 360 px (рус. и каз.), подписи нижнего меню читаемы, «Сменить» легко нажать.
// Нужен Playwright. Запуск: NODE_PATH=$(npm root -g) node tests/ui-phone.test.js
const { chromium } = require('playwright'); const fs = require('fs'), http = require('http'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const web = http.createServer((rq, rs) => { const f = path.join(ROOT, decodeURIComponent(new URL(rq.url, 'http://x').pathname)); if (!f.startsWith(ROOT + path.sep) || !fs.existsSync(f) || !fs.statSync(f).isFile()) { rs.writeHead(404); return rs.end(); } rs.writeHead(200, { 'Content-Type': f.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/javascript' }); fs.createReadStream(f).pipe(rs); });
let fails = 0; const ok = (n, c, x) => { if (!c) fails++; console.log((c ? 'ok  ' : 'FAIL') + ' ' + n + (!c && x !== undefined ? ' | ' + JSON.stringify(x) : '')); };
(async () => {
  await new Promise((r) => web.listen(0, '127.0.0.1', r)); const APP = 'http://127.0.0.1:' + web.address().port + '/index.html';
  const b = await chromium.launch();
  for (const w of [320, 360]) {
    const ctx = await b.newContext({ viewport: { width: w, height: 740 }, serviceWorkers: 'block' });
    await ctx.route(/open-meteo|workers\.dev/, (r) => r.abort());
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(APP + '?demo=1&lang=kk'); await p.waitForTimeout(800);
    for (const lang of ['kk', 'ru']) {
      await p.evaluate((l) => setLang(l), lang); const wide = [];
      for (const k of 'HSYIZRPFDLKCWXM') { await p.evaluate((k) => tab(k), k); const d = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth); if (d > 0) wide.push(k + ':' + d); }
      ok(w + ' px, ' + lang + ': ни один экран не шире телефона', wide.length === 0, wide);
    }
    await p.evaluate(() => tab('H'));
    const fs10 = await p.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.tabbar button')).fontSize)); ok(w + ' px: подписи нижнего меню не мельче 11 px', fs10 >= 11, fs10);
    const h = await p.evaluate(() => { const e = document.getElementById('fbGo'); return e ? e.getBoundingClientRect().height : -1 }); ok(w + ' px: «Сменить» хозяйство высотой не меньше 44 px', h >= 44, h);
    ok(w + ' px: ошибок нет', errs.length === 0, errs); await ctx.close();
  }
  console.log(fails ? 'FAILED ' + fails : 'ALL OK'); await b.close(); web.close();
})();
