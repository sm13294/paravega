/**
 * Pre-aggregation must be exact: over randomized brush sessions, every view
 * answered from the cube must equal the full-scan answer, count for count.
 * With measures (sum, mean, min, max, stdev, valid), counts, valid, min and
 * max must be equal and sums and moments equal up to rounding (1e-9 relative),
 * since both paths add the same values in a different order.
 *
 *   node test/preagg.cjs
 */
let vega, vl; // loaded in the main function (see test/vega-env.cjs)
const seedrandom = require("seedrandom");
const { registerParaweb, buildConfig } = require("../dist/paraweb-vega.cjs");

const N = 120000;
const rng = seedrandom("preagg");
const carriers = ["AA", "DL", "UA", "WN", "B6"];
const cols = {
  // integers: many values fall exactly on bucket boundaries
  a: Float64Array.from({ length: N }, () => Math.floor(rng() * 100)),
  // continuous with missing values
  b: Float64Array.from({ length: N }, () => (rng() < 0.02 ? NaN : (rng() + rng()) * 50 - 50)),
  // skewed, many duplicates
  c: Float64Array.from({ length: N }, () => Math.round(1000 * rng() * rng() * rng())),
  carrier: Array.from({ length: N }, () => carriers[Math.floor(rng() * carriers.length)]),
};
const FIELDS = ["a", "b", "c"];

const MEASURES = {
  ops: ["count", "valid", "sum", "mean", "min", "max", "stdev"],
  fields: [null, "b", "b", "b", "a", "c", "c"],
  as: ["count", "valid_b", "sum_b", "mean_b", "min_a", "max_c", "stdev_c"],
};
const EXACT_KEYS = new Set(["count", "valid_b", "min_a", "max_c", "bin0", "bin1", "carrier"]);

function spec(preagg, resolution, measures) {
  const signals = FIELDS.map(f => ({ name: `r_${f}`, value: null }));
  const data = FIELDS.map(f => ({
    name: `v_${f}`,
    transform: [{
      type: "pwaggregate", table: "t", preagg, ...(resolution ? { preaggResolution: resolution } : {}),
      filter: FIELDS.filter(g => g !== f).map(g => ({ field: g, range: { signal: `r_${g}` } })),
      bins: [{ field: f, maxbins: 30 }],
      ...(f === "c" ? { groupby: ["carrier"] } : {}), // a 2D key space for one view
      ...(measures ? MEASURES : {}),
    }],
  }));
  return { signals, data };
}

/** Random brush on a field: normal, reversed, tiny, outside the extent, or cleared. */
function randomRange(f) {
  const ext = { a: [0, 99], b: [-50, 50], c: [0, 1000] }[f];
  const span = ext[1] - ext[0];
  const u = rng();
  if (u < 0.08) return null;
  if (u < 0.15) return [ext[0] - span, ext[1] + span];
  if (u < 0.25) { const x = ext[0] + rng() * span; return [x, x + span * 1e-4]; }
  if (u < 0.35) { const x = Math.floor(ext[0] + rng() * span); return [x, x]; } // a single integer
  const x = ext[0] + rng() * span, y = ext[0] + rng() * span;
  return rng() < 0.2 ? [Math.max(x, y), Math.min(x, y)] : [Math.min(x, y), Math.max(x, y)];
}

const key = rows => rows.map(r => `${r.bin0}|${r.carrier ?? ""}:${r.count}`).sort().join(",");

/** Same groups, exact on EXACT_KEYS, 1e-9 relative on the rest. */
function sameRows(got, exp) {
  if (got.length !== exp.length) return false;
  const k = r => `${r.bin0}|${r.carrier ?? ""}`;
  const m = new Map(exp.map(r => [k(r), r]));
  for (const r of got) {
    const e = m.get(k(r));
    if (!e) return false;
    for (const f of Object.keys(e)) {
      if (f.startsWith("Symbol") || typeof e[f] !== "number") continue;
      const a = r[f], b = e[f];
      if (EXACT_KEYS.has(f) || !Number.isFinite(b)) { if (!Object.is(a, b) && !(a === b)) return false; }
      else if (!(Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b)))) return false;
    }
  }
  return true;
}

async function run(resolution, measures) {
  const paths = { index: 0, scan: 0 };
  const pw = registerParaweb(vega, { threads: 8, operators: false, onStats: s => { if (s.name !== "ref") paths[s.path]++; } });
  pw.registerTable("t", cols);
  const fast = new vega.View(vega.parse(spec(true, resolution, measures)), { renderer: "none" });
  const ref = new vega.View(vega.parse(spec(false, undefined, measures)), { renderer: "none" });
  await Promise.all([fast.runAsync(), ref.runAsync()]);
  let checks = 0, fails = 0;
  // Sessions: pick a field, move its brush many times, then switch.
  const order = ["a", "a", "b", "c", "a", "b", "b", "c", "a"];
  for (const f of order) {
    for (let step = 0; step < 25; step++) {
      const r = randomRange(f);
      fast.signal(`r_${f}`, r); ref.signal(`r_${f}`, r);
      await fast.runAsync(); await ref.runAsync();
      for (const g of FIELDS) {
        checks++;
        const x = key(fast.data(`v_${g}`)), y = key(ref.data(`v_${g}`));
        if (x !== y || (measures && !sameRows(fast.data(`v_${g}`), ref.data(`v_${g}`)))) {
          fails++;
          if (fails <= 5) console.log(`FAIL R=${resolution ?? "auto"} brush ${f}=${JSON.stringify(r)} view ${g}\n  got ${x.slice(0, 160)}\n  exp ${y.slice(0, 160)}`);
        }
      }
    }
  }
  fast.finalize(); ref.finalize(); pw.terminate();
  console.log(`R=${resolution ?? "auto"}${measures ? " with measures" : ""}: ${checks - fails}/${checks} views exact; pre-aggregated path answered ${paths.index}, scan ${paths.scan}`);
  return { fails, paths };
}

(async () => {
  ({ vega, vl } = await require("./vega-env.cjs").loadVega());
  let fails = 0;
  // Small chunks exercise the chunked, low-priority build path
  // (rows per worker here are far below the default chunk size).
  for (const [R, chunk] of [[8, 1000], [64, 0], [undefined, 1000], [undefined, 1 << 18]]) {
    buildConfig.chunkRows = chunk;
    console.log(`chunkRows=${chunk || "unsplit"}`);
    for (const measures of [false, true]) {
      const r = await run(R, measures);
      fails += r.fails;
      if (r.paths.index === 0) { console.log("FAIL: the index path was never used"); fails++; }
    }
  }
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
