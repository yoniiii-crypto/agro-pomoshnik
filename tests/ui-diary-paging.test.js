// Большой дневник порциями по 150.
// Нужен Playwright. Запуск: NODE_PATH=$(npm root -g) node tests/ui-diary-paging.test.js
const { chromium } = require('playwright'); const fs = require('fs'), http = require('http'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const web = http.createServer((rq, rs) => { const f = path.join(ROOT, decodeURIComponent(new URL(rq.url, 'http://x').pathname)); if (!f.startsWith(ROOT + '/') || !fs.existsSync(f)) { rs.writeHead(404); return rs.end(); } rs.writeHead(200, { 'Content-Type': f.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/javascript' }); fs.createReadStream(f).pipe(rs); });
let fails = 0; const ok = (n, c, x) => { if (!c) fails++; console.log((c ? 'ok  ' : 'FAIL') + ' ' + n + (!c && x !== undefined ? ' | ' + JSON.stringify(x) : '')); };
(async () => {
  await new Promise((r) => web.listen(0, '127.0.0.1', r)); const APP = 'http://127.0.0.1:' + web.address().port + '/index.html';
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', acceptDownloads: true });
  await ctx.route(/open-meteo|workers\.dev/, (r) => r.abort());
  await ctx.addInitScript(() => { if (localStorage.getItem('agro_onb_v1') == null) { localStorage.setItem('agro_onb_v1', '1'); const D = []; for (let i = 0; i < 320; i++) D.push({ id: 1700000000000 + i * 1000, f: 'Поле ' + (1 + i % 5), d: '2026-0' + (4 + i % 5) + '-1' + (i % 9), o: i % 2 ? 'Осмотр поля' : 'Удобрения', cr: 'Пшеница', c: 1000, y: 0, p: '', n: 'запись ' + i }); localStorage.setItem('agro_diary_v1', JSON.stringify(D)); } });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(APP); await p.waitForTimeout(400); await p.evaluate(() => tab('D'));
  const n = () => p.evaluate(() => document.querySelectorAll('#dList .er').length);
  ok('показаны первые 150 записей и кнопка «Показать ещё»', (await n()) === 150 && /Показать ещё 150 \(всего 320\)/.test(await p.textContent('#dMore')));
  await p.click('#dMore'); ok('ещё порция', (await n()) === 300 && /Показать ещё 20/.test(await p.textContent('#dMore')));
  await p.click('#dMore'); ok('все записи, кнопки больше нет', (await n()) === 320 && !(await p.$('#dMore')));
  await p.fill('#dSearch', 'запись 1'); await p.waitForTimeout(300); ok('поиск начинает с первой порции и ищет по всем записям', (await n()) === await p.evaluate(() => Math.min(150, dFiltered().length)) && await p.evaluate(() => dFiltered().length) > 100);
  await p.fill('#dSearch', ''); await p.waitForTimeout(300);
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#dCsv')]); const rows = fs.readFileSync(await dl.path(), 'utf8').trim().split(/\r\n/).length - 1;
  ok('в Excel уходят все записи, а не только показанные на экране', rows === 320, rows);
  ok('ошибок нет', errs.length === 0, errs);
  console.log(fails ? 'FAILED ' + fails : 'ALL OK'); await b.close(); web.close();
})();
