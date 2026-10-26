// Offline cache: downloads every app file once, then works with no internet.
const CACHE = "pose-studio-standalone-v6-1";
self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const files = await (await fetch("files.json", { cache: "no-cache" })).json();
    const cache = await caches.open(CACHE);
    // App files are required; bundled pose-library files are best-effort so one missing file never breaks install.
    const core = files.filter((f) => !f.startsWith("pose_library/"));
    const optional = files.filter((f) => f.startsWith("pose_library/"));
    await cache.addAll(core);
    await Promise.allSettled(optional.map((f) => cache.add(f)));
    self.skipWaiting();
  })());
});
self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith((async () => {
    const u = new URL(e.request.url);
    if (e.request.mode === "navigate" || u.pathname.endsWith("/index.html")) {
      try { const r = await fetch(e.request); return r; } catch (_) {}
    }
    const hit = await caches.match(e.request, { ignoreSearch: true });
    if (hit) return hit;
    try { return await fetch(e.request); } catch (_) { return new Response("offline", { status: 503 }); }
  })());
});
