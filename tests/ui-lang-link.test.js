// Ссылка с ?lang=kk (QR в казахском буклете и флаере): демо открывается сразу на казахском,
// на «Сводке» казахские названия культур и демо-хозяйства; данные при этом остаются русскими.
// Нужен Playwright. Запуск: NODE_PATH=$(npm root -g) node tests/ui-lang-link.test.js
const { chromium } = require('playwright'); const fs = require('fs'), http = require('http'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const web = http.createServer((rq, rs) => { const f = path.join(ROOT, decodeURIComponent(new URL(rq.url, 'http://x').pathname)); if (!f.startsWith(ROOT + path.sep) || !fs.existsSync(f) || !fs.statSync(f).isFile()) { rs.writeHead(404); return rs.end(); } rs.writeHead(200, { 'Content-Type': f.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/javascript' }); fs.createReadStream(f).pipe(rs); });
let fails = 0; const ok = (n, c, x) => { if (!c) fails++; console.log((c ? 'ok  ' : 'FAIL') + ' ' + n + (!c && x !== undefined ? ' | ' + JSON.stringify(x) : '')); };
(async () => {
  await new Promise((r) => web.listen(0, '127.0.0.1', r)); const APP = 'http://127.0.0.1:' + web.address().port + '/index.html';
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  await ctx.route(/open-meteo|workers\.dev/, (r) => r.abort());
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(APP + '?demo=1&lang=kk');
  await p.waitForFunction(() => typeof FARMS != 'undefined' && FARMS.cur === 'demo' && D.length > 10, null, { timeout: 15000 });
  await p.waitForTimeout(800);
  await p.evaluate(() => { if (TOUR && TOUR.on) tourEnd(); tab('H'); segGo('hSeg', 's'); });
  await p.waitForTimeout(300);
  const st = await p.evaluate(() => ({ lang: LANG, html: document.documentElement.lang, saved: localStorage.getItem('agro_lang_v1'),
    bar: document.getElementById('farmBar').textContent, crop: document.getElementById('hCrop').textContent,
    name: FARMS.list.filter((f) => f.id === 'demo')[0].name, cr: D.filter((e) => /пшениц/i.test(e.cr || '')).length }));
  ok('язык из ссылки включён и запомнен', st.lang === 'kk' && st.html === 'kk' && st.saved === 'kk', st);
  ok('демо-хозяйство и область по-казахски', /Демо-шаруашылық, Қостанай облысы/.test(st.bar), st.bar);
  ok('культуры на «Сводке» по-казахски', /жаздық бидай/.test(st.crop) && /арпа/.test(st.crop) && !/яровая пшеница/.test(st.crop), st.crop);
  ok('данные не тронуты: имя хозяйства и культуры в записях по-русски', st.name === 'Демо-хозяйство, Костанайская обл.' && st.cr > 0, st);
  const chk = await p.evaluate(() => runChecks(ctxOf ? ctxOf() : { D: D, AR: AR }).filter((c) => c.src === 'rot').map((c) => c.t + ' ' + c.x).join(' | '));
  ok('предупреждения о севообороте по-казахски', /монокультура/.test(chk) && /қатарынан үш жыл|жылдан кейін қайта егілді/.test(chk) && !/три года подряд|Культура вернулась/.test(chk), chk);
  await p.evaluate(() => { tab('L'); }); await p.waitForTimeout(300);
  const lc = await p.evaluate(() => ({ cards: document.getElementById('lCards').textContent, rot: document.getElementById('lRot').textContent }));
  ok('вкладка «Алқаптар»: число полей, культуры и таблица севооборота по-казахски', /\d+ алқап/.test(lc.cards) && /жаздық бидай/.test(lc.cards) && /Келесі:/.test(lc.cards) && !/яровая пшеница|полей/.test(lc.cards) && /Алқап/.test(lc.rot) && !/яровая пшеница|По записям/.test(lc.rot), lc);
  await p.evaluate(() => { tab('D'); }); await p.waitForTimeout(300);
  const dj = await p.evaluate(() => { const L = document.getElementById('dList'); return { t: L ? L.textContent : '', sum: (document.getElementById('dSum') || {}).textContent || '' }; });
  ok('журнал: «жиналды», «Өзгерту», «Жою» и итоги по сезонам по-казахски', /жиналды \d/.test(dj.t) && /Өзгерту/.test(dj.t) && /Жою/.test(dj.t) && !/собрано \d|Изменить|Удалить/.test(dj.t) && !/суммируются внутри года/.test(dj.sum), { t: dj.t.slice(0, 300), sum: dj.sum.slice(-200) });
  await p.evaluate(() => { document.getElementById('lRu').onclick(); tab('H'); segGo('hSeg', 's'); }); await p.waitForTimeout(300);
  const ru = await p.evaluate(() => ({ bar: document.getElementById('farmBar').textContent, crop: document.getElementById('hCrop').textContent, saved: localStorage.getItem('agro_lang_v1') }));
  ok('переключение на русский возвращает русские названия', /Демо-хозяйство, Костанайская обл\./.test(ru.bar) && /яровая пшеница/.test(ru.crop) && ru.saved === 'ru', ru);
  const cr = await p.evaluate(() => {
    const kk = { 'Жаздық бидай': 'яровая пшеница', 'Күздік бидай': 'озимая пшеница', 'Арпа': 'ячмень', 'Сұлы': 'овёс', 'Жүгері': 'кукуруза', 'Күнбағыс': 'подсолнечник',
      'Майлы зығыр': 'лён масличный', 'Асбұршақ': 'горох', 'Ноқат': 'горох', 'Картоп': 'картофель', 'Жоңышқа': 'многолетние травы', 'Сүдігер': 'пар', 'Күріш': 'рис' };
    const ru = { 'Пшеница яровая Омская 36': 'яровая пшеница', 'Озимая пшеница': 'озимая пшеница', 'Ячмень': 'ячмень', 'Рис': 'рис', 'пар': 'пар', 'Лён': 'лён масличный', 'Нут': 'горох' };
    const bad = [];
    Object.keys(kk).forEach((n) => { if (cropOf(n).k !== kk[n]) bad.push(n + '→' + cropOf(n).k); });
    Object.keys(ru).forEach((n) => { if (cropOf(n).k !== ru[n]) bad.push(n + '→' + cropOf(n).k); });
    Object.keys(CROPKK).forEach((k) => { if (cropOf(CROPKK[k]).k !== k) bad.push('показ ' + CROPKK[k] + '→' + cropOf(CROPKK[k]).k); });
    if (cropYear({ d: '2026-09-05', cr: 'Күздік бидай' }) !== 2027) bad.push('озимая осенью по-казахски — урожай следующего года');
    if (cropYear({ d: '2026-09-05', cr: 'Озимая пшеница' }) !== 2027) bad.push('озимая осенью по-русски — урожай следующего года');
    if (cropYear({ d: '2026-05-10', cr: 'Жаздық бидай' }) !== 2026) bad.push('яровая весной — урожай этого года');
    return bad; });
  ok('казахские названия культур распознаются, русские — как раньше', cr.length === 0, cr);
  await p.goto(APP + '?lang=xx'); await p.waitForTimeout(500);
  ok('незнакомый язык в ссылке игнорируется', await p.evaluate(() => LANG === 'ru'));
  ok('ошибок нет', errs.length === 0, errs);
  console.log(fails ? 'FAILED ' + fails : 'ALL OK'); await b.close(); web.close();
})();
