// Editor de Fotos: cache para abrir rápido e funcionar sem internet (o blur precisa de internet e do PC).
const CACHE = 'editorfotos-v2';
const ASSETS = ['./', 'index.html', 'styles.css', 'app.js', 'arte.js', 'sync.js', 'config.js', 'manifest.webmanifest',
  'icon-192.png', 'recursos/fundo.jpg', 'recursos/logo.png', 'recursos/chamada.png', 'recursos/Montserrat-BlackItalic.otf'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS.map((url) => new Request(url, { cache: 'reload' })))));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((k) => k.startsWith('editorfotos-') && k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

// Rede primeiro (pega atualizações), cache como reserva offline. Só arquivos do próprio site.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' })
      .then((res) => {
        const copia = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copia));
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match(e.request, { ignoreSearch: true })))
  );
});
