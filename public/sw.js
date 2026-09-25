const params = new URL(self.location.href).searchParams;
const BUILD_VERSION = params.get("v") || "development";
const CACHE_PREFIX = "nutrition-sleep-shell-";
const CACHE_NAME = CACHE_PREFIX + BUILD_VERSION;
const OFFLINE_URL = "/offline.html";
const STATIC_SHELL = [
  OFFLINE_URL,
  "/manifest.webmanifest",
  "/icon.svg",
];
const NEVER_INTERCEPT_PREFIXES = [
  "/api/",
  "/auth/",
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(STATIC_SHELL.map(async (url) => {
      try {
        const response = await fetch(url, { cache: "reload" });
        if (response.ok) await cache.put(url, response);
      } catch {
        // A partial static shell can still install; navigation fallback is best-effort.
      }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
        .map((key) => caches.delete(key)),
    );
    await self.clients.claim();
  })());
});

function isNeverIntercepted(pathname) {
  return NEVER_INTERCEPT_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function isStaticAsset(pathname) {
  return pathname.startsWith("/_next/static/")
    || STATIC_SHELL.includes(pathname);
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (isNeverIntercepted(url.pathname)) return;

  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        return await fetch(request, { cache: "no-store" });
      } catch {
        return (await caches.match(OFFLINE_URL))
          || new Response("Offline", {
            status: 503,
            headers: { "content-type": "text/plain; charset=utf-8" },
          });
      }
    })());
    return;
  }

  if (!isStaticAsset(url.pathname)) return;

  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;

    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    }
    return response;
  })());
});
