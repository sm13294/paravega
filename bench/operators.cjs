/**
 * Unchanged Vega and Vega-Lite specifications on stock Vega and on ParaVega's
 * parallel operators (Node.js, worker_threads): time to the first view and
 * the latency of an interaction (signal or selection-store update), median
 * of the updates after one warm-up.
 *
 *   npm run vega:build && node --max-old-space-size=16000 bench/operators.cjs \
 *     [--sizes=1000000,10000000] [--threads=16] [--specs=a,b] [--modes=stock,paraweb] [--out=file.json]
 *
 * Reported: time to the first view, the first interaction (which also starts
 * index builds), and the median, p95 and maximum of the following ones.
 *
 * Modes: stock (Vega), paraweb-inline (ParaVega's kernels and columns on the
 * main thread, no workers), paraweb (parallel operators, Farm loop), paraweb-seq
 * (parallel operators, Vega's sequential loop), paraweb-index (with the
 * pre-aggregation index).
 *
 * Every configuration runs in a fresh child process, so heap state and JIT
 * warm-up of one configuration do not affect the next.
 */
const path = require("path");
const fs = require("fs");
const { execFileSync } = require("child_process");

const arg = (name, def) => {
  const a = process.argv.find(x => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : def;
};
const ROOT = path.resolve(__dirname, "..");

// --------------------------------------------------------------------------- specs
// --------------------------------------------------------------------------- specs (demo/operatorSpecs.js)
let makeRows, SPECS;
const loadSpecs = async () => ({ makeRows, SPECS } = await import(path.join(__dirname, "../demo/operatorSpecs.js")));

// --------------------------------------------------------------------------- one configuration (child)
async function child(name, n, threads, mode) {
  await loadSpecs();
  const { vega, vl } = await require(path.join(ROOT, "test/vega-env.cjs")).loadVega();
  const { registerParaweb, inlineWorkerFactory } = require(path.join(ROOT, "dist/paraweb-vega.cjs"));
  const def = await SPECS[name]();
  let spec = def.spec;
  if (def.vl) spec = vl.compile(def.vl).spec;
  spec = JSON.parse(JSON.stringify(spec));
  const fallbacks = [];
  let concurrent = 0;
  const handle = mode === "stock" ? null : registerParaweb(vega, {
    threads, preaggregate: mode === "paraweb-index", onFallback: (t, r) => fallbacks.push(`${t}: ${r}`),
    farm: mode !== "paraweb-seq", onFarmStats: s => { concurrent = Math.max(concurrent, s.maxConcurrent); },
    // paraweb-inline: the same kernels and columns on the calling thread, without workers.
    ...(mode === "paraweb-inline" ? { threads: 1, workerFactory: inlineWorkerFactory() } : {}),
  });
  const rows = makeRows(n);
  spec.data.find(d => d.name === def.source).values = rows;
  let t0 = performance.now();
  const view = new vega.View(vega.parse(spec), { renderer: "none" });
  await view.runAsync();
  const initMs = performance.now() - t0;
  const apply = u => { for (const [k, v] of Object.entries(u)) k.startsWith("data:") ? view.data(k.slice(5), v) : view.signal(k, v); };
  const ms = [];
  const reps = Number(process.env.REPS || 9);
  let firstMs = 0;
  for (let k = 0; k <= reps; k++) {
    apply(def.updates(k));
    t0 = performance.now();
    await view.runAsync();
    if (k > 0) ms.push(performance.now() - t0); else firstMs = performance.now() - t0;
  }
  // Checksum of every data set except the source and stores, to compare modes: the exact sum of
  // all numbers (Shewchuk's algorithm, as Python's math.fsum), rounded once, so it does not depend
  // on the row order (materialized data sets can list the same rows in another order than Vega's
  // incremental one) and needs no array of all values.
  const checksum = v => {
    const partials = [];
    const add = x => {
      let i = 0;
      for (let j = 0; j < partials.length; j++) {
        let y = partials[j];
        if (Math.abs(x) < Math.abs(y)) { const t = x; x = y; y = t; }
        const hi = x + y, lo = y - (hi - x);
        if (lo) partials[i++] = lo;
        x = hi;
      }
      partials.length = i;
      partials.push(x);
    };
    for (const d of spec.data) {
      if (d.name === def.source || d.name.endsWith("_store")) continue;
      for (const t of v.data(d.name)) for (const x of Object.values(t)) if (typeof x === "number" && Number.isFinite(x)) add(x);
    }
    return partials.reduce((a, b) => a + b, 0);
  };
  const check = checksum(view);
  // Stock Vega also evaluated afresh in the final state: incremental updates in Vega can leave
  // stale results (seen with the box plot's whiskers), which a fresh evaluation does not.
  let checkFresh = null;
  if (mode === "stock") {
    const s2 = { ...spec, data: spec.data.map(d => (d.name === def.source ? { ...d, values: makeRows(n) } : JSON.parse(JSON.stringify(d)))) };
    const fresh = new vega.View(vega.parse(s2), { renderer: "none" });
    for (const [k, v] of Object.entries(def.updates(reps))) k.startsWith("data:") ? fresh.data(k.slice(5), v) : fresh.signal(k, v);
    await fresh.runAsync();
    checkFresh = checksum(fresh);
    fresh.finalize();
  }
  ms.sort((a, b) => a - b);
  const q = p => ms[Math.min(ms.length - 1, Math.ceil(p * ms.length) - 1)];
  const r = { spec: name, n, threads, mode, vega: vega.version, initMs, firstMs, updateMs: ms[ms.length >> 1], updateP95Ms: q(0.95), updateMaxMs: ms[ms.length - 1], updateMinMs: ms[0], rss: process.memoryUsage().rss, check, checkFresh, fallbacks, concurrent };
  view.finalize();
  if (handle) handle.terminate();
  return r;
}

// --------------------------------------------------------------------------- driver
async function main() {
  if (process.argv[2] === "--child") {
    const [, , , name, n, threads, mode] = process.argv;
    const r = await child(name, Number(n), Number(threads), mode);
    process.stdout.write("RESULT " + JSON.stringify(r) + "\n");
    process.exit(0);
  }
  const sizes = arg("sizes", "1000000").split(",").map(Number);
  const threads = Number(arg("threads", "16"));
  await loadSpecs();
  const specs = arg("specs", Object.keys(SPECS).join(",")).split(",");
  const modes = arg("modes", "stock,paraweb,paraweb-index").split(",");
  const stockMax = Number(arg("stock-max", "1000000"));
  const out = arg("out", null);
  const results = [];
  for (const n of sizes) for (const name of specs) for (const mode of modes) {
    if (mode === "stock" && n > stockMax) continue;
    let r;
    try {
      const o = execFileSync(process.execPath, ["--max-old-space-size=16000", __filename, "--child", name, String(n), String(threads), mode],
        { encoding: "utf8", maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "inherit"], timeout: 30 * 60 * 1000 });
      r = JSON.parse(o.split("\n").find(l => l.startsWith("RESULT ")).slice(7));
    } catch (e) {
      r = { spec: name, n, threads, mode, error: String(e.message || e).slice(0, 200) };
    }
    results.push(r);
    console.log(r.error ? `${name.padEnd(18)} ${String(n).padStart(9)} ${mode.padEnd(14)} ERROR ${r.error}`
      : `${name.padEnd(18)} ${String(n).padStart(9)} ${mode.padEnd(14)} init ${r.initMs.toFixed(0).padStart(7)} ms  first ${r.firstMs.toFixed(1).padStart(8)}  update ${r.updateMs.toFixed(2).padStart(9)} ms p95 ${r.updateP95Ms.toFixed(1).padStart(8)}  check ${r.check.toPrecision(12)}${r.checkFresh != null && r.checkFresh !== r.check ? ` (fresh ${r.checkFresh.toPrecision(12)})` : ""}  farm ${r.concurrent}${r.fallbacks.length ? "  fallbacks: " + r.fallbacks.join("; ") : ""}`);
    if (out) fs.writeFileSync(out, JSON.stringify({ node: process.version, threads, results }, null, 2));
  }
}
main().catch(e => { console.error(e); process.exit(1); });
