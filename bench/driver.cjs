/**
 * Browser benchmark for paraweb-vega: runs the crossfilter demo under
 * headless Chrome (COOP/COEP server) for each backend / size / worker
 * count, one fresh page per configuration and repetition.
 *
 *   node bench/driver.cjs [--quick] [--modes=a,b] [--reps=3]
 *
 * Repetitions are the outer loop, so slow drift (thermal state, background
 * activity) is spread over all configurations instead of hitting one. Raw
 * per-repetition results are written after every configuration, so a crash
 * keeps what was measured. The summary reports mean, standard deviation and
 * a 95% confidence interval (Student's t) per metric across repetitions.
 */
const puppeteer = require("puppeteer");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const http = require("http");

const PORT = 8787;
const ROOT = path.resolve(__dirname, "..");
const quick = process.argv.includes("--quick");
const modesArg = (process.argv.find(a => a.startsWith("--modes=")) || "").slice(8);
const MODES = modesArg ? new Set(modesArg.split(",")) : null;
const SUITE = (process.argv.find(a => a.startsWith("--suite=")) || "--suite=crossfilter").slice(8);
const DATASET = (process.argv.find(a => a.startsWith("--dataset=")) || "--dataset=synthetic").slice(10);
const DASHBOARD = (process.argv.find(a => a.startsWith("--dashboard=")) || "--dashboard=three").slice(12);
// --browser=firefox uses puppeteer's Firefox (WebDriver BiDi); default Chrome.
const BROWSER = (process.argv.find(a => a.startsWith("--browser=")) || "--browser=chrome").slice(10);
const REPS = Number((process.argv.find(a => a.startsWith("--reps=")) || "--reps=1").slice(7));

const listArg = name => {
  const a = process.argv.find(x => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3).split(",").map(Number) : null;
};
const SIZES = listArg("sizes") ?? (quick ? [1e6] : [1e5, 1e6, 5e6, 1e7]);
const THREADS = listArg("threads") ?? (quick ? [1, 4, 16] : [1, 2, 4, 8, 16]);
const TUPLE_MAX = 5e6; // Vega tuples above this exhaust tab memory
const AUTO_MAX = 1e7; // ParaVega's operators create no derived tuples, so the source tuples fit at 10M
const STOCK_MAX = 1e6; // stock Vega at 5M did not finish within 30 minutes (two attempts)

function configs() {
  if (SUITE === "scatter") return scatterConfigs();
  const out = [];
  for (const n of SIZES) {
    if (n <= STOCK_MAX) out.push({ mode: "stock", n, threads: 1 });
    if (n <= TUPLE_MAX) out.push({ mode: "crossfilter", n, threads: 1 });
    out.push({ mode: "inline", n, threads: 1 });
    // Mosaic + DuckDB-WASM at its best thread count (16), with and without pre-aggregation.
    out.push({ mode: "mosaic", n, threads: 16 });
    out.push({ mode: "mosaic-noconsol", n, threads: 16 });
    out.push({ mode: "mosaic-nopreagg", n, threads: 16 });
    out.push({ mode: "falcon-arrow", n, threads: 1 });
    out.push({ mode: "falcon-duckdb", n, threads: 16 });
    out.push({ mode: "gpu", n, threads: 16 });
    for (const threads of THREADS) {
      if (n <= TUPLE_MAX) out.push({ mode: "tuples", n, threads });
      out.push({ mode: "table", n, threads });
      out.push({ mode: "preagg", n, threads });
      // The stock specification, unchanged, on ParaVega's parallel operators.
      if (n <= AUTO_MAX) out.push({ mode: "auto", n, threads }, { mode: "auto-preagg", n, threads });
    }
  }
  return MODES ? out.filter(c => MODES.has(c.mode)) : out;
}

