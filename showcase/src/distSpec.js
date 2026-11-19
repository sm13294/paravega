// The distribution explorer of the showcase: an unchanged Vega-Lite specification.
// A histogram of departure times with an interval brush filters two views of the arrival
// delay per carrier: density estimates (Vega's kde) and box plots (quartiles). Every brush
// move re-estimates the densities and re-sorts the delays of the selected rows, which is
// the work that the workers speed up most (Section 6.2 of the paper).
export const CARRIERS = ["C1", "C2", "C3", "C4", "C5", "C6"];

/** Synthetic flights-like rows: departure time, arrival delay, carrier (seeded). */
export function makeDistRows(n, seed = 7) {
  let s = seed >>> 0;
  const rand = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const shift = [-8, -2, 4, 10, 18, 28];   // carriers differ in their typical delay
  const spread = [22, 30, 26, 38, 34, 48];
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const c = Math.floor(rand() * CARRIERS.length);
    const peak = rand() < 0.5 ? 8 : 17;
    const time = Math.min(23.99, Math.max(0, peak + (rand() + rand() + rand() - 1.5) * 5));
    // later flights are delayed more, so the brush changes the distributions visibly
    const u = rand() + rand() + rand() + rand() - 2;
    const delay = Math.round((shift[c] + (time - 12) * 1.5 + u * spread[c] + (rand() < 0.05 ? 120 * rand() : 0)) * 10) / 10;
    out[i] = { time, delay, carrier: CARRIERS[c] };
  }
  return out;
}

export function distVegaLite() {
  const delay = { field: "delay", type: "quantitative", title: "arrival delay (min)" };
  return {
    $schema: "https://vega.github.io/schema/vega-lite/v6.json",
    data: { name: "flights" },
    config: { view: { stroke: null }, axis: { labelFontSize: 11, titleFontSize: 12 } },
    vconcat: [
      {
        width: 740, height: 110,
        params: [{ name: "b", select: { type: "interval", encodings: ["x"] } }],
        mark: { type: "bar", color: "#8a96a3" },
        encoding: {
          x: { field: "time", bin: { maxbins: 48 }, title: "departure time (h) · drag to select" },
          y: { aggregate: "count", title: "flights" },
        },
      },
      {
        hconcat: [
          {
            width: 340, height: 230, title: "Density of the delay per carrier (selected flights)",
            transform: [{ filter: { param: "b" } }, { density: "delay", groupby: ["carrier"], extent: [-150, 250] }],
            mark: { type: "line", strokeWidth: 2 },
            encoding: {
              x: { field: "value", type: "quantitative", title: "arrival delay (min)" },
              y: { field: "density", type: "quantitative" },
              color: { field: "carrier", type: "nominal", scale: { domain: CARRIERS } },
            },
          },
          {
            width: 340, height: 230, title: "Delay per carrier: quartiles and range (selected flights)",
            transform: [{ filter: { param: "b" } }],
            mark: { type: "boxplot", extent: "min-max" },
            encoding: {
              x: { field: "carrier", type: "nominal", sort: CARRIERS },
              y: delay,
              color: { field: "carrier", type: "nominal", scale: { domain: CARRIERS }, legend: null },
            },
          },
        ],
      },
    ],
  };
}
