/**
 * Dense marks (runtime/dense.ts) against stock Vega, in Node (renderer
 * "none", so no raster): the bounds of every symbol mark must be the same
 * as the union of Vega's item bounds, and the dense path must be taken.
 * Pixels and picking are tested in the browser (test/dense-browser.cjs).
 *
 *   npm run vega:build && node test/dense.cjs
 */
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
let vega, vl; // loaded in the main function (see test/vega-env.cjs)
const { registerParaweb } = require(path.join(ROOT, "dist/paraweb-vega.cjs"));

const N = Number(process.env.N || 60000);

function rows(n) {
  let s = 7;
  const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  const cats = ["a", "b", "c", "d", "e"];
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = { x: rnd() * 100, y: rnd() * rnd() * 50, w: Math.round(rnd() * 20), c: cats[Math.floor(rnd() * 5)],
      t: new Date(Date.UTC(2020, 0, 1) + Math.floor(rnd() * 365) * 864e5) };
  }
  return out;
}

const CASES = [
  {
    name: "Vega-Lite point: x, y, nominal color",
    vl: { data: { name: "d" }, mark: "point", encoding: {
      x: { field: "x", type: "quantitative" }, y: { field: "y", type: "quantitative" }, color: { field: "c", type: "nominal" } } },
  },
  {
    name: "Vega-Lite circle: size by field, shape by category, opacity, filter by interval brush on another view",
    vl: { data: { name: "d" }, vconcat: [
      { params: [{ name: "b", select: { type: "interval", encodings: ["x"] } }], mark: "bar",
        encoding: { x: { field: "x", bin: true }, y: { aggregate: "count" } } },
      { transform: [{ filter: { param: "b" } }], mark: { type: "point", filled: true, opacity: 0.4 },
        encoding: { x: { field: "x", type: "quantitative" }, y: { field: "y", type: "quantitative", scale: { type: "sqrt" } },
          size: { field: "w", type: "quantitative" }, shape: { field: "c", type: "nominal" } } },
    ] },
    updates: [{ "data:b_store": [{ unit: "concat_0", fields: [{ field: "x", channel: "x", type: "R" }], values: [[20, 60]] }] }],
  },
  {
    name: "Vega-Lite square: temporal x, calculate field on y",
    vl: { data: { name: "d" }, transform: [{ calculate: "datum.y * 2 + 1", as: "y2" }], mark: "square",
      encoding: { x: { field: "t", type: "temporal" }, y: { field: "y2", type: "quantitative" }, color: { value: "#336" } } },
  },
  {
    name: "Vega symbol mark: signal-driven size, filter by signal",
    spec: {
      width: 400, height: 300,
      signals: [{ name: "r", value: [10, 90] }, { name: "sz", value: 12 }],
      data: [{ name: "d" }, { name: "f", source: "d", transform: [{ type: "filter", expr: "datum.x >= r[0] && datum.x <= r[1]" }] }],
      scales: [
        { name: "sx", type: "linear", domain: [0, 100], range: "width" },
        { name: "sy", type: "linear", domain: [0, 50], range: "height" },
        { name: "sc", type: "ordinal", domain: ["a", "b", "c", "d", "e"], range: "category" },
      ],
      marks: [{ type: "symbol", from: { data: "f" }, encode: {
        enter: { shape: { value: "diamond" }, strokeWidth: { value: 1.5 } },
        update: { x: { scale: "sx", field: "x" }, y: { scale: "sy", field: "y" }, size: { signal: "sz * sz" },
          stroke: { scale: "sc", field: "c" }, fillOpacity: { value: 0.3 }, fill: { scale: "sc", field: "c" } } } }],
    },
    updates: [{ r: [30, 50] }, { sz: 4 }],
  },
];

function symbolMarks(view) {
  const out = [];
  const walk = s => {
    if (!s) return;
    if (s.marktype === "symbol" && s.role === "mark") out.push(s);
    for (const it of s.items || []) if (it.items) for (const m of it.items) walk(m);
  };
  walk(view.scenegraph().root);
  return out;
}

async function run(c, mode) {
  let spec = c.spec || vl.compile(c.vl).spec;
  spec = JSON.parse(JSON.stringify(spec));
  const fallbacks = [];
  const pw = mode === "stock" ? null : registerParaweb(vega, { threads: 4, onFallback: (t, r) => fallbacks.push(t + ": " + r) });
  const src = spec.data.find(d => d.name === "d");
  src.values = rows(N);
  const view = new vega.View(vega.parse(spec), { renderer: "none" });
  await view.runAsync();
  const snaps = [];
  // Layout: the view, and the position and bounds of every group (views, legends, axes).
  const groups = [];
  const walk = (m) => (m.items || []).forEach(it => { if (m.marktype === "group") { groups.push([it.x || 0, it.y || 0, it.bounds.x1, it.bounds.y1, it.bounds.x2, it.bounds.y2]); (it.items || []).forEach(walk); } });
  const snap = () => (groups.length = 0, walk(view.scenegraph().root), [{ b: [...view.origin(), view._viewWidth, view._viewHeight, ...groups.flat()], items: 0, layout: true }]).concat(symbolMarks(view).map(m => ({
    b: [m.bounds.x1, m.bounds.y1, m.bounds.x2, m.bounds.y2], items: m.items.length, dense: !!m._pwDense, m: m._pwDense ? m._pwDense.m : m.items.length,
  })));
  snaps.push(snap());
  for (const u of c.updates || []) {
    for (const [k, v] of Object.entries(u)) k.startsWith("data:") ? view.data(k.slice(5), v) : view.signal(k, v);
    await view.runAsync();
    snaps.push(snap());
  }
  view.finalize();
  if (pw) pw.terminate();
  return { snaps, fallbacks };
}

(async () => {
  ({ vega, vl } = await require("./vega-env.cjs").loadVega());
  let pass = 0;
  for (const c of CASES) {
    if (process.env.CASE && !c.name.includes(process.env.CASE)) continue;
    const a = await run(c, "stock"), b = await run(c, "paraweb");
    const errs = [];
    a.snaps.forEach((sa, k) => {
      const sb = b.snaps[k];
      if (sa.length !== sb.length) { errs.push(`step ${k}: ${sa.length} vs ${sb.length} marks`); return; }
      sa.forEach((ma, j) => {
        const mb = sb[j];
        if (!ma.layout && ma.items >= N / 10 && !mb.dense) errs.push(`step ${k} mark ${j}: not dense (${ma.items} items)`);
        if (!ma.layout && mb.dense && ma.m !== mb.m) errs.push(`step ${k} mark ${j}: ${ma.m} items vs ${mb.m} rows`);
        const close = ma.b.every((v, q) => v === mb.b[q] || Math.abs(v - mb.b[q]) <= 1e-9 * Math.max(1, Math.abs(v)));
        if (!close) errs.push(`step ${k} mark ${j}: bounds ${ma.b} vs ${mb.b}`);
      });
    });
    if (b.fallbacks.length) errs.push("fallbacks: " + b.fallbacks.join("; "));
    if (errs.length) console.log("FAIL", c.name, "\n  " + errs.join("\n  "));
    else { pass++; console.log("ok  ", c.name, b.snaps.map(s => s.filter(m => m.dense).map(m => m.m).join("/")).join(" ")); }
  }
  console.log(`${pass}/${CASES.length} dense cases passed`);
  process.exit(pass === CASES.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
