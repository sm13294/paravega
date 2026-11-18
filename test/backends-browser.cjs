/**
 * Browser check that every backend shows the same histograms for the same
 * brushes, on both data sets, including Mosaic (which only runs in a browser).
 * Exact backends must match ParaVega's scan bin for bin; Mosaic with
 * pre-aggregation is approximate by design and is reported separately.
 *
 *   node test/backends-browser.cjs [rows]
 */
const puppeteer = require("puppeteer");
const { spawn } = require("child_process");
const path = require("path");

const N = Number(process.argv[2] || 1e6);
const ROOT = path.resolve(__dirname, "..");
const EXACT = (process.env.MODES || "stock,crossfilter,inline,tuples,preagg,gpu,mosaic-nopreagg").split(",");
const APPROX = (process.env.APPROX ?? (process.env.MODES ? "" : "mosaic,mosaic-noconsol,falcon-arrow,falcon-duckdb")).split(",").filter(Boolean);
const DASHBOARD = process.env.DASHBOARD || "three";
const BRUSHES = DASHBOARD === "wide" ? [
  { distance: [40, 120] },
  { distance: [40, 120], air_time: [30, 90] },
  { dep_delay: [100, 160], arr_time: [250, 30], delay: [5, 295] },
  { distance: [0, 300], delay: [150, 152], time: [0, 300], air_time: [10, 200], dep_delay: [90, 200], arr_time: [100, 101] },
] : [
  { distance: [40, 120] },
  { distance: [40, 120], delay: [100, 160] },
  { time: [250, 30], delay: [5, 295] },
  { distance: [0, 300], delay: [150, 152], time: [0, 300] },
];

(async () => {
  const server = spawn("node", [path.join(ROOT, "bench/serve.cjs")], { stdio: "ignore", env: { ...process.env, PORT: "8787" } });
  await new Promise(r => setTimeout(r, 800));
  const browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox"], protocolTimeout: 900000 });
  let fails = 0;
  try {
    for (const dataset of (process.env.DATASETS || (DASHBOARD === "wide" ? "flights" : "synthetic,flights")).split(",")) {
      const run = async mode => {
        const page = await browser.newPage();
        page.on("pageerror", e => console.log("pageerror", e.message));
        await page.goto("http://localhost:8787/demo/crossfilter.html", { waitUntil: "load" });
        await page.waitForFunction("window.pwReady === true");
        await page.evaluate((m, n, d, db) => window.pwBench({ mode: m, n, threads: 16, dataset: d, dashboard: db, steps: 2, warmup: 1, dragMs: 100 }), mode, N, dataset, DASHBOARD);
        const out = [];
        for (const b of BRUSHES) out.push(await page.evaluate(b => window.pwHistograms(b), b));
        await page.close();
        return out;
      };
      const ref = await run("table");
      const cmp = (got) => {
        let diff = 0, total = 0, maxRel = 0;
        ref.forEach((r, s) => {
          for (const f of Object.keys(r)) {
            if (!got[s][f]) continue; // view not provided by this backend (Falcon has no mean view)
            const a = new Map(r[f].map(([k, v]) => [String(k), v]));
            const b = new Map(got[s][f].map(([k, v]) => [String(k), v]));
            for (const k of new Set([...a.keys(), ...b.keys()])) {
              total++;
              const x = a.get(k) || 0, y = b.get(k) || 0;
              const same = f === "mean" ? Math.abs(x - y) <= 1e-9 * Math.max(1, Math.abs(x)) : x === y;
              if (!same) {
                diff++; maxRel = Math.max(maxRel, Math.abs(x - y) / Math.max(1, Math.abs(x)));
                if (process.env.VERBOSE) console.log(`  brush ${s} view ${f} bin ${k}: ref ${x} got ${y}`);
              }
            }
          }
        });
        return { diff, total, maxRel };
      };
      for (const mode of [...EXACT, ...APPROX]) {
        const r = cmp(await run(mode));
        const exact = EXACT.includes(mode);
        if (exact && r.diff) fails++;
        console.log(`${dataset.padEnd(10)} ${mode.padEnd(16)} ${r.diff}/${r.total} bins differ` +
          (r.diff ? ` (max ${(r.maxRel * 100).toFixed(2)}%)` : "") + (exact ? (r.diff ? "  FAIL" : "  ok") : "  (approximate by design)"));
      }
    }
  } finally {
    await browser.close();
    server.kill();
  }
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
