/**
 * The unchanged specifications of bench/operators.cjs in Chrome, end to end
 * (canvas renderer, every interaction until drawn), with and without
 * cross-origin isolation. One fresh browser per configuration.
 *
 *   npm run vega:build && node bench/operators-browser.cjs \
 *     [--sizes=1000000] [--specs=a,b] [--modes=stock,paraweb] [--threads=16] [--isolation=on,off] [--out=file.json]
 *
 * Without isolation there is no SharedArrayBuffer; ParaVega then leaves Vega
 * unchanged, so the run measures stock Vega (reported as active: false).
 *
 * Memory: rendererMB is the resident memory of the page's renderer processes
 * (ps rss), read after the interactions while the view is alive. The workers
 * run in the renderer process, so shared memory is counted once. (mem, from
 * performance.measureUserAgentSpecificMemory, counts a SharedArrayBuffer once
 * per worker that maps it, see test/browser/memprobe.js, and is kept only for
 * the record.)
 */
const puppeteer = require("puppeteer");
const { spawn, execFileSync } = require("child_process");

/** Resident memory in MB of the renderer processes started by the browser process. */
function rendererMB(browserPid) {
  const rows = execFileSync("ps", ["-A", "-o", "pid=,ppid=,rss=,command="], { encoding: "utf8", maxBuffer: 1 << 26 })
    .split("\n").map(l => l.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/)).filter(Boolean)
    .map(m => ({ pid: +m[1], ppid: +m[2], rss: +m[3], cmd: m[4] }));
  const kids = new Set([browserPid]);
  for (let grew = true; grew;) { grew = false; for (const r of rows) if (kids.has(r.ppid) && !kids.has(r.pid)) { kids.add(r.pid); grew = true; } }
  return rows.filter(r => kids.has(r.pid) && /--type=renderer/.test(r.cmd)).reduce((a, r) => a + r.rss, 0) / 1024;
}
const path = require("path");
const fs = require("fs");

const arg = (name, def) => {
  const a = process.argv.find(x => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : def;
};
const sizes = arg("sizes", "1000000").split(",").map(Number);
const threads = Number(arg("threads", "16"));
const modes = arg("modes", "stock,paraweb").split(",");
const isolation = arg("isolation", "on").split(",");
const out = arg("out", null);
const PORT = 8790;

(async () => {
  const server = spawn("node", [path.join(__dirname, "serve.cjs")], { stdio: "ignore", env: { ...process.env, PORT: String(PORT) } });
  await new Promise(r => setTimeout(r, 800));
  const { SPECS } = await import(path.join(__dirname, "../demo/operatorSpecs.js"));
  const specs = arg("specs", Object.keys(SPECS).join(",")).split(",");
  const results = [];
  try {
    for (const iso of isolation) for (const n of sizes) for (const spec of specs) for (const mode of modes) {
      if (iso === "off" && mode !== "paraweb") continue; // without isolation ParaVega is stock Vega
      const browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox", "--enable-blink-features=ForceEagerMeasureMemory"], protocolTimeout: 3600000 });
      let r;
      try {
        const page = await browser.newPage();
        await page.setViewport({ width: 1400, height: 1000, deviceScaleFactor: 1 });
        page.on("pageerror", e => console.log("pageerror", e.message));
        await page.goto(`http://localhost:${iso === "on" ? PORT : PORT + 1}/demo/operators.html${process.env.VEGA === "5" ? "?vega=5" : ""}`, { waitUntil: "load" });
        await page.waitForFunction("window.pwReady === true");
        r = await page.evaluate(o => window.pwOp(o), { spec, mode, n, threads, reps: Number(process.env.REPS || 9), keep: true });
        r.rendererMB = rendererMB(browser.process().pid);
        Object.assign(r, await page.evaluate(() => window.pwFinish()));
      } catch (e) {
        r = { spec, mode, n, error: String(e.message || e).slice(0, 200) };
      }
      await browser.close();
      results.push(r);
      const mb = r.rendererMB != null ? `${r.rendererMB.toFixed(0)} MB renderer` : "--";
      console.log(r.error ? `${spec.padEnd(18)} ${mode.padEnd(8)} iso ${iso} ERROR ${r.error}`
        : `${spec.padEnd(18)} ${String(n).padStart(8)} ${mode.padEnd(8)} iso ${iso} active ${r.active ? "y" : "n"}  first view ${r.initMs.toFixed(0).padStart(6)}  first ${r.firstMs.toFixed(1).padStart(7)}  median ${r.updateMs.toFixed(1).padStart(7)}  p95 ${r.updateP95Ms.toFixed(1).padStart(7)}  max ${r.updateMaxMs.toFixed(1).padStart(7)} ms  mem ${mb}` +
          (r.fallbacks && r.fallbacks.length ? "  fallbacks: " + [...new Set(r.fallbacks)].join("; ") : ""));
      if (out) fs.writeFileSync(out, JSON.stringify({ threads, results }, null, 2));
    }
  } finally {
    server.kill();
  }
})().catch(e => { console.error(e); process.exit(1); });
