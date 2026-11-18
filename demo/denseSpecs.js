/**
 * Specifications with large symbol marks, for the dense-mark browser test
 * and benchmark (test/dense-browser.cjs, bench/dense-browser.cjs). Each
 * entry is a Vega-Lite or Vega specification over the data set "d", with
 * a list of interactions (signal values or "data:<name>" store contents).
 */
export function makeRows(n, seed = 7) {
  let s = seed;
  const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  const cats = ["a", "b", "c", "d", "e"];
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const u = rnd() + rnd() + rnd() - 1.5;
    out[i] = { x: rnd() * 100, y: Math.round((u * 30 + 50) * 10) / 10, w: Math.round(rnd() * 20), c: cats[Math.floor(rnd() * 5)],
      t: new Date(Date.UTC(2020, 0, 1) + Math.floor(rnd() * 365) * 864e5) };
  }
  return out;
}

const brush = (unit, field, lo, hi) => [{ unit, fields: [{ field, channel: "x", type: "R" }], values: [[lo, hi]] }];

export const SPECS = {
  "vl-point": {
    vl: { data: { name: "d" }, width: 500, height: 320, mark: "point", encoding: {
      x: { field: "x", type: "quantitative" }, y: { field: "y", type: "quantitative" }, color: { field: "c", type: "nominal" } } },
    updates: [],
  },
  "vl-linked": {
    vl: { data: { name: "d" }, vconcat: [
      { width: 500, height: 100, params: [{ name: "b", select: { type: "interval", encodings: ["x"] } }], mark: "bar",
        encoding: { x: { field: "x", bin: { maxbins: 40 } }, y: { aggregate: "count" } } },
      { width: 500, height: 300, transform: [{ filter: { param: "b" } }], mark: { type: "circle", opacity: 0.5 },
        encoding: { x: { field: "x", type: "quantitative", scale: { domain: [0, 100] } }, y: { field: "y", type: "quantitative", scale: { domain: [0, 100] } },
          color: { field: "c", type: "nominal" }, size: { field: "w", type: "quantitative" } } },
    ] },
    updates: [
      { "data:b_store": brush("concat_0", "x", 20, 60) },
      { "data:b_store": brush("concat_0", "x", 25, 65) },
      { "data:b_store": brush("concat_0", "x", 30, 70) },
      { "data:b_store": brush("concat_0", "x", 35, 75) },
      { "data:b_store": brush("concat_0", "x", 40, 80) },
    ],
  },
  "vl-square-time": {
    vl: { data: { name: "d" }, width: 500, height: 300, transform: [{ calculate: "datum.y * 2 + 1", as: "y2" }], mark: { type: "square", size: 8 },
      encoding: { x: { field: "t", type: "temporal" }, y: { field: "y2", type: "quantitative" }, color: { value: "#336" }, opacity: { value: 0.3 } } },
    updates: [],
  },
  "vega-symbol": {
    spec: {
      width: 500, height: 320, padding: 5,
      signals: [{ name: "r", value: [10, 90] }, { name: "sz", value: 7 }],
      data: [{ name: "d" }, { name: "f", source: "d", transform: [{ type: "filter", expr: "datum.x >= r[0] && datum.x <= r[1]" }] }],
      scales: [
        { name: "sx", type: "linear", domain: [0, 100], range: "width" },
        { name: "sy", type: "linear", domain: [0, 100], range: "height" },
        { name: "sc", type: "ordinal", domain: ["a", "b", "c", "d", "e"], range: "category" },
      ],
      axes: [{ orient: "bottom", scale: "sx" }, { orient: "left", scale: "sy" }],
      marks: [{ type: "symbol", from: { data: "f" }, encode: {
        enter: { shape: { value: "diamond" }, strokeWidth: { value: 0.75 } },
        update: { x: { scale: "sx", field: "x" }, y: { scale: "sy", field: "y" }, size: { signal: "sz * sz" },
          stroke: { scale: "sc", field: "c" }, fillOpacity: { value: 0.2 }, fill: { scale: "sc", field: "c" } } } }],
    },
    updates: [{ r: [30, 50] }, { sz: 4 }, { r: [0, 100] }],
  },
};

export function compile(vega, vegaLite, def) {
  const spec = def.spec ? JSON.parse(JSON.stringify(def.spec)) : vegaLite.compile(def.vl).spec;
  return spec;
}
