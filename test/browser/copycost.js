// bench/copycost.cjs in the browser: cost of ParaWeb's original per-call
// interface (browser-demo/, the browser form of ParaWeb's patterns) against the
// resident runtime (src/resident) for the work of one brush move at n rows.
// copyMs, originalMs, residentFnMs and residentMs as in bench/copycost.cjs;
// medians of 5 runs after one warm-up (3 runs for originalMs).
import { ResidentPool, browserWorkerFactory, mapReduce } from "paraweb-js/resident";
import { MapReduceSharedBrowser } from "paraweb-js/browser/mapReduceSharedBrowser.js";

const params = new URLSearchParams(location.search);
const n = Number(params.get("n") || 1e7);
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

const copyMs = await time(() => { for (const c of cols) new Float64Array(new SharedArrayBuffer(8 * n)).set(c); });

const arr = Array.from(cols[0]);
// The original call: copies its input into new shared memory, maps it into a new array, and reduces that.
const originalMs = await time(() => new MapReduceSharedBrowser().mapReduce(x => (x >= 20 && x <= 40 ? 1 : 0), (a, b) => a + b, arr, T), 3);

const pool = new ResidentPool(T, browserWorkerFactory());
cols.forEach((c, j) => { const v = new Float64Array(new SharedArrayBuffer(8 * n)); v.set(c); pool.ensureColumn(`c${j}`, "f64", v.buffer); });
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
const residentMs = await time(() => mapReduce({ map, combine }, { pool, n, keys: K, slots: 1, cols: ["c0", "c1", "c2"], args: { lo: 10, hi: 90 } }));
// The same per-element call as originalMs, with the input kept resident ({ pool, key }).
const fnPool = new ResidentPool(T, browserWorkerFactory());
const residentFnMs = await time(() => mapReduce(x => (x >= 20 && x <= 40 ? 1 : 0), (a, b) => a + b, arr, { pool: fnPool, key: "c0" }));
fnPool.terminate();
pool.terminate();

const r = { n, threads: T, copyMs, originalMs, residentFnMs, residentMs, browser: navigator.userAgent };
console.log(JSON.stringify(r));
globalThis.__pwResult = r;
globalThis.__pwExit = 0;
