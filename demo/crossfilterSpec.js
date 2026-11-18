/**
 * Crossfilter dashboard: one histogram per field, an interval brush on each,
 * and every histogram filtered by the brushes of the others. Panels are laid
 * out in rows of three. With opts.mean = { x, y, maxbins }, one more panel
 * shows the mean of y per bin of x, filtered by every brush (a non-count
 * aggregate under brushing).
 *
 * mode = "stock"  : Vega filter -> bin -> aggregate on tuples
 *        "tuples" : pwaggregate over the same tuples
 *        "table"  : pwaggregate over a registered columnar table (no tuples)
 *        "inline" : as "table", but the kernel runs on the main thread (no workers)
 *        "crossfilter": Vega's incremental crossfilter + resolvefilter transforms
 *        "external": no transforms; an external engine inserts h_* and bg_* rows
 */

export const FIELDS = ["distance", "delay", "time"];
const DEFAULT_FIELDS = FIELDS;
/** The six-view dashboard on flights-10m. */
export const WIDE_FIELDS = ["distance", "delay", "time", "dep_delay", "air_time", "arr_time"];

export const W = 300, H = 160, L = 40, GAP = 40, TOP = 20;
const PANEL = W + GAP + L;
const ROW = H + TOP + 45;
const COLS = 3;
const panelX = i => (i % COLS) * PANEL + L;
const panelY = i => Math.floor(i / COLS) * ROW + TOP;
const PANEL_AT = `floor(y() / ${ROW}) * ${COLS} + floor(x() / ${PANEL})`;

