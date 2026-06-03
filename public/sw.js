const CACHE_NAME = "foryou-static-v18";
const STATIC_ASSETS = [
  "/css/styles.css?v=20260603-watchv3",
  "/js/admin.js?v=20260603-watchv3",
  "/js/message.js?v=20260516-backup5",
  "/js/profile.js?v=20260516-backup5",
  "/js/secret-login.js?v=20260516-backup5",
  "/js/watch-together.js?v=20260603-watchv3",
  "/assets/seal.svg",
  "/manifest.webmanifest"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== "GET" || url.origin !== self.location.origin) {
    return;
  }

  if (url.pathname.startsWith("/api") || url.pathname.startsWith("/socket.io")) {
    return;
  }

  const isStaticAsset =
    url.pathname.startsWith("/css/") ||
    url.pathname.startsWith("/js/") ||
    url.pathname.startsWith("/assets/") ||
    url.pathname === "/manifest.webmanifest";

  if (!isStaticAsset) {
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      // Performance polish: show cached static assets immediately, then refresh the cache in the background.
      const refresh = fetch(request).then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        return response;
      }).catch(() => cached || Response.error());

      return cached || refresh;
    })
  );
});
