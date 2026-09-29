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
        const response = await fetch(url, {
          cache: "reload",
          credentials: "same-origin",
        });
        if (isSafeStaticShellResponse(response)) {
          await cache.put(url, await asFinalResponse(response));
        }
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

async function asFinalResponse(response) {
  const headers = new Headers(response.headers);
  // A Response reconstructed from its body no longer carries a redirect chain.
  // Drop transport/redirect-only headers because the body is already decoded.
  headers.delete("content-encoding");
  headers.delete("content-length");
  headers.delete("transfer-encoding");
  headers.delete("location");

  return new Response(await response.clone().blob(), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function isSafeStaticShellResponse(response) {
  if (!response.ok) return false;
  try {
    return new URL(response.url).origin === self.location.origin;
  } catch {
    return false;
  }
}

async function offlineShellResponse() {
  const cached = await caches.match(OFFLINE_URL);
  if (!cached) {
    return new Response(
      "<!doctype html><html lang=\"ja\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>オフライン</title><body><main><h1>オフラインです</h1><p>現在、サーバーから最新の栄養・睡眠データを読み込めません。</p><p>接続を戻してから再試行してください。</p></main></body></html>",
      {
        status: 503,
        headers: { "content-type": "text/html; charset=utf-8" },
      },
    );
  }
  return asFinalResponse(cached);
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
        return offlineShellResponse();
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
