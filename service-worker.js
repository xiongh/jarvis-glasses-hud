const BUILD_ID = 'local';
const CACHE_PREFIX = 'jarvis-glasses-hud-v5-';
const ALL_CACHE_PREFIX = 'jarvis-glasses-hud-';
const CACHE = `${CACHE_PREFIX}${BUILD_ID}`;
const ASSETS = ['./', './index.html', './google-apps.html', './google-apps.js', './styles.css', './youtube-player.js', './auth-config.js', './unlock.html', './unlock.js', './connectors-config.js', './connectors.js', './app.js', './input-diagnostics.js', './staging-apps-connect.html', './staging-apps-connect.js?approval=20261111-2', './staging-passkey.html', './staging-passkey.js', './manifest.webmanifest', './release-manifest.json', './health.json'];
self.addEventListener('install', (event) => event.waitUntil((async () => {
  const cache = await caches.open(CACHE);
  try {
    await cache.addAll(ASSETS.map((asset) => new Request(new URL(asset, self.location.href), { cache: 'reload' })));
  } catch (error) {
    await caches.delete(CACHE);
    throw error;
  }
  // Keep a complete verified release waiting until the user chooses RELOAD
  // LATEST. This prevents a controlled glasses page from mixing old UI code
  // with a newly claimed controller midway through an interaction.
})()));
self.addEventListener('message', (event) => {
  if (event.data?.type === 'ACTIVATE_UPDATE') event.waitUntil(self.skipWaiting());
});
self.addEventListener('activate', (event) => event.waitUntil((async () => {
  const generationCaches = (await caches.keys()).filter((key) => key.startsWith(ALL_CACHE_PREFIX));
  // Keep the current complete release and one predecessor. The predecessor is
  // a recoverable fallback if activation or a subsequent navigation fails.
  const retained = new Set(generationCaches.slice(-2));
  retained.add(CACHE);
  await Promise.all(generationCaches.filter((key) => !retained.has(key)).map((key) => caches.delete(key)));
  await self.clients.claim();
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of clients) client.postMessage({ type: 'JARVIS_HUD_UPDATE_ACTIVATED', buildId: BUILD_ID });
})()));
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  // Never mix a predecessor cache with this release's app and connector code.
  event.respondWith(caches.open(CACHE).then((cache) => cache.match(event.request)).then((cached) => cached || fetch(event.request)));
});
