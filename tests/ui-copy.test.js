// «На другие поля»: копия записи на несколько полей.
// Нужен Playwright. Запуск: NODE_PATH=$(npm root -g) node tests/ui-copy.test.js
const { chromium } = require('playwright'); const fs = require('fs'), http = require('http'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const web = http.createServer((rq, rs) => { const f = path.join(ROOT, decodeURIComponent(new URL(rq.url, 'http://x').pathname)); if (!f.startsWith(ROOT + path.sep) || !fs.existsSync(f) || !fs.statSync(f).isFile()) { rs.writeHead(404); return rs.end(); } rs.writeHead(200, { 'Content-Type': f.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/javascript' }); fs.createReadStream(f).pipe(rs); });
let fails = 0; const ok = (n, c, x) => { if (!c) fails++; console.log((c ? 'ok  ' : 'FAIL') + ' ' + n + (!c && x !== undefined ? ' | ' + JSON.stringify(x) : '')); };
(async () => {
  await new Promise((r) => web.listen(0, '127.0.0.1', r)); const APP = 'http://127.0.0.1:' + web.address().port + '/index.html';
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
  await ctx.route(/open-meteo|workers\.dev/, (r) => r.abort());
  await ctx.addInitScript(() => { if (localStorage.getItem('agro_onb_v1') == null) { localStorage.setItem('agro_onb_v1', '1');
    localStorage.setItem('agro_fields_v1', JSON.stringify({ 'Поле 1': 100, 'Поле 2': 200, 'Поле 3': 50 }));
    localStorage.setItem('agro_diary_v1', JSON.stringify([
      { id: 1, f: 'Поле 1', d: '2026-05-10', o: 'Сев или посадка', cr: 'Яровая пшеница', c: 0, y: 0, p: '', n: '' },
      { id: 2, f: 'Поле 2', d: '2026-05-11', o: 'Сев или посадка', cr: 'Ячмень', c: 0, y: 0, p: '', n: '' },
      { id: 3, f: 'Поле 1', d: '2026-06-14', o: 'Защита растений', cr: 'Яровая пшеница', c: 500000, y: 0, p: 'Гербицид по этикетке', w: 30, n: 'ветер 2 м/с' },
      { id: 4, f: 'Поле 1', d: '2026-09-01', o: 'Уборка', cr: 'Яровая пшеница', c: 0, y: 200, p: '', n: '' }])); } });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(APP); await p.waitForTimeout(400); await p.evaluate(() => tab('D'));
  ok('у уборки кнопки «На другие поля» нет', !(await p.$('[data-cpo="4"]')) && !!(await p.$('[data-cpo="3"]')));
  await p.click('[data-cpo="3"]'); await p.waitForSelector('[data-cpp="3"]');
  const pan = await p.textContent('[data-cpp="3"]'); ok('в списке другие поля и пересчёт затрат 5 000 ₸/га', /Поле 2/.test(pan) && /Поле 3/.test(pan) && !/Поле 1/.test(pan) && /5\s000 ₸\/га/.test(pan), pan);
  await p.screenshot({ path: require('os').tmpdir() + '/shot_copy.png' });
  await p.check('[data-cpp="3"] [data-cpf="Поле 2"]'); await p.check('[data-cpp="3"] [data-cpf="Поле 3"]'); await p.click('[data-cpgo="3"]'); await p.waitForTimeout(150);
  const made = await p.evaluate(() => D.filter((e) => e.o === 'Защита растений' && e.id !== 3).map((e) => [e.f, e.cr, e.c, e.p, e.w, e.d, e.n]).sort());
  ok('две копии: культура поля, затраты по площади, препарат, срок ожидания и дата те же', made.length === 2 && made[0][0] === 'Поле 2' && made[0][1] === 'Ячмень' && made[0][2] === 1000000 && made[1][0] === 'Поле 3' && made[1][2] === 250000 && made.every((m) => m[3] === 'Гербицид по этикетке' && m[4] === 30 && m[5] === '2026-06-14' && m[6] === 'ветер 2 м/с'), made);
  ok('сообщение и панель закрыта', /Записано на полей: 2/.test(await p.textContent('#toastT')) && !(await p.$('[data-cpp="3"]')));
  await p.click('#toastB'); ok('«Отменить» убирает копии', await p.evaluate(() => D.filter((e) => e.o === 'Защита растений').length === 1));
  await p.evaluate(() => { AR['Поле 3'] = 0; saveAR(); tab('D'); }); await p.click('[data-cpo="3"]'); await p.check('[data-cpp="3"] [data-cpf="Поле 3"]'); await p.click('[data-cpgo="3"]'); await p.waitForTimeout(100);
  ok('поле без площади: затраты 0 и предупреждение', /Без площади, затраты 0: Поле 3/.test(await p.textContent('#toastT')) && await p.evaluate(() => D.some((e) => e.f === 'Поле 3' && e.o === 'Защита растений' && e.c === 0)));
  await p.click('[data-cpo="3"]'); await p.click('[data-cpgo="3"]'); ok('без отмеченных полей ничего не записывается', /Отметьте поля/.test(await p.textContent('#toastT')));
  await p.click('[data-cpx="3"]'); ok('«Отмена» закрывает панель', !(await p.$('[data-cpp="3"]')));
  await p.evaluate(() => { localStorage.setItem(syncMetaKey(FARMS.cur), JSON.stringify({ v: 1, code: 'ABCDEFGHJKMNPQRSTVWX', id: '0123456789abcdef', ro: 1, h: {}, s: {}, d: {}, tag: '0123456789abcdef', last: Date.now() })); SYNC.shc = null; tab('D'); });
  ok('у наблюдателя кнопки нет', !(await p.$('[data-cpo]')));
  ok('ошибок нет', errs.length === 0, errs);
  console.log(fails ? 'FAILED ' + fails : 'ALL OK'); await b.close(); web.close();
})();
