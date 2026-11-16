// Обсуждение записи и «Спросить ИИ» (ИИ подменён).
// Нужен Playwright. Запуск: NODE_PATH=$(npm root -g) node tests/ui-discussion-ai.test.js
const { chromium } = require('playwright'); const fs = require('fs'), http = require('http'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const web = http.createServer((rq, rs) => { const f = path.join(ROOT, decodeURIComponent(new URL(rq.url, 'http://x').pathname)); if (!f.startsWith(ROOT + '/') || !fs.existsSync(f)) { rs.writeHead(404); return rs.end(); } rs.writeHead(200, { 'Content-Type': f.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/javascript' }); fs.createReadStream(f).pipe(rs); });
let fails = 0; const ok = (n, c, x) => { if (!c) fails++; console.log((c ? 'ok  ' : 'FAIL') + ' ' + n + (!c && x !== undefined ? ' | ' + JSON.stringify(x) : '')); };
(async () => {
  await new Promise((r) => web.listen(0, '127.0.0.1', r)); const APP = 'http://127.0.0.1:' + web.address().port + '/index.html';
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
  await ctx.route(/open-meteo|workers\.dev/, (r) => r.abort());
  await ctx.addInitScript(() => { if (localStorage.getItem('agro_onb_v1') == null) { localStorage.setItem('agro_onb_v1', '1'); const now = Date.now();
    localStorage.setItem('agro_diary_v1', JSON.stringify([{ id: 1, f: 'Поле 7', d: '2026-11-14', o: 'Осмотр поля', cr: 'Пшеница', c: 0, y: 0, p: '', n: 'на нижних листьях бурые пятна', by: 'Фермер Ахмет', ph: ['ptest1'] }]));
    localStorage.setItem('agro_comments_v1', JSON.stringify([{ id: 'c1', e: '1', by: 'Агроном Ерлан', t: 'Пришлите фото листа крупно.', d: now - 3600000 }]));
    localStorage.setItem('agro_sync_v1', JSON.stringify({ v: 1, code: 'ABCDEFGHJKMNPQRSTVWX', id: '0123456789abcdef', ro: 0, h: { agro_diary_v1: { 1: 'x' } }, s: {}, d: {}, tag: '0123456789abcdef', last: now })); localStorage.setItem('agro_me_v1', 'Фермер Ахмет'); } });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(APP); await p.waitForTimeout(500);
  await p.evaluate(() => new Promise((res) => { const c = document.createElement('canvas'); c.width = 120; c.height = 90; c.getContext('2d').fillRect(10, 10, 50, 50); c.toBlob((bl) => pPut('ptest1', bl).then(res), 'image/jpeg', 0.8); }));
  await p.evaluate(() => { AIS = null; tab('D'); }); await p.click('[data-cmo="1"]'); await p.waitForTimeout(150);
  ok('без ИИ кнопки «Спросить ИИ» нет', !(await p.$('[data-cmai="1"]')));
  await p.evaluate(() => { window.__q = null; AIC = { images: true }; AIS = (prompt, opt) => { window.__q = { prompt, n: (opt.images || []).length, t: (opt.images || [])[0] && opt.images[0].type }; opt.onText && opt.onText({ text: '— Похоже на септориоз' }); return new Promise((r) => setTimeout(() => r({ text: '— Похоже на септориоз: бурые пятна с тёмными точками.\n— Проверьте нижние ярусы на 10 растениях.' }), 200)); }; refreshData(); });
  await p.waitForSelector('[data-cmai="1"]'); await p.fill('[data-cmi="1"]', 'Что это за пятна?'); await p.click('[data-cmai="1"]');
  await p.waitForFunction(() => CM.some((c) => c.ai), null, { timeout: 5000 });
  const st = await p.evaluate(() => ({ cm: CM.map((c) => [c.by, c.ai || 0, c.t.slice(0, 20)]), q: window.__q }));
  ok('вопрос опубликован комментарием, ответ ИИ — комментарием «ИИ-агроном»', st.cm.length === 3 && st.cm[1][0] === 'Фермер Ахмет' && st.cm[1][2] === 'Что это за пятна?' && st.cm[2][0] === 'ИИ-агроном' && st.cm[2][1] === 1, st.cm);
  ok('ИИ получил запись, всё обсуждение и фото к записи', /бурые пятна/.test(st.q.prompt) && /Пришлите фото листа крупно/.test(st.q.prompt) && /Что это за пятна\?/.test(st.q.prompt) && /История поля/.test(st.q.prompt) && st.q.n === 1 && st.q.t === 'image/jpeg', [st.q.n, st.q.prompt.slice(0, 300)]);
  const th = await p.textContent('#dList'); ok('в ветке ответ ИИ с пометкой, счётчик обновился', /ИИ-агроном\s*ИИ/.test(th) && /Проверьте нижние ярусы/.test(th) && /Обсудить \(3\)/.test(th), th.slice(0, 400));
  await (await p.$('#dList')).screenshot({ path: require('os').tmpdir() + '/shot_cmai.png' });
  await p.evaluate(() => { const m = JSON.parse(localStorage.getItem('agro_sync_v1')); m.ro = 1; localStorage.setItem('agro_sync_v1', JSON.stringify(m)); SYNC.shc = null; refreshData(); });
  ok('у наблюдателя нет ни поля ввода, ни «Спросить ИИ»', !(await p.$('[data-cmi="1"]')) && !(await p.$('[data-cmai="1"]')));
  ok('ошибок нет', errs.length === 0, errs);
  console.log(fails ? 'FAILED ' + fails : 'ALL OK'); await b.close(); web.close();
})();
