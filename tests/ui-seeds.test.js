// Семена и удобрения на сезон, заявка поставщику, профиль для банка: своевременность записей.
// Нужен Playwright. Запуск: NODE_PATH=$(npm root -g) node tests/ui-seeds.test.js
const { chromium } = require('playwright'); const fs = require('fs'), http = require('http'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const web = http.createServer((rq, rs) => { const f = path.join(ROOT, decodeURIComponent(new URL(rq.url, 'http://x').pathname)); if (!f.startsWith(ROOT + '/') || !fs.existsSync(f)) { rs.writeHead(404); return rs.end(); } rs.writeHead(200, { 'Content-Type': f.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/javascript' }); fs.createReadStream(f).pipe(rs); });
let fails = 0; const ok = (n, c, x) => { if (!c) fails++; console.log((c ? 'ok  ' : 'FAIL') + ' ' + n + (!c && x !== undefined ? ' | ' + JSON.stringify(x) : '')); };
(async () => {
  await new Promise((r) => web.listen(0, '127.0.0.1', r)); const APP = 'http://127.0.0.1:' + web.address().port + '/index.html';
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
  await ctx.route(/open-meteo|workers\.dev/, (r) => r.abort());
  await ctx.addInitScript(() => { if (localStorage.getItem('agro_onb_v1') == null) localStorage.setItem('agro_onb_v1', '1'); window.print = () => {}; });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(APP + '?demo=1'); await p.waitForFunction(() => typeof FARMS != 'undefined' && FARMS.cur === 'demo' && D.length > 10, null, { timeout: 15000 });
  await p.waitForTimeout(2000); await p.evaluate(() => { if (TOUR && TOUR.on) tourEnd(); tab('K'); }); await p.waitForTimeout(300);
  const S = await p.evaluate(() => { const S = seedNeed(); return { ny: S.ny, list: S.list.map((r) => [r.k, r.a, Math.round(r.kg), Math.round(r.t * 10) / 10]), miss: S.miss, noA: S.noA }; });
  console.log(JSON.stringify(S));
  ok('расчёт семян: культуры с площадью и нормой', S.list.length > 0 && S.list.every((r) => r[1] >= 0 && r[2] > 0));
  const wheat = S.list.find((r) => /пшеница/i.test(r[0])); if (wheat) ok('норма пшеницы = 3 млн × 38 г / 90 % ≈ 127 кг/га', wheat[2] === 127, wheat);
  const txt = await p.textContent('#calN'); ok('блок «Семена на сезон» в плане работ', /Семена и удобрения на сезон/.test(txt) && /Итого/.test(txt), txt.slice(0, 200));
  const share = await p.evaluate(() => seedNeedText(seedNeed())); ok('текст заявки поставщику', /Заявка на семена, сезон/.test(share) && /Итого: [\d,]+ т/.test(share) && /Демо-хозяйство/.test(share), share);
  await p.evaluate(()=>kSeg('b'));await p.click('#snTask'); await p.evaluate(()=>kSeg('b'));await p.click('#snTask'); const tk = await p.evaluate(() => TK.filter((t) => /^Закупить семена:/.test(t.n)).map((t) => [t.n, t.d]));
  ok('задача на закупку добавлена один раз и обновляется', tk.length === 1 && /т/.test(tk[0][0]), tk);
  ok('без норм удобрений — подсказка открыть нормы', /Впишите нормы N, P₂O₅ и K₂O/.test(await p.textContent('#calN')));
  await p.evaluate(()=>kSeg('b'));await p.click('#snNorms'); await p.waitForSelector('#nmF input'); await p.fill('#nmF input[data-key="Яровая пшеница|n"]', '60'); await p.fill('#nmF input[data-key="Яровая пшеница|p"]', '30'); await p.fill('#nmF input[data-key="Горох|p"]', '40');
  ok('нормы удобрений сохраняются в «Нормах агронома»', await p.evaluate(() => NORMS.f['Яровая пшеница|n'] === 60 && NORMS.f['Горох|p'] === 40 && JSON.parse(localStorage.getItem(FK('agro_norms_v1'))).f['Яровая пшеница|p'] === 30));
  await p.evaluate(() => tab('K')); await p.waitForTimeout(200);
  const F = await p.evaluate(() => seedNeed().fert.map((o) => [o.n, Math.round(o.t * 10) / 10]));
  console.log(JSON.stringify(F));
  const am = F.find((x) => /Аммофос/.test(x[0])), sel = F.find((x) => /селитра/.test(x[0]));
  ok('удобрения по маркам: аммофос на фосфор, селитра на остаток азота', am && sel && Math.abs(am[1] - (58 * 990 + 77 * 1230) / 1000) < 0.2 && Math.abs(sel[1] - 154 * 990 / 1000) < 0.3, F);
  const share2 = await p.evaluate(() => seedNeedText(seedNeed())); ok('заявка с удобрениями', /Заявка на семена и удобрения/.test(share2) && /Удобрения:\n— /.test(share2) && /— Аммофос 12-52: [\d,]+ т/.test(share2) && !/обл\. \(/.test(share2), share2);
  await p.evaluate(()=>kSeg('b'));await p.click('#snTask'); ok('задача на закупку включает удобрения', await p.evaluate(() => TK.filter((t) => /^Закупить семена:/.test(t.n)).length === 1 && /удобрения: .*Аммофос/.test(TK.filter((t) => /^Закупить семена:/.test(t.n))[0].n)));
  await (await p.$('#calN')).screenshot({ path: require('os').tmpdir() + '/shot_seed.png' });
  // в хозяйстве без площади и культуры
  await p.evaluate(() => { const fake = { list: [{ d: '2027-05-15', o: 'Сев или посадка', f: 'Поле Х', cr: '' }, { d: '2027-05-15', o: 'Сев или посадка', f: 'Поле Y', cr: 'Ячмень' }], ny: 2027 }; window.__sp = seasonPlan; seasonPlan = () => fake; renderSeedNeed(); });
  const t2 = await p.textContent('#calN'); ok('поле без культуры и без площади названы, расчёт не ломается', /Поле Х — культура не выбрана/.test(t2) && /Не указана площадь: Поле Y/.test(t2) && !/NaN|undefined/.test(t2), t2);
  await p.evaluate(() => { seasonPlan = window.__sp; });
  // профиль для банка: своевременность
  await p.evaluate(() => { const now = Date.now(); D.push({ id: now, f: 'Поле 1 · Центральное', d: today(), o: 'Осмотр поля', cr: '', c: 0, y: 0, p: '', n: 'вовремя' }, { id: now + 1, f: 'Поле 1 · Центральное', d: iso(new Date(now - 10 * DD)), o: 'Осмотр поля', cr: '', c: 0, y: 0, p: '', n: 'поздно' }); PLAN = 'farm'; report('bank'); });
  const bt = await p.textContent('#printArea'); ok('в профиле для банка — доля записей, внесённых вовремя', /Внесены в течение 3 дней/.test(bt) && /50 %/.test(bt), bt.slice(bt.indexOf('Как ведётся'), bt.indexOf('Как ведётся') + 500));
  ok('ошибок нет', errs.length === 0, errs);
  console.log(fails ? 'FAILED ' + fails : 'ALL OK'); await b.close(); web.close();
})();
