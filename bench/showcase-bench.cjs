/**
 * The two case studies of the showcase (the crossfilter dashboard and the
 * distribution explorer) in headless Chrome, with the showcase's own replay:
 * a one-second drag at 60 Hz along a fixed path, set without waiting for
 * results (showcase/src/app.js, replay()).
 *
 *   npm run showcase && node bench/showcase-bench.cjs \
 *     [--pages=distributions,crossfilter] [--sizes=100000,1000000,5000000] [--reps=10] [--out=file.json]
 *
 * Protocol: repetitions are the outer loop; every (page, size, configuration)
 * runs in a fresh browser process: the page is loaded, one replay warms up,
 * and the next replay is measured. Stock Vega runs up to --stockMax rows.
 *
 * Per replay (all in ms): positions (brush positions set), updates (brush
 * positions that were evaluated and drawn), medianMs (latency of an update,
 * from its first evaluation until the next position starts or the dataflow is
 * idle), maxLagMs (largest age of a brush input when its results were drawn),
 * maxGapMs (largest gap between animation frames during the drag), settleMs
 * (from the end of the drag until the views are up to date), firstViewMs.
 */
const puppeteer = require("puppeteer");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

const arg = (name, def) => {
  const a = process.argv.find(x => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : def;
};
const pages = arg("pages", "distributions,crossfilter").split(",");
const sizes = arg("sizes", "100000,1000000,5000000").split(",").map(Number);
const reps = Number(arg("reps", "10"));
const stockMax = Number(arg("stockMax", "1000000"));
const out = arg("out", null);
const PORT = Number(arg("port", "8790"));

// Configurations per page: [label, URL parameters].
const workers = [1, 2, 4, 8, 16];
const CONFIGS = {
  distributions: [
    ["stock", { engine: "stock" }],
    ["main", { engine: "paravega", threads: "0" }],
    ...workers.map(t => [`w${t}`, { engine: "paravega", threads: String(t) }]),
    ["gpu-exact", { engine: "gpu", threads: "16", gpumode: "exact" }],
    ["gpu-approx", { engine: "gpu", threads: "16", gpumode: "approx" }],
  ],
  crossfilter: [
    ["stock", { engine: "stock" }],
    ["main", { engine: "paravega", threads: "0" }],
    ...workers.map(t => [`w${t}`, { engine: "paravega", threads: String(t) }]),
    ["index", { engine: "index", threads: "16" }],
    ["gpu", { engine: "gpu", threads: "16" }],
  ],
};
const FILE = { distributions: "distributions.html", crossfilter: "index.html" };

async function runOne(pageName, rows, label, params) {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--enable-unsafe-webgpu", "--enable-features=Vulkan"],
    protocolTimeout: 3600000,
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 1000, deviceScaleFactor: 1 });
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    const qs = new URLSearchParams({ ...params, rows: String(rows), drag: "1000" });
    await page.goto(`http://localhost:${PORT}/showcase/site/${FILE[pageName]}?${qs}`, { waitUntil: "load" });
    await page.waitForFunction(() => /drag a brush|rror/.test(document.getElementById("status").textContent), { timeout: 1800000, polling: 500 });
    const replay = async () => {
      const before = await page.evaluate(() => JSON.parse(localStorage.getItem("paravega-showcase-runs") || "[]").length);
      await page.click("#replay");
      await page.waitForFunction(n => JSON.parse(localStorage.getItem("paravega-showcase-runs") || "[]").length > n, { timeout: 1800000, polling: 250 }, before);
      return page.evaluate(() => { const r = JSON.parse(localStorage.getItem("paravega-showcase-runs")); return r[r.length - 1]; });
    };
    await replay(); // warm-up
    const r = await replay();
    const note = await page.evaluate(() => document.getElementById("engineNote").textContent);
    return { ...r, label, params, warn: /not available|inactive/.test(note) ? note : undefined, errors: errors.length ? errors.slice(0, 3) : undefined };
  } finally {
    await browser.close();
  }
}

(async () => {
  const server = spawn("node", [path.join(__dirname, "serve.cjs")], { stdio: "ignore", env: { ...process.env, PORT: String(PORT) } });
  await new Promise(r => setTimeout(r, 800));
  const results = [];
  const meta = { started: new Date().toISOString(), cpus: os.cpus().length, cpu: os.cpus()[0].model, memGB: Math.round(os.totalmem() / 2 ** 30), reps, sizes, pages, stockMax };
  const save = () => { if (out) fs.writeFileSync(out, JSON.stringify({ meta, results }, null, 2)); };
  try {
    for (let rep = 1; rep <= reps; rep++) {
      for (const pageName of pages) for (const rows of sizes) for (const [label, params] of CONFIGS[pageName]) {
        if (label === "stock" && rows > stockMax) continue;
        let r;
        try { r = await runOne(pageName, rows, label, params); }
        catch (e) { r = { page: pageName, rows, label, params, error: String(e.message || e).slice(0, 200) }; }
        r.rep = rep;
        results.push(r);
        save();
        const f = v => v == null ? "-" : v.toFixed(v >= 100 ? 0 : 1);
        console.log(r.error ? `rep ${rep} ${pageName} ${rows} ${label} ERROR ${r.error}`
          : `rep ${rep} ${pageName.padEnd(13)} ${String(rows).padStart(8)} ${label.padEnd(10)} updates ${String(r.updates).padStart(3)}/${r.positions}  median ${f(r.medianMs).padStart(6)}  lag ${f(r.maxLagMs).padStart(6)}  gap ${f(r.maxGapMs).padStart(6)}  settle ${f(r.settleMs).padStart(6)}  first view ${f(r.firstViewMs).padStart(6)} ms${r.gpu === false && params.engine === "gpu" ? "  NO GPU" : ""}${r.warn ? "  WARN" : ""}`);
      }
    }
  } finally {
    meta.finished = new Date().toISOString();
    save();
    server.kill();
  }
})().catch(e => { console.error(e); process.exit(1); });
