// Черновик записи: набранное в форме переживает перезапуск приложения, очищается кнопкой и после «Добавить запись».
// Нужен Playwright. Запуск: NODE_PATH=$(npm root -g) node tests/ui-draft.test.js
const { chromium } = require('playwright'); const fs = require('fs'), http = require('http'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const web = http.createServer((rq, rs) => { const f = path.join(ROOT, decodeURIComponent(new URL(rq.url, 'http://x').pathname)); if (!f.startsWith(ROOT + path.sep) || !fs.existsSync(f) || !fs.statSync(f).isFile()) { rs.writeHead(404); return rs.end(); } rs.writeHead(200, { 'Content-Type': f.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/javascript' }); fs.createReadStream(f).pipe(rs); });
let fails = 0; const ok = (n, c, x) => { if (!c) fails++; console.log((c ? 'ok  ' : 'FAIL') + ' ' + n + (!c && x !== undefined ? ' | ' + JSON.stringify(x) : '')); };
(async () => {
  await new Promise((r) => web.listen(0, '127.0.0.1', r)); const APP = 'http://127.0.0.1:' + web.address().port + '/index.html';
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  await ctx.route(/open-meteo|workers\.dev/, (r) => r.abort());
  await ctx.addInitScript(() => { if (localStorage.getItem('agro_onb_v1') == null) { localStorage.setItem('agro_onb_v1', '1'); localStorage.setItem('agro_tour_v1', '1'); localStorage.setItem('agro_fields_v1', JSON.stringify({ 'Поле 1': 100, 'Поле 2': 50 })); } });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(APP); await p.waitForTimeout(300); await p.evaluate(() => tab('D'));
  await p.click('#navAdd'); await p.waitForTimeout(250);
  await p.fill('#dField', 'Поле 1'); await p.fill('#dDate', '2026-06-14'); await p.evaluate(() => { $('dOp').value = 'Защита растений'; $('dOp').dispatchEvent(new Event('change', { bubbles: true })) });
  await p.fill('#dCost', '250000'); await p.fill('#dPr', 'Гербицид по этикетке'); await p.fill('#dNote', 'ветер 2 м/с, фаза кущения');
  await p.reload(); await p.waitForTimeout(300); await p.evaluate(() => tab('D'));
  await p.click('#navAdd'); await p.waitForTimeout(250);
  const v = await p.evaluate(() => ['dField', 'dDate', 'dOp', 'dCost', 'dPr', 'dNote'].map((id) => $(id).value));
  ok('после перезапуска форма восстановлена', JSON.stringify(v) === JSON.stringify(['Поле 1', '2026-06-14', 'Защита растений', '250000', 'Гербицид по этикетке', 'ветер 2 м/с, фаза кущения']), v);
  ok('видно сообщение о черновике и блок препарата', await p.isVisible('#dDraft') && /черновик/.test(await p.textContent('#dDraft')) && await p.isVisible('#dPr'));
  await p.click('#dDraftX'); ok('«Очистить» стирает поля и черновик', await p.evaluate(() => $('dNote').value === '' && $('dCost').value === '' && $('dDraft').classList.contains('hidden') && localStorage.getItem(draftKey()) === null));
  await p.fill('#dField', 'Поле 2'); await p.fill('#dNote', 'осмотр всходов'); await p.click('#dAdd'); await p.waitForTimeout(200);
  ok('после «Добавить запись» запись есть, черновика нет', await p.evaluate(() => D.some((e) => e.f === 'Поле 2' && e.n === 'осмотр всходов') && localStorage.getItem(draftKey()) === null));
  await p.reload(); await p.waitForTimeout(300); await p.evaluate(() => tab('D')); await p.click('#navAdd'); await p.waitForTimeout(250);
  ok('новая форма после сохранения пустая', await p.evaluate(() => $('dNote').value === '' && $('dDraft').classList.contains('hidden')));
  await p.fill('#dField', 'Поле 1'); await p.fill('#dNote', 'для Поля 1'); await p.click('#shX'); await p.waitForTimeout(250);
  await p.reload(); await p.waitForTimeout(300); await p.evaluate(() => { tab('D'); openSheet('new', { f: 'Поле 2' }) }); await p.waitForTimeout(250);
  ok('черновик другого поля не подставляется в форму этого поля', await p.evaluate(() => $('dField').value === 'Поле 2' && $('dNote').value === '' && $('dDraft').classList.contains('hidden')));
  await p.evaluate(() => closeSheet()); await p.waitForTimeout(250);
  await p.evaluate(() => { const e = D[0]; openSheet('edit'); }); ok('черновик не теряется при открытии других форм', await p.evaluate(() => JSON.parse(localStorage.getItem(draftKey()) || '{}').dNote === 'для Поля 1'));
  await p.evaluate(() => { const o = JSON.parse(localStorage.getItem(draftKey())); o.t = Date.now() - 8 * 864e5; localStorage.setItem(draftKey(), JSON.stringify(o)); closeSheet(); }); await p.waitForTimeout(250);
  await p.reload(); await p.waitForTimeout(300); await p.evaluate(() => { tab('D'); openSheet('new') }); await p.waitForTimeout(250);
  ok('черновик старше 7 дней не восстанавливается', await p.evaluate(() => $('dNote').value === '' && localStorage.getItem(draftKey()) === null));
  ok('ошибок нет', errs.length === 0, errs);
  console.log(fails ? 'FAILED ' + fails : 'ALL OK'); await b.close(); web.close();
})();
