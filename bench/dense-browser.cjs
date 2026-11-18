/**
 * Large symbol marks in Chrome: stock Vega, ParaVega's parallel operators
 * with Vega's items (paraweb-items), and ParaVega with dense marks
 * (paraweb). Time to the first rendered view, and the median and maximum
 * latency of an interaction (signal or selection update, until the canvas
 * is drawn). One fresh page per configuration.
 *
 *   npm run vega:build && node bench/dense-browser.cjs \
 *     [--sizes=100000,1000000] [--specs=vl-linked,vega-symbol] [--modes=stock,paraweb-items,paraweb] [--threads=16] [--out=file.json]
 */
const puppeteer = require("puppeteer");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const arg = (name, def) => {
  const a = process.argv.find(x => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : def;
};
const ROOT = path.resolve(__dirname, "..");
const sizes = arg("sizes", "100000,1000000").split(",").map(Number);
const specs = arg("specs", "vl-point,vl-linked,vega-symbol").split(",");
const modes = arg("modes", "stock,paraweb-items,paraweb").split(",");
const threads = Number(arg("threads", "16"));
const stockMax = Number(arg("stock-max", "1000000"));
const out = arg("out", null);

(async () => {
  const server = spawn("node", [path.join(ROOT, "bench/serve.cjs")], { stdio: "ignore", env: { ...process.env, PORT: "8787" } });
  await new Promise(r => setTimeout(r, 800));
  const browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox", "--js-flags=--max-old-space-size=16000"], protocolTimeout: 3600000 });
  const results = [];
  try {
    for (const n of sizes) for (const spec of specs) for (const mode of modes) {
      if (mode !== "paraweb" && n > stockMax) continue;
      const page = await browser.newPage();
      await page.setViewport({ width: 1200, height: 1000, deviceScaleFactor: Number(process.env.DPR || 1) });
      page.on("pageerror", e => console.log("pageerror", e.message));
      await page.goto(`http://localhost:8787/demo/dense.html${process.env.VEGA === "5" ? "?vega=5" : ""}`, { waitUntil: "load" });
      await page.waitForFunction("window.pwReady === true");
      let r;
      try {
        r = await page.evaluate(o => window.pwBench(o), { spec, mode, n, threads, reps: Number(process.env.REPS || 9) });
      } catch (e) {
        r = { spec, mode, n, threads, error: String(e.message || e).slice(0, 200) };
      }
      await page.close();
      results.push(r);
      console.log(r.error ? `${spec.padEnd(14)} ${String(n).padStart(8)} ${mode.padEnd(14)} ERROR ${r.error}`
        : `${spec.padEnd(14)} ${String(n).padStart(8)} ${mode.padEnd(14)} first view ${r.initMs.toFixed(0).padStart(7)} ms` +
          (r.updateMs != null ? `  update ${r.updateMs.toFixed(1).padStart(8)} ms (max ${r.updateMaxMs.toFixed(1)})` : "") +
          (r.phases && r.phases.length ? "  last: " + r.phases.map(p => `rows ${p.rows.toFixed(1)} bound ${p.bound.toFixed(1)} draw ${p.draw.toFixed(1)}` + (p.workers ? " workers(ms,items,encMs) " + JSON.stringify(p.workers) : "")).join("; ") : ""));
      if (out) fs.writeFileSync(out, JSON.stringify({ threads, results }, null, 2));
    }
  } finally {
    await browser.close();
    server.kill();
  }
})().catch(e => { console.error(e); process.exit(1); });
