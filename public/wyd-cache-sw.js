const CLASSIC_CACHE_NAME = "wyd-classic-assets-v1";
const CLASSIC_PREFIX = "/game-data/classic/";
const NETWORK_FIRST = new Set([
  "/game-data/classic/manifest.json",
  "/game-data/classic/precache-armia.json",
]);

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || request.headers.has("range")) return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(CLASSIC_PREFIX)) return;
  const job = (
    NETWORK_FIRST.has(url.pathname)
      ? networkFirst(request)
      : cacheFirst(request)
  );
  event.respondWith(job.then((result) => result.response));
  event.waitUntil(job.then((result) => result.cacheJob).catch(() => undefined));
});

async function cacheFirst(request) {
  const cache = await caches.open(CLASSIC_CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return { response: cached, cacheJob: Promise.resolve() };
  const response = await fetch(request);
  return {
    response,
    cacheJob: response.ok ? safeCachePut(cache, request, response.clone()) : Promise.resolve(),
  };
}

async function networkFirst(request) {
  const cache = await caches.open(CLASSIC_CACHE_NAME);
  try {
    const response = await fetch(request);
    return {
      response,
      cacheJob: response.ok ? safeCachePut(cache, request, response.clone()) : Promise.resolve(),
    };
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return { response: cached, cacheJob: Promise.resolve() };
    throw error;
  }
}

function safeCachePut(cache, request, response) {
  return cache.put(request, response).catch(() => {
    // Quota eviction and private-mode restrictions must never break gameplay.
  });
}