/** bins: { field: { extent: [lo, hi], maxbins } } */
export function crossfilterSpec(mode, bins, FIELDS = DEFAULT_FIELDS, opts = {}) {
  const signals = [
    { name: "active", value: -1, on: [
      { events: "mousedown", update: PANEL_AT },
      { events: "window:mouseup", update: "-1" },
    ] },
  ];
  const data = [];
  const marks = [];
  const scales = [];

  const columnar = mode === "table" || mode === "inline" || mode === "external";
  const src = { name: "src", transform: [] };
  if (!columnar) data.push(src);
  if (mode === "crossfilter") {
    for (const f of FIELDS) {
      src.transform.push({ type: "bin", field: f, extent: bins[f].extent, maxbins: bins[f].maxbins, as: [`${f}0`, `${f}1`] });
      // An empty brush must not restrict anything (rows can lie outside the bin extent).
      signals.push({ name: `${f}_q`, update: `${f}_range || [-1e308, 1e308]` });
    }
    // Crossfilter on a derived data set (same tuple objects): its output
    // carries no tuples, so the unfiltered histograms read "src" directly.
    data.push({ name: "xf", source: "src", transform: [
      { type: "crossfilter", signal: "xfilter", fields: FIELDS, query: FIELDS.map(f => ({ signal: `${f}_q` })) },
    ] });
  }

  FIELDS.forEach((f, i) => {
    const local = `clamp(x() - ${panelX(i)}, 0, ${W})`;
    signals.push(
      { name: `${f}_px`, value: null, on: [
        { events: "mousedown", update: `${PANEL_AT} === ${i} ? [${local}, ${local}] : ${f}_px` },
        { events: "[mousedown, window:mouseup] > window:mousemove",
          update: `active === ${i} && ${f}_px ? [${f}_px[0], ${local}] : ${f}_px` },
        { events: "dblclick", update: `${PANEL_AT} === ${i} ? null : ${f}_px` },
      ] },
      { name: `${f}_range`, value: null,
        update: `${f}_px && abs(${f}_px[1] - ${f}_px[0]) > 1 ? ` +
          `[invert('x_${f}', min(${f}_px[0], ${f}_px[1])), invert('x_${f}', max(${f}_px[0], ${f}_px[1]))] : null` },
    );

    const others = FIELDS.filter(g => g !== f);
    const { extent, maxbins } = bins[f];
    const binParam = { field: f, extent, maxbins, as: ["bin0", "bin1"] };

    // Unfiltered background histogram (computed once).
    if (mode === "external") {
      // Results are inserted by an external engine (Mosaic baseline).
      data.push({ name: `bg_${f}` }, { name: `h_${f}` });
    } else if (mode === "stock") {
      data.push({ name: `bg_${f}`, source: "src", transform: [
        { type: "bin", ...binParam },
        { type: "aggregate", groupby: ["bin0", "bin1"] },
      ] });
      const pred = others
        .map(g => `(!${g}_range || (datum.${g} >= ${g}_range[0] && datum.${g} <= ${g}_range[1]))`)
        .join(" && ");
      data.push({ name: `h_${f}`, source: "src", transform: [
        { type: "filter", expr: pred },
        { type: "bin", ...binParam },
        { type: "aggregate", groupby: ["bin0", "bin1"] },
      ] });
    } else if (mode === "crossfilter") {
      data.push({ name: `bg_${f}`, source: "src", transform: [{ type: "aggregate", groupby: [`${f}0`, `${f}1`] }] });
      data.push({ name: `h_${f}`, source: "xf", transform: [
        { type: "resolvefilter", ignore: 1 << i, filter: { signal: "xfilter" } },
        { type: "aggregate", groupby: [`${f}0`, `${f}1`] },
      ] });
    } else {
      const base = columnar ? { table: "flights" } : {};
      const wrap = t => (columnar ? { name: t.name, transform: t.transform } : { ...t, source: "src" });
      data.push(wrap({ name: `bg_${f}`, transform: [{ type: "pwaggregate", ...base, bins: [binParam] }] }));
      data.push(wrap({ name: `h_${f}`, transform: [{
        type: "pwaggregate", ...base, name: f,
        filter: others.map(g => ({ field: g, range: { signal: `${g}_range` } })),
        bins: [binParam],
      }] }));
    }

    scales.push(
      { name: `x_${f}`, type: "linear", domain: extent, range: [0, W], zero: false, nice: false },
      { name: `y_${f}`, type: "linear", domain: { data: `bg_${f}`, field: "count" }, range: [H, 0], nice: true },
    );

    const b0 = mode === "crossfilter" ? `${f}0` : "bin0", b1 = mode === "crossfilter" ? `${f}1` : "bin1";
    const bar = (from, fill) => ({
      type: "rect", from: { data: from },
      encode: { update: {
        x: { scale: `x_${f}`, field: b0 }, x2: { scale: `x_${f}`, field: b1, offset: -0.5 },
        y: { scale: `y_${f}`, field: "count" }, y2: { scale: `y_${f}`, value: 0 }, fill: { value: fill },
      } },
    });

    marks.push({
      type: "group",
      encode: { enter: { x: { value: panelX(i) }, y: { value: panelY(i) }, width: { value: W }, height: { value: H } } },
      axes: [
        { scale: `x_${f}`, orient: "bottom", title: f, tickCount: 6 },
        { scale: `y_${f}`, orient: "left", tickCount: 4, format: "~s" },
      ],
      marks: [
        bar(`bg_${f}`, "#e3e6ea"),
        bar(`h_${f}`, "#4c78a8"),
        { type: "rect", encode: { update: {
          x: { signal: `${f}_px ? ${f}_px[0] : 0` }, x2: { signal: `${f}_px ? ${f}_px[1] : 0` },
          y: { value: 0 }, y2: { value: H },
          fill: { value: "#f58518" }, fillOpacity: { value: 0.18 },
          stroke: { value: "#f58518" }, strokeOpacity: { signal: `${f}_px ? 0.8 : 0` },
        } } },
      ],
    });
  });

  let panels = FIELDS.length;
  if (opts.mean) {
    const { x, y, maxbins = 24 } = opts.mean;
    const i = panels++;
    const binParam = { field: x, extent: bins[x].extent, maxbins, as: ["bin0", "bin1"] };
    const allRanges = FIELDS.map(g => ({ field: g, range: { signal: `${g}_range` } }));
    const anyPred = FIELDS
      .map(g => `(!${g}_range || (datum.${g} >= ${g}_range[0] && datum.${g} <= ${g}_range[1]))`).join(" && ");
    if (mode === "external") {
      data.push({ name: "m_mean" });
    } else if (mode === "stock") {
      data.push({ name: "m_mean", source: "src", transform: [
        { type: "filter", expr: anyPred },
        { type: "bin", ...binParam },
        { type: "aggregate", groupby: ["bin0", "bin1"], ops: ["mean"], fields: [y], as: ["mean"] },
      ] });
    } else if (mode === "crossfilter") {
      // Bin on the source tuples, like the histogram bins: a bin transform
      // after resolvefilter would write fields onto tuples that the
      // crossfilter index tracks, which breaks Vega's dataflow.
      src.transform.push({ type: "bin", ...binParam, as: ["mbin0", "mbin1"] });
      data.push({ name: "m_mean", source: "xf", transform: [
        { type: "resolvefilter", ignore: 0, filter: { signal: "xfilter" } },
        { type: "aggregate", groupby: ["mbin0", "mbin1"], ops: ["mean"], fields: [y], as: ["mean"] },
        { type: "formula", as: "bin0", expr: "datum.mbin0" },
        { type: "formula", as: "bin1", expr: "datum.mbin1" },
      ] });
    } else {
      const columnar = mode === "table" || mode === "inline";
      const t = { type: "pwaggregate", ...(columnar ? { table: "flights" } : {}), name: "mean",
        filter: allRanges, bins: [binParam], ops: ["mean"], fields: [y], as: ["mean"] };
      data.push(columnar ? { name: "m_mean", transform: [t] } : { name: "m_mean", source: "src", transform: [t] });
    }
    scales.push(
      { name: "x_mean", type: "linear", domain: bins[x].extent, range: [0, W], zero: false, nice: false },
      { name: "y_mean", type: "linear", domain: { data: "m_mean", field: "mean" }, range: [H, 0], nice: true, zero: true },
    );
    marks.push({
      type: "group",
      encode: { enter: { x: { value: panelX(i) }, y: { value: panelY(i) }, width: { value: W }, height: { value: H } } },
      axes: [
        { scale: "x_mean", orient: "bottom", title: `mean ${y} by ${x}`, tickCount: 6 },
        { scale: "y_mean", orient: "left", tickCount: 4, format: "~s" },
      ],
      marks: [{ type: "rect", from: { data: "m_mean" }, encode: { update: {
        x: { scale: "x_mean", field: "bin0" }, x2: { scale: "x_mean", field: "bin1", offset: -0.5 },
        y: { scale: "y_mean", field: "mean" }, y2: { scale: "y_mean", value: 0 }, fill: { value: "#54a24b" },
      } } }],
    });
  }

  const rows = Math.ceil(panels / COLS);
  return {
    $schema: "https://vega.github.io/schema/vega/v5.json",
    width: Math.min(panels, COLS) * PANEL, height: rows * ROW, padding: 0, autosize: "none",
    signals, data, scales, marks,
  };
}

