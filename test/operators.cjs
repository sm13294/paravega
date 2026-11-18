/**
 * Differential test of the parallel operators: unchanged Vega specifications
 * run once on Vega's own operators and once with registerParaweb(vega)
 * installed, and every named data set must hold the same tuples (compared as
 * multisets, numbers to a relative tolerance of 1e-9), after the first run
 * and after every signal update.
 *
 *   npm run vega:build && node test/operators.cjs
 */
const path = require("path");
let vega, vl; // loaded in the main function (see test/vega-env.cjs)
const seedrandom = require("seedrandom");
const { registerParaweb } = require("../dist/paraweb-vega.cjs");

const N = Number(process.env.N || 50000);
const rng = seedrandom("paraweb-vega-operators");
const carriers = ["AA", "DL", "UA", "WN", "B6", "AS", "NK"];
const rows = () => {
  const r = seedrandom("rows");
  const out = [];
  for (let i = 0; i < N; i++) {
    const u = r() + r() + r() - 1.5;
    out.push({
      delay: r() < 0.03 ? null : Math.round(u * 80 * 10) / 10,
      distance: Math.round(50 + r() * r() * 2500),
      time: r() * 24,
      carrier: r() < 0.01 ? null : carriers[Math.floor(r() * carriers.length)],
      date: new Date(Date.UTC(2020, 0, 1) + Math.floor(r() * 365) * 864e5),
    });
  }
  return out;
};
void rng;

function canon(v) {
  if (v instanceof Date) return "D" + +v;
  if (typeof v === "number") return Number.isFinite(v) ? +v.toPrecision(10) : String(v);
  return v;
}
function key(t) {
  return JSON.stringify(Object.keys(t).sort().map(k => [k, canon(t[k])]));
}
function close(x, y) {
  if (typeof x === "number" && typeof y === "number") {
    if (Number.isNaN(x) || Number.isNaN(y)) return Number.isNaN(x) && Number.isNaN(y);
    // Sums are reassociated by the parallel scans: relative 1e-9, or absolute 1e-6 near zero (cancellation).
    return x === y || Math.abs(x - y) <= 1e-9 * Math.max(Math.abs(x), Math.abs(y)) || Math.abs(x - y) < 1e-6;
  }
  if (x instanceof Date && y instanceof Date) return +x === +y;
  return x === y;
}
function rowClose(t, u) {
  const k1 = Object.keys(t).sort(), k2 = Object.keys(u).sort();
  return k1.length === k2.length && k1.every((k, i) => k === k2[i] && close(t[k], u[k]));
}
function same(a, b, ordered) {
  if (a.length !== b.length) return `length ${a.length} vs ${b.length}`;
  if (ordered) {
    for (let i = 0; i < a.length; i++) if (!rowClose(a[i], b[i])) return `row ${i}: ${key(a[i])} vs ${key(b[i])}`;
    return null;
  }
  // Exact keys first (numbers to 10 digits), then a tolerant match for the rest.
  const m = new Map();
  for (const t of a) { const k = key(t); if (!m.has(k)) m.set(k, []); m.get(k).push(t); }
  const restB = [];
  for (const t of b) {
    const l = m.get(key(t));
    if (l && l.length) l.pop(); else restB.push(t);
  }
  const restA = [...m.values()].flat();
  for (const t of restB) {
    const j = restA.findIndex(u => rowClose(u, t));
    if (j < 0) return "missing " + key(t);
    restA.splice(j, 1);
  }
  return null;
}

