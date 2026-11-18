/**
 * Differential test: every case runs as a stock Vega spec and as a
 * pwaggregate spec over the same data, and the outputs must agree
 * (numbers to a relative tolerance of 1e-9, groups compared as sets).
 *
 *   node test/correctness.cjs
 */
let vega, vl; // loaded in the main function (see test/vega-env.cjs)
const seedrandom = require("seedrandom");
const { registerParaweb } = require("../dist/paraweb-vega.cjs");

const N = Number(process.env.N || 60000);
const rng = seedrandom("paraweb-vega");
const carriers = ["AA", "DL", "UA", "WN", "B6", "AS", "NK", "F9", "HA", "G4"];
const rows = [];
for (let i = 0; i < N; i++) {
  const u = rng() + rng() + rng() - 1.5;
  rows.push({
    delay: rng() < 0.03 ? null : Math.round(u * 80 * 10) / 10,
    distance: Math.round(50 + rng() * rng() * 2500),
    time: rng() * 24,
    carrier: rng() < 0.01 ? null : carriers[Math.floor(rng() * carriers.length)],
  });
}
const columns = {
  delay: Float64Array.from(rows, r => (r.delay == null ? NaN : r.delay)),
  distance: Float64Array.from(rows, r => r.distance),
  time: Float64Array.from(rows, r => r.time),
  carrier: rows.map(r => r.carrier),
};

const ALL_OPS = ["count", "valid", "missing", "sum", "mean", "average", "variance",
  "variancep", "stdev", "stdevp", "stderr", "min", "max"];

/**
 * Each case gives the pieces of both specs. `stock` lists the Vega
 * transforms to run after an extent data set; `pw` is the pwaggregate.
 */
const cases = [
  {
    name: "histogram (maxbins 20, count)",
    stock: [
      { type: "bin", field: "distance", extent: { signal: "ext_distance" }, maxbins: 20, as: ["bin0", "bin1"] },
      { type: "aggregate", groupby: ["bin0", "bin1"] },
    ],
    pw: { bins: [{ field: "distance", maxbins: 20 }] },
  },
  {
    name: "histogram filtered by range signal",
    signals: [{ name: "brush", value: [400, 1200] }],
    stock: [
      { type: "filter", expr: "datum.distance >= brush[0] && datum.distance <= brush[1]" },
      { type: "bin", field: "time", extent: { signal: "ext_time" }, maxbins: 24, as: ["bin0", "bin1"] },
      { type: "aggregate", groupby: ["bin0", "bin1"] },
    ],
    pw: { filter: [{ field: "distance", range: { signal: "brush" } }], bins: [{ field: "time", maxbins: 24 }] },
    update: [{ brush: [100, 300] }, { brush: [2000, 2600] }, { brush: [5000, 6000] }],
  },
  {
    name: "group-by carrier, all ops on a field with nulls",
    stock: [{ type: "aggregate", groupby: ["carrier"], ops: ALL_OPS, fields: ALL_OPS.map(() => "delay") }],
    pw: { groupby: ["carrier"], ops: ALL_OPS, fields: ALL_OPS.map(() => "delay") },
  },
  {
    name: "2D bins (distance x time), count + mean",
    stock: [
      { type: "bin", field: "distance", extent: { signal: "ext_distance" }, maxbins: 40, as: ["d0", "d1"] },
      { type: "bin", field: "time", extent: { signal: "ext_time" }, maxbins: 40, as: ["t0", "t1"] },
      { type: "aggregate", groupby: ["d0", "d1", "t0", "t1"], ops: ["count", "mean"], fields: [null, "delay"], as: ["n", "avg"] },
    ],
    pw: {
      bins: [{ field: "distance", maxbins: 40, as: ["d0", "d1"] }, { field: "time", maxbins: 40, as: ["t0", "t1"] }],
      ops: ["count", "mean"], fields: [null, "delay"], as: ["n", "avg"],
    },
  },
  {
    name: "large key space (2D bins x carrier, stdev) -> parallel merge",
    stock: [
      { type: "bin", field: "distance", extent: { signal: "ext_distance" }, maxbins: 60, as: ["d0", "d1"] },
      { type: "bin", field: "time", extent: { signal: "ext_time" }, maxbins: 60, as: ["t0", "t1"] },
      { type: "aggregate", groupby: ["d0", "d1", "t0", "t1", "carrier"], ops: ["count", "stdev", "max"], fields: [null, "delay", "delay"] },
    ],
    pw: {
      bins: [{ field: "distance", maxbins: 60, as: ["d0", "d1"] }, { field: "time", maxbins: 60, as: ["t0", "t1"] }],
      groupby: ["carrier"], ops: ["count", "stdev", "max"], fields: [null, "delay", "delay"],
    },
  },
  {
    name: "oneOf filter + group-by + bin",
    signals: [{ name: "sel", value: ["AA", "DL"] }],
    stock: [
      { type: "filter", expr: "indexof(sel, datum.carrier) >= 0" },
      { type: "bin", field: "time", extent: { signal: "ext_time" }, maxbins: 12, as: ["bin0", "bin1"] },
      { type: "aggregate", groupby: ["bin0", "bin1", "carrier"], ops: ["sum"], fields: ["distance"] },
    ],
    pw: { filter: [{ field: "carrier", oneOf: { signal: "sel" } }], bins: [{ field: "time", maxbins: 12 }], groupby: ["carrier"], ops: ["sum"], fields: ["distance"] },
    update: [{ sel: ["NK"] }, { sel: ["AA", "UA", "HA", "G4"] }],
  },
  {
    name: "explicit extent + step + anchor, values outside extent",
    stock: [
      { type: "bin", field: "delay", extent: [-50, 50], step: 7, anchor: 3, as: ["bin0", "bin1"] },
      { type: "aggregate", groupby: ["bin0", "bin1"] },
    ],
    pw: { bins: [{ field: "delay", extent: [-50, 50], step: 7, anchor: 3 }] },
  },
  {
    name: "no group-by, two range filters",
    signals: [{ name: "b1", value: [500, 1500] }, { name: "b2", value: [6, 18] }],
    stock: [
      { type: "filter", expr: "datum.distance >= b1[0] && datum.distance <= b1[1] && datum.time >= b2[0] && datum.time <= b2[1]" },
      { type: "aggregate", ops: ["count", "mean", "min"], fields: [null, "distance", "time"] },
    ],
    pw: {
      filter: [{ field: "distance", range: { signal: "b1" } }, { field: "time", range: { signal: "b2" } }],
      ops: ["count", "mean", "min"], fields: [null, "distance", "time"],
    },
  },
];

