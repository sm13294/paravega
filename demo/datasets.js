/**
 * Benchmark datasets, shared by the benchmark pages.
 *
 *   "synthetic": deterministic flights-like columns (crossfilterSpec.js)
 *   "flights":   the public flights-10m data set (Mosaic datasets), converted
 *                by bench/convert-flights.mjs into shuffled Float64 columns in
 *                data/flights/. The first n rows are a random
 *                sample. Bin extents follow Vega's crossfilter-flights example.
 */
import { generateColumns, binsFor, FIELDS } from "./crossfilterSpec.js";

// delay, distance, time: as in Vega's crossfilter-flights example. The
// extras of the six-view dashboard use comparable round ranges.
const FLIGHTS_EXTENTS = {
  delay: [-60, 180], distance: [0, 2400], time: [0, 24],
  dep_delay: [-60, 180], air_time: [0, 480], arr_time: [0, 24],
};
const flightsFull = {};

async function loadFlights(fields) {
  const base = new URL("../data/flights/", import.meta.url);
  await Promise.all(fields.filter(f => !flightsFull[f]).map(async f => {
    const res = await fetch(new URL(`${f}.f64`, base));
    if (!res.ok) throw new Error(`flights data missing (${f}.f64): run bench/convert-flights.mjs`);
    flightsFull[f] = new Float64Array(await res.arrayBuffer());
  }));
  return flightsFull;
}

/** Columns as Float64Arrays over SharedArrayBuffers, plus bin settings. */
export async function getDataset(name, n, fields = FIELDS) {
  if (name === "synthetic") {
    const extra = fields.filter(f => !FIELDS.includes(f));
    if (extra.length) throw new Error(`synthetic data has no fields ${extra.join(", ")}`);
    const cols = generateColumns(n);
    return { cols, bins: binsFor(cols) };
  }
  if (name === "flights") {
    const full = await loadFlights(fields);
    if (n > full[fields[0]].length) throw new Error(`flights has ${full[fields[0]].length} rows, asked for ${n}`);
    const cols = {};
    for (const f of fields) {
      const c = new Float64Array(new SharedArrayBuffer(8 * n));
      c.set(full[f].subarray(0, n));
      cols[f] = c;
    }
    const bins = {};
    for (const f of fields) bins[f] = { extent: FLIGHTS_EXTENTS[f], maxbins: 40 };
    return { cols, bins };
  }
  throw new Error(`unknown dataset: ${name}`);
}