async function run(spec, names, updates, parallel) {
  let handle = null;
  const fallbacks = [];
  let kernels = 0;
  if (parallel) {
    handle = registerParaweb(vega, { threads: 4, minRows: 1000, onFallback: (t, r) => fallbacks.push(`${t}: ${r}`),
      onStats: () => { kernels++; } });
  }
  const s = JSON.parse(JSON.stringify(spec));
  (s.data.find(d => d.name === (spec.$source || "src")) || s.data[0]).values = rows();
  const view = new vega.View(vega.parse(s), { renderer: "none" });
  await view.runAsync();
  const snap = () => names.map(n => view.data(n).map(t => ({ ...t })));
  const out = [snap()];
  for (const u of updates) {
    for (const [k, v] of Object.entries(u)) {
      // "data:<name>" replaces the tuples of a data set (a selection store).
      if (k.startsWith("data:")) view.data(k.slice(5), v);
      else view.signal(k, v);
    }
    await view.runAsync();
    out.push(snap());
  }
  const sigs = names.map(() => null);
  view.finalize();
  if (handle) handle.terminate();
  return { out, fallbacks, sigs, kernels };
}

const src = transform => ({ name: "src", transform: transform || [] });

const cases = [
  {
    name: "histogram with brush filter (hand-written range test)",
    signals: [{ name: "r", value: null }],
    data: [src(), { name: "h", source: "src", transform: [
      { type: "filter", expr: "!r || (datum.distance >= r[0] && datum.distance <= r[1])" },
      { type: "bin", field: "time", extent: [0, 24], maxbins: 24, as: ["bin0", "bin1"] },
      { type: "aggregate", groupby: ["bin0", "bin1"] },
    ] }],
    names: ["h"],
    updates: [{ r: [100, 400] }, { r: [300, 2600] }, { r: null }, { r: [5000, 6000] }],
    expectFallback: 0,
  },
  {
    name: "general expression filter, string field, all ops",
    signals: [{ name: "lo", value: 10 }],
    data: [src(), { name: "g", source: "src", transform: [
      { type: "filter", expr: "datum.carrier === 'AA' || (isValid(datum.delay) && datum.delay > lo)" },
      { type: "aggregate", groupby: ["carrier"],
        ops: ["count", "valid", "missing", "sum", "mean", "variance", "stdev", "min", "max"],
        fields: [null, "delay", "delay", "delay", "delay", "delay", "delay", "delay", "delay"] },
    ] }],
    names: ["g"],
    updates: [{ lo: -20 }, { lo: 60 }],
    expectFallback: 0,
  },
  {
    name: "extent -> bin with signal extent -> aggregate (Vega-Lite style)",
    data: [src([{ type: "extent", field: "delay", signal: "ext" }]), { name: "h", source: "src", transform: [
      { type: "bin", field: "delay", extent: { signal: "ext" }, maxbins: 30, as: ["b0", "b1"] },
      { type: "aggregate", groupby: ["b0", "b1"], ops: ["count", "mean"], fields: [null, "distance"], as: ["n", "m"] },
    ] }],
    names: ["h"],
    updates: [],
    expectFallback: 0,
  },
  {
    name: "formula feeding a filter and an aggregate, materialized output",
    signals: [{ name: "k", value: 2 }],
    data: [src(), { name: "f", source: "src", transform: [
      { type: "formula", as: "speed", expr: "datum.distance / max(1, datum.time) * k" },
      { type: "filter", expr: "datum.speed > 200" },
    ] }, { name: "fa", source: "f", transform: [
      { type: "aggregate", groupby: ["carrier"], ops: ["count", "max"], fields: [null, "speed"] },
    ] }],
    names: ["f", "fa"],
    updates: [{ k: 1 }, { k: 4 }],
    expectFallback: null,
  },
  {
    name: "filter output read by a mark data set (materialized changesets)",
    signals: [{ name: "r", value: [0, 500] }],
    data: [src(), { name: "sel", source: "src", transform: [
      { type: "filter", expr: "datum.distance >= r[0] && datum.distance <= r[1] && datum.time < 12" },
    ] }],
    names: ["sel"],
    updates: [{ r: [400, 900] }, { r: [0, 50] }, { r: [0, 5000] }],
    expectFallback: 0,
  },
  {
    name: "date field and string functions (main-thread fallback inside kernels)",
    data: [src(), { name: "d", source: "src", transform: [
      { type: "formula", as: "m", expr: "month(datum.date)" },
      { type: "formula", as: "lab", expr: "lower(datum.carrier || 'none')" },
      { type: "aggregate", groupby: ["lab"], ops: ["count", "sum"], fields: [null, "distance"] },
    ] }],
    names: ["d"],
    updates: [],
    expectFallback: null,
  },
];

