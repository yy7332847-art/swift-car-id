/* Service Worker — مجدي للتشييك
 * Strategy:
 *  - HTML/navigations: NetworkFirst → fallback to cache → fallback to /index.html → offline page
 *  - Hashed assets (/assets/*): CacheFirst (immutable)
 *  - Icons/manifest/favicons: StaleWhileRevalidate
 *  - Everything else (cross-origin, APIs): pass through (no caching)
 * Update flow: on message {type:"SKIP_WAITING"} → skipWaiting + claim.
 */
const VERSION = "v3-2026-07-22";
const PRECACHE = `precache-${VERSION}`;
const RUNTIME = `runtime-${VERSION}`;
const HTML_CACHE = `html-${VERSION}`;

const PRECACHE_URLS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./favicon.ico",
  "./favicon-32.png",
  "./apple-touch-icon.png",
  "./icon-192.png",
  "./icon-512.png",
];

const OFFLINE_HTML = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>غير متصل</title><style>body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Tahoma,sans-serif;background:#0f172a;color:#e2e8f0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;text-align:center}.card{max-width:360px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:24px;padding:32px}h1{margin:0 0 8px;font-size:22px}p{margin:0 0 20px;color:#94a3b8;line-height:1.7;font-size:14px}button{background:#eab308;color:#0f172a;border:0;border-radius:14px;padding:12px 22px;font-weight:800;font-size:15px;cursor:pointer}</style></head><body><div class="card"><div style="font-size:56px;margin-bottom:12px">📡</div><h1>لا يوجد اتصال بالإنترنت</h1><p>تحقّق من الاتصال ثم أعد المحاولة. يمكنك متابعة العمل في وضع عدم الاتصال — سيتم مزامنة بياناتك تلقائياً عند عودة الشبكة.</p><button onclick="location.reload()">إعادة المحاولة</button></div></body></html>`;

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(PRECACHE);
      await Promise.allSettled(PRECACHE_URLS.map((u) => cache.add(new Request(u, { cache: "reload" }))));
    })(),
  );
  // Do NOT auto-skipWaiting — we prompt the user first.
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      const keep = new Set([PRECACHE, RUNTIME, HTML_CACHE]);
      await Promise.all(names.filter((n) => !keep.has(n)).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

function isHashedAsset(url) {
  return url.pathname.includes("/assets/") && /\.[a-f0-9]{6,}\.(js|css|woff2?|ttf|otf|png|jpg|jpeg|svg|webp)$/i.test(url.pathname);
}

function isIconLike(url) {
  return /(icon-|favicon|apple-touch|manifest\.webmanifest)/.test(url.pathname);
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Only handle same-origin requests
  if (url.origin !== self.location.origin) return;

  // Never cache API/dynamic backend calls or supabase
  if (url.pathname.startsWith("/api/") || url.hostname.endsWith(".supabase.co")) return;

  // HTML / navigations → NetworkFirst
  if (req.mode === "navigate" || (req.headers.get("accept") || "").includes("text/html")) {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          const cache = await caches.open(HTML_CACHE);
          cache.put(req, fresh.clone()).catch(() => {});
          return fresh;
        } catch {
          const cached = (await caches.match(req)) || (await caches.match("./index.html")) || (await caches.match("./"));
          if (cached) return cached;
          return new Response(OFFLINE_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } });
        }
      })(),
    );
    return;
  }

  // Hashed built assets → CacheFirst (immutable)
  if (isHashedAsset(url)) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(req);
        if (cached) return cached;
        try {
          const fresh = await fetch(req);
          if (fresh.ok) {
            const cache = await caches.open(RUNTIME);
            cache.put(req, fresh.clone()).catch(() => {});
          }
          return fresh;
        } catch {
          return cached || Response.error();
        }
      })(),
    );
    return;
  }

  // Icons / manifest → StaleWhileRevalidate
  if (isIconLike(url)) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(req);
        const fetchPromise = fetch(req)
          .then((res) => {
            if (res.ok) {
              caches.open(PRECACHE).then((c) => c.put(req, res.clone())).catch(() => {});
            }
            return res;
          })
          .catch(() => cached);
        return cached || fetchPromise;
      })(),
    );
    return;
  }
});