function scatterConfigs() {
  const out = [];
  for (const n of SIZES) {
    if (n <= TUPLE_MAX) out.push({ mode: "stock", n, threads: 1 });
    for (const threads of THREADS) {
      if (n <= TUPLE_MAX) out.push({ mode: "pwfilter-tuples", n, threads });
      out.push({ mode: "pwfilter-table", n, threads });
    }
  }
  return MODES ? out.filter(c => MODES.has(c.mode)) : out;
}

const wait = ms => new Promise(r => setTimeout(r, ms));
async function waitForServer(url) {
  for (let i = 0; i < 50; i++) {
    try {
      await new Promise((res, rej) => { const q = http.get(url, r => { r.destroy(); res(); }); q.on("error", rej); });
      return;
    } catch { await wait(200); }
  }
  throw new Error("server did not start");
}

// Two-sided 95% Student's t critical values by degrees of freedom.
const T95 = [NaN, 12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228];
function stats(xs) {
  const v = xs.filter(x => Number.isFinite(x));
  const n = v.length;
  if (!n) return null;
  const mean = v.reduce((a, b) => a + b, 0) / n;
  const sd = n > 1 ? Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : 0;
  const t = T95[Math.min(n - 1, T95.length - 1)] || 1.96;
  return { n, mean, sd, ci95: n > 1 ? t * sd / Math.sqrt(n) : 0, min: Math.min(...v), max: Math.max(...v) };
}
const METRICS = {
  initMs: r => r.initMs, firstBrushMs: r => r.firstBrushMs, secondBrushMs: r => r.secondBrushMs,
  sweepMs: r => r.brushMedianMs, jumpMs: r => r.jumpMedianMs,
  computeMs: r => r.computeMedianMs ?? NaN, selected: r => r.selectedMedian ?? NaN,
  dragFps: r => r.drag.fps, dragMaxGapMs: r => r.drag.maxFrameGapMs, dragSettleMs: r => r.drag.settleMs,
};
function summarize(results) {
  const groups = new Map();
  for (const r of results) {
    const k = `${r.mode}|${r.n}|${r.threads}`;
    if (!groups.has(k)) groups.set(k, { mode: r.mode, n: r.n, threads: r.threads, ok: [], errors: [] });
    const g = groups.get(k);
    if (r.error) g.errors.push(r.error); else g.ok.push(r);
  }
  return [...groups.values()].map(g => {
    const m = {};
    for (const [name, get] of Object.entries(METRICS)) m[name] = stats(g.ok.map(get));
    return { mode: g.mode, n: g.n, threads: g.threads, reps: g.ok.length, errors: g.errors, metrics: m };
  });
}