(async () => {
  ({ vega, vl } = await require("./vega-env.cjs").loadVega());
  let pass = 0, fail = 0;
  // The full crossfilter dashboard of the benchmarks, unchanged ("stock").
  const { crossfilterSpec, FIELDS } = await import(path.join(__dirname, "../demo/crossfilterSpec.js"));
  const bins = { distance: { extent: [0, 4000], maxbins: 40 }, delay: { extent: [-60, 180], maxbins: 40 }, time: { extent: [0, 24], maxbins: 24 } };
  const cf = crossfilterSpec("stock", bins, FIELDS, { mean: { x: "distance", y: "delay", maxbins: 20 } });
  cases.unshift({
    name: "crossfilter dashboard (stock spec)",
    spec: cf,
    names: cf.data.map(d => d.name).filter(n => n !== "src"),
    // Brushes are set in pixels; the *_range signals are derived from them.
    updates: [{ distance_px: [20, 80] }, { delay_px: [100, 160] }, { distance_px: [30, 120] }, { time_px: [60, 110] }, { distance_px: null }],
    expectFallback: 0,
    aggregates: true,
  });

  // Vega-Lite specifications, compiled unchanged.
  const vlc = (s) => ({ ...vl.compile(s).spec, $source: "flights" });
  const cfVL = vlc({
    data: { name: "flights" },
    repeat: { column: ["distance", "delay", "time"] },
    spec: { layer: [
      { params: [{ name: "brush", select: { type: "interval", encodings: ["x"] } }],
        mark: "bar", encoding: { x: { field: { repeat: "column" }, bin: { maxbins: 20 } }, y: { aggregate: "count" }, color: { value: "#ddd" } } },
      { transform: [{ filter: { param: "brush" } }],
        mark: "bar", encoding: { x: { field: { repeat: "column" }, bin: { maxbins: 20 } }, y: { aggregate: "count" } } },
    ] },
  });
  const R = (unit, field, lo, hi) => [{ unit, fields: [{ field, channel: "x", type: "R" }], values: [[lo, hi]] }];
  const names = s => s.data.map(d => d.name).filter(n => n !== "flights" && !n.endsWith("_store"));
  cases.push({
    name: "Vega-Lite crossfilter (repeat, interval brush)",
    spec: cfVL, names: names(cfVL),
    updates: [
      { "data:brush_store": R("child__column_distance_layer_0", "distance", 200, 900) },
      { "data:brush_store": R("child__column_distance_layer_0", "distance", 300, 1400) },
      { "data:brush_store": R("child__column_delay_layer_0", "delay", 1500, -10) },
      { "data:brush_store": [] },
    ],
    expectFallback: 0, aggregates: true,
  });
  const ptVL = vlc({
    data: { name: "flights" },
    params: [{ name: "pick", select: { type: "point", fields: ["carrier"] } }],
    transform: [{ filter: { param: "pick", empty: false } }],
    mark: "bar", encoding: { x: { field: "time", bin: true }, y: { aggregate: "mean", field: "delay" } },
  });
  cases.push({
    name: "Vega-Lite point selection (empty: false) on a nominal field, mean",
    spec: ptVL, names: names(ptVL),
    updates: [
      { "data:pick_store": [{ unit: "", fields: [{ field: "carrier", type: "E" }], values: ["AA"] }] },
      { "data:pick_store": [{ unit: "", fields: [{ field: "carrier", type: "E" }], values: ["AA"] }, { unit: "", fields: [{ field: "carrier", type: "E" }], values: ["UA"] }] },
      { "data:pick_store": [] },
    ],
    expectFallback: 0,
  });
  const scVL = vlc({
    data: { name: "flights" },
    hconcat: [
      { params: [{ name: "b2", select: { type: "interval" } }], mark: "point",
        encoding: { x: { field: "distance", type: "quantitative" }, y: { field: "delay", type: "quantitative" } } },
      { transform: [{ filter: { param: "b2" } }], mark: "bar",
        encoding: { x: { field: "carrier", type: "nominal" }, y: { aggregate: "count" } } },
    ],
  });
  cases.push({
    name: "Vega-Lite 2-D interval brush filtering an aggregate",
    spec: scVL, names: names(scVL),
    updates: [
      { "data:b2_store": [{ unit: "concat_0", fields: [{ field: "distance", channel: "x", type: "R" }, { field: "delay", channel: "y", type: "R" }], values: [[100, 800], [-20, 30]] }] },
      { "data:b2_store": [] },
    ],
    expectFallback: 0,
  });

  const tuVL = vlc({
    data: { name: "flights" },
    vconcat: [
      { params: [{ name: "tb", select: { type: "interval", encodings: ["x"] } }], mark: "bar",
        encoding: { x: { field: "distance", bin: { maxbins: 30 } }, y: { aggregate: "count" } } },
      { transform: [{ filter: { param: "tb" } }], mark: "line",
        encoding: { x: { timeUnit: "yearmonth", field: "date" }, y: { aggregate: "mean", field: "delay" }, color: { field: "carrier" } } },
      { transform: [{ filter: { param: "tb" } }, { calculate: "datum.distance / max(1, datum.time)", as: "speed" }], mark: "bar",
        encoding: { x: { field: "speed", bin: { maxbins: 25 } }, y: { aggregate: "sum", field: "speed" } } },
      { transform: [{ timeUnit: "month", field: "date", as: "mon" }, { filter: { param: "tb" } }], mark: "bar",
        encoding: { x: { field: "mon", timeUnit: "month" }, y: { aggregate: "count" } } },
    ],
  });
  cases.push({
    name: "Vega-Lite timeUnit, calculate + bin + sum, month of a date",
    spec: tuVL, names: names(tuVL),
    updates: [
      { "data:tb_store": [{ unit: "concat_0", fields: [{ field: "distance", channel: "x", type: "R" }], values: [[100, 900]] }] },
      { "data:tb_store": [] },
    ],
    expectFallback: 0, aggregates: true,
  });

  cases.push({
    name: "joinaggregate (group mean per row) -> filter on it -> aggregate; materialized rows",
    signals: [{ name: "r", value: [0, 4000] }],
    data: [src(), { name: "j", source: "src", transform: [
      { type: "filter", expr: "datum.distance >= r[0] && datum.distance <= r[1]" },
      { type: "joinaggregate", groupby: ["carrier"], ops: ["mean", "count", "max"], fields: ["delay", null, "distance"], as: ["avg", "n", "mx"] },
      { type: "filter", expr: "datum.delay > datum.avg" },
      { type: "formula", as: "rel", expr: "datum.distance / datum.mx" },
      { type: "aggregate", groupby: ["carrier"], ops: ["count", "mean"], fields: [null, "rel"] },
    ] }, { name: "jt", source: "src", transform: [
      { type: "joinaggregate", groupby: ["carrier"], ops: ["sum"], fields: ["time"], as: ["tsum"] },
      { type: "filter", expr: "datum.time > 23.5" },
    ] }],
    names: ["j", "jt"],
    updates: [{ r: [200, 900] }, { r: [0, 300] }],
    expectFallback: 0,
  });
  const normVL = vlc({
    data: { name: "flights" },
    transform: [
      { joinaggregate: [{ op: "sum", field: "distance", as: "tot" }], groupby: ["carrier"] },
      { calculate: "datum.distance / datum.tot * 1e4", as: "share" },
    ],
    mark: "bar", encoding: { x: { field: "share", bin: { maxbins: 30 } }, y: { aggregate: "count" }, color: { field: "carrier" } },
  });
  cases.push({ name: "Vega-Lite joinaggregate + calculate + bin by group", spec: normVL, names: names(normVL), updates: [], expectFallback: 0 });

  cases.push({
    name: "sorted collect (parallel sample sort): numbers, strings with nulls, descending, after a filter",
    // The signal reads s1, so its tuples are created and sorted by the workers (not lazily).
    signals: [{ name: "r", value: [0, 4000] }, { name: "first", update: "length(data('s1')) ? data('s1')[0].distance : -1" }],
    data: [src(), { name: "s1", source: "src", transform: [
      { type: "filter", expr: "datum.distance >= r[0] && datum.distance <= r[1]" },
      { type: "collect", sort: { field: ["carrier", "distance"], order: ["ascending", "descending"] } },
    ] }, { name: "s2", source: "src", transform: [
      { type: "collect", sort: { field: "time" } },
    ] }],
    names: ["s1", "s2"], ordered: ["s1", "s2"],
    updates: [{ r: [300, 1200] }, { r: [0, 100] }],
    expectFallback: 0,
  });

  const WOPS = ["row_number", "rank", "dense_rank", "percent_rank", "cume_dist", "count", "sum", "mean", "min", "max", "valid", "missing"];
  const WF = [null, null, null, null, null, null, "delay", "delay", "delay", "time", "delay", "delay"];
  cases.push({
    name: "window (parallel Scan): ranks and cumulative aggregates, peers and ignorePeers, partitions, no sort",
    signals: [{ name: "r", value: [0, 4000] }],
    data: [src(), { name: "w1", source: "src", transform: [
      { type: "filter", expr: "datum.distance >= r[0] && datum.distance <= r[1]" },
      { type: "window", groupby: ["carrier"], sort: { field: "distance" }, ops: WOPS, fields: WF,
        as: WOPS.map(o => "w_" + o) },
    ] }, { name: "w2", source: "src", transform: [
      { type: "window", sort: { field: ["distance", "time"], order: ["descending", "ascending"] }, ignorePeers: true,
        ops: ["row_number", "rank", "cume_dist", "sum", "count"], fields: [null, null, null, "delay", null], as: ["rn", "rk", "cd", "s", "c"] },
    ] }, { name: "w3", source: "src", transform: [
      { type: "window", groupby: ["carrier"], ops: ["row_number", "count", "max"], fields: [null, null, "distance"], as: ["rn", "c", "mx"] },
    ] }],
    names: ["w1", "w2", "w3"],
    updates: [{ r: [300, 1200] }],
    expectFallback: 0,
  });

  // Quantiles: a Vega-Lite box plot (aggregate with q1, median, q3, min, max; joinaggregate and filter for outliers).
  const boxVL = vlc({
    data: { name: "flights" },
    vconcat: [
      { params: [{ name: "b", select: { type: "interval", encodings: ["x"] } }], mark: "bar",
        encoding: { x: { field: "distance", bin: { maxbins: 20 } }, y: { aggregate: "count" } } },
      { transform: [{ filter: { param: "b" } }], mark: "boxplot", encoding: { x: { field: "carrier" }, y: { field: "delay", type: "quantitative" } } },
    ],
  });
  cases.push({
    name: "Vega-Lite box plot (q1, median, q3 by parallel sort) behind a brush",
    spec: boxVL, names: names(boxVL),
    updates: [{ "data:b_store": R("concat_0", "distance", 300, 1500) }],
    expectFallback: 0,
  });
  cases.push({
    name: "aggregate with median, q1, q3 next to other ops, derived field, bins",
    signals: [{ name: "r", value: [0, 4000] }],
    data: [src(), { name: "q", source: "src", transform: [
      { type: "filter", expr: "datum.distance >= r[0] && datum.distance <= r[1]" },
      { type: "formula", expr: "datum.delay * 2", as: "d2" },
      { type: "bin", field: "time", extent: [0, 24], maxbins: 6, as: ["b0", "b1"] },
      { type: "aggregate", groupby: ["b0", "carrier"], ops: ["median", "q1", "q3", "count", "mean", "median"], fields: ["delay", "d2", "distance", null, "delay", "distance"] },
    ] }, { name: "q0", source: "src", transform: [
      { type: "aggregate", ops: ["median", "q3"], fields: ["time", "delay"], as: ["m", "t"] },
    ] }],
    names: ["q", "q0"],
    updates: [{ r: [300, 1200] }],
    expectFallback: 0,
  });

  // Lookup: a small secondary table joined into the rows, then used by filter, formula and aggregate.
  cases.push({
    name: "lookup (values from a secondary table by key, default, two keys) feeding filter, formula, aggregate",
    signals: [{ name: "hub", value: "east" }],
    data: [
      { name: "carriers", values: [
        { code: "AA", name: "American", region: "east", fleet: 950 }, { code: "DL", name: "Delta", region: "east", fleet: 900 },
        { code: "UA", name: "United", region: "west", fleet: 850 }, { code: "WN", name: "Southwest", region: "west", fleet: 780 },
        { code: "B6", name: "JetBlue", region: "east", fleet: 290 }, { code: "AS", name: "Alaska", region: "west", fleet: 330 } ] },
      src(),
      { name: "l1", source: "src", transform: [
        { type: "lookup", from: "carriers", key: "code", fields: ["carrier"], values: ["name", "region", "fleet"], default: "unknown" },
        { type: "filter", expr: "datum.region === hub || datum.region === 'unknown'" },
        { type: "formula", expr: "datum.delay / datum.fleet", as: "rate" },
        { type: "aggregate", groupby: ["name", "region"], ops: ["count", "mean", "sum"], fields: [null, "rate", "fleet"], as: ["n", "r", "f"] },
      ] },
      { name: "l2", source: "src", transform: [
        { type: "formula", expr: "datum.carrier === 'AA' ? 'DL' : datum.carrier", as: "c2" },
        { type: "lookup", from: "carriers", key: "code", fields: ["carrier", "c2"], values: ["fleet"], as: ["f1", "f2"] },
        { type: "filter", expr: "datum.f1 != null && datum.f2 > 300" },
      ] },
    ],
    names: ["l1", "l2"],
    updates: [{ hub: "west" }],
    expectFallback: 0,
    // The default "unknown" also fills the numeric field fleet: Vega sums the string as NaN, so that sum runs on Vega.
    allowFallback: ["aggregate: measure fleet with values that are not numbers"],
  });

  // Window frames and value ops.
  cases.push({
    name: "window frames (sliding, one-sided, whole partition, peers) and value ops (lag, lead, first, last, nth)",
    signals: [{ name: "r", value: [0, 4000] }],
    data: [src(), { name: "f1", source: "src", transform: [
      { type: "filter", expr: "datum.distance >= r[0] && datum.distance <= r[1]" },
      { type: "window", groupby: ["carrier"], sort: { field: "distance" }, frame: [-3, 3],
        ops: ["sum", "mean", "count", "valid", "missing", "min", "max", "rank"], fields: ["delay", "delay", null, "delay", "delay", "delay", "delay", null],
        as: ["s", "m", "c", "v", "mi", "lo", "hi", "rk"] },
    ] }, { name: "f2", source: "src", transform: [
      { type: "window", sort: { field: "time" }, frame: [-50, 0], ignorePeers: true, ops: ["mean", "sum"], fields: ["delay", "distance"], as: ["ma", "sd"] },
    ] }, { name: "f3", source: "src", transform: [
      { type: "window", groupby: ["carrier"], sort: { field: "distance" }, frame: [null, null],
        ops: ["sum", "count", "first_value", "last_value", "nth_value", "lag", "lead"],
        fields: ["delay", null, "delay", "delay", "distance", "delay", "distance"], params: [null, null, null, null, 3, 2, null],
        as: ["tot", "n", "fv", "lv", "nv", "lg", "ld"] },
    ] }, { name: "f4", source: "src", transform: [
      { type: "window", groupby: ["carrier"], sort: { field: "distance" }, frame: [0, 10], ops: ["sum", "max", "first_value", "last_value"],
        fields: ["distance", "distance", "delay", "delay"], as: ["s", "mx", "fv", "lv"] },
    ] }],
    names: ["f1", "f2", "f3", "f4"],
    updates: [{ r: [300, 1200] }],
    expectFallback: 0,
  });

  // Density (kde): Vega-Lite density per group behind a brush; Vega kde with every option.
  const dVL = vlc({
    data: { name: "flights" },
    vconcat: [
      { params: [{ name: "b", select: { type: "interval", encodings: ["x"] } }], mark: "bar",
        encoding: { x: { field: "distance", bin: { maxbins: 20 } }, y: { aggregate: "count" } } },
      { transform: [{ filter: { param: "b" } }, { density: "delay", groupby: ["carrier"] }], mark: "line",
        encoding: { x: { field: "value", type: "quantitative" }, y: { field: "density", type: "quantitative" }, color: { field: "carrier" } } },
    ],
  });
  cases.push({
    name: "Vega-Lite density per group (kde, estimated bandwidth) behind a brush",
    spec: dVL, names: names(dVL),
    updates: [{ "data:b_store": R("concat_0", "distance", 300, 1500) }, { "data:b_store": R("concat_0", "distance", 800, 900) }],
    expectFallback: 0,
    // The per-color line facets aggregate the density output with parameters ParaVega does not
    // support; they see 1,000 rows or more only because this test lowers minRows to 1000.
    allowFallback: ["aggregate: cross, drop or key"],
  });
  cases.push({
    name: "Vega kde: cumulative, counts, extent, shared, steps, fixed bandwidth, derived field",
    signals: [{ name: "r", value: [0, 4000] }],
    data: [src(), { name: "k1", source: "src", transform: [
      { type: "filter", expr: "datum.distance >= r[0] && datum.distance <= r[1]" },
      { type: "kde", field: "delay", groupby: ["carrier"], cumulative: true, counts: true, resolve: "shared" },
    ] }, { name: "k2", source: "src", transform: [
      { type: "formula", expr: "datum.delay / 10 + datum.time", as: "z" },
      { type: "kde", field: "z", extent: [-20, 40], minsteps: 10, maxsteps: 60, as: ["x", "y"] },
    ] }, { name: "k3", source: "src", transform: [
      { type: "kde", field: "time", groupby: ["carrier"], bandwidth: 0.5, steps: 50 },
    ] }],
    names: ["k1", "k2", "k3"],
    updates: [{ r: [300, 1200] }],
    expectFallback: 0,
  });

  for (const c of cases) {
    if (process.env.CASE && !c.name.includes(process.env.CASE)) continue;
    const spec = c.spec || { signals: c.signals || [], data: c.data };
    const a = await run(spec, c.names, c.updates, false);
    const b = await run(spec, c.names, c.updates, true);
    let bad = null;
    a.out.forEach((step, si) => step.forEach((d, di) => {
      const r = same(d, b.out[si][di], c.ordered && c.ordered.includes(c.names[di]));
      if (r && !bad) bad = `step ${si}, data ${c.names[di]}: ${r}`;
    }));
    const unexpected = b.fallbacks.filter(f => !(c.allowFallback || []).includes(f));
    if (c.expectFallback === 0 && unexpected.length) bad = bad || "unexpected fallback: " + unexpected.join("; ");
    if (c.aggregates && b.kernels === 0) bad = bad || "no parallel aggregation ran";
    if (bad) { fail++; console.log("FAIL", c.name, "-", bad); }
    else { pass++; console.log("ok  ", c.name, b.fallbacks.length ? `(fallbacks: ${b.fallbacks.join("; ")})` : ""); }
  }
  console.log(`${pass}/${pass + fail} operator cases passed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
