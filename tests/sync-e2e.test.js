// Общая база: сквозная проверка на двух «телефонах» (два отдельных браузера) и настоящем коде сервера.
// Сервер работает в этом же процессе: запросы страницы перехватываются и передаются в server/ai-proxy-worker.js,
// вместо Cloudflare D1 — SQLite. Приложение открывается с маленького локального http-сервера, как с сайта:
// у страницы, открытой файлом, Chromium после перезагрузки иногда даёт пустое хранилище.
// Нужен Playwright. Запуск: node tests/sync-e2e.test.js
const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
let APP = '';
const SRV = 'https://agro-ai.example.workers.dev';
const SITE = 'https://yoniiii-crypto.github.io';
let fails = 0; const ok = (name, cond, extra) => { if (!cond) fails++; console.log((cond ? 'ok  ' : 'FAIL') + ' ' + name + (extra !== undefined && !cond ? ' | ' + JSON.stringify(extra) : '')); };

(async () => {
  const worker = (await import(path.resolve(__dirname, '..', 'server', 'ai-proxy-worker.js'))).default;
  const { fakeD1 } = await import(path.resolve(__dirname, 'fake-d1.mjs'));
  const db = fakeD1(); const env = { GEMINI_KEY: 'K', AGRO_DB: db }; const log = [];
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };
  const web = http.createServer((rq, rs) => {
    const f = path.join(ROOT, decodeURIComponent(new URL(rq.url, 'http://x').pathname));
    if (!f.startsWith(ROOT + path.sep) || !fs.existsSync(f) || !fs.statSync(f).isFile()) { rs.writeHead(404); return rs.end(); }
    rs.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(rs);
  });
  await new Promise((r) => web.listen(0, '127.0.0.1', r)); APP = 'http://127.0.0.1:' + web.address().port + '/index.html';
  const b = await chromium.launch();
  const device = async (name, o = {}) => {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    await ctx.route(/open-meteo/, (r) => r.abort());
    await ctx.addInitScript((u) => { try { if (localStorage.getItem('agro_aiproxy_v1') == null) localStorage.setItem('agro_aiproxy_v1', u); if (localStorage.getItem('agro_onb_v1') == null) localStorage.setItem('agro_onb_v1', '1'); } catch (e) {} }, SRV);
    await ctx.route(/agro-ai\.example\.workers\.dev/, async (route) => {
      const rq = route.request(); const H = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
      if (o.oldServer) return route.fulfill({ status: 400, contentType: 'application/json', headers: H, body: JSON.stringify({ error: { code: 400, message: 'Bad model' } }) });
      const res = await worker.fetch(new Request(rq.url(), { method: rq.method(), headers: { 'Content-Type': 'application/json', Origin: SITE, 'CF-Connecting-IP': name }, body: rq.method() === 'POST' ? rq.postData() : undefined }), env);
      if (rq.method() === 'POST') log.push(name + ' ' + new URL(rq.url()).pathname.replace('/sync/', '') + ' ' + res.status);
      const h = {}; res.headers.forEach((v, k) => { h[k] = v; }); Object.assign(h, H);
      await route.fulfill({ status: res.status, headers: h, body: await res.text() });
    });
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    return { ctx, p, errs, name };
  };
  const ids = (d) => d.p.evaluate(() => D.map((e) => e.id).sort((x, y) => x - y).join(','));
  const sync = async (d) => { await d.p.evaluate(() => syncRun(FARMS.cur, true)); await d.p.waitForTimeout(150); };
  const farms = () => db._db.prepare('SELECT id, length(data) AS n, data FROM farms').all();

  // Телефон A: своё хозяйство с записями
  const A = await device('A'); await A.p.goto(APP); await A.p.waitForTimeout(500);
  await A.p.evaluate(() => { FARMS.list[0].name = 'КХ «Береке»'; saveFarms(); D.push({ id: 1001, f: 'Поле 1', d: '2026-05-16', o: 'Сев или посадка', cr: 'Яровая пшеница', c: 3500000, y: 0, p: '', n: 'норма 120 кг/га' }, { id: 1002, f: 'Поле 2', d: '2026-09-03', o: 'Уборка', cr: 'Ячмень', c: 900000, y: 320, p: '', n: '' }); save();
    AR['Поле 1'] = 420; AR['Поле 2'] = 380; saveAR(); TK.push({ id: 2001, d: '2026-11-20', o: 'Другое', f: '', n: 'Договор на семена', done: 0 }); saveTK(); PR['яровая пшеница'] = 92000; savePR(); tab('X', 'mFarm'); });
  await A.p.waitForSelector('#syMake', { timeout: 10000 });
  ok('раздел «Общая база» появился, когда сервер его поддерживает', await A.p.isVisible('#syMake') && await A.p.isVisible('#syCode'));
  await A.p.click('#syMake'); await A.p.click('#dlgOk'); await A.p.waitForSelector('#syCodeT', { state: 'visible', timeout: 10000 });
  const code = (await A.p.textContent('#syCodeT')).trim();
  ok('после «Сделать общим» показан код из 20 знаков', /^([0-9A-HJKMNP-TV-Z]{4}-){4}[0-9A-HJKMNP-TV-Z]{4}$/.test(code), code);
  let F = farms(); ok('на сервере одно хозяйство, и в нём нет открытого текста', F.length === 1 && !/Поле|Береке|пшеница|1001/.test(F[0].data) && !F[0].data.includes(code.replace(/-/g, '')), F.map((x) => x.n));
  ok('строка состояния под заголовком показывает «общее»', /общее/.test(await A.p.textContent('#farmBar')), await A.p.textContent('#farmBar'));

  // Телефон B: подключение по ссылке-приглашению
  const B = await device('B'); await B.p.goto(APP + '#join=' + code); await B.p.waitForSelector('#dlg:not(.hidden)', { timeout: 10000 });
  ok('ссылка-приглашение спрашивает подтверждение', /Подключить общее хозяйство/.test(await B.p.textContent('#dlgT')) && !(await B.p.evaluate(() => location.hash)));
  await Promise.all([B.p.waitForEvent('load'), B.p.click('#dlgOk')]); await B.p.waitForFunction(() => typeof D != 'undefined' && D.length > 0, null, { timeout: 10000 });
  ok('на втором телефоне появились записи, поля, план, цены и название', await ids(B) === '1001,1002' && await B.p.evaluate(() => AR['Поле 1'] === 420 && TK.length === 1 && PR['яровая пшеница'] === 92000 && farmName(FARMS.cur) === 'КХ «Береке»' && FARMS.list.length === 1));
  ok('пустое хозяйство на втором телефоне заменено общим, а не добавлено вторым', await B.p.evaluate(() => FARMS.list.length === 1 && !!syncMeta(FARMS.cur)));

  // Запись на B через форму → доходит до A без перезагрузки страницы
  await B.p.evaluate(() => { tab('D'); openSheet('new'); }); await B.p.waitForTimeout(300); await B.p.fill('#dField', 'Поле 1'); await B.p.fill('#dNote', 'осмотр агронома: ржавчина'); await B.p.click('#dAdd'); await B.p.waitForFunction(() => D.length === 3);
  const t0 = Date.now(); while (!log.includes('B put 200') && Date.now() - t0 < 20000) await B.p.waitForTimeout(250);
  ok('телефон B сам отправил новую запись через несколько секунд (' + ((Date.now() - t0) / 1000).toFixed(1) + ' с)', log.includes('B put 200') && Date.now() - t0 < 15000, log.slice(-4));
  // Правка уже после запуска приложения: телефон замечает её сам и отправляет через несколько секунд
  await B.p.waitForTimeout(1200); const puts0 = log.filter((x) => x === 'B put 200').length, t1 = Date.now();
  await B.p.evaluate(() => { const e = D[D.length - 1]; e.n += ', очаги по краю поля'; save(); });
  while (log.filter((x) => x === 'B put 200').length === puts0 && Date.now() - t1 < 20000) await B.p.waitForTimeout(250);
  ok('правка после запуска ушла сама (' + ((Date.now() - t1) / 1000).toFixed(1) + ' с)', log.filter((x) => x === 'B put 200').length === puts0 + 1 && Date.now() - t1 < 12000);
  let loads = 0; A.p.on('load', () => loads++); await A.p.evaluate(() => tab('D')); await sync(A);
  ok('запись агронома появилась на телефоне A без перезагрузки страницы', (await A.p.evaluate(() => D.length)) === 3 && loads === 0 && /ржавчина, очаги по краю поля/.test(await A.p.textContent('#dList')));

  // Удаление на A → пропадает на B; правка на B → доходит до A
  await A.p.evaluate(() => { D = D.filter((e) => e.id !== 1002); save(); }); await sync(A);
  await B.p.evaluate(() => { const e = D.filter((x) => x.id === 1001)[0]; e.c = 4000000; save(); }); await sync(B); await sync(A);
  ok('удаление и правка разошлись по обоим телефонам', !(await ids(A)).includes('1002') && !(await ids(B)).includes('1002') && (await A.p.evaluate(() => D.filter((x) => x.id === 1001)[0].c)) === 4000000 && await ids(A) === await ids(B));

  // Оба без связи добавляют записи, потом связь возвращается
  await A.ctx.setOffline(true); await B.ctx.setOffline(true);
  await A.p.evaluate(() => { D.push({ id: 3001, f: 'Поле 2', d: '2026-11-10', o: 'Осмотр поля', cr: '', c: 0, y: 0, p: '', n: 'офлайн A' }); save(); AR['Поле 3'] = 510; saveAR(); });
  await B.p.evaluate(() => { D.push({ id: 3002, f: 'Поле 1', d: '2026-11-11', o: 'Осмотр поля', cr: '', c: 0, y: 0, p: '', n: 'офлайн B' }); save(); TK.push({ id: 2002, d: '2026-11-25', o: 'Другое', f: '', n: 'Снегозадержание', done: 0 }); saveTK(); });
  const off = await A.p.evaluate(() => syncRun(FARMS.cur, true)); ok('без интернета синхронизация тихо откладывается', off && off.offline === true);
  await A.ctx.setOffline(false); await B.ctx.setOffline(false); await sync(A); await sync(B); await sync(A);
  ok('записи, сделанные без связи на двух телефонах, слились', (await ids(A)).includes('3001') && (await ids(A)).includes('3002') && await ids(A) === await ids(B) && await A.p.evaluate(() => TK.length === 2 && AR['Поле 3'] === 510) && await B.p.evaluate(() => AR['Поле 3'] === 510));

  // Чужая правка приходит, пока на A открыта форма с набранным текстом
  await A.p.evaluate(() => { tab('D'); openSheet('new'); }); await A.p.waitForTimeout(300); await A.p.fill('#dNote', 'набираю и не хочу потерять');
  await B.p.evaluate(() => { D.push({ id: 4001, f: 'Поле 2', d: '2026-11-12', o: 'Удобрения', cr: '', c: 100, y: 0, p: '', n: 'пока A печатает' }); save(); }); await sync(B); await sync(A);
  ok('данные обновились, а открытая форма и набранный текст на месте', (await ids(A)).includes('4001') && await A.p.inputValue('#dNote') === 'набираю и не хочу потерять' && await A.p.isVisible('#sheetW'));
  await A.p.fill('#dField', 'Поле 3'); await A.p.click('#dAdd'); await A.p.waitForTimeout(300); await sync(A); await sync(B);
  ok('запись из открытой формы сохранилась и не затёрла чужую', (await A.p.evaluate(() => D.some((e) => e.n === 'набираю и не хочу потерять') && D.some((e) => e.id === 4001))) && await ids(A) === await ids(B));

  // Переименование хозяйства и нормы агронома
  await A.p.evaluate(() => { FARMS.list[0].name = 'КХ «Береке-2»'; saveFarms(); NORMS.y['N|Яровая пшеница'] = 15; saveNorms(); }); await sync(A); await sync(B);
  ok('новое название и норма агронома дошли до второго телефона', await B.p.evaluate(() => farmName(FARMS.cur) === 'КХ «Береке-2»' && NORMS.y['N|Яровая пшеница'] === 15));

  // Команда: имя телефона, автор записи, задача «кому», карточка «Команда» на Сводке
  await A.p.evaluate(() => tab('X', 'mFarm')); await A.p.waitForSelector('#syMe'); await A.p.fill('#syMe', '  Фермер   Ахмет '); await A.p.click('#syMeS');
  ok('имя телефона сохраняется без лишних пробелов', await A.p.evaluate(() => syncMe() === 'Фермер Ахмет' && $('syMe').value === 'Фермер Ахмет'));
  const nA = await A.p.evaluate(() => D.length);
  await B.p.evaluate(() => { localStorage.setItem('agro_me_v1', 'Агроном Ерлан'); tab('D'); openSheet('new'); }); await B.p.waitForTimeout(300); await B.p.fill('#dField', 'Поле 2'); await B.p.fill('#dNote', 'запись агронома с подписью'); await B.p.click('#dAdd'); await B.p.waitForTimeout(200);
  await B.p.evaluate(() => tab('K')); await B.p.waitForSelector('#kTo'); await B.p.fill('#kN', 'Проверить влагу на Поле 2'); await B.p.fill('#kTo', 'фермер ахмет'); await B.p.click('#kAdd'); await B.p.waitForTimeout(200);
  ok('новая запись и задача агронома подписаны его именем, старые записи — без подписи', await B.p.evaluate(() => D.filter((e) => e.n === 'запись агронома с подписью')[0].by === 'Агроном Ерлан' && TK.filter((t) => t.n === 'Проверить влагу на Поле 2')[0].by === 'Агроном Ерлан' && !D.filter((e) => e.id === 1001)[0].by));
  await sync(B); await sync(A); await A.p.evaluate(() => tab('H')); await A.p.waitForTimeout(300);
  const team = await A.p.textContent('#hTeam'), htask = await A.p.textContent('#hTask');
  ok('у фермера на Сводке: запись агронома с его именем и задача с пометкой «вам»', (await A.p.evaluate(() => D.length)) === nA + 1 && /Агроном Ерлан/.test(team) && /Задач для вас: 1/.test(team) && /кому: фермер ахмет/.test(htask) && /вам/.test(htask) && /автор: Агроном Ерлан/.test(htask), [team, htask]);
  await A.p.evaluate(() => { D.push({ id: 8001, f: 'Поле 1', d: '2026-11-14', o: 'Осмотр поля', cr: '', c: 0, y: 0, p: '', n: 'своя запись' }); save(); tab('H'); }); await A.p.waitForTimeout(200);
  ok('фермеру пришло сообщение о новой задаче от агронома', /Новая задача для вас: «Проверить влагу на Поле 2» \(Агроном Ерлан\)/.test(await A.p.textContent('#toastT')), await A.p.textContent('#toastT'));
  await A.p.click('#hTask [data-done="' + (await A.p.evaluate(() => TK.filter((t) => t.n === 'Проверить влагу на Поле 2')[0].id)) + '"]'); await A.p.waitForTimeout(300); await sync(A); await B.p.evaluate(() => tab('K')); await sync(B);
  ok('агроному пришло сообщение, что фермер выполнил задачу, в плане видно кто', /Задача выполнена: «Проверить влагу на Поле 2» \(Фермер Ахмет\)/.test(await B.p.textContent('#toastT')) && /✓ Фермер Ахмет/.test(await B.p.textContent('#calL')), [await B.p.textContent('#toastT')]);
  ok('своя запись подписана, но в «Записи коллег» не попадает', await A.p.evaluate(() => D.filter((e) => e.id === 8001)[0].by === 'Фермер Ахмет') && !/своя запись|Фермер Ахмет/.test(await A.p.textContent('#hTeam')));
  await A.p.evaluate(() => tab('D')); ok('в дневнике видно, кто сделал запись', /автор: Агроном Ерлан/.test(await A.p.textContent('#dList')));
  await sync(A); await sync(B);
  ok('у агронома подпись фермера тоже на месте', await B.p.evaluate(() => (D.filter((e) => e.id === 8001)[0] || {}).by === 'Фермер Ахмет'));

  // Обсуждение записи: агроном комментирует, фермер получает сообщение и отвечает; одновременные комментарии не теряются
  await B.p.evaluate(() => tab('D')); await B.p.click('[data-cmo="1001"]'); await B.p.waitForSelector('[data-cmi="1001"]');
  await B.p.fill('[data-cmi="1001"]', 'Похоже на септориоз, пришлите фото листа'); await B.p.click('[data-cms="1001"]'); await B.p.waitForTimeout(150);
  ok('комментарий агронома сохранён с его именем', await B.p.evaluate(() => CM.length === 1 && CM[0].by === 'Агроном Ерлан' && CM[0].e === '1001'));
  await sync(B); await A.p.evaluate(() => tab('D')); await sync(A);
  ok('фермеру пришло сообщение о комментарии, у записи счётчик', /Новый комментарий \(Агроном Ерлан\): «Похоже на септориоз/.test(await A.p.textContent('#toastT')) && /Обсудить \(1\)/.test(await A.p.textContent('[data-cmo="1001"]')), await A.p.textContent('#toastT'));
  await A.p.click('#toastB'); await A.p.waitForSelector('[data-cmi="1001"]'); await A.p.fill('[data-cmi="1001"]', 'Фото пришлю вечером'); await A.p.press('[data-cmi="1001"]', 'Enter'); await A.p.waitForTimeout(150);
  await B.p.click('[data-cmi="1001"]'); await B.p.type('[data-cmi="1001"]', 'черновик агронома');
  await sync(A); await sync(B);
  ok('агроном видит ответ фермера сразу, хотя набирает текст: набранное не пропало', /Фото пришлю вечером/.test(await B.p.textContent('[data-cml="1001"]')) && await B.p.inputValue('[data-cmi="1001"]') === 'черновик агронома' && await B.p.evaluate(() => document.activeElement && document.activeElement.dataset.cmi === '1001') && /Новый комментарий \(Фермер Ахмет\)/.test(await B.p.textContent('#toastT')) && /Обсудить \(2\)/.test(await B.p.textContent('[data-cmo="1001"]')));
  await B.p.fill('[data-cmi="1001"]', ''); await B.p.evaluate(() => { delete CMDRAFT['1001']; document.activeElement.blur(); });
  await A.p.evaluate(() => { CM.push({ id: 'cA', e: '1001', by: 'Фермер Ахмет', t: 'одновременно A', d: Date.now() }); saveCM(); });
  await B.p.evaluate(() => { CM.push({ id: 'cB', e: '1001', by: 'Агроном Ерлан', t: 'одновременно B', d: Date.now() }); saveCM(); });
  await sync(A); await sync(B); await sync(A);
  ok('комментарии, написанные одновременно, сохранились оба', await A.p.evaluate(() => CM.length === 4) && await B.p.evaluate(() => CM.length === 4));
  await A.p.evaluate(() => tab('H')); await A.p.waitForTimeout(150); ok('на «Сводке» фермера — комментарии коллег', /Комментарии коллег/.test(await A.p.textContent('#hTeam')) && /одновременно B/.test(await A.p.textContent('#hTeam')));

  // Склад: продажа, записанная агрономом, видна у фермера
  await B.p.evaluate(() => { SALES.push({ id: 'sB1', y: 2026, k: 'ячмень', t: 50, p: 80000, d: '2026-11-15', b: 'Элеватор' }); saveSL(); }); await sync(B); await A.p.evaluate(() => tab('L')); await sync(A);
  ok('продажа зерна с одного телефона видна на другом', await A.p.evaluate(() => SALES.some((x) => x.id === 'sB1' && x.t === 50 && x.p === 80000)));
  await B.p.evaluate(() => { BND['Поле 1'] = [[52.7, 63.6], [52.702, 63.6], [52.702, 63.603]]; saveBND(); }); await sync(B); await sync(A);
  ok('граница поля с одного телефона видна на другом', await A.p.evaluate(() => !!BND['Поле 1'] && BND['Поле 1'].length === 3 && BND['Поле 1'][1][0] === 52.702));

  // Общие фото: снимок с телефона A шифруется, уходит на сервер и появляется у B
  const pid = await A.p.evaluate(() => new Promise((res) => { const c = document.createElement('canvas'); c.width = 240; c.height = 160; const g = c.getContext('2d'); g.fillStyle = '#3a7'; g.fillRect(0, 0, 240, 160); g.fillStyle = '#c33'; g.fillRect(40, 30, 60, 60);
    c.toBlob((bl) => { const id = 'p' + Date.now().toString(36) + 'te'; pPut(id, bl).then(() => { D.push({ id: 9100, f: 'Поле 1', d: '2026-11-15', o: 'Осмотр поля', cr: '', c: 0, y: 0, p: '', n: 'фото ржавчины', ph: [id] }); save(); res(id); }); }, 'image/jpeg', 0.8); }));
  await sync(A);
  const sizeA = await A.p.evaluate((id) => pGet(id).then((x) => x.size), pid), ph = db._db.prepare('SELECT pid, sz, data FROM photos').all();
  ok('фото ушло на сервер зашифрованным', log.includes('A pput 200') && ph.length === 1 && ph[0].pid === pid && !ph[0].data.startsWith('/9j/') && ph[0].sz === ph[0].data.length, ph.map((x) => [x.pid, x.sz, x.data.slice(0, 8)]));
  await sync(A); ok('отправленное фото второй раз не отправляется', log.filter((x) => x === 'A pput 200').length === 1);
  await B.p.evaluate(() => tab('D')); await sync(B); await B.p.waitForTimeout(300);
  ok('у агронома фото загрузилось само, такое же, как у фермера', (await B.p.evaluate((id) => pGet(id).then((x) => x && x.size), pid)) === sizeA && log.includes('B pget 200'));
  ok('в дневнике агронома фото видно', await B.p.evaluate((id) => /blob:/.test((document.querySelector('#dList .ph[data-ph="' + id + '"]') || {}).style.backgroundImage || ''), pid));

  // Только просмотр: отдельный код для банка, страховой или наблюдателя
  await A.p.evaluate(() => tab('X', 'mFarm')); await A.p.waitForSelector('#syShow'); await A.p.click('#syShow'); await A.p.waitForFunction(() => /^[0-9A-Z]{4}-/.test(document.getElementById('syViewT').textContent), null, { timeout: 5000 });
  const vcode = (await A.p.textContent('#syViewT')).trim();
  ok('у владельца два разных кода: для работы и только для просмотра', /^([0-9A-HJKMNP-TV-Z]{4}-){4}[0-9A-HJKMNP-TV-Z]{4}$/.test(vcode) && vcode !== code && (await A.p.textContent('#syCodeT')).trim() === code);
  const V = await device('V'); await V.p.goto(APP + '#view=' + vcode); await V.p.waitForSelector('#dlg:not(.hidden)');
  ok('ссылка просмотра предупреждает о режиме', /только просмотр/.test(await V.p.textContent('#dlgT')));
  await Promise.all([V.p.waitForEvent('load'), V.p.click('#dlgOk')]); await V.p.waitForFunction(() => typeof D != 'undefined' && D.length > 0, null, { timeout: 10000 });
  await V.p.evaluate(() => tab('D')); await V.p.waitForTimeout(900);
  ok('наблюдатель видит записи, в шапке «только просмотр», кнопки «+» нет', await ids(V) === await ids(A) && /только просмотр/.test(await V.p.textContent('#farmBar')) && !(await V.p.isVisible('#navAdd')) && await V.p.evaluate(() => syncMeta(FARMS.cur).ro === 1));
  const before = farms()[0].data; await V.p.evaluate(() => { D.push({ id: 7777, f: 'Поле 1', d: '2026-11-14', o: 'Осмотр поля', cr: '', c: 0, y: 0, p: '', n: 'правка наблюдателя' }); D = D.filter((e) => e.id !== 1001); save(); AR['Чужое поле'] = 5; saveAR(); });
  await sync(V); await V.p.waitForTimeout(200);
  ok('правки наблюдателя не уходят на сервер и откатываются на его телефоне', farms()[0].data === before && !log.some((x) => /^V put/.test(x)) && await ids(V) === await ids(A) && !(await V.p.evaluate(() => 'Чужое поле' in AR)) && /только для просмотра/.test(await V.p.textContent('#toastT')), [await ids(V), await V.p.textContent('#toastT')]);
  await A.p.evaluate(() => { D.push({ id: 6001, f: 'Поле 1', d: '2026-11-14', o: 'Осмотр поля', cr: '', c: 0, y: 0, p: '', n: 'для наблюдателя' }); save(); }); await sync(A); await sync(V);
  ok('новые записи владельца доходят до наблюдателя', (await ids(V)).includes('6001'));
  await V.p.evaluate(() => tab('D')); await V.p.click('[data-cmo="1001"]'); await V.p.waitForTimeout(150);
  ok('наблюдатель читает обсуждение, но написать в нём не может', /Похоже на септориоз/.test(await V.p.textContent('#dList')) && !(await V.p.$('[data-cmi="1001"]')));
  ok('наблюдатель видит фото, но сам фото не отправляет', (await V.p.evaluate((id) => pGetAny(id).then((x) => x && x.size), pid)) === sizeA && !log.some((x) => /^V (pput|pdel)/.test(x)));
  // фото удалённой записи убирается с сервера при суточной уборке
  await A.p.evaluate(() => { D = D.filter((e) => e.id !== 9100); save(); }); await sync(A);
  ok('сразу после удаления записи фото на сервере ещё есть (запас на сутки)', db._db.prepare('SELECT COUNT(*) AS n FROM photos').get().n === 1);
  db._db.prepare('UPDATE photos SET ct = 1').run(); await A.p.evaluate(() => localStorage.removeItem(FK('agro_syncphgc_v1'))); await sync(A);
  ok('через сутки фото удалённой записи убрано с сервера', db._db.prepare('SELECT COUNT(*) AS n FROM photos').get().n === 0 && log.includes('A pdel 200'));
  const W = await device('W'); await W.p.goto(APP); await W.p.waitForTimeout(400); await W.p.evaluate(() => tab('X', 'mFarm')); await W.p.waitForSelector('#syJoin'); await W.p.fill('#syCode', vcode);
  await Promise.all([W.p.waitForEvent('load'), W.p.click('#syJoin')]); await W.p.waitForFunction(() => typeof D != 'undefined' && D.length > 0, null, { timeout: 10000 });
  ok('код просмотра, введённый вручную, сам распознаётся как «только просмотр»', await W.p.evaluate(() => syncMeta(FARMS.cur).ro === 1) && await ids(W) === await ids(A));
  const up = await W.p.evaluate((c) => syncJoin(c, 'w').then((r) => r.already && syncMeta(FARMS.cur).ro === 0), code);
  ok('наблюдатель, получивший код для работы, становится полноправным участником', up === true);

  // Третий телефон: своё хозяйство уже есть — общее добавляется отдельным; неверный код
  const C = await device('C'); await C.p.goto(APP); await C.p.waitForTimeout(400);
  await C.p.evaluate(() => { D.push({ id: 9001, f: 'Своё поле', d: '2026-06-01', o: 'Осмотр поля', cr: '', c: 0, y: 0, p: '', n: '' }); save(); tab('X', 'mFarm'); }); await C.p.waitForSelector('#syJoin');
  await C.p.fill('#syCode', 'ABCD-EFGH-JKMN-PQRS-TVWX'); await C.p.click('#syJoin'); await C.p.waitForFunction(() => /не найдено/.test(document.getElementById('toastT').textContent), null, { timeout: 10000 }).catch(() => {});
  ok('неверный код: понятное сообщение, ничего не подключено', /не найдено/.test(await C.p.textContent('#toastT')) && await C.p.evaluate(() => FARMS.list.length === 1 && !syncMeta(FARMS.cur)));
  await C.p.fill('#syCode', 'abc'); await C.p.click('#syJoin'); ok('неполный код отклоняется без запроса к серверу', /20 знаков/.test(await C.p.textContent('#toastT')));
  await C.p.fill('#syCode', code.toLowerCase().replace(/-/g, ' ')); await Promise.all([C.p.waitForEvent('load'), C.p.click('#syJoin')]); await C.p.waitForFunction(() => typeof D != 'undefined' && D.length > 1, null, { timeout: 10000 });
  ok('на телефоне со своими записями общее хозяйство добавлено отдельным, свои записи целы', await C.p.evaluate(() => FARMS.list.length === 2 && farmName(FARMS.cur) === 'КХ «Береке-2»' && lsJ('agro_diary_v1', 'f1', []).length === 1 && !D.some((e) => e.id === 9001)) && await ids(C) === await ids(A));

  // Кабинет консультанта: все хозяйства на «Сводке», новые записи коллег с прошлого раза
  await C.p.evaluate(() => tab('H')); await C.p.waitForTimeout(200);
  ok('у консультанта на «Сводке» карточка «Мои хозяйства» с обоими хозяйствами', /Мои хозяйства/.test(await C.p.textContent('#hFarms')) && /Хозяйств: 2/.test(await C.p.textContent('#hFarms')) && /КХ «Береке-2»/.test(await C.p.textContent('#hFarms')) && await C.p.isVisible('#hfSync'));
  const sharedC = await C.p.evaluate(() => FARMS.cur);
  await Promise.all([C.p.waitForEvent('load'), C.p.click('#hFarms [data-hfo="f1"]')]); await C.p.waitForFunction(() => typeof FARMS != 'undefined' && FARMS.cur === 'f1');
  await A.p.evaluate(() => { D.push({ id: Date.now(), f: 'Поле 2', d: '2026-11-15', o: 'Осмотр поля', cr: '', c: 0, y: 0, p: '', n: 'для консультанта' }); save(); }); await sync(A);
  await C.p.evaluate(() => tab('H')); await C.p.click('#hfSync'); await C.p.waitForFunction(() => /Обновлено общих хозяйств: 1/.test(document.getElementById('toastT').textContent), null, { timeout: 15000 }).catch(() => {});
  const hf = await C.p.textContent('#hFarms');
  ok('«Обновить» подтянуло общее хозяйство, хотя открыто другое, и показало новую запись коллеги', /новых записей: 1/.test(hf) && await C.p.evaluate((f) => lsJ('agro_diary_v1', f, []).some((e) => e.n === 'для консультанта'), sharedC), hf);
  await Promise.all([C.p.waitForEvent('load'), C.p.click('#hFarms [data-hfo="' + sharedC + '"]')]); await C.p.waitForFunction((f) => typeof FARMS != 'undefined' && FARMS.cur === f, sharedC);
  await C.p.evaluate(() => tab('H')); ok('открытое хозяйство больше не считает записи новыми', !/новых записей/.test(await C.p.textContent('#hFarms')));

  // Отключение телефона и удаление общей копии
  await B.p.evaluate(() => tab('X', 'mFarm')); await B.p.waitForSelector('#syOff'); await B.p.click('#syOff'); await B.p.click('#dlgOk'); await B.p.waitForTimeout(300);
  await A.p.evaluate(() => { D.push({ id: 5001, f: 'Поле 1', d: '2026-11-13', o: 'Осмотр поля', cr: '', c: 0, y: 0, p: '', n: 'после отключения B' }); save(); }); await sync(A);
  const bAfter = await B.p.evaluate(() => syncRun(FARMS.cur, true));
  ok('отключённый телефон хранит свои записи, но новые не получает', bAfter && bAfter.off === true && !(await ids(B)).includes('5001') && (await ids(B)).includes('1001') && !(await B.p.evaluate(() => !!syncMeta(FARMS.cur))));
  await A.p.evaluate(() => tab('X', 'mFarm')); await A.p.waitForSelector('#syDel'); await A.p.click('#syDel'); await A.p.click('#dlgOk'); await A.p.waitForFunction(() => !syncMeta(FARMS.cur), null, { timeout: 10000 });
  F = farms(); ok('«Удалить общую копию»: на сервере пусто, записи на телефоне остались', F.length === 0 && (await ids(A)).includes('5001'));
  const cGone = await C.p.evaluate(() => syncRun(FARMS.cur, true)); await C.p.evaluate(() => tab('X', 'mFarm')); await C.p.waitForTimeout(300);
  ok('другой телефон видит, что копию удалили, и записи у него остались', cGone && cGone.err === 'gone' && /удалили с сервера/.test(await C.p.textContent('#mSync')) && (await C.p.evaluate(() => D.length)) > 3);

  // Старый сервер без общей базы: раздел скрыт, приложение работает как раньше
  const O = await device('O', { oldServer: true }); await O.p.goto(APP); await O.p.waitForTimeout(400); await O.p.evaluate(() => tab('X', 'mFarm')); await O.p.waitForTimeout(1200);
  ok('со старым сервером раздел общей базы скрыт', !(await O.p.$('#syMake')) && !(await O.p.$('#syCode')) && (await O.p.textContent('#mSync')) === '');

  const allErrs = [A, B, C, O, V, W].flatMap((d) => d.errs);
  ok('ошибок на страницах нет', allErrs.length === 0, allErrs);
  console.log('запросы к серверу:', log.length, '|', [...new Set(log.map((x) => x.split(' ').slice(1).join(' ')))].join(', '));
  console.log(fails ? 'FAILED ' + fails : 'ALL OK'); await b.close(); web.close(); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
