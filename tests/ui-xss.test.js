// Защита от внедрения кода: строки, которые приходят от коллег через общую базу (поля, записи журнала,
// задачи, комментарии, продажи, нормы, имя автора, название хозяйства), подменяются строкой с HTML.
// Ни на одном экране не должно появиться чужого тега или атрибута, и чужой скрипт не должен выполниться.
// Нужен Playwright. Запуск: NODE_PATH=$(npm root -g) node tests/ui-xss.test.js
const { chromium } = require('playwright'); const fs = require('fs'), http = require('http'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const web = http.createServer((rq, rs) => { const f = path.join(ROOT, decodeURIComponent(new URL(rq.url, 'http://x').pathname)); if (!f.startsWith(ROOT + path.sep) || !fs.existsSync(f) || !fs.statSync(f).isFile()) { rs.writeHead(404); return rs.end(); } rs.writeHead(200, { 'Content-Type': f.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/javascript' }); fs.createReadStream(f).pipe(rs); });
let fails = 0; const ok = (n, c, x) => { if (!c) fails++; console.log((c ? 'ok  ' : 'FAIL') + ' ' + n + (!c && x !== undefined ? ' | ' + JSON.stringify(x) : '')); };
const X = (t) => t + '"\'><x-pwn></x-pwn><img src=x data-pwn onerror="window.__pwn=(window.__pwn||0)+1">\' data-pwn=\'1';
(async () => {
  await new Promise((r) => web.listen(0, '127.0.0.1', r)); const APP = 'http://127.0.0.1:' + web.address().port + '/index.html';
  const b = await chromium.launch();
  for (const mode of ['ru', 'kk', 'nums', 'ids']) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    await ctx.route(/open-meteo|workers\.dev/, (r) => r.abort());
    await ctx.addInitScript(([F1, F2, CR, N, BY, FN, mode]) => { if (localStorage.getItem('agro_onb_v1') != null) return;
      const num = (v) => mode === 'nums' || mode === 'ids' ? N : v; const I = (v) => mode === 'ids' ? N + v : v; const DT = (v) => mode === 'ids' ? v + N : v;
      localStorage.setItem('agro_onb_v1', '1'); localStorage.setItem('agro_tour_v1', '1'); localStorage.setItem('agro_lang_v1', mode === 'kk' ? 'kk' : 'ru');
      localStorage.setItem('agro_me_v1', BY);
      localStorage.setItem('agro_farms_v1', JSON.stringify({ list: [{ id: 'f1', name: FN }, { id: 'f2', name: FN + '2' }], cur: 'f1' }));
      localStorage.setItem('agro_fields_v1', JSON.stringify({ [F1]: num(100), [F2]: num(50) }));
      localStorage.setItem('agro_diary_v1', JSON.stringify([
        { id: I(1), f: F1, d: DT('2026-05-10'), o: 'Сев или посадка', cr: CR, c: num(1000), y: 0, p: N, n: N, by: BY },
        { id: I(2), f: F1, d: DT('2026-06-14'), o: 'Защита растений', cr: CR, c: num(5000), y: 0, p: N, w: num(30), n: N, by: BY },
        { id: 3, f: F1, d: '2026-09-01', o: 'Уборка', cr: CR, c: 0, y: num(200), p: '', n: N, by: BY },
        { id: 4, f: F2, d: '2026-07-01', o: N, cr: 'Ячмень', c: 0, y: 0, p: N, n: N, by: BY },
        { id: 5, f: F2, d: '2026-06-01', o: 'Осмотр поля', cr: 'Ячмень', c: 0, y: 0, p: '', n: 'Учёт сорняков: ' + N + ' 5 шт/м² (x), порог 3 шт/м²', by: BY }]));
      localStorage.setItem('agro_tasks_v1', JSON.stringify([{ id: I(11), d: DT('2026-01-01'), o: N, f: F1, cr: CR, n: N, done: 0, by: BY, to: BY }, { id: 12, d: '2099-01-01', o: 'Другое', f: F2, n: N, done: 1, by: BY }]));
      localStorage.setItem('agro_comments_v1', JSON.stringify([{ id: I('c1'), e: I(1), by: BY, t: N, d: Date.now() - 1000 }, { id: 'c2', e: '1', ai: 1, t: N, d: Date.now() }]));
      localStorage.setItem('agro_sales_v1', JSON.stringify([{ id: I(21), y: '2026', k: CR, t: num(10), p: num(90000), u: 0, n: N, b: N, d: '2026-10-01' }, { id: 22, y: '2026', k: N, t: 1, p: 1, u: 1, n: N }]));
      localStorage.setItem('agro_prices_v1', JSON.stringify({ [CR]: num(90000), [N]: 1 }));
      localStorage.setItem('agro_norms_v1', JSON.stringify({ y: { [N]: 1 }, r: { [N]: 1 }, n: {}, m: {}, pt: { [N]: { t: 3, u: N } }, f: { [CR + '|n']: num(30) } }));
      localStorage.setItem('agro_bounds_v1', JSON.stringify({ [F1]: [[53.2, 63.6], [53.21, 63.6], [53.21, 63.62]] }));
      localStorage.setItem('agro_region_v1', JSON.stringify({ o: 'Костанайская', z: N }));
      localStorage.setItem('agro_loc_v1', N);
    }, [X('Поле'), X('Участок'), X('Пшеница'), X('заметка'), X('Ахмет'), X('КХ'), mode]);
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => d.dismiss());
    await p.goto(APP); await p.waitForTimeout(500);
    const bad = [];
    const check = async (where) => { const r = await p.evaluate(() => ({ n: document.querySelectorAll('x-pwn,[data-pwn]').length, run: window.__pwn || 0, at: Array.prototype.slice.call(document.querySelectorAll('x-pwn,[data-pwn]'), 0, 2).map((e) => { const s = e.closest('section,div[id]'); return s ? s.id : e.parentNode && e.parentNode.tagName; }) })); if (r.n || r.run) bad.push(where + ': ' + JSON.stringify(r)); };
    await check('старт');
    const tabs = await p.evaluate(() => Object.keys(TABS));
    for (const k of tabs) { try { await p.evaluate((k) => tab(k), k); await p.waitForTimeout(80); } catch (e) { errs.push(k + ': ' + e.message); } await check('экран ' + k); }
    const secs = await p.evaluate(() => Array.prototype.filter.call(document.querySelectorAll('#more > section'), (s) => s.id).map((s) => s.id));
    for (const s of secs) { try { await p.evaluate((s) => tab('X', s), s); await p.waitForTimeout(60); } catch (e) { errs.push(s + ': ' + e.message); } await check('Ещё/' + s); }
    for (const f of await p.evaluate(() => fieldsList())) { await p.evaluate((f) => { CURF = f; tab('G'); }, f); await p.waitForTimeout(80); await check('страница поля'); }
    await p.evaluate(() => tab('D')); for (const sel of ['[data-cm]', '[data-cpo]', '[data-ed]']) { const els = await p.$$(sel); for (const el of els.slice(0, 2)) { try { await el.click({ timeout: 500 }); await p.waitForTimeout(60); } catch (e) {} } }
    await check('журнал с открытыми панелями');
    ok(mode + ': ни на одном экране нет внедрённого HTML', bad.length === 0, bad);
    ok(mode + ': ошибок нет', errs.length === 0, errs.slice(0, 5));
    await ctx.close();
  }
  console.log(fails ? 'FAILED ' + fails : 'ALL OK'); await b.close(); web.close();
})();
