// Офлайн-копия: при медленной сети приложение открывается из копии за ~3 с, без сети и при ошибке сайта — тоже из копии.
// Нужен Playwright. Запуск: NODE_PATH=$(npm root -g) node tests/sw-slow.test.js
const { chromium } = require('playwright'); const fs = require('fs'), http = require('http'), path = require('path');
const ROOT = path.resolve(__dirname, '..'); let MODE = 'ok', hits = 0;
const web = http.createServer((rq, rs) => { const u = new URL(rq.url, 'http://x'); const f = path.join(ROOT, decodeURIComponent(u.pathname === '/' ? '/index.html' : u.pathname)); if (!f.startsWith(ROOT + path.sep) || !fs.existsSync(f) || !fs.statSync(f).isFile()) { rs.writeHead(404); return rs.end(); }
  const send = () => { rs.writeHead(200, { 'Content-Type': f.endsWith('.html') ? 'text/html; charset=utf-8' : f.endsWith('.json') || f.endsWith('.webmanifest') ? 'application/json' : f.endsWith('.png') ? 'image/png' : f.endsWith('.svg') ? 'image/svg+xml' : 'text/javascript', 'Cache-Control': 'no-store' }); fs.createReadStream(f).pipe(rs); };
  if (f.endsWith('index.html')) { hits++; if (MODE === 'slow') return setTimeout(send, 12000); if (MODE === 'err') { rs.writeHead(503); return rs.end('GitHub Pages error'); } }
  send(); });
let fails = 0; const ok = (n, c, x) => { if (!c) fails++; console.log((c ? 'ok  ' : 'FAIL') + ' ' + n + (!c && x !== undefined ? ' | ' + JSON.stringify(x) : '')); };
(async () => {
  await new Promise((r) => web.listen(0, '127.0.0.1', r)); const APP = 'http://127.0.0.1:' + web.address().port + '/index.html';
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.route(/open-meteo|workers\.dev/, (r) => r.abort());
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(APP); await p.evaluate(() => navigator.serviceWorker.ready); await p.reload(); await p.waitForTimeout(500);
  ok('офлайн-копия включилась', await p.evaluate(() => !!navigator.serviceWorker.controller));
  MODE = 'slow'; let t0 = Date.now(); await p.reload({ waitUntil: 'domcontentloaded' }); let dt = Date.now() - t0;
  ok('медленная сеть: открылось из копии быстрее 6 с', dt < 6000 && await p.evaluate(() => typeof tab == 'function'), dt);
  MODE = 'ok'; await p.waitForTimeout(500);
  MODE = 'err'; await p.reload(); ok('сайт отвечает ошибкой: открылась копия', await p.evaluate(() => typeof tab == 'function' && !/GitHub Pages error/.test(document.body.textContent)));
  MODE = 'ok'; await ctx.setOffline(true); await p.reload(); ok('без сети: открылась копия', await p.evaluate(() => typeof tab == 'function')); await ctx.setOffline(false);
  t0 = Date.now(); hits = 0; await p.reload(); dt = Date.now() - t0; ok('хорошая сеть: страница берётся из сети', hits >= 1 && dt < 6000, [hits, dt]);
  ok('ошибок нет', errs.length === 0, errs);
  console.log(fails ? 'FAILED ' + fails : 'ALL OK'); await b.close(); web.close(); process.exit(0);
})();
