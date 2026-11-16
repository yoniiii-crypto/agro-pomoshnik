// Команда общего хозяйства: автор записи, задачи «кому», карточка «Команда», выгрузка автора в Excel.
// Нужен Playwright. Запуск: NODE_PATH=$(npm root -g) node tests/ui-team.test.js
const { chromium } = require('playwright'); const fs = require('fs');
const http = require('http'), path = require('path'); const ROOT = path.resolve(__dirname, '..'); let APP = '';
const web = http.createServer((rq, rs) => { const f = path.join(ROOT, decodeURIComponent(new URL(rq.url, 'http://x').pathname)); if (!f.startsWith(ROOT + '/') || !fs.existsSync(f) || !fs.statSync(f).isFile()) { rs.writeHead(404); return rs.end(); } rs.writeHead(200, { 'Content-Type': f.endsWith('.html') ? 'text/html; charset=utf-8' : f.endsWith('.js') ? 'text/javascript' : 'application/octet-stream' }); fs.createReadStream(f).pipe(rs); });
let fails = 0; const ok = (n, c, x) => { if (!c) fails++; console.log((c ? 'ok  ' : 'FAIL') + ' ' + n + (!c && x !== undefined ? ' | ' + JSON.stringify(x) : '')); };
(async () => {
  await new Promise((r) => web.listen(0, '127.0.0.1', r)); APP = 'http://127.0.0.1:' + web.address().port + '/index.html';
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, acceptDownloads: true, serviceWorkers: 'block' });
  await ctx.route(/open-meteo|workers\.dev/, (r) => r.abort());
  await ctx.addInitScript(() => { if (localStorage.getItem('agro_onb_v1') == null) localStorage.setItem('agro_onb_v1', '1'); });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(APP); await p.waitForTimeout(400);
  // обычное хозяйство: ничего командного
  await p.evaluate(() => { localStorage.setItem('agro_me_v1', 'Агроном Ерлан'); D.push({ id: 1, f: 'Поле 1', d: '2026-05-10', o: 'Сев или посадка', cr: 'Пшеница', c: 0, y: 0, p: '', n: '' }); save(); tab('K'); });
  ok('в необщем хозяйстве нет поля «Кому», карточки «Команда» и подписи', !(await p.$('#kTo')) && await p.evaluate(() => !D[0].by && $('hTeam').classList.contains('hidden')));
  // делаем вид, что хозяйство общее (без сервера: телефон без связи)

  await p.evaluate(() => { localStorage.setItem('agro_sync_v1', JSON.stringify({ v: 1, code: 'ABCDEFGHJKMNPQRSTVWX', id: '0123456789abcdef', ro: 0, h: { agro_diary_v1: { 1: 'x' }, agro_tasks_v1: {} }, s: {}, d: {}, tag: '0123456789abcdef' })); });
  await p.reload(); await p.waitForTimeout(400);
  await p.evaluate(() => { tab('D'); openSheet('new'); }); await p.waitForTimeout(250); await p.fill('#dField', 'Поле 2'); await p.fill('#dNote', 'осмотр'); await p.click('#dAdd'); await p.waitForTimeout(200);
  await p.evaluate(() => { D.push({ id: 5, f: 'Поле 1', d: '2026-11-12', o: 'Осмотр поля', cr: '', c: 0, y: 0, p: '', n: 'ржавчина', by: 'Фермер Ахмет' }, { id: 6, f: 'Поле 3', d: '2026-11-13', o: 'Удобрения', cr: '', c: 0, y: 0, p: '', n: '', by: 'агроном ерлан' }); save(); });
  ok('новая запись подписана, чужая подпись не перезаписана, старая без подписи', await p.evaluate(() => D.filter((e) => e.n === 'осмотр')[0].by === 'Агроном Ерлан' && D.filter((e) => e.id === 5)[0].by === 'Фермер Ахмет' && !D.filter((e) => e.id === 1)[0].by));
  await p.evaluate(() => tab('K')); await p.waitForSelector('#kTo'); await p.fill('#kN', 'Подготовить опрыскиватель'); await p.fill('#kTo', 'Фермер Ахмет'); await p.click('#kAdd'); await p.waitForTimeout(150);
  await p.fill('#kN', 'Купить семена'); await p.fill('#kTo', 'агроном ерлан'); await p.click('#kAdd'); await p.waitForTimeout(150);
  ok('задачи с полем «Кому», подсказки имён', await p.evaluate(() => TK.length === 2 && TK[0].to === 'Фермер Ахмет' && TK[0].by === 'Агроном Ерлан' && [...document.querySelectorAll('#kTeam option')].map((o) => o.value).includes('Фермер Ахмет')));
  const cal = await p.textContent('#calL'); ok('в плане: «кому» и метка «вам» только у своей задачи', /кому: Фермер Ахмет/.test(cal) && (cal.match(/вам/g) || []).length === 1, cal);
  await p.screenshot({ path: require('os').tmpdir() + '/shot_team_plan.png', fullPage: false });
  await p.evaluate(() => tab('H')); await p.waitForTimeout(300);
  const team = await p.textContent('#hTeam');
  ok('карточка «Команда»: записи коллег (без своих, без учёта регистра), задачи для вас', /Фермер Ахмет/.test(team) && !/Удобрения · Поле 3/.test(team) && /Задач для вас: 1/.test(team), team);
  await (await p.$('#hTeam')).scrollIntoViewIfNeeded(); await p.waitForTimeout(150); await (await p.$('#hTeam')).screenshot({ path: require('os').tmpdir() + '/shot_team_home.png' });
  await p.evaluate(() => tab('D')); ok('в дневнике видно автора', /автор: Фермер Ахмет/.test(await p.textContent('#dList')));
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#dCsv')]); const csv = fs.readFileSync(await dl.path(), 'utf8');
  ok('выгрузка в Excel с колонкой «Автор»', /;Автор\r\n/.test(csv) && /Фермер Ахмет/.test(csv), csv.slice(0, 200));
  const back = await p.evaluate((t) => impRows(csvParse(t)).ok.map((e) => e.by || ''), csv);
  ok('загрузка той же таблицы сохраняет автора', back.includes('Фермер Ахмет') && back.includes('Агроном Ерлан') && back.filter((x) => !x).length === 1, back);
  await p.evaluate(() => { localStorage.setItem('agro_lang_v1', 'kk'); }); await p.reload(); await p.waitForTimeout(400); await p.evaluate(() => tab('H')); await p.waitForTimeout(200);
  { const kt = await p.textContent('#hTeam'); ok('по-казахски карточка тоже переведена', /Әріптестердің соңғы жазбалары/.test(kt), [kt, await p.evaluate(() => [LANG, Object.keys(localStorage).length])]); }
  await p.evaluate(() => { localStorage.setItem('agro_lang_v1', 'ru'); tab('X', 'mFarm'); }); await p.reload(); await p.waitForTimeout(300); await p.evaluate(() => tab('X', 'mFarm')); await p.waitForTimeout(300);
  await (await p.$('#mSync')).screenshot({ path: require('os').tmpdir() + '/shot_team_sync.png' });
  ok('в разделе «Общая база» есть поле имени', await p.inputValue('#syMe') === 'Агроном Ерлан');
  ok('ошибок на странице нет', errs.length === 0, errs);
  console.log(fails ? 'FAILED ' + fails : 'ALL OK'); await b.close(); web.close();
})();
