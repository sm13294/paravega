/*
 * Cross-origin isolation for static hosts that cannot set HTTP headers
 * (GitHub Pages): this service worker re-serves every same-origin response
 * with the two headers that enable SharedArrayBuffer,
 *   Cross-Origin-Opener-Policy: same-origin
 *   Cross-Origin-Embedder-Policy: require-corp
 * Every file of the showcase is same-origin, so nothing else is needed.
 * Registered by isolate.js; on a host that sends the headers itself, it is
 * not needed and does no harm.
 */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", e => {
  const req = e.request;
  // Requests that cannot be re-issued as they are.
  if (req.cache === "only-if-cached" && req.mode !== "same-origin") return;
  e.respondWith((async () => {
    const res = await fetch(req);
    if (res.status === 0 || res.type === "opaque") return res;
    const headers = new Headers(res.headers);
    headers.set("Cross-Origin-Opener-Policy", "same-origin");
    headers.set("Cross-Origin-Embedder-Policy", "require-corp");
    headers.set("Cross-Origin-Resource-Policy", "same-origin");
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  })());
});
