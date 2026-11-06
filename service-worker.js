const BUILD_ID = 'local';
const CACHE_PREFIX = 'jarvis-glasses-hud-v5-';
const ALL_CACHE_PREFIX = 'jarvis-glasses-hud-';
const CACHE = `${CACHE_PREFIX}${BUILD_ID}`;
const ASSETS = ['./', './index.html', './styles.css', './youtube-player.js', './connectors-config.js', './connectors.js', './app.js', './staging-passkey.html', './staging-passkey.js', './manifest.webmanifest', './release-manifest.json', './health.json'];
self.addEventListener('install', (event) => event.waitUntil((async () => {
  const cache = await caches.open(CACHE);
  try {
    await cache.addAll(ASSETS.map((asset) => new Request(new URL(asset, self.location.href), { cache: 'reload' })));
  } catch (error) {
    await caches.delete(CACHE);
    throw error;
  }
})()));
self.addEventListener('message', (event) => {
  if (event.data?.type === 'ACTIVATE_UPDATE') event.waitUntil(self.skipWaiting());
});
self.addEventListener('activate', (event) => event.waitUntil((async () => {
  // CacheStorage.keys() is creation ordered. Keep this release and its direct
  // predecessor so a newly activated release never evicts the last known-good
  // offline bundle until a second successful release exists.
  const generationCaches = (await caches.keys()).filter((key) => key.startsWith(ALL_CACHE_PREFIX));
  const retained = new Set(generationCaches.slice(-2));
  retained.add(CACHE);
  await Promise.all(generationCaches.filter((key) => !retained.has(key)).map((key) => caches.delete(key)));
  await self.clients.claim();
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of clients) client.postMessage({ type: 'JARVIS_HUD_UPDATE_ACTIVATED', buildId: BUILD_ID });
})()));
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});