/** Deterministic flights-like columns (mulberry32). */
export function generateColumns(n, seed = 42) {
  let s = seed >>> 0;
  const rand = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const sab = () => new Float64Array(new SharedArrayBuffer(8 * n));
  const distance = sab(), delay = sab(), time = sab();
  for (let i = 0; i < n; i++) {
    distance[i] = Math.round(50 + 2400 * rand() * rand());
    const u = rand() + rand() + rand() + rand() - 2;
    delay[i] = Math.round((u * 45 + (rand() < 0.08 ? 90 * rand() : 0)) * 10) / 10;
    const peak = rand() < 0.5 ? 8 : 17;
    time[i] = Math.min(23.99, Math.max(0, peak + (rand() + rand() + rand() - 1.5) * 5));
  }
  return { distance, delay, time };
}

export function columnsToTuples(cols) {
  const keys = Object.keys(cols);
  const n = cols[keys[0]].length;
  const make = new Function("c", "i", `return { ${keys.map((k, j) => `${JSON.stringify(k)}: c[${j}][i]`).join(", ")} };`);
  const cs = keys.map(k => cols[k]);
  const out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = make(cs, i);
  return out;
}

export function binsFor(cols, fields = FIELDS) {
  const bins = {};
  for (const f of fields) {
    let lo = Infinity, hi = -Infinity;
    const c = cols[f];
    for (let i = 0; i < c.length; i++) { const v = c[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
    bins[f] = { extent: [lo, hi], maxbins: 40 };
  }
  return bins;
}
