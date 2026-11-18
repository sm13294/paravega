// Make the page cross-origin isolated on hosts that cannot send the headers:
// register coi-sw.js and reload once, after which the service worker adds
// them. Sets window.pwIsolation to a short description for the page.
(() => {
  const store = { get: k => { try { return sessionStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { sessionStorage.setItem(k, v); } catch {} } };
  if (window.crossOriginIsolated) { window.pwIsolation = "isolated"; store.set("pw-coi-reload", ""); return; }
  if (!window.isSecureContext || !("serviceWorker" in navigator)) {
    window.pwIsolation = "unavailable (needs https or localhost, and service workers)";
    return;
  }
  const reloaded = store.get("pw-coi-reload");
  navigator.serviceWorker.register(new URL("coi-sw.js", document.baseURI)).then(reg => {
    if (reloaded) { window.pwIsolation = "service worker installed, but the page is not isolated"; return; }
    const go = () => { store.set("pw-coi-reload", "1"); location.reload(); };
    if (reg.active && navigator.serviceWorker.controller) go();
    else navigator.serviceWorker.addEventListener("controllerchange", go, { once: true });
  }, err => { window.pwIsolation = "service worker failed: " + err.message; });
  window.pwIsolation = "installing service worker";
})();
