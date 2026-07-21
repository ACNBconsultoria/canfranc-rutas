const VERSION = "canfranc-offline-v4";
const CACHE = `${VERSION}-content`;
const ROUTES = [
  "canal-roya-rinconada",
  "canfranc-estacion-pueblo",
  "cola-caballo-centenario",
  "coll-ladrones-cascada-negras",
  "collarada-por-ip",
  "gruta-helada-lecherines",
  "ibon-estanes-sansanet",
  "ibon-ip-circular",
  "ibon-iserias",
  "ibones-anayet-canal-roya",
  "la-moleta-circular",
  "la-raca-astun",
  "lagos-astun",
  "paseo-ayerbe-arboretum",
  "picauve-bunkers",
  "pico-anayet-canal-roya",
  "pico-aspe-candanchu",
  "pico-monjes-astun",
  "somport-canfranc-camino",
  "vertice-anayet-canal-roya"
];

const SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./offline-nav.css",
  "./offline-nav.js",
  "./account-community.css",
  "./account-community.js",
  "./supabase-config.js",
  "./vendor/supabase-2.110.6.js",
  "./assets/index-DcVUb1ur-github.js",
  "./assets/index-Bge4jphQ.css",
  "./assets/Map3D-WBWj1Iwt-navfix.js",
  "./assets/Map3D-B2k4QVOw.css",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

const ROUTE_FILES = ROUTES.flatMap((route) => [
  `./tracks/${route}/route.geojson`,
  `./tracks/${route}/slope.geojson`,
  `./tracks/${route}/profile.json`,
  `./tracks/${route}/stats.json`
]);
const OFFLINE_FILES = [...SHELL, ...ROUTE_FILES];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    for (const file of SHELL) {
      try { await cache.add(file); } catch (_) {}
    }
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith("canfranc-offline-") && key !== CACHE).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
  if (event.data && event.data.type === "CACHE_ALL") event.waitUntil(cacheAll(event.source));
});

async function cacheAll(source) {
  const cache = await caches.open(CACHE);
  let done = 0;
  let cached = 0;
  let failed = 0;
  for (const file of OFFLINE_FILES) {
    try {
      const request = new Request(file, { cache: "reload" });
      const response = await fetch(request);
      if (!response.ok) throw new Error(String(response.status));
      await cache.put(request, response);
      cached += 1;
    } catch (_) {
      failed += 1;
    }
    done += 1;
    source && source.postMessage({ type: "CACHE_PROGRESS", done, total: OFFLINE_FILES.length });
  }
  if (failed) source && source.postMessage({ type: "CACHE_ERROR", cached, failed });
  else source && source.postMessage({ type: "CACHE_COMPLETE", cached });
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  // Los mapas y el relieve de terceros no se descargan masivamente ni se guardan aquí.
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        const cache = await caches.open(CACHE);
        await cache.put(new URL("./index.html", self.registration.scope).href, response.clone());
        return response;
      } catch (_) {
        return (await caches.match(new URL("./index.html", self.registration.scope).href)) || Response.error();
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;
    try {
      const response = await fetch(request);
      if (response.ok) {
        const cache = await caches.open(CACHE);
        await cache.put(request, response.clone());
      }
      return response;
    } catch (_) {
      return new Response("Recurso no disponible sin conexión", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }
  })());
});