async function main() {
  const server = spawn("node", [path.join(ROOT, "bench/serve.cjs")], { stdio: "ignore", env: { ...process.env, PORT: "8787" } });
  const page_ = SUITE === "scatter" ? "scatter" : "crossfilter";
  // --vega=5 (or VEGA=5): the pages load Vega 5.33 instead of Vega 6.
  const vega5 = (process.argv.find(a => a.startsWith("--vega=")) || "").slice(7) === "5" || process.env.VEGA === "5";
  const url = `http://localhost:${PORT}/demo/${page_}.html${vega5 ? "?vega=5" : ""}`;
  const benchFn = SUITE === "scatter" ? "pwScatterBench" : "pwBench";
  await waitForServer(url);
  // A fresh browser process per configuration: memory from earlier pages
  // (the flights columns, DuckDB-WASM, Vega tuples) cannot pile up across a
  // long campaign. A single shared browser filled swap and then the disk
  // (ENOSPC) in rep 3 of the flights crossfilter suite.
  const launch = () => BROWSER === "firefox"
    ? puppeteer.launch({ browser: "firefox", headless: true, protocolTimeout: 1800000 })
    : puppeteer.launch({ headless: "new", args: ["--no-sandbox", "--js-flags=--max-old-space-size=8192"], protocolTimeout: 1800000 });
  let browser = await launch();
  const env = { userAgent: await browser.version(), cores: null, date: new Date().toISOString(), browserPerConfig: true, browser: BROWSER };
  await browser.close();
  browser = null;
  const results = [];
  const dir = path.join(ROOT, "benchmark-results/vega");
  fs.mkdirSync(dir, { recursive: true });
  const tag = (BROWSER !== "chrome" ? `-${BROWSER}` : "") + (DASHBOARD !== "three" ? `-${DASHBOARD}` : "") + (DATASET !== "synthetic" ? `-${DATASET}` : "") + (quick ? "-quick" : "") + (modesArg ? "-" + modesArg.replace(/,/g, "+") : "") + (REPS > 1 ? `-reps${REPS}` : "");
  const file = path.join(dir, `${page_}-${env.date.replace(/[:.]/g, "")}${tag}.json`);
  const save = () => fs.writeFileSync(file, JSON.stringify({ env, suite: SUITE, dataset: DATASET, dashboard: SUITE === "scatter" ? null : DASHBOARD, reps: REPS, results, summary: summarize(results) }, null, 2));
  const list = configs();
  try {
    for (let rep = 0; rep < REPS; rep++) for (const [ci, cfg0] of list.entries()) {
      const cfg = { ...cfg0, dataset: DATASET, ...(SUITE === "scatter" ? {} : { dashboard: DASHBOARD }) };
      browser = await launch();
      const page = await browser.newPage();
      await page.setViewport({ width: 1300, height: 400 });
      page.on("pageerror", e => console.error("[pageerror]", e.message));
      await page.goto(url, { waitUntil: "load" });
      await page.waitForFunction("window.pwReady === true && window.vega");
      env.cores = env.cores ?? await page.evaluate(() => navigator.hardwareConcurrency);
      process.stderr.write(`[rep ${rep + 1}/${REPS} ${ci + 1}/${list.length}] ${cfg.mode.padEnd(6)} n=${String(cfg.n).padEnd(9)} T=${String(cfg.threads).padEnd(3)} ... `);
      try {
        const r = await page.evaluate((c, fn) => window[fn](c), cfg, benchFn);
        const [lo, hi] = r.rowsRange ?? [cfg.n, cfg.n];
        if (r.rowsSeen < lo || r.rowsSeen > hi) throw new Error(`sanity check failed: dashboard shows ${r.rowsSeen} rows, expected ${lo === hi ? lo : `${lo} to ${hi}`}`);
        r.rep = rep;
        results.push(r);
        process.stderr.write(`brush ${r.brushMedianMs.toFixed(1)} ms, jump ${r.jumpMedianMs.toFixed(1)} ms, drag ${r.drag.fps.toFixed(0)} fps, gap ${r.drag.maxFrameGapMs.toFixed(0)} ms\n`);
      } catch (e) {
        results.push({ ...cfg, rep, error: String(e.message || e) });
        process.stderr.write(`ERROR ${e.message}\n`);
      }
      await page.close();
      await browser.close();
      browser = null;
      save();
    }
  } finally {
    if (browser) await browser.close();
    server.kill();
  }

  save();
  console.log(`\nwrote ${path.relative(ROOT, file)}  (${env.userAgent}, ${env.cores} cores, ${REPS} reps)\n`);

  const f = (s, d = 1) => (s ? `${s.mean.toFixed(d)}±${s.ci95.toFixed(d)}` : "n/a");
  console.log("mode             rows        T  reps   init ms        1st ms       2nd ms       sweep ms       jump ms       drag fps   max gap ms");
  for (const g of summarize(results)) {
    const m = g.metrics;
    console.log(
      `${g.mode.padEnd(17)}${String(g.n).padEnd(12)}${String(g.threads).padEnd(3)}${String(g.reps).padStart(4)}  ` +
      [f(m.initMs, 0), f(m.firstBrushMs, 0), f(m.secondBrushMs, 0), f(m.sweepMs, 2), f(m.jumpMs, 2), f(m.dragFps, 0), f(m.dragMaxGapMs, 0)]
        .map(x => x.padStart(12)).join("  ") + (g.errors.length ? `  (${g.errors.length} errors)` : ""),
    );
  }
}

main().catch(e => { console.error(e); process.exit(1); });
