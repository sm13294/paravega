/**
 * Parallel sort of row ids (Divide and Conquer as a sample sort).
 *
 *  1. The main thread samples the rows, sorts the sample, and picks one
 *     splitter per worker boundary.
 *  2. Map: every worker assigns its rows to buckets (binary search among
 *     the splitters) and counts them per bucket.
 *  3. Scan: exclusive prefix sums over (bucket, worker) give every worker
 *     its write offset in every bucket.
 *  4. Scatter: every worker writes its row ids at its offsets.
 *  5. Map: worker b sorts bucket b.
 * Keys are resident Float64 columns compared as numbers (no missing values),
 * with an order per key; equal keys keep the order of the row ids, which is
 * the stable order of Vega's collect and window.
 */
import { WorkerPool } from "../pool";
import { map as pwMap } from "paraweb-js/resident";
import { splitRanges } from "paraweb-js/resident";

export interface SortKey {
  key: string;
  view: Float64Array;
  /** 1 ascending, -1 descending. */
  order: 1 | -1;
}

function cmpSource(nk: number, orders: number[]): string {
  // Compare rows a and b by the keys, then by row id.
  const parts: string[] = [];
  for (let k = 0; k < nk; k++) {
    const o = orders[k];
    parts.push(`x = K${k}[a]; y = K${k}[b]; if (x < y) return ${-o}; if (x > y) return ${o};`);
  }
  return `function cmp(a, b) { let x, y; ${parts.join(" ")} return a - b; }`;
}

/** Below this many rows, the main thread sorts (same comparator). */
const MAIN_THREAD_SORT = 1 << 16;

/**
 * Sort `rows` (row ids into the key columns). Returns a new shared array of
 * the same ids in sorted order.
 */
export async function sortRows(pool: WorkerPool, rows: Int32Array, keys: SortKey[]): Promise<Int32Array> {
  const m = rows.length;
  const out = new Int32Array(new SharedArrayBuffer(4 * Math.max(1, m)));
  const orders = keys.map(k => k.order);
  const cmpSrc = cmpSource(keys.length, orders);
  const decl = keys.map((_k, i) => `const K${i} = cols[${i}];`).join("\n");
  const cols = keys.map(k => k.key);
  keys.forEach(k => pool.ensureColumn(k.key, "f64", k.view.buffer as SharedArrayBuffer));
  const T = Math.min(pool.size, Math.max(1, Math.floor(m / 4096)));
  if (m < MAIN_THREAD_SORT || T < 2) {
    const cmp = new Function(...keys.map((_k, i) => `K${i}`), `${cmpSrc}; return cmp;`)(...keys.map(k => k.view));
    out.set(rows);
    out.subarray(0, m).sort(cmp);
    return out.subarray(0, m);
  }

  // 1. Splitters from a sorted sample.
  const cmpMain = new Function(...keys.map((_k, i) => `K${i}`), `${cmpSrc}; return cmp;`)(...keys.map(k => k.view));
  const S = Math.min(m, 256 * T);
  const sample = new Int32Array(S);
  for (let s = 0; s < S; s++) sample[s] = rows[Math.floor(((s + 0.5) * m) / S)];
  sample.sort(cmpMain);
  const splitters = new Int32Array(T - 1);
  for (let b = 1; b < T; b++) splitters[b - 1] = sample[Math.floor((b * S) / T)];

  const rowsShared = rows.buffer instanceof SharedArrayBuffer && rows.byteOffset === 0 && rows.length * 4 === rows.buffer.byteLength
    ? rows : (() => { const r = new Int32Array(new SharedArrayBuffer(4 * m)); r.set(rows); return r; })();
  const bucket = new Int32Array(new SharedArrayBuffer(4 * m));
  const sb = (a: Int32Array) => ({ buffer: a.buffer as SharedArrayBuffer, type: "i32" as const });

  // 2. Map: bucket of every row, counts per bucket.
  const countSrc = `${decl}\n${cmpSrc}\nconst R = bufs[0], B = bufs[1], sp = args.sp, T = sp.length + 1;
const counts = new Array(T).fill(0);
for (let j = start; j < end; j++) {
  const r = R[j]; let lo = 0, hi = sp.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (cmp(sp[mid], r) <= 0) lo = mid + 1; else hi = mid; }
  B[j] = lo; counts[lo]++;
}
return counts;`;
  const res = await pwMap({ key: "pv:sort:count:" + keys.length + ":" + orders.join(","), src: countSrc }, {
    pool, n: m, threads: T, cols, bufs: [sb(rowsShared), sb(bucket)], args: { sp: Array.from(splitters) },
  });
  const counts: number[][] = res.map(c => c[0]);
  const W = counts.length;

  // 3. Scan: offsets per (bucket, worker), and the bucket bounds.
  const offsets: number[][] = counts.map(() => new Array(T).fill(0));
  const bounds: [number, number][] = [];
  let acc = 0;
  for (let b = 0; b < T; b++) {
    const s0 = acc;
    for (let w = 0; w < W; w++) { offsets[w][b] = acc; acc += counts[w][b]; }
    bounds.push([s0, acc]);
  }

  // 4. Scatter: row ids to their bucket positions.
  const scatterSrc = `const R = bufs[0], B = bufs[1], O = bufs[2], off = args.offsets[args.t].slice();
for (let j = start; j < end; j++) O[off[B[j]]++] = R[j];
return 0;`;
  await pwMap({ key: "pv:sort:scatter", src: scatterSrc }, {
    pool, n: m, threads: T, bufs: [sb(rowsShared), sb(bucket), sb(out)], args: { offsets },
  });

  // 5. Map: sort every bucket (one bucket per worker).
  const sortSrc = `${decl}\n${cmpSrc}\nconst O = bufs[0];
for (let b = start; b < end; b++) { const [s, e] = args.bounds[b]; O.subarray(s, e).sort(cmp); }
return 0;`;
  await pwMap({ key: "pv:sort:bucket:" + keys.length + ":" + orders.join(","), src: sortSrc }, {
    pool, n: T, threads: T, cols, bufs: [sb(out)], args: { bounds },
  });
  void splitRanges;
  return out.subarray(0, m);
}
