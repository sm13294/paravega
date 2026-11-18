/**
 * Convert the public flights-10m Parquet file (Mosaic datasets) into raw
 * Float64 column files for the benchmark pages.
 *
 *   node bench/convert-flights.mjs <in.parquet> <outDir>
 *
 * Fields: delay = ARR_DELAY (minutes), distance = DISTANCE (miles),
 * time = DEP_TIME (hours). Rows with a missing value in any of these three
 * are dropped (cancelled or diverted flights), because stock Vega and
 * ParaVega treat nulls differently in range predicates. Rows are shuffled
 * once with a fixed seed so that the first n rows are a random sample.
 *
 * Extra fields for the six-view dashboard (dep_delay = DEP_DELAY, air_time =
 * AIR_TIME, arr_time = ARR_TIME) use the same rows and order; a missing
 * extra value is stored as NaN. They do not affect which rows are kept, so
 * the three core files are the same as before the extras were added.
 */
import { asyncBufferFromFile, parquetRead } from "hyparquet";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const [input, outDir] = process.argv.slice(2);
if (!input || !outDir) { console.error("usage: convert-flights.mjs <in.parquet> <outDir>"); process.exit(1); }

const SRC = { delay: "ARR_DELAY", distance: "DISTANCE", time: "DEP_TIME" };
const EXTRA = { dep_delay: "DEP_DELAY", air_time: "AIR_TIME", arr_time: "ARR_TIME" };
const file = await asyncBufferFromFile(input);
const cols = {};
await parquetRead({
  file,
  columns: [...Object.values(SRC), ...Object.values(EXTRA)],
  onChunk: ({ columnName, columnData, rowStart }) => {
    const c = (cols[columnName] ??= []);
    for (let i = 0; i < columnData.length; i++) c[rowStart + i] = columnData[i];
  },
});
const n0 = cols[SRC.delay].length;
const keep = [];
for (let i = 0; i < n0; i++) {
  if (Object.values(SRC).every(k => cols[k][i] != null && Number.isFinite(Number(cols[k][i])))) keep.push(i);
}

// Fisher-Yates with mulberry32, seed 20261117.
let s = 20261117 >>> 0;
const rand = () => {
  s = (s + 0x6d2b79f5) >>> 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
for (let i = keep.length - 1; i > 0; i--) {
  const j = Math.floor(rand() * (i + 1));
  [keep[i], keep[j]] = [keep[j], keep[i]];
}

fs.mkdirSync(outDir, { recursive: true });
const meta = {
  source: "https://idl.uw.edu/mosaic-datasets/data/flights-10m.parquet",
  sha256: crypto.createHash("sha256").update(fs.readFileSync(input)).digest("hex"),
  rowsInSource: n0, rows: keep.length, droppedMissing: n0 - keep.length,
  shuffleSeed: 20261117, fields: SRC, extraFields: EXTRA, extents: {}, missingExtra: {},
};
for (const [name, src] of [...Object.entries(SRC), ...Object.entries(EXTRA)]) {
  const out = new Float64Array(keep.length);
  let lo = Infinity, hi = -Infinity, missing = 0;
  for (let i = 0; i < keep.length; i++) {
    const raw = cols[src][keep[i]];
    const v = raw == null ? NaN : Number(raw);
    if (v !== v) { missing++; out[i] = NaN; continue; }
    out[i] = v;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  meta.extents[name] = [lo, hi];
  if (name in EXTRA) meta.missingExtra[name] = missing;
  fs.writeFileSync(path.join(outDir, `${name}.f64`), Buffer.from(out.buffer));
}
fs.writeFileSync(path.join(outDir, "meta.json"), JSON.stringify(meta, null, 2));
console.log(JSON.stringify(meta, null, 2));
