/**
 * The crossfilter dashboard must show identical histograms under every
 * backend for the same brushes.  node test/crossfilterModes.mjs
 */
import { createRequire } from "node:module";
import { crossfilterSpec, generateColumns, columnsToTuples, binsFor, FIELDS } from "../demo/crossfilterSpec.js";
const require = createRequire(import.meta.url);
const { vega } = await require("./vega-env.cjs").loadVega();
const { registerParaweb, inlineWorkerFactory } = require("../dist/paraweb-vega.cjs");

const cols = generateColumns(200000, 7);
const tuples = columnsToTuples(cols);
const bins = binsFor(cols);
const brushes = [
  {},
  { distance_px: [40, 120] },
  { distance_px: [40, 120], delay_px: [100, 160] },
  { delay_px: [10, 290], time_px: [200, 60] },
  { distance_px: [0, 300], delay_px: [150, 152], time_px: [0, 300] },
];

async function histograms(mode) {
  let pw = null;
  if (mode === "table" || mode === "inline") {
    pw = registerParaweb(vega, mode === "inline" ? { threads: 1, workerFactory: inlineWorkerFactory(), operators: false } : { threads: 8, operators: false });
    pw.registerTable("flights", cols);
  } else if (mode === "tuples") pw = registerParaweb(vega, { threads: 8, operators: false });
  const spec = crossfilterSpec(mode, bins);
  if (mode !== "table" && mode !== "inline") spec.data[0].values = tuples.map(t => ({ ...t }));
  const view = new vega.View(vega.parse(spec), { renderer: "none" });
  await view.runAsync();
  const out = [];
  for (const b of brushes) {
    for (const f of FIELDS) view.signal(`${f}_px`, b[`${f}_px`] ?? null);
    await view.runAsync();
    out.push(FIELDS.map(f => {
      const k0 = mode === "crossfilter" ? `${f}0` : "bin0";
      return view.data(`h_${f}`).filter(r => r.count > 0).map(r => `${r[k0]}:${r.count}`).sort().join(",");
    }));
  }
  view.finalize();
  if (pw) pw.terminate();
  return out;
}

const ref = await histograms("stock");
let fail = 0;
for (const mode of ["tuples", "table", "inline", "crossfilter"]) {
  const got = await histograms(mode);
  brushes.forEach((b, s) => FIELDS.forEach((f, j) => {
    if (got[s][j] !== ref[s][j]) { fail++; console.log(`FAIL ${mode} brush ${s} h_${f}\n  got ${got[s][j].slice(0, 200)}\n  exp ${ref[s][j].slice(0, 200)}`); }
  }));
  console.log(`${fail ? "checked" : "ok  "} ${mode}`);
}
console.log(fail ? `${fail} mismatches` : "all backends agree");
process.exit(fail ? 1 : 0);
