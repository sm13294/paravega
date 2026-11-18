/**
 * Static server for the browser benchmarks: the repository tree on PORT with
 * cross-origin isolation (COOP/COEP, so SharedArrayBuffer is available) and
 * on PORT + 1 without it.
 *
 *   node bench/serve.cjs   # 8790 isolated, 8791 not isolated
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const PORT = Number(process.env.PORT || 8790);
const ROOT = path.resolve(__dirname, "..");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8", ".mjs": "application/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".css": "text/css; charset=utf-8", ".wasm": "application/wasm" };
const serve = isolated => (req, res) => {
  const p = path.normalize(req.url.split("?")[0]).replace(/^(\.\.(\/|\\|$))+/, "");
  const file = path.join(ROOT, p);
  const h = isolated ? { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp", "Cross-Origin-Resource-Policy": "same-origin" } : {};
  if (!file.startsWith(ROOT)) { res.writeHead(403, h); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { ...h, "Content-Type": "text/plain" }); res.end("not found"); return; }
    res.writeHead(200, { ...h, "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream" });
    res.end(data);
  });
};
http.createServer(serve(true)).listen(PORT, () => console.log(`isolated:     http://localhost:${PORT}`));
http.createServer(serve(false)).listen(PORT + 1, () => console.log(`not isolated: http://localhost:${PORT + 1}`));
