/**
 * Linked scatterplot: a histogram of departure time with an interval brush,
 * and a scatterplot (distance x delay) of the rows inside the brush.
 * Measures row filtering: the selected rows themselves are drawn.
 *
 * mode = "stock"         : Vega filter expression on tuples
 *        "pwfilter-tuples": pwfilter over the same tuples
 *        "pwfilter-table" : pwfilter over a registered columnar table
 *
 * An empty brush selects nothing (in every mode), so the page never tries
 * to draw all rows.
 */
export const W = 300, H = 160, SW = 420, SH = 260, L = 44, TOP = 20, GAP = 60;
const NOTHING = "[1e300, 1e300]";

export function scatterSpec(mode, bins) {
  const { extent, maxbins } = bins.time;
  const sx = L + W + GAP; // scatterplot x offset
  const local = `clamp(x() - ${L}, 0, ${W})`;
  const signals = [
    { name: "time_px", value: null, on: [
      { events: "mousedown", update: `x() < ${L + W} ? [${local}, ${local}] : time_px` },
      { events: "[mousedown, window:mouseup] > window:mousemove", update: `time_px ? [time_px[0], ${local}] : time_px` },
      { events: "dblclick", update: "null" },
    ] },
    { name: "time_range", value: null,
      update: "time_px && abs(time_px[1] - time_px[0]) > 0.5 ? " +
        "[invert('x_time', min(time_px[0], time_px[1])), invert('x_time', max(time_px[0], time_px[1]))] : null" },
    { name: "sel_range", update: `time_range || ${NOTHING}` },
  ];

  const binParam = { field: "time", extent, maxbins, as: ["bin0", "bin1"] };
  const data = [];
  if (mode !== "pwfilter-table") data.push({ name: "src" });
  if (mode === "stock") {
    data.push({ name: "hist", source: "src", transform: [{ type: "bin", ...binParam }, { type: "aggregate", groupby: ["bin0", "bin1"] }] });
    data.push({ name: "sel", source: "src", transform: [
      { type: "filter", expr: "datum.time >= sel_range[0] && datum.time <= sel_range[1]" },
    ] });
  } else {
    const table = mode === "pwfilter-table" ? { table: "flights" } : {};
    const wrap = d => (mode === "pwfilter-table" ? d : { ...d, source: "src" });
    data.push(wrap({ name: "hist", transform: [{ type: "pwaggregate", ...table, bins: [binParam] }] }));
    data.push(wrap({ name: "sel", transform: [{
      type: "pwfilter", ...table, name: "sel",
      filter: [{ field: "time", range: { signal: "sel_range" } }],
      ...(mode === "pwfilter-table" ? { fields: ["distance", "delay", "time"] } : {}),
    }] }));
  }

  return {
    $schema: "https://vega.github.io/schema/vega/v5.json",
    width: sx + SW + 20, height: Math.max(H, SH) + TOP + 45, padding: 0, autosize: "none",
    signals, data,
    scales: [
      { name: "x_time", type: "linear", domain: extent, range: [0, W], zero: false, nice: false },
      { name: "y_time", type: "linear", domain: { data: "hist", field: "count" }, range: [H, 0], nice: true },
      { name: "x_dist", type: "linear", domain: bins.distance.extent, range: [0, SW], zero: false, nice: false },
      { name: "y_delay", type: "linear", domain: bins.delay.extent, range: [SH, 0], zero: false, nice: false },
    ],
    marks: [
      { type: "group",
        encode: { enter: { x: { value: L }, y: { value: TOP }, width: { value: W }, height: { value: H } } },
        axes: [{ scale: "x_time", orient: "bottom", title: "time" }, { scale: "y_time", orient: "left", tickCount: 4, format: "~s" }],
        marks: [
          { type: "rect", from: { data: "hist" }, encode: { update: {
            x: { scale: "x_time", field: "bin0" }, x2: { scale: "x_time", field: "bin1", offset: -0.5 },
            y: { scale: "y_time", field: "count" }, y2: { scale: "y_time", value: 0 }, fill: { value: "#4c78a8" } } } },
          { type: "rect", encode: { update: {
            x: { signal: "time_px ? time_px[0] : 0" }, x2: { signal: "time_px ? time_px[1] : 0" },
            y: { value: 0 }, y2: { value: H }, fill: { value: "#f58518" }, fillOpacity: { value: 0.25 } } } },
        ] },
      { type: "group",
        encode: { enter: { x: { value: sx }, y: { value: TOP }, width: { value: SW }, height: { value: SH } } },
        axes: [{ scale: "x_dist", orient: "bottom", title: "distance" }, { scale: "y_delay", orient: "left", title: "delay" }],
        marks: [{ type: "symbol", from: { data: "sel" }, encode: { update: {
          x: { scale: "x_dist", field: "distance" }, y: { scale: "y_delay", field: "delay" },
          size: { value: 4 }, fill: { value: "#4c78a8" }, fillOpacity: { value: 0.5 } } } }] },
    ],
  };
}
