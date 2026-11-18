/**
 * The WebGPU path must equal the CPU scan, count for count, over randomized
 * brushes (range filters with awkward bounds, bins with values outside the
 * extent and missing values, a group-by dimension). A view with measures must
 * fall back to the CPU. Runs in Node.js with the Dawn-based "webgpu" package.
 *
 *   node test/gpu.cjs
 */
let vega, vl; // loaded in the main function (see test/vega-env.cjs)
const seedrandom = require("seedrandom");
const { registerParaweb } = require("../dist/paraweb-vega.cjs");

const N = 200003;
const rng = seedrandom("gpu");
const carriers = ["AA", "DL", "UA", "WN", "B6", null];
const cols = {
  a: Float64Array.from({ length: N }, () => Math.floor(rng() * 100)),
  b: Float64Array.from({ length: N }, () => (rng() < 0.02 ? NaN : (rng() + rng()) * 50 - 50)),
  c: Float64Array.from({ length: N }, () => (rng() < 0.001 ? -0 : Math.round(1000 * rng() * rng() * rng()))),
  carrier: Array.from({ length: N }, () => carriers[Math.floor(rng() * carriers.length)]),
};
const FIELDS = ["a", "b", "c"];

function spec() {
  const signals = FIELDS.map(f => ({ name: `r_${f}`, value: null }));
  const data = FIELDS.map(f => ({
    name: `v_${f}`,
    transform: [{
      type: "pwaggregate", table: "t", name: f,
      filter: FIELDS.filter(g => g !== f).map(g => ({ field: g, range: { signal: `r_${g}` } })),
      // narrower extent than the data for b: values fall in the -Inf / +Inf bins
      bins: [{ field: f, maxbins: 30, ...(f === "b" ? { extent: [-20, 20] } : {}) }],
      ...(f === "c" ? { groupby: ["carrier"] } : {}),
    }],
  }));
  data.push({ name: "m", transform: [{ type: "pwaggregate", table: "t", name: "m",
    filter: FIELDS.map(g => ({ field: g, range: { signal: `r_${g}` } })),
    groupby: ["carrier"], ops: ["count", "mean"], fields: [null, "b"], as: ["count", "mean_b"] }] });
  return { signals, data };
}

function randomRange(f) {
  const ext = { a: [0, 99], b: [-50, 50], c: [0, 1000] }[f];
  const span = ext[1] - ext[0], u = rng();
  if (u < 0.1) return null;
  if (u < 0.15) return [-Infinity, Infinity];
  if (u < 0.2) return [-0, 0];
  if (u < 0.3) { const x = Math.floor(ext[0] + rng() * span); return [x, x]; }
  const x = ext[0] + rng() * span, y = ext[0] + rng() * span;
  return [Math.min(x, y), Math.max(x, y)];
}

const rowsKey = rows => rows.map(r => JSON.stringify(Object.keys(r).sort().map(k => [k, r[k]]))).sort().join("\n");

(async () => {
  ({ vega, vl } = await require("./vega-env.cjs").loadVega());
  const paths = {};
  const gpu = registerParaweb(vega, { threads: 8, gpu: true, operators: false, onStats: s => { paths[`${s.name}:${s.path}`] = (paths[`${s.name}:${s.path}`] || 0) + 1; } });
  await gpu.ready;
  if (!gpu.gpu) { console.log("WebGPU not available: skipped"); process.exit(0); }
  gpu.registerTable("t", cols);
  const fast = new vega.View(vega.parse(spec()), { renderer: "none" });
  await fast.runAsync();
  const snap = () => Object.fromEntries([...FIELDS.map(f => `v_${f}`), "m"].map(d => [d, rowsKey(fast.data(d))]));
  const results = [];
  const moves = [];
  for (let s = 0; s < 120; s++) { const f = FIELDS[Math.floor(rng() * 3)]; moves.push([f, randomRange(f)]); }
  for (const [f, r] of moves) { fast.signal(`r_${f}`, r); await fast.runAsync(); results.push(snap()); }
  fast.finalize(); gpu.terminate();

  const cpu = registerParaweb(vega, { threads: 8, operators: false });
  cpu.registerTable("t", cols);
  const ref = new vega.View(vega.parse(spec()), { renderer: "none" });
  await ref.runAsync();
  let checks = 0, fails = 0;
  for (let i = 0; i < moves.length; i++) {
    const [f, r] = moves[i];
    ref.signal(`r_${f}`, r); await ref.runAsync();
    for (const d of [...FIELDS.map(f => `v_${f}`), "m"]) {
      checks++;
      const y = rowsKey(ref.data(d));
      if (results[i][d] !== y) { fails++; if (fails <= 3) console.log(`FAIL move ${i} ${f}=${JSON.stringify(r)} view ${d}\n got ${results[i][d].slice(0, 200)}\n exp ${y.slice(0, 200)}`); }
    }
  }
  ref.finalize(); cpu.terminate();
  const gpuUsed = ["a", "b", "c"].every(f => paths[`${f}:gpu`] > 0) && !paths["m:gpu"];
  console.log(`${checks - fails}/${checks} views equal; paths ${JSON.stringify(paths)}`);
  if (!gpuUsed) { console.log("FAIL: histograms must use the GPU and the measures view the CPU"); fails++; }
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
