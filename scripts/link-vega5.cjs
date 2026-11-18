/**
 * Vega 5.33 and Vega-Lite 5.23 are installed next to Vega 6 under the aliases
 * vega5 and vega-lite5, for comparisons with earlier results. Vega-Lite 5
 * loads "vega" itself; this links its own node_modules/vega to vega5, so that
 * it does not load Vega 6. Runs as postinstall.
 */
const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
// Only in a development checkout (devDependencies installed); a no-op elsewhere.
if (!fs.existsSync(path.join(root, "node_modules/vega-lite5")) || !fs.existsSync(path.join(root, "node_modules/vega5"))) process.exit(0);
const dir = path.join(root, "node_modules/vega-lite5/node_modules");
const link = path.join(dir, "vega");
fs.mkdirSync(dir, { recursive: true });
try { fs.rmSync(link, { recursive: true, force: true }); } catch { /* none */ }
fs.symlinkSync(path.join(root, "node_modules/vega5"), link, "dir");
console.log("linked", path.relative(root, link), "->", "node_modules/vega5");
