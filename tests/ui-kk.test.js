// Казахский: «Пастбище», «Корма», «План работ» и признаки в «Что с растением» переведены; смена языка не стирает введённые числа.
// Нужен Playwright. Запуск: NODE_PATH=$(npm root -g) node tests/ui-kk.test.js
const { chromium } = require('playwright'); const fs = require('fs'), http = require('http'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const web = http.createServer((rq, rs) => { const f = path.join(ROOT, decodeURIComponent(new URL(rq.url, 'http://x').pathname)); if (!f.startsWith(ROOT + path.sep) || !fs.existsSync(f) || !fs.statSync(f).isFile()) { rs.writeHead(404); return rs.end(); } rs.writeHead(200, { 'Content-Type': f.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/javascript' }); fs.createReadStream(f).pipe(rs); });
let fails = 0; const ok = (n, c, x) => { if (!c) fails++; console.log((c ? 'ok  ' : 'FAIL') + ' ' + n + (!c && x !== undefined ? ' | ' + JSON.stringify(x) : '')); };
(async () => {
  await new Promise((r) => web.listen(0, '127.0.0.1', r)); const APP = 'http://127.0.0.1:' + web.address().port + '/index.html';
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  await ctx.route(/open-meteo|workers\.dev/, (r) => r.abort());
  await ctx.addInitScript(() => { if (localStorage.getItem('agro_onb_v1') == null) { localStorage.setItem('agro_onb_v1', '1'); localStorage.setItem('agro_tour_v1', '1'); localStorage.setItem('agro_plan_v1', 'farm');
    localStorage.setItem('agro_tasks_v1', JSON.stringify([{ id: 1, d: '2020-01-01', o: 'Обработка почвы', f: '', n: 'Старая задача', done: 0 }])); } });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(APP + '?lang=kk'); await p.waitForTimeout(400);
  await p.evaluate(() => tab('P')); let t = (await p.textContent('#herd')) + (await p.textContent('#past'));
  ok('«Пастбище»: подписи на казахском', /Жайылым ауданы, га/.test(t) && /Мал басы/.test(t) && /ІҚМ: бас саны/.test(t) && !/Площадь пастбища/.test(t), t.slice(0, 300));
  ok('«Пастбище»: итог на казахском', /Пайдалануға болатын азық/.test(await p.textContent('#pRes')));
  await p.fill('#paA', '777'); await p.dispatchEvent('#paA', 'input');
  await p.evaluate(() => tab('F')); t = await p.textContent('#feed');
  ok('«Корма»: подписи и итог на казахском', /Қорада ұстау кезеңі/.test(t) && /Сүрлем, т/.test(t) && /Шығынды ескергендегі қажеттілік/.test(await p.textContent('#fRes')), t.slice(0, 300));
  await p.evaluate(() => tab('K')); await p.waitForTimeout(100); t = (await p.textContent('#calA')) + (await p.textContent('#calL'));
  ok('«План работ»: группы, кнопки и вид работы на казахском', /Мерзімі өткен/i.test(t) && /Орындалды/.test(t) && /Топырақ өңдеу/.test(t) && !/Просрочено/i.test(t), t.slice(0, 400));
  ok('«План работ»: в списке работ казахские названия, а значение прежнее', await p.evaluate(() => { const o = [...document.querySelectorAll('#kOp option')].find((x) => x.value == 'Обработка почвы'); return !!o && o.textContent == opName('Обработка почвы') && o.textContent != o.value }));
  await p.evaluate(() => tab('S')); t = await p.textContent('#dgA');
  ok('«Что с растением»: признаки на казахском', /саусаққа жұғады/.test(t) && !/пыльца пачкает пальцы/.test(t), t.slice(0, 300));
  await p.click('.dgS[data-s="0"]'); ok('«Что с растением»: признак в итоге на казахском', /саусаққа жұғады/.test(await p.textContent('#dgR')));
  await p.evaluate(() => { setLang('ru'); tab('P') }); t = (await p.textContent('#herd')) + (await p.textContent('#past'));
  ok('после смены на русский подписи русские, введённая площадь осталась', /Площадь пастбища, га/.test(t) && /Стадо/.test(t) && (await p.inputValue('#paA')) === '777' && /Корма, которые можно использовать/.test(await p.textContent('#pRes')), [t.slice(0, 200), await p.inputValue('#paA')]);
  await p.evaluate(() => tab('S')); ok('признаки снова на русском', /пыльца пачкает пальцы/.test(await p.textContent('#dgA')));
  ok('ошибок нет', errs.length === 0, errs);
  console.log(fails ? 'FAILED ' + fails : 'ALL OK'); await b.close(); web.close();
})();
