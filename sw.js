/* Alqap (бывший «Агро-помощник»): офлайн-режим. Сначала сеть (чтобы получать обновления), без сети — сохранённая копия.
   При слабой связи в поле сеть может отвечать минутами: если ответа нет за SLOW мс, открываем сохранённую копию,
   а загрузка из сети продолжается в фоне и обновляет копию к следующему запуску. */
const CACHE = 'agro-v8.0';
const SLOW = 3000;
const FILES = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './icon.svg'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  if (new URL(e.request.url).origin !== location.origin) return;
  const net = fetch(e.request).then(r => {
    // в копию попадают только удачные ответы: страница ошибки GitHub не должна заменить рабочую офлайн-копию
    if (r.ok && r.type === 'basic') { const copy = r.clone(); return caches.open(CACHE).then(c => c.put(e.request, copy)).then(() => r, () => r); }
    return r;
  });
  e.waitUntil(net.catch(() => {}));
  const saved = () => caches.match(e.request).then(r => r || (e.request.mode === 'navigate' ? caches.match('./index.html') : undefined));
  e.respondWith(new Promise(resolve => {
    let done = false; const give = r => { if (!done && r) { done = true; resolve(r); } };
    // медленная сеть: через SLOW мс отдаём копию, если она есть
    const t = setTimeout(() => saved().then(give), SLOW);
    net.then(r => {
      clearTimeout(t);
      // сайт ответил ошибкой (например, сбой GitHub) — отдаём сохранённую копию, если она есть
      if (r.ok) give(r); else saved().then(c => give(c || r));
    }, () => { clearTimeout(t); saved().then(c => give(c || Response.error())); });
  }));
});
