/**
 * Dense marks in Chrome against stock Vega, through the same updates.
 * Exact: canvas size (layout), item order, the dense path being taken, and
 * what a pointer at 35 positions picks (before and after the updates).
 * Pixels are compared with a tolerance. Item values and bounds are tested
 * exactly in Node (test/dense.cjs), and Chrome draws the same items on a
 * worker's OffscreenCanvas bit for bit (demo/raster-experiment.html), but its
 * antialiasing of a path depends on the other draw calls on the same canvas,
 * so stripes drawn in different workers cannot be bit-identical to one
 * canvas (an earlier draw of only the items in a stripe changes edge pixels
 * by up to 56 levels), and compositing a stripe over a background rounds by
 * up to 3 levels. Pixels pass with PSNR >= 20 dB and no 4x4 block whose mean
 * differs by 96 levels or more, which a missing or misplaced symbol would
 * exceed. Both metrics are reported.
 *
 *   npm run vega:build && node test/dense-browser.cjs [rows]
 *   DPR=2 SPECS=vl-linked node test/dense-browser.cjs 50000
 */
const puppeteer = require("puppeteer");
const { spawn } = require("child_process");
const path = require("path");

const N = Number(process.argv[2] || 60000);
const ROOT = path.resolve(__dirname, "..");
const SPECS = (process.env.SPECS || "vl-point,vl-linked,vl-square-time,vega-symbol").split(",");
const DPRS = (process.env.DPR || "1,2").split(",").map(Number);

(async () => {
  const server = spawn("node", [path.join(ROOT, "bench/serve.cjs")], { stdio: "ignore", env: { ...process.env, PORT: "8787" } });
  await new Promise(r => setTimeout(r, 800));
  const browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox"], protocolTimeout: 900000 });
  let fails = 0;
  try {
    for (const dpr of DPRS) for (const spec of SPECS) {
      const page = await browser.newPage();
      await page.setViewport({ width: 1200, height: 1000, deviceScaleFactor: dpr });
      page.on("pageerror", e => console.log("pageerror", e.message));
      page.on("console", m => { if (m.type() === "error" || m.type() === "warning") console.log("console", m.text()); });
      await page.goto("http://localhost:8787/demo/dense.html" + (process.env.VEGA === "5" ? "?vega=5" : ""), { waitUntil: "load" });
      await page.waitForFunction("window.pwReady === true");
      const r = await page.evaluate(o => window.pwCheck(o), { spec, n: N, threads: 8 });
      await page.close();
      if (process.env.VERBOSE) console.log(JSON.stringify(r.dbg), JSON.stringify(r.steps.map(s => ({ hist: s.hist, topRows: s.topRows, samples: s.samples }))));
      const bad = r.steps.some(s => s.size || s.psnr < 20 || s.block >= 96 || !/^(same,?)+$/.test(s.order)) || r.pickDiff > 0 || r.fallbacks.length
        || r.steps.some(s => !s.dense.some(m => m > 0));
      if (bad) fails++;
      console.log(`${bad ? "FAIL" : "ok  "} dpr ${dpr} ${spec.padEnd(15)} ` +
        r.steps.map(s => s.size ? "size " + JSON.stringify(s.sizes) : `psnr ${s.psnr.toFixed(1)} block ${s.block.toFixed(1)}@${s.blockAt} >32 ${(100 * s.over32 / s.total).toFixed(2)}% dense ${s.dense.join("/")} ${s.order}`).join(" | ") +
        `  picks ${r.picks - r.pickDiff}/${r.picks} same (${r.pickHits} hits)` + (r.fallbacks.length ? "  fallbacks: " + r.fallbacks.join("; ") : ""));
    }
  } finally {
    await browser.close();
    server.kill();
  }
  console.log(fails ? `${fails} failing` : "all dense views match stock Vega");
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
