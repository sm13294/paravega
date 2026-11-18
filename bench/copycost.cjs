/**
 * Cost of ParaWeb's original per-call interface versus the resident runtime,
 * for the work of one brush move at n rows (Node.js, worker_threads).
 *
 *   npm run build && node bench/copycost.cjs [n] [outFile]
 *
 * copyMs      copying three Float64 columns into fresh SharedArrayBuffers,
 *             which the shared-memory variants do on every call
 * originalMs  one call of the original shared MapReduce (map to 0/1, reduce
 *             with +) that counts the rows of one brush range: a single bin
 *             of a single view, since the original MapReduce reduces to one
 *             value; its input is a JS array, as its interface requires
 * residentFnMs the same call as originalMs with the input kept resident ({ pool, key })
 * residentMs  a full 40-bin histogram with two range filters through the
 *             resident runtime (columns already resident), as ParaVega runs it
 * Medians of 5 runs after one warm-up.
 */
const path = require("path");
const fs = require("fs");
const ROOT = path.resolve(__dirname, "..");
const paraweb = require("paraweb-js");
const { ResidentPool, nodeWorkerFactory } = paraweb.resident;

const n = Number(process.argv[2] || 1e7);
const out = process.argv[3];
const T = 16;
const median = a => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
let s = 7;
const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
const cols = [0, 1, 2].map(() => Float64Array.from({ length: n }, () => rnd() * 100));

async function time(fn, reps = 5) {
  await fn();
  const t = [];
  for (let i = 0; i < reps; i++) { const t0 = performance.now(); await fn(); t.push(performance.now() - t0); }
  return median(t);
}

(async () => {
  const copyMs = await time(() => {
    for (const c of cols) new Float64Array(new SharedArrayBuffer(8 * n)).set(c);
  });

  const arr = Array.from(cols[0]);
  const originalMs = await time(() => paraweb.shared.mapReduce(
    x => (x >= 20 && x <= 40 ? 1 : 0), (a, b) => a + b, arr, T), 3);

  const pool = new ResidentPool(T, nodeWorkerFactory());
  const shared = cols.map(c => { const v = new Float64Array(new SharedArrayBuffer(8 * n)); v.set(c); return v; });
  shared.forEach((v, j) => pool.ensureColumn(`c${j}`, "f64", v.buffer));
  const K = 40;
  const map = { key: "h", src: `const a = cols[0], b = cols[1], c = cols[2], out = bufs[0], base = args.base;
    if (args.first) out.fill(0, base, base + ${K});
    for (let i = start; i < end; i++) {
      const y = b[i], z = c[i];
      if (!(y >= args.lo && y <= args.hi && z >= args.lo && z <= args.hi)) continue;
      let k = Math.floor(a[i] / 2.5); if (k > ${K - 1}) k = ${K - 1};
      out[base + k] += 1;
    }` };
  const combine = { key: "hc", src: `const p = bufs[0], d = bufs[1];
    for (let k = start; k < end; k++) { let v = 0; for (let t = 0; t < args.T; t++) v += p[t * args.region + k]; d[k] = v; }` };
  const residentMs = await time(() => paraweb.shared.mapReduce({ map, combine }, {
    pool, n, keys: K, slots: 1, cols: ["c0", "c1", "c2"], args: { lo: 10, hi: 90 },
  }));
  // The same per-element call as originalMs, with the input kept resident ({ pool, key }).
  const fnPool = new ResidentPool(T, nodeWorkerFactory());
  const residentFnMs = await time(() => paraweb.shared.mapReduce(
    x => (x >= 20 && x <= 40 ? 1 : 0), (a, b) => a + b, arr, { pool: fnPool, key: "c0" }));
  fnPool.terminate();
  pool.terminate();

  const r = { n, threads: T, copyMs, originalMs, residentFnMs, residentMs, node: process.version };
  console.log(JSON.stringify(r));
  if (out) fs.writeFileSync(out, JSON.stringify(r, null, 2));
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
