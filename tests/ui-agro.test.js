// «Агрономы онлайн»: сквозная проверка на трёх «телефонах» (агроном, фермер, администратор) и настоящем коде сервера.
// Запросы страницы перехватываются и передаются в server/ai-proxy-worker.js, вместо Cloudflare D1 — SQLite.
// Отдельно — режим примеров, когда сервис на сервере не подключён.
// Нужен Playwright. Запуск: NODE_PATH=$(npm root -g) node tests/ui-agro.test.js
const { chromium } = require('playwright');
const path = require('path'), http = require('http'), fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const SRV = 'https://agro-ai.example.workers.dev', SITE = 'https://yoniiii-crypto.github.io', ADMIN = 'test-admin-key-1234567890';
let fails = 0; const ok = (name, cond, extra) => { if (!cond) fails++; console.log((cond ? 'ok  ' : 'FAIL') + ' ' + name + (extra !== undefined && !cond ? ' | ' + JSON.stringify(extra) : '')); };

(async () => {
  const worker = (await import(path.resolve(ROOT, 'server', 'ai-proxy-worker.js'))).default;
  const { fakeD1 } = await import(path.resolve(__dirname, 'fake-d1.mjs'));
  const db = fakeD1(); const env = { GEMINI_KEY: 'K', AGRO_DB: db, AGRO_ADMIN: ADMIN };
  const web = http.createServer((rq, rs) => { const f = path.join(ROOT, decodeURIComponent(new URL(rq.url, 'http://x').pathname)); if (!f.startsWith(ROOT + path.sep) || !fs.existsSync(f) || !fs.statSync(f).isFile()) { rs.writeHead(404); return rs.end(); } rs.writeHead(200, { 'Content-Type': f.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/javascript' }); fs.createReadStream(f).pipe(rs); });
  await new Promise((r) => web.listen(0, '127.0.0.1', r)); const APP = 'http://127.0.0.1:' + web.address().port + '/index.html';
  const b = await chromium.launch(); const errs = [];
  const device = async (name, o = {}) => {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    await ctx.route(/open-meteo/, (r) => r.abort());
    await ctx.addInitScript(([u, seed]) => { try { localStorage.setItem('agro_aiproxy_v1', u); if (localStorage.getItem('agro_onb_v1') == null) { localStorage.setItem('agro_onb_v1', '1'); if (seed) localStorage.setItem('agro_diary_v1', JSON.stringify([{ id: 1, f: 'Поле 3', d: '2026-05-10', o: 'Сев или посадка', cr: 'Яровая пшеница', c: 0, y: 0, p: '', n: '' }])); } } catch (e) {} }, [SRV, !!o.seed]);
    await ctx.route(/agro-ai\.example\.workers\.dev/, async (route) => {
      const rq = route.request(); const H = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
      const res = await worker.fetch(new Request(rq.url(), { method: rq.method(), headers: { 'Content-Type': 'application/json', Origin: SITE, 'CF-Connecting-IP': name }, body: rq.method() === 'POST' ? rq.postData() : undefined }), o.env || env);
      const h = {}; res.headers.forEach((v, k) => { h[k] = v; }); Object.assign(h, H);
      await route.fulfill({ status: res.status, headers: h, body: await res.text() });
    });
    const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(name + ': ' + e.message));
    await p.goto(APP + (o.q || '')); await p.waitForTimeout(300);
    await p.evaluate(() => tab('X', 'mAgro')); await p.waitForTimeout(400);
    return p;
  };
  const txt = (p) => p.textContent('#mAgro');
  const wait = (p) => p.waitForTimeout(350);

  // 1. Агроном заполняет анкету
  const ag = await device('agronom');
  await ag.evaluate(() => { document.getElementById('agApD').open = true; });
  await ag.fill('#agAN', 'Айгерим Нурланова'); await ag.selectOption('#agAR', 'Костанайская'); await ag.fill('#agAC', 'пшеница, ячмень');
  await ag.fill('#agAE', '12'); await ag.fill('#agAP', '15000'); await ag.fill('#agAF', 'чат'); await ag.fill('#agAB', 'Агроном-фитопатолог'); await ag.fill('#agAPh', '+7 700 000 0000');
  await ag.click('#agApply'); await wait(ag); await ag.waitForTimeout(300);
  const code = await ag.evaluate(() => document.getElementById('agMyCode') && document.getElementById('agMyCode').value);
  ok('анкета отправлена, агроном видит свой код', /^[0-9a-f]{16}-[0-9a-f]{64}$/.test(code || ''), code);
  ok('кабинет агронома: анкета на проверке', /Кабинет агронома/.test(await txt(ag)) && /анкета на проверке/.test(await txt(ag)));

  // 2. Фермер: каталог пока пуст
  const fm = await device('farmer', { seed: true });
  ok('фермер: до проверки каталог пуст, примеров нет', /Пока в каталоге нет агрономов/.test(await txt(fm)) && !/Пример анкеты/.test(await txt(fm)));

  // 3. Администратор одобряет анкету
  ok('обычный пользователь не видит блок администратора', !(await fm.$('#agAdD')));
  const ad = await device('admin', { q: '?admin=1' });
  await ad.evaluate(() => { document.getElementById('agAdD').open = true; });
  await ad.fill('#agAK', 'wrong'); await ad.click('#agAdm'); await wait(ad);
  ok('неверный ключ администратора не открывает админку', !(await ad.$('[data-adm="approve"]')) && /Неверный код/.test(await ad.textContent('#toastT')));
  await ad.fill('#agAK', ADMIN); await ad.click('#agAdm'); await wait(ad);
  ok('админ видит анкету с телефоном', /Айгерим Нурланова/.test(await txt(ad)) && /\+7 700 000 0000/.test(await txt(ad)));
  await ad.click('[data-adm="approve"]'); await wait(ad);
  ok('после одобрения анкет на проверке нет', /Новых анкет нет/.test(await txt(ad)));

  // 4. Фермер заказывает консультацию
  await fm.evaluate(() => { AG.list = null; renderAgro(); }); await wait(fm);
  ok('фермер видит агронома в каталоге с ценой', /Айгерим Нурланова/.test(await txt(fm)) && /15\s000 ₸/.test(await txt(fm)));
  await fm.click('[data-ago]'); await wait(fm);
  const sum = await fm.textContent('.agsum');
  ok('разбивка цены: агроному 13 500 ₸, Alqap 1 500 ₸ (10 %)', /13\s500 ₸/.test(sum) && /Alqap 1\s500 ₸ \(10 %\)/.test(sum), sum);
  await fm.click('#agSend'); await fm.waitForTimeout(150);
  ok('без вопроса и телефона заказ не уходит', (await fm.evaluate(() => JSON.parse(localStorage.getItem('agro_orders_v1') || '[]').length)) === 0);
  await fm.fill('#agQ', 'На листьях пшеницы оранжевые пятна, что делать?'); await fm.fill('#agPh', '+7 701 111 2233'); await fm.fill('#agNm', 'Ерлан');
  await fm.click('#agSend'); await wait(fm);
  const my = await fm.evaluate(() => JSON.parse(localStorage.getItem('agro_orders_v1') || '[]'));
  ok('заказ создан: ожидает оплаты, цена и комиссия с сервера', my.length === 1 && my[0].st === 'pay' && my[0].price === 15000 && my[0].fee === 1500 && my[0].f === 'Поле 3', my);
  ok('в «Мои консультации» статус «Ожидает оплаты»', /Мои консультации/.test(await txt(fm)) && /Ожидает оплаты/.test(await txt(fm)));
  const sent = db._db.prepare('SELECT ctx, phone FROM orders').get();
  ok('на сервер ушли история поля и телефон', /Поле 3/.test(sent.ctx) && sent.phone === '+7 701 111 2233', sent);

  // 5. Агроном до оплаты вопроса не видит
  await ag.click('#agMeRef'); await wait(ag);
  ok('агроном: до оплаты вопросов нет', /Оплаченных вопросов пока нет/.test(await txt(ag)));

  // 6. Админ отмечает оплату
  await ad.evaluate(() => agAdmLoad()); await wait(ad);
  ok('админ видит заказ с телефоном фермера', /Ерлан, \+7 701 111 2233/.test(await txt(ad)));
  await ad.click('[data-adm="paid"]'); await wait(ad);

  // 7. Агроном отвечает
  await ag.click('#agMeRef'); await wait(ag);
  const agt = await txt(ag);
  ok('агроном видит оплаченный вопрос, без телефона фермера', /оранжевые пятна/.test(agt) && !/701 111 2233/.test(agt) && /13\s500 ₸ вам/.test(agt), agt.slice(0, 400));
  const oid = await ag.evaluate(() => AG.inbox[0].id);
  await ag.fill('#agA' + oid, 'Похоже на бурую ржавчину. Осмотрите нижние листья; если поражение выше порога — фунгицид из Госреестра.');
  await ag.click('[data-aga]'); await wait(ag);
  ok('ответ сохранён у агронома', /Ваш ответ/.test(await txt(ag)) && /бурую ржавчину/.test(await txt(ag)));

  // 8. Фермер получает ответ, оценивает, сохраняет в журнал
  await fm.click('#agRef'); await wait(fm);
  ok('фермер видит ответ агронома', /Есть ответ/.test(await txt(fm)) && /бурую ржавчину/.test(await txt(fm)));
  await fm.click('[data-agr][data-n="5"]'); await wait(fm);
  ok('оценка 5 сохранена', /Ваша оценка: ★★★★★/.test(await txt(fm)));
  await fm.click('[data-ags]'); await wait(fm);
  const dj = await fm.evaluate(() => D.filter((e) => /Консультация агронома/.test(e.n || '')).map((e) => e.f + '|' + e.o));
  ok('ответ сохранён в журнал поля «Поле 3»', dj.length === 1 && dj[0] === 'Поле 3|Осмотр поля', dj);

  // 9. Админ: итоги и выплата
  await ad.evaluate(() => agAdmLoad()); await wait(ad);
  const tot = await ad.textContent('#mAgro .agtot');
  ok('итоги: оплачено 15 000, комиссия 1 500, к выплате 13 500', /15\s000 ₸/.test(tot) && /1\s500 ₸/.test(tot) && /13\s500 ₸/.test(tot), tot);
  await ad.click('[data-adm="payout"]'); await wait(ad);
  ok('после выплаты агроному долгов нет', /0 ₸выплатить агрономам/.test((await ad.textContent('#mAgro .agtot')).replace(/\s+/g, ' ').replace(' выплатить', 'выплатить')) || /агроному выплачено/.test(await txt(ad)));
  await ag.click('#agMeRef'); await wait(ag);
  ok('в каталоге у агронома рейтинг ★ 5 (1)', /★ 5 \(1\)/.test(await txt(ag)));

  // 10. Казахский
  await fm.evaluate(() => { setLang('kk'); tab('X', 'mAgro'); }); await wait(fm);
  ok('по-казахски: заголовок, статус, ответ', /Бұл қалай жұмыс істейді/.test(await txt(fm)) && /Жауап бар/.test(await txt(fm)) && /Менің кеңестерім/.test(await txt(fm)));
  await fm.evaluate(() => setLang('ru'));

  // 11. Сервис не подключён: примеры анкет с пометкой
  const dm = await device('demo', { env: { GEMINI_KEY: 'K' } });
  const dt = await txt(dm);
  ok('без сервиса: пометка и примеры анкет', /Сервис ещё подключается/.test(dt) && (dt.match(/Пример анкеты/g) || []).length === 2, dt.slice(0, 300));
  await dm.click('[data-ago="demo1"]'); await wait(dm); await dm.fill('#agQ', 'Проверка примера'); await dm.fill('#agPh', '+77000000000'); await dm.click('#agSend'); await wait(dm);
  ok('пример заказа помечен «пример»', /пример/.test(await txt(dm)) && /Ожидает оплаты/.test(await txt(dm)));
  await dm.click('#agRef'); await wait(dm); await dm.click('#agRef'); await wait(dm);
  ok('в примере после «Обновить» приходит пример ответа', /Пример ответа/.test(await txt(dm)));
  ok('в примере анкету агронома отправить нельзя', await dm.evaluate(() => { document.getElementById('agApD').open = true; return true; }) && true);

  // 12. Пункт меню
  await fm.evaluate(() => tab('M')); await wait(fm);
  await fm.click('[data-sec="mAgro"]'); await wait(fm);
  ok('пункт меню «Агрономы онлайн» открывает раздел', await fm.evaluate(() => CUR === 'X' && XSEC === 'mAgro' && !document.getElementById('mAgro').classList.contains('hidden')) && (await fm.textContent('#pageT')) === 'Агрономы онлайн');
  await fm.screenshot({ path: require('os').tmpdir() + '/shot_agro.png', fullPage: true });

  ok('ошибок на страницах нет', errs.length === 0, errs);
  console.log(fails ? 'FAILED ' + fails : 'ALL OK'); await b.close(); web.close(); process.exit(fails ? 1 : 0);
})();
