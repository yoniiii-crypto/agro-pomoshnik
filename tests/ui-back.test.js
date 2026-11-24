// Кнопка «Назад» телефона: закрывает форму, окно и тур, возвращает на прошлый экран и на «Сводку»; только со «Сводки» выходит из приложения.
// Нужен Playwright. Запуск: NODE_PATH=$(npm root -g) node tests/ui-back.test.js
const { chromium } = require('playwright'); const fs = require('fs'), http = require('http'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const web = http.createServer((rq, rs) => { const f = path.join(ROOT, decodeURIComponent(new URL(rq.url, 'http://x').pathname)); if (!f.startsWith(ROOT + path.sep) || !fs.existsSync(f) || !fs.statSync(f).isFile()) { rs.writeHead(404); return rs.end(); } rs.writeHead(200, { 'Content-Type': f.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/javascript' }); fs.createReadStream(f).pipe(rs); });
let fails = 0; const ok = (n, c, x) => { if (!c) fails++; console.log((c ? 'ok  ' : 'FAIL') + ' ' + n + (!c && x !== undefined ? ' | ' + JSON.stringify(x) : '')); };
(async () => {
  await new Promise((r) => web.listen(0, '127.0.0.1', r)); const ORIGIN = 'http://127.0.0.1:' + web.address().port, APP = ORIGIN + '/index.html';
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  await ctx.route(/open-meteo|workers\.dev/, (r) => r.abort());
  await ctx.addInitScript(() => { if (localStorage.getItem('agro_onb_v1') == null) { localStorage.setItem('agro_onb_v1', '1'); localStorage.setItem('agro_tour_v1', '1');
    localStorage.setItem('agro_fields_v1', JSON.stringify({ 'Поле 1': 100 }));
    localStorage.setItem('agro_diary_v1', JSON.stringify([{ id: 1, f: 'Поле 1', d: '2026-05-10', o: 'Сев или посадка', cr: 'Ячмень', c: 0, y: 0, p: '', n: '' }])); } });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(ORIGIN + '/README.md'); await p.goto(APP); await p.waitForTimeout(400);
  const st = () => p.evaluate(() => ({ cur: CUR, url: location.pathname, sheet: sheetOpen(), dlg: !document.getElementById('dlg').classList.contains('hidden'), tour: TOUR.on }));
  const back = async () => { await p.goBack({ waitUntil: 'commit' }).catch(() => {}); await p.waitForTimeout(350); };
  ok('старт на «Сводке»', (await st()).cur === 'H');
  await p.click('#tD'); await p.waitForTimeout(100); await p.click('#navAdd'); await p.waitForTimeout(250);
  ok('форма записи открыта', (await st()).sheet);
  await back(); let s = await st(); ok('«Назад» закрывает форму и остаётся в «Дневнике»', !s.sheet && s.cur === 'D' && s.url === '/index.html', s);
  await back(); s = await st(); ok('«Назад» из «Дневника» ведёт на «Сводку»', s.cur === 'H' && s.url === '/index.html', s);
  await p.click('#tL'); await p.waitForTimeout(100); await p.click('[data-f="Поле 1"]'); await p.waitForTimeout(100);
  ok('открыта страница поля', (await st()).cur === 'G');
  await back(); s = await st(); ok('«Назад» со страницы поля ведёт к «Полям»', s.cur === 'L', s);
  await p.click('#tM'); await p.waitForTimeout(100); await p.evaluate(() => tab('R')); await p.waitForTimeout(100);
  await back(); s = await st(); ok('«Назад» с «Риска» ведёт в меню «Ещё»', s.cur === 'M', s);
  await p.evaluate(() => ask('Проверка?', 'Да', function () {})); await back(); s = await st(); ok('«Назад» закрывает окно вопроса', !s.dlg && s.cur === 'M', s);
  await p.evaluate(() => tab('H')); await p.evaluate(() => tourStart(0)); await p.waitForTimeout(150); await back(); s = await st(); ok('«Назад» закрывает тур', !s.tour && s.cur === 'H' && s.url === '/index.html', s);
  await p.click('#navAdd'); await p.waitForTimeout(250); await p.click('#shX'); await p.waitForTimeout(300);
  await p.keyboard.press('Escape'); ok('Esc на «Сводке» ничего не ломает', (await st()).cur === 'H');
  await back(); ok('«Назад» на «Сводке» выходит из приложения (и после формы, закрытой крестиком)', /README\.md$/.test(p.url()), p.url());
  ok('ошибок нет', errs.length === 0, errs);
  console.log(fails ? 'FAILED ' + fails : 'ALL OK'); await b.close(); web.close();
})();
