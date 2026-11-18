/**
 * The unchanged Vega and Vega-Lite specifications of the operator benchmark
 * (bench/operators.cjs in Node, demo/operators.html in the browser), and the
 * synthetic rows they read. Each entry gives a Vega specification (spec) or a
 * Vega-Lite one (vl), the name of the source data set, and the k-th
 * interaction (signal values, or "data:<name>" for a selection store).
 */
export function makeRows(n) {
  let s = 12345;
  const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  const carriers = ["AA", "DL", "UA", "WN", "B6", "AS", "NK", "F9", "HA", "G4"];
  const t0 = Date.UTC(2020, 0, 1);
  const rows = new Array(n);
  for (let i = 0; i < n; i++) {
    const u = rnd() + rnd() + rnd() - 1.5;
    rows[i] = {
      delay: Math.round(u * 80 * 10) / 10,
      distance: Math.round(50 + rnd() * rnd() * 2500),
      time: rnd() * 24,
      carrier: carriers[Math.floor(rnd() * carriers.length)],
      date: new Date(t0 + Math.floor(rnd() * 365 * 24) * 36e5),
    };
  }
  return rows;
}

export const SPECS = {
  /** The hand-written three-view crossfilter of the benchmarks (Vega). */
  "vega-crossfilter": async () => {
    const { crossfilterSpec, FIELDS } = await import("./crossfilterSpec.js");
    const bins = { distance: { extent: [0, 4000], maxbins: 40 }, delay: { extent: [-60, 180], maxbins: 40 }, time: { extent: [0, 24], maxbins: 24 } };
    return {
      spec: crossfilterSpec("stock", bins, FIELDS), source: "src",
      updates: k => ({ distance_px: [20 + 5 * k, 80 + 5 * k] }),
    };
  },
  /** Vega-Lite crossfilter: repeated layered histograms with one interval brush. */
  "vl-crossfilter": () => ({
    vl: {
      data: { name: "flights" }, repeat: { column: ["distance", "delay", "time"] },
      spec: { layer: [
        { params: [{ name: "brush", select: { type: "interval", encodings: ["x"] } }], mark: "bar",
          encoding: { x: { field: { repeat: "column" }, bin: { maxbins: 20 } }, y: { aggregate: "count" }, color: { value: "#ddd" } } },
        { transform: [{ filter: { param: "brush" } }], mark: "bar",
          encoding: { x: { field: { repeat: "column" }, bin: { maxbins: 20 } }, y: { aggregate: "count" } } },
      ] },
    },
    source: "flights",
    updates: k => ({ "data:brush_store": [{ unit: "child__column_distance_layer_0", fields: [{ field: "distance", channel: "x", type: "R" }], values: [[200 + 40 * k, 1000 + 40 * k]] }] }),
  }),
  /** Vega-Lite overview + detail: a brush on a histogram filters a monthly line per carrier. */
  "vl-timeunit": () => ({
    vl: {
      data: { name: "flights" },
      vconcat: [
        { params: [{ name: "b", select: { type: "interval", encodings: ["x"] } }], mark: "bar",
          encoding: { x: { field: "distance", bin: { maxbins: 40 } }, y: { aggregate: "count" } } },
        { transform: [{ filter: { param: "b" } }], mark: "line",
          encoding: { x: { timeUnit: "yearmonthdate", field: "date" }, y: { aggregate: "mean", field: "delay" }, color: { field: "carrier" } } },
      ],
    },
    source: "flights",
    updates: k => ({ "data:b_store": [{ unit: "concat_0", fields: [{ field: "distance", channel: "x", type: "R" }], values: [[100 + 30 * k, 900 + 30 * k]] }] }),
  }),
  /** Vega-Lite normalized histogram: joinaggregate + calculate + bin, filtered by a brush. */
  "vl-joinaggregate": () => ({
    vl: {
      data: { name: "flights" },
      vconcat: [
        { params: [{ name: "b", select: { type: "interval", encodings: ["x"] } }], mark: "bar",
          encoding: { x: { field: "time", bin: { maxbins: 24 } }, y: { aggregate: "count" } } },
        { transform: [
          { filter: { param: "b" } },
          { joinaggregate: [{ op: "mean", field: "delay", as: "avg" }], groupby: ["carrier"] },
          { calculate: "datum.delay - datum.avg", as: "dev" },
        ], mark: "bar", encoding: { x: { field: "dev", bin: { maxbins: 30 } }, y: { aggregate: "count" }, color: { field: "carrier" } } },
      ],
    },
    source: "flights",
    updates: k => ({ "data:b_store": [{ unit: "concat_0", fields: [{ field: "time", channel: "x", type: "R" }], values: [[2 + 0.5 * k, 10 + 0.5 * k]] }] }),
  }),
  /** Vega-Lite density plot: delay density per carrier (kde, estimated bandwidth), filtered by a brush. */
  "vl-density": () => ({
    vl: {
      data: { name: "flights" },
      vconcat: [
        { params: [{ name: "b", select: { type: "interval", encodings: ["x"] } }], mark: "bar",
          encoding: { x: { field: "distance", bin: { maxbins: 40 } }, y: { aggregate: "count" } } },
        { transform: [{ filter: { param: "b" } }, { density: "delay", groupby: ["carrier"] }], mark: "line",
          encoding: { x: { field: "value", type: "quantitative" }, y: { field: "density", type: "quantitative" }, color: { field: "carrier" } } },
      ],
    },
    source: "flights",
    updates: k => ({ "data:b_store": [{ unit: "concat_0", fields: [{ field: "distance", channel: "x", type: "R" }], values: [[100 + 30 * k, 900 + 30 * k]] }] }),
  }),
  /** Vega-Lite moving average: mean delay over the 30 previous rows by time, per carrier (window frame), filtered by a brush. */
  "vl-movingavg": () => ({
    vl: {
      data: { name: "flights" },
      vconcat: [
        { params: [{ name: "b", select: { type: "interval", encodings: ["x"] } }], mark: "bar",
          encoding: { x: { field: "distance", bin: { maxbins: 40 } }, y: { aggregate: "count" } } },
        { transform: [
          { filter: { param: "b" } },
          { window: [{ op: "mean", field: "delay", as: "ma" }], frame: [-30, 0], groupby: ["carrier"], sort: [{ field: "time" }] },
          { filter: "datum.ma > 20" },
        ], mark: "bar", encoding: { x: { field: "time", bin: { maxbins: 48 } }, y: { aggregate: "count" }, color: { field: "carrier" } } },
      ],
    },
    source: "flights",
    updates: k => ({ "data:b_store": [{ unit: "concat_0", fields: [{ field: "distance", channel: "x", type: "R" }], values: [[100 + 30 * k, 900 + 30 * k]] }] }),
  }),
  /** Vega-Lite lookup: carrier names and regions from a small table, then a grouped bar chart, filtered by a brush. */
  "vl-lookup": () => ({
    vl: {
      datasets: { carriers: ["AA", "DL", "UA", "WN", "B6", "AS", "NK", "F9", "HA", "G4"].map((c, i) => ({ code: c, name: "Carrier " + c, region: i % 3 ? "west" : "east" })) },
      data: { name: "flights" },
      vconcat: [
        { params: [{ name: "b", select: { type: "interval", encodings: ["x"] } }], mark: "bar",
          encoding: { x: { field: "distance", bin: { maxbins: 40 } }, y: { aggregate: "count" } } },
        { transform: [
          { filter: { param: "b" } },
          { lookup: "carrier", from: { data: { name: "carriers" }, key: "code", fields: ["name", "region"] } },
        ], mark: "bar", encoding: { x: { field: "name" }, y: { aggregate: "mean", field: "delay" }, color: { field: "region" } } },
      ],
    },
    source: "flights",
    updates: k => ({ "data:b_store": [{ unit: "concat_0", fields: [{ field: "distance", channel: "x", type: "R" }], values: [[100 + 30 * k, 900 + 30 * k]] }] }),
  }),
  /** Vega-Lite box plot of delay per carrier (aggregate and joinaggregate with q1, median, q3), filtered by a brush. */
  "vl-boxplot": () => ({
    vl: {
      data: { name: "flights" },
      vconcat: [
        { params: [{ name: "b", select: { type: "interval", encodings: ["x"] } }], mark: "bar",
          encoding: { x: { field: "distance", bin: { maxbins: 40 } }, y: { aggregate: "count" } } },
        { transform: [{ filter: { param: "b" } }], mark: "boxplot",
          encoding: { x: { field: "carrier" }, y: { field: "delay", type: "quantitative" } } },
      ],
    },
    source: "flights",
    updates: k => ({ "data:b_store": [{ unit: "concat_0", fields: [{ field: "distance", channel: "x", type: "R" }], values: [[100 + 30 * k, 900 + 30 * k]] }] }),
  }),
  /** Vega: cumulative distribution per carrier (window), filtered by a range signal; the result is aggregated. */
  "vega-window": () => ({
    spec: {
      signals: [{ name: "r", value: [0, 4000] }],
      data: [{ name: "src" }, { name: "cdf", source: "src", transform: [
        { type: "filter", expr: "datum.distance >= r[0] && datum.distance <= r[1]" },
        { type: "window", groupby: ["carrier"], sort: { field: "delay" }, ops: ["cume_dist", "rank"], fields: [null, null], as: ["p", "rk"] },
        { type: "filter", expr: "datum.p >= 0.9" },
        { type: "aggregate", groupby: ["carrier"], ops: ["count", "min"], fields: [null, "delay"], as: ["n", "p90"] },
      ] }],
    },
    source: "src",
    updates: k => ({ r: [100 + 20 * k, 1500 + 20 * k] }),
  }),
  /** Vega: the 1,000 longest flights in a distance range (sorted collect), as tuples. */
  "vega-sort": () => ({
    spec: {
      signals: [{ name: "r", value: [0, 4000] }],
      data: [{ name: "src" }, { name: "top", source: "src", transform: [
        { type: "filter", expr: "datum.distance >= r[0] && datum.distance <= r[1]" },
        { type: "collect", sort: { field: ["time", "delay"], order: ["descending", "ascending"] } },
        { type: "window", sort: { field: ["time", "delay"], order: ["descending", "ascending"] }, ops: ["row_number"], as: ["i"] },
        { type: "filter", expr: "datum.i <= 1000" },
      ] }],
    },
    source: "src",
    updates: k => ({ r: [100 + 20 * k, 1500 + 20 * k] }),
  }),
};