function stockSpec(c) {
  return {
    signals: c.signals || [],
    data: [
      { name: "src", values: rows },
      { name: "extents", source: "src", transform: [
        { type: "extent", field: "distance", signal: "ext_distance" },
        { type: "extent", field: "time", signal: "ext_time" },
      ] },
      { name: "out", source: "src", transform: c.stock },
    ],
  };
}

function pwSpec(c, mode) {
  const t = { type: "pwaggregate", ...c.pw };
  if (mode === "table") {
    return { signals: c.signals || [], data: [{ name: "out", transform: [{ ...t, table: "rows" }] }] };
  }
  return { signals: c.signals || [], data: [{ name: "src", values: rows }, { name: "out", source: "src", transform: [t] }] };
}

function close(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return a == b && (a === undefined) === (b === undefined) || (a == null && b == null);
  if (typeof a === "number" && typeof b === "number") {
    if (Number.isNaN(a) && Number.isNaN(b)) return true;
    return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
  }
  return false;
}

function compare(expected, actual) {
  const strip = r => {
    const o = {};
    for (const k of Object.keys(r)) if (k !== "_id" && !k.startsWith("Symbol")) o[k] = r[k];
    return o;
  };
  const E = expected.map(strip), A = actual.map(strip);
  if (E.length !== A.length) return `group count ${A.length} != ${E.length}`;
  const dimKeys = r => JSON.stringify(Object.keys(r).filter(k => /^(bin|d|t)[01]$|^carrier$/.test(k)).sort().map(k => String(r[k])));
  const byKey = new Map(A.map(r => [dimKeys(r), r]));
  for (const e of E) {
    const a = byKey.get(dimKeys(e));
    if (!a) return `missing group ${dimKeys(e)}`;
    for (const k of Object.keys(e)) {
      if (!close(e[k], a[k])) return `group ${dimKeys(e)} field ${k}: ${a[k]} != ${e[k]}`;
    }
    for (const k of Object.keys(a)) if (!(k in e)) return `unexpected field ${k}`;
  }
  return null;
}

async function evalSpec(spec, updates) {
  const view = new vega.View(vega.parse(spec), { renderer: "none" });
  await view.runAsync();
  const results = [view.data("out").slice()];
  for (const u of updates || []) {
    for (const [k, v] of Object.entries(u)) view.signal(k, v);
    await view.runAsync();
    results.push(view.data("out").slice());
  }
  view.finalize();
  return results;
}

async function main() {
  ({ vega, vl } = await require("./vega-env.cjs").loadVega());
  let failures = 0, checks = 0;
  for (const threads of [1, 3, 16]) {
    const statsSeen = new Set();
    const pw = registerParaweb(vega, { threads, operators: false, onStats: s => statsSeen.add(s.mergeMode) });
    pw.registerTable("rows", columns);
    for (const c of cases) {
      const expected = await evalSpec(stockSpec(c), c.update);
      for (const mode of ["tuples", "table"]) {
        const actual = await evalSpec(pwSpec(c, mode), c.update);
        for (let s = 0; s < expected.length; s++) {
          checks++;
          const err = compare(expected[s], actual[s]);
          const label = `[threads=${threads} ${mode}] ${c.name}${s ? ` (update ${s})` : ""}`;
          if (err) { failures++; console.log(`FAIL ${label}: ${err}`); }
          else console.log(`ok   ${label} (${expected[s].length} groups)`);
        }
      }
    }
    console.log(`threads=${threads}: merge modes used = ${[...statsSeen].join(", ")}`);
    pw.terminate();
  }
  console.log(`\n${checks - failures}/${checks} checks passed`);
  process.exit(failures ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
