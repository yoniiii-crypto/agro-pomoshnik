// Строка об авторском праве (свидетельство № 82019) в подвале и в «Ещё», на русском и казахском.
// Нужен Playwright. Запуск: NODE_PATH=$(npm root -g) node tests/ui-copyright.test.js
const { chromium } = require('playwright'); const fs = require('fs'), http = require('http'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const web = http.createServer((rq, rs) => { const f = path.join(ROOT, decodeURIComponent(new URL(rq.url, 'http://x').pathname)); if (!f.startsWith(ROOT + path.sep) || !fs.existsSync(f) || !fs.statSync(f).isFile()) { rs.writeHead(404); return rs.end(); } rs.writeHead(200, { 'Content-Type': f.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/javascript' }); fs.createReadStream(f).pipe(rs); });
let fails = 0; const ok = (n, c, x) => { if (!c) fails++; console.log((c ? 'ok  ' : 'FAIL') + ' ' + n + (!c && x !== undefined ? ' | ' + JSON.stringify(x) : '')); };
(async () => {
  await new Promise((r) => web.listen(0, '127.0.0.1', r)); const APP = 'http://127.0.0.1:' + web.address().port + '/index.html';
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  await ctx.route(/open-meteo|workers\.dev/, (r) => r.abort());
  await ctx.addInitScript(() => { localStorage.setItem('agro_onb_v1', '1'); });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(APP); await p.waitForTimeout(400);
  const ru = await p.textContent('#copyR'), ru2 = await p.textContent('#mCopyR');
  ok('подвал: свидетельство № 82019 от 25.11.2026', /№ 82019 от 25\.11\.2026/.test(ru) && /Саутбаев/.test(ru), ru);
  ok('«Ещё»: та же строка', ru2 === ru, ru2);
  await p.goto(APP + '?lang=kk'); await p.waitForTimeout(400);
  const kk = await p.textContent('#copyR'), kk2 = await p.textContent('#mCopyR');
  ok('казахский: «Авторлық құқық куәлігі № 82019, 25.11.2026»', /Авторлық құқық куәлігі № 82019, 25\.11\.2026/.test(kk) && kk2 === kk, kk);
  await p.goto(APP + '?lang=ru'); await p.waitForTimeout(400);
  ok('обратно на русский', (await p.textContent('#copyR')) === ru);
  ok('без ошибок на странице', errs.length === 0, errs);
  await b.close(); web.close(); process.exit(fails ? 1 : 0);
})();
