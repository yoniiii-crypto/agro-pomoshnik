// Дневник: категории, сезон, выгрузка показанного.
// Нужен Playwright. Запуск: NODE_PATH=$(npm root -g) node tests/ui-diary.test.js
const { chromium } = require('playwright'); const fs = require('fs'), http = require('http'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const web = http.createServer((rq, rs) => { const f = path.join(ROOT, decodeURIComponent(new URL(rq.url, 'http://x').pathname)); if (!f.startsWith(ROOT + '/') || !fs.existsSync(f)) { rs.writeHead(404); return rs.end(); } rs.writeHead(200, { 'Content-Type': f.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/javascript' }); fs.createReadStream(f).pipe(rs); });
let fails = 0; const ok = (n, c, x) => { if (!c) fails++; console.log((c ? 'ok  ' : 'FAIL') + ' ' + n + (!c && x !== undefined ? ' | ' + JSON.stringify(x) : '')); };
(async () => {
  await new Promise((r) => web.listen(0, '127.0.0.1', r)); const APP = 'http://127.0.0.1:' + web.address().port + '/index.html';
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block', acceptDownloads: true });
  await ctx.route(/open-meteo|workers\.dev/, (r) => r.abort());
  await ctx.addInitScript(() => { if (localStorage.getItem('agro_onb_v1') == null) localStorage.setItem('agro_onb_v1', '1'); });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(APP + '?demo=1'); await p.waitForFunction(() => typeof FARMS != 'undefined' && FARMS.cur === 'demo' && D.length > 10, null, { timeout: 15000 });
  await p.waitForTimeout(2000); await p.evaluate(() => { if (TOUR && TOUR.on) tourEnd(); tab('D'); window.scrollTo(0, 0); }); await p.waitForTimeout(300);
  const pos = await p.evaluate(() => ({ csv: document.getElementById('dCsv').getBoundingClientRect().top, list: document.getElementById('dList').getBoundingClientRect().top, vh: innerHeight }));
  ok('кнопки выгрузки наверху, над списком, видны без прокрутки', pos.csv < pos.list && pos.csv < pos.vh, pos);
  const chips = await p.$$eval('#dOps [data-op]', (a) => a.map((x) => x.textContent));
  ok('категории по типам работ с количеством', chips[0] === 'Все ' + (await p.evaluate(() => D.length)) && chips.some((c) => /^Защита \d+$/.test(c)) && chips.some((c) => /^Уборка \d+$/.test(c)), chips);
  await p.click('#dOps [data-op="Защита растений"]'); await p.waitForTimeout(150);
  const f1 = await p.evaluate(() => ({ n: dFiltered().length, all: dFiltered().every((e) => e.o === 'Защита растений'), rows: document.querySelectorAll('#dList .er').length, pressed: document.querySelector('#dOps [data-op="Защита растений"]').getAttribute('aria-pressed') }));
  ok('нажал «Защита» — в списке только защита растений', f1.all && f1.n > 0 && f1.rows === f1.n && f1.pressed === 'true', f1);
  const yrs = await p.$$eval('#dYear option', (a) => a.map((x) => x.value)); await p.selectOption('#dYear', yrs[2]); await p.waitForTimeout(150);
  const f2 = await p.evaluate((y) => ({ n: dFiltered().length, ok: dFiltered().every((e) => e.o === 'Защита растений' && String(cropYear(e)) === y), total: document.getElementById('dTotal').textContent }), yrs[2]);
  ok('сезон + категория вместе', f2.ok && f2.n > 0 && new RegExp('Записей: ' + f2.n).test(f2.total), [yrs, f2]);
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#dCsv')]); const csv = fs.readFileSync(await dl.path(), 'utf8').trim().split(/\r\n/);
  ok('в Excel выгружается ровно показанное', csv.length - 1 === f2.n && csv.slice(1).every((r) => /;Защита растений;/.test(r)), [csv.length - 1, f2.n]);
  await p.selectOption('#dYear', ''); await p.click('#dOps [data-op=""]'); await p.waitForTimeout(100);
  ok('«Все» и «Все сезоны» возвращают весь дневник', await p.evaluate(() => dFiltered().length === D.length));
  await p.screenshot({ path: require('os').tmpdir() + '/shot_diary_top.png' });
  await p.evaluate(() => { localStorage.setItem('agro_lang_v1', 'kk'); }); await p.reload(); await p.waitForTimeout(2200); await p.evaluate(() => { if (TOUR && TOUR.on) tourEnd(); tab('D'); });
  ok('по-казахски подписи и категории', /Жүктеп алу және жүктеу/.test(await p.textContent('#diary')) && /Барлығы/.test(await p.textContent('#dOps')) && /Маусым/.test(await p.textContent('#diary')));
  ok('ошибок нет', errs.length === 0, errs);
  console.log(fails ? 'FAILED ' + fails : 'ALL OK'); await b.close(); web.close();
})();
