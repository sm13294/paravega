/**
 * Vega's window transform as a parallel Scan.
 *
 * The rows of the input relation are sorted by partition and sort keys
 * (sort.ts), so every partition is a contiguous run and, inside it, rows
 * with equal sort keys (peers) are adjacent. The sorted rows are cut into
 * one chunk per worker at peer-group boundaries, and then:
 *  1. Map: every worker scans its chunk as if each partition started there,
 *     and returns the state at the start and end of the chunk;
 *  2. Scan: the main thread combines these states into the carry of every
 *     chunk (the rows of its first partition in earlier chunks) and the
 *     size of every partition that spans chunks;
 *  3. Map: every worker adds its carry and writes the final values to
 *     resident columns, indexed by row id.
 * Supported: row_number, rank, dense_rank, percent_rank, cume_dist; the
 * aggregates count, valid, missing, sum, mean, average, min, max; and the
 * value ops lag, lead, first_value, last_value, nth_value of numeric
 * fields; with or without ignorePeers. Over the default frame [null, 0],
 * aggregates are running values of the scan. Over other frames, the frame
 * of every row is Vega's (setWindow, then adjustRange to whole peer groups
 * when there is a sort and peers count), found from the row's index in its
 * partition and the partition size; count, valid and sum are differences of
 * prefix sums over the sorted rows (phase 1 writes the prefixes of every
 * chunk, phase 2 adds the chunk totals), and min and max scan the frame,
 * which is therefore limited to bounded frames. sum, mean and average are
 * floating-point updates whose result depends on their order (Vega adds the
 * rows that enter the frame and removes the rows that leave it, and its mean
 * is an incremental update), so they are computed in a fourth step, a
 * sequential pass per partition in Vega's order of updates, with whole
 * partitions distributed over the workers; their values are then Vega's,
 * bit for bit. The semantics are those of vega-transforms' Window,
 * WindowOps and AggregateOps.
 */
import { WorkerPool } from "../pool";
import { SortKey, sortRows } from "./sort";
import { map as pwMap } from "paraweb-js/resident";

export const WINDOW_RANK_OPS = new Set(["row_number", "rank", "dense_rank", "percent_rank", "cume_dist"]);
export const WINDOW_AGG_OPS = new Set(["count", "valid", "missing", "sum", "mean", "average", "min", "max"]);
export const WINDOW_VALUE_OPS = new Set(["lag", "lead", "first_value", "last_value", "nth_value"]);
/** Widest bounded frame for min and max (they scan the frame). */
export const MAX_SCAN_FRAME = 4096;

export interface WindowOp {
  op: string;
  /** Measure column (aggregates other than count). */
  measure?: { key: string; view: Float64Array };
  /** Field of a value op: values and tags (0 value, 1 null, 2 undefined). */
  value?: { key: string; view: Float64Array; tagKey: string | null; tag: Uint8Array | null };
  /** Offset of lag and lead, n of nth_value. */
  param?: number;
}

export interface WindowColumn { view: Float64Array; tag: Uint8Array }

const sb = (a: Int32Array | Float64Array | Uint8Array, type: "i32" | "f64" | "u8") => ({ buffer: a.buffer as SharedArrayBuffer, type });

/**
 * Compute the window ops for `rows` (row ids of the relation). Returns one
 * column per op, over all n rows of the base table (rows outside `rows` are
 * left undefined).
 */
export async function computeWindow(
  pool: WorkerPool, n: number, rows: Int32Array, groupKeys: SortKey[], sortKeys: SortKey[],
  ops: WindowOp[], ignorePeers: boolean,
  /** Keys that only order the rows (no peers), as when the window has no sort of its own. */
  orderOnly = false,
  /** Vega's frame; [null, 0] is the default. */
  frame: [number | null, number | null] = [null, 0],
): Promise<WindowColumn[]> {
  const m = rows.length;
  const outs: WindowColumn[] = ops.map(() => ({
    view: new Float64Array(new SharedArrayBuffer(8 * Math.max(1, n))),
    tag: new Uint8Array(new SharedArrayBuffer(Math.max(1, n))),
  }));
  for (const o of outs) o.tag.fill(2);
  if (m === 0) return outs;
  const S = await sortRows(pool, rows, [...groupKeys, ...sortKeys]);
  const G = groupKeys.length, K = sortKeys.length;
  const hasSort = K > 0 && !orderOnly;
  const range = hasSort && !ignorePeers;
  const framed = !(frame[0] == null && frame[1] === 0);

  // Cut at peer-group starts (partition starts when there is no sort).
  const views = [...groupKeys, ...sortKeys].map(k => k.view);
  const same = (a: number, b: number, upto: number) => {
    for (let k = 0; k < upto; k++) if (views[k][a] !== views[k][b]) return false;
    return true;
  };
  const T = Math.min(pool.size, Math.max(1, Math.floor(m / 4096)));
  const cuts: number[] = [0];
  for (let t = 1; t < T; t++) {
    let p = Math.max(cuts[cuts.length - 1] + 1, Math.floor((t * m) / T));
    while (p < m && hasSort && same(S[p - 1], S[p], G + K)) p++;
    if (p < m && p > cuts[cuts.length - 1]) cuts.push(p);
  }
  cuts.push(m);
  const bounds: [number, number][] = [];
  for (let c = 0; c + 1 < cuts.length; c++) bounds.push([cuts[c], cuts[c + 1]]);
  const C = bounds.length;
  const cont = bounds.map(([s]) => (s > 0 && same(S[s - 1], S[s], G) ? 1 : 0));

  // Measures by column key; every aggregate keeps count, valid, sum, min, max of its field.
  const mkeys: string[] = [];
  const mIndex = ops.map(o => {
    if (!o.measure) return -1;
    let j = mkeys.indexOf(o.measure.key);
    if (j < 0) { j = mkeys.length; mkeys.push(o.measure.key); pool.ensureColumn(o.measure.key, "f64", o.measure.view.buffer as SharedArrayBuffer); }
    return j;
  });
  const NM = mkeys.length;
  // Per sorted position: local index, first-peer index, dense rank, last-peer index, local partition size.
  const loc = Array.from({ length: 5 }, () => new Float64Array(new SharedArrayBuffer(8 * m)));
  // Per sorted position and measure: count, valid, sum, min, max at the end of the frame.
  const acc = Array.from({ length: 1 + 4 * NM }, () => new Float64Array(new SharedArrayBuffer(8 * m)));
  // Other frames: per sorted position and measure, valid count and sum of the earlier rows of the chunk.
  const pre = Array.from({ length: framed ? 2 * NM : 0 }, () => new Float64Array(new SharedArrayBuffer(8 * m)));
  const keyCols = [...groupKeys, ...sortKeys].map(k => k.key);
  [...groupKeys, ...sortKeys].forEach(k => pool.ensureColumn(k.key, "f64", k.view.buffer as SharedArrayBuffer));
  const cols = [...keyCols, ...mkeys];
  const decl = cols.map((_c, i) => `const C${i} = cols[${i}];`).join("\n");
  const sameG = G ? Array.from({ length: G }, (_x, k) => `C${k}[a] === C${k}[b]`).join(" && ") : "true";
  const sameP = G + K ? Array.from({ length: G + K }, (_x, k) => `C${k}[a] === C${k}[b]`).join(" && ") : "true";
  const mcols = Array.from({ length: NM }, (_x, j) => `C${G + K + j}`);

  // 1. Map: local scan of every chunk.
  const phase1 = `${decl}
const S = bufs[0], L0 = bufs[1], L1 = bufs[2], L2 = bufs[3], L3 = bufs[4], L4 = bufs[5], A0 = bufs[6];
const A = [${Array.from({ length: NM }, (_x, j) => `[bufs[${7 + 4 * j}], bufs[${8 + 4 * j}], bufs[${9 + 4 * j}], bufs[${10 + 4 * j}]]`).join(", ")}];
const M = [${mcols.join(", ")}];
const PRE = [${Array.from({ length: framed ? NM : 0 }, (_x, j) => `[bufs[${7 + 4 * NM + 2 * j}], bufs[${8 + 4 * NM + 2 * j}]]`).join(", ")}];
const sameG = (a, b) => ${sameG};
const samePeer = (a, b) => ${hasSort ? sameP : "false"};
const out = [];
for (let c = start; c < end; c++) {
  const [s, e] = args.bounds[c];
  const starts = [];
  let pstart = s, idx = 0, dense = 0, cnt = 0;
  const va = new Float64Array(${NM}), su = new Float64Array(${NM}), mn = new Float64Array(${NM}).fill(NaN), mx = new Float64Array(${NM}).fill(NaN);
  let first = null;
  const finish = (p0, p1) => { for (let q = p0; q < p1; q++) L4[q] = p1 - p0; };
  const pv = new Float64Array(${NM}), ps = new Float64Array(${NM});
  for (let q = s; q < e && PRE.length; q++) {
    const r = S[q];
    for (let k = 0; k < PRE.length; k++) { PRE[k][0][q] = pv[k]; PRE[k][1][q] = ps[k]; const v = M[k][r]; if (v === v) { pv[k]++; ps[k] += v; } }
  }
  let j = s;
  while (j < e) {
    if (j > s && !sameG(S[j - 1], S[j])) {
      starts.push(j);
      if (first === null) first = { len: idx, dense, cnt, va: Array.from(va), su: Array.from(su), mn: Array.from(mn), mx: Array.from(mx), end: j };
      finish(pstart, j);
      pstart = j; idx = 0; dense = 0; cnt = 0; va.fill(0); su.fill(0); mn.fill(NaN); mx.fill(NaN);
    }
    let g = j + 1;
    while (g < e && samePeer(S[g - 1], S[g])) g++;
    dense++;
    const rank0 = idx;
    for (let q = j; q < g; q++) {
      const r = S[q];
      cnt++;
      for (let k = 0; k < ${NM}; k++) { const v = M[k][r]; if (v === v) { va[k]++; su[k] += v; if (!(v >= mn[k])) mn[k] = v; if (!(v <= mx[k])) mx[k] = v; } }
      L0[q] = idx++; L1[q] = rank0; L2[q] = dense; L3[q] = g - 1 - pstart;
      if (!${range}) { A0[q] = cnt; for (let k = 0; k < ${NM}; k++) { A[k][0][q] = va[k]; A[k][1][q] = su[k]; A[k][2][q] = mn[k]; A[k][3][q] = mx[k]; } }
    }
    if (${range}) for (let q = j; q < g; q++) { A0[q] = cnt; for (let k = 0; k < ${NM}; k++) { A[k][0][q] = va[k]; A[k][1][q] = su[k]; A[k][2][q] = mn[k]; A[k][3][q] = mx[k]; } }
    j = g;
  }
  finish(pstart, e);
  const last = { len: idx, dense, cnt, va: Array.from(va), su: Array.from(su), mn: Array.from(mn), mx: Array.from(mx), start: pstart };
  out.push({ first: first || { ...last, end: e }, last, single: first === null, pv: Array.from(pv), ps: Array.from(ps), starts });
}
return out;`;
  const bufs = [sb(S, "i32"), ...loc.map(a => sb(a, "f64")), ...acc.map(a => sb(a, "f64")), ...pre.map(a => sb(a, "f64"))];
  const res = await pwMap({ key: `pv:win1:${G}:${K}:${NM}:${range}:${hasSort}:${framed}`, src: phase1 }, {
    pool, n: C, threads: C, cols, bufs, args: { bounds },
  });
  const sums: any[] = res.flat().flat();

  // 2. Scan: carry into every chunk, and the total size of partitions that span chunks.
  type St = { len: number; dense: number; cnt: number; va: number[]; su: number[]; mn: number[]; mx: number[] };
  const empty = (): St => ({ len: 0, dense: 0, cnt: 0, va: new Array(NM).fill(0), su: new Array(NM).fill(0), mn: new Array(NM).fill(NaN), mx: new Array(NM).fill(NaN) });
  const add = (a: St, b: St): St => ({
    len: a.len + b.len, dense: a.dense + b.dense, cnt: a.cnt + b.cnt,
    va: a.va.map((x, k) => x + b.va[k]), su: a.su.map((x, k) => x + b.su[k]),
    mn: a.mn.map((x, k) => (!(b.mn[k] >= x) ? b.mn[k] : x)).map((x, k) => (x !== x ? a.mn[k] : x)),
    mx: a.mx.map((x, k) => (!(b.mx[k] <= x) ? b.mx[k] : x)).map((x, k) => (x !== x ? a.mx[k] : x)),
  });
  const carry: St[] = new Array(C);
  for (let c = 0; c < C; c++) {
    if (!cont[c]) { carry[c] = empty(); continue; }
    const prev = sums[c - 1];
    carry[c] = add(prev.single && cont[c - 1] ? carry[c - 1] : empty(), prev.last);
  }
  // Total size of the partition of the first segment of chunk c (when it continues) and of the last segment.
  const firstTotal = new Array(C).fill(-1), lastTotal = new Array(C).fill(-1);
  for (let c = 0; c + 1 < C; c++) {
    // The last partition of chunk c continues into chunk c + 1 and starts in chunk c.
    if (!cont[c + 1] || (sums[c].single && cont[c])) continue;
    let total = sums[c].last.len, c1 = c + 1;
    for (;;) {
      total += sums[c1].first.len;
      if (sums[c1].single && c1 + 1 < C && cont[c1 + 1]) { c1++; continue; }
      break;
    }
    lastTotal[c] = total;
    for (let q = c + 1; q <= c1; q++) firstTotal[q] = total;
  }

  // Prefix bases of every chunk (valid count and sum per measure), for frames other than the default.
  const baseV: number[][] = [], baseS: number[][] = [];
  { const v = new Array(NM).fill(0), su = new Array(NM).fill(0);
    for (let c = 0; c < C; c++) {
      baseV.push(v.slice()); baseS.push(su.slice());
      if (framed) for (let k = 0; k < NM; k++) { v[k] += sums[c].pv[k]; su[k] += sums[c].ps[k]; }
    }
    baseV.push(v.slice()); baseS.push(su.slice());
  }
  // Value ops: their fields as extra columns.
  const vkeys: string[] = [];
  const vIndex = ops.map(o => {
    if (!o.value) return -1;
    const j = vkeys.length;
    vkeys.push(o.value.key);
    pool.ensureColumn(o.value.key, "f64", o.value.view.buffer as SharedArrayBuffer);
    vkeys.push(o.value.tagKey || "");
    if (o.value.tagKey) pool.ensureColumn(o.value.tagKey, "u8", o.value.tag!.buffer as SharedArrayBuffer);
    return j;
  });
  const vcols = vkeys.filter(k => k);

  // 3. Map: final values, written by row id.
  const opCodes = ops.map(o => o.op);
  // Columns of phase 3: the measures (min and max of other frames), then the value-op fields.
  const p3cols = [...mkeys, ...vcols];
  let vslot = 0;
  const vdecl = vIndex.map((j, o) => {
    if (j < 0) return "null";
    const val = `cols[${NM + vslot++}]`;
    const tg = ops[o].value!.tagKey ? `cols[${NM + vslot++}]` : "null";
    return `[${val}, ${tg}]`;
  });
  const phase3 = `const S = bufs[0], L0 = bufs[1], L1 = bufs[2], L2 = bufs[3], L3 = bufs[4], L4 = bufs[5], A0 = bufs[6];
const A = [${Array.from({ length: NM }, (_x, j) => `[bufs[${7 + 4 * j}], bufs[${8 + 4 * j}], bufs[${9 + 4 * j}], bufs[${10 + 4 * j}]]`).join(", ")}];
const PRE = [${Array.from({ length: framed ? NM : 0 }, (_x, j) => `[bufs[${7 + 4 * NM + 2 * j}], bufs[${8 + 4 * NM + 2 * j}]]`).join(", ")}];
const OB = ${7 + 4 * NM + (framed ? 2 * NM : 0)};
const M = [${Array.from({ length: NM }, (_x, j) => `cols[${j}]`).join(", ")}];
const VF = [${vdecl.join(", ")}];
const ops = args.ops, mi = args.mi, prm = args.prm, f0 = args.frame[0], f1 = args.frame[1], framed = ${framed}, range = ${range};
const starts = args.starts, m = args.m;
// Prefix (valid, sum) of measure k before sorted position x.
const chunkOf = x => { let c = 0; while (c + 1 < starts.length && starts[c + 1] <= x) c++; return c; };
const preV = (k, x) => { if (x >= m) return args.baseV[starts.length][k]; const c = chunkOf(x); return args.baseV[c][k] + PRE[k][0][x]; };
const preS = (k, x) => { if (x >= m) return args.baseS[starts.length][k]; const c = chunkOf(x); return args.baseS[c][k] + PRE[k][1][x]; };
const firstPeer = x => x - (L0[x] - L1[x]), lastPeer = x => x + (L3[x] - L0[x]);
const val = (o, x) => { const F = VF[o]; if (F[1] && F[1][S[x]] !== 0) return F[1][S[x]] === 1 ? null : undefined; return F[0][S[x]]; };
for (let c = start; c < end; c++) {
  const [s, e] = args.bounds[c], cr = args.carry[c], ft = args.firstTotal[c], lt = args.lastTotal[c];
  const segEnd = args.cont[c] ? args.firstEnd[c] : s, lastStart = args.lastStart[c];
  for (let q = s; q < e; q++) {
    const inFirst = q < segEnd, r = S[q];
    const base = inFirst ? cr : null;
    let size = L4[q];
    if (inFirst && ft >= 0) size = ft; else if (q >= lastStart && lt >= 0) size = lt;
    const off = base ? base.len : 0;
    // Vega's frame of the row: [i0, i1) in its partition, which starts at sorted position ps.
    const li = off + L0[q], ps = q - li;
    let i0 = f0 == null ? 0 : Math.max(0, li - Math.abs(f0));
    let i1 = f1 == null ? size : Math.min(size, li + Math.abs(f1) + 1);
    if (range && i1 > i0) { i0 = firstPeer(ps + i0) - ps; i1 = lastPeer(ps + i1 - 1) + 1 - ps; }
    for (let o = 0; o < ops.length; o++) {
      const V = bufs[OB + 2 * o], G = bufs[OB + 2 * o + 1];
      let v, k = mi[o];
      if (VF[o]) {
        let x = -1;
        switch (ops[o]) {
          case "lag": x = li - prm[o] >= 0 ? q - prm[o] : -1; break;
          case "lead": x = li + prm[o] < size ? q + prm[o] : -1; break;
          case "first_value": x = ps + i0; break;
          case "last_value": x = ps + i1 - 1; break;
          case "nth_value": x = i0 + prm[o] - 1 < i1 ? ps + i0 + prm[o] - 1 : -1; break;
        }
        v = x < 0 ? null : val(o, x);
        if (v === undefined) G[r] = 2; else if (v === null) G[r] = 1; else { V[r] = v; G[r] = 0; }
        continue;
      }
      if (framed && ops[o] !== "row_number" && ops[o] !== "rank" && ops[o] !== "dense_rank" && ops[o] !== "percent_rank" && ops[o] !== "cume_dist") {
        const cnt = i1 - i0;
        if (ops[o] === "count") v = cnt;
        else {
          const va = preV(k, ps + i1) - preV(k, ps + i0);
          if (ops[o] === "valid") v = va;
          else if (ops[o] === "missing") v = cnt - va;
          else if (!va) v = undefined;
          else if (ops[o] === "sum") v = preS(k, ps + i1) - preS(k, ps + i0);
          else if (ops[o] === "mean" || ops[o] === "average") v = (preS(k, ps + i1) - preS(k, ps + i0)) / va;
          else {
            let b = NaN;
            const mx = ops[o] === "max", Mk = M[k];
            for (let x = ps + i0; x < ps + i1; x++) { const y = Mk[S[x]]; if (y === y && (b !== b || (mx ? y > b : y < b))) b = y; }
            v = b;
          }
        }
        if (v === undefined) G[r] = 2; else { V[r] = v; G[r] = 0; }
        continue;
      }
      switch (ops[o]) {
        case "row_number": v = off + L0[q] + 1; break;
        case "rank": v = off + L1[q] + 1; break;
        case "dense_rank": v = (base ? base.dense : 0) + L2[q]; break;
        case "percent_rank": v = (off + L1[q]) / (size - 1); break;
        // As WindowOps.cume_dist: the first row of a partition is 1 / size, even with peers.
        case "cume_dist": v = (off + L0[q] === 0 ? 1 : off + L3[q] + 1) / size; break;
        case "count": v = (base ? base.cnt : 0) + A0[q]; break;
        default: {
          const va = (base ? base.va[k] : 0) + A[k][0][q];
          if (ops[o] === "valid") { v = va; break; }
          if (ops[o] === "missing") { v = (base ? base.cnt : 0) + A0[q] - va; break; }
          if (!va) { v = undefined; break; }
          const su = (base ? base.su[k] : 0) + A[k][1][q];
          if (ops[o] === "sum") v = su;
          else if (ops[o] === "mean" || ops[o] === "average") v = su / va;
          else if (ops[o] === "min") { const a = base ? base.mn[k] : NaN, b = A[k][2][q]; v = a !== a ? b : b !== b ? a : Math.min(a, b); }
          else { const a = base ? base.mx[k] : NaN, b = A[k][3][q]; v = a !== a ? b : b !== b ? a : Math.max(a, b); }
        }
      }
      if (v === undefined) G[r] = 2; else { V[r] = v; G[r] = 0; }
    }
  }
}
return 0;`;
  const firstEnd = sums.map(x => (x.single ? x.first.end : x.first.end));
  const lastStart = sums.map(x => x.last.start);
  await pwMap({ key: `pv:win3:${NM}:${framed}:${range}:${vdecl.join("|")}`, src: phase3 }, {
    pool, n: C, threads: C, cols: p3cols,
    bufs: [...bufs, ...outs.flatMap(o => [sb(o.view, "f64"), sb(o.tag, "u8")])],
    args: { bounds, carry, cont, firstTotal, lastTotal, firstEnd, lastStart, ops: opCodes, mi: mIndex,
      prm: ops.map(o => o.param ?? 0), frame, starts: bounds.map(b => b[0]), m, baseV, baseS },
  });

  // 4. sum, mean, average: a sequential pass per partition in Vega's order (whole partitions per worker).
  const seqOps = ops.map((o, i) => (o.op === "sum" || o.op === "mean" || o.op === "average" ? i : -1)).filter(i => i >= 0);
  if (seqOps.length) {
    const pstarts: number[] = [];
    sums.forEach((x, c) => { if (!cont[c]) pstarts.push(bounds[c][0]); for (const q of x.starts) pstarts.push(q); });
    const parts: [number, number][] = pstarts.map((p0, i) => [p0, i + 1 < pstarts.length ? pstarts[i + 1] : m]);
    // Contiguous runs of partitions with about m / W rows each.
    const W = Math.min(pool.size, parts.length);
    const groups: [number, number][] = [];
    let gi = 0;
    for (let w = 0; w < W && gi < parts.length; w++) {
      const target = ((w + 1) * m) / W;
      let gj = gi + 1;
      while (gj < parts.length && parts[gj][0] < target) gj++;
      if (w === W - 1) gj = parts.length;
      groups.push([gi, gj]);
      gi = gj;
    }
    const seqKeys = [...new Set(seqOps.map(i => mIndex[i]))];
    const OB0 = 7 + 4 * NM + (framed ? 2 * NM : 0);
    const phase4 = `const S = bufs[0], L0 = bufs[1], L1 = bufs[2], L3 = bufs[4];
const M = [${Array.from({ length: NM }, (_x, j) => `cols[${j}]`).join(", ")}];
const f0 = args.frame[0], f1 = args.frame[1], range = ${range}, parts = args.parts, seq = args.seq, mi = args.mi, kinds = args.kinds, keys = args.keys;
const OUT = seq.map(o => [bufs[${OB0} + 2 * o], bufs[${OB0} + 2 * o + 1]]);
const firstPeer = x => x - (L0[x] - L1[x]), lastPeer = x => x + (L3[x] - L0[x]);
const valid = new Float64Array(keys.length), sum = new Float64Array(keys.length), mean = new Float64Array(keys.length);
const slot = mi.map(k => keys.indexOf(k));
const add = (x) => { const r = S[x]; for (let a = 0; a < keys.length; a++) { const v = M[keys[a]][r]; if (v !== v) continue; ++valid[a]; sum[a] += +v; const d = v - mean[a]; mean[a] += d / valid[a]; } };
const rem = (x) => { const r = S[x]; for (let a = 0; a < keys.length; a++) { const v = M[keys[a]][r]; if (v !== v) continue; --valid[a]; sum[a] -= v; const d = v - mean[a]; mean[a] -= valid[a] ? d / valid[a] : mean[a]; } };
for (let g = start; g < end; g++) for (let p = args.groups[g][0]; p < args.groups[g][1]; p++) {
  const ps = parts[p][0], n = parts[p][1] - ps;
  valid.fill(0); sum.fill(0); mean.fill(0);
  let i0 = 0, i1 = 0;
  for (let i = 0; i < n; i++) {
    const p0 = i0, p1 = i1;
    i0 = f0 == null ? 0 : Math.max(0, i - Math.abs(f0));
    i1 = f1 == null ? n : Math.min(n, i + Math.abs(f1) + 1);
    if (range) {
      if (i0 > 0) i0 = firstPeer(ps + i0) - ps;
      if (i1 - 1 < n - 1) i1 = lastPeer(ps + i1 - 1) + 1 - ps;
    }
    for (let j = p0; j < i0; j++) rem(ps + j);
    for (let j = p1; j < i1; j++) add(ps + j);
    const r = S[ps + i];
    for (let q = 0; q < seq.length; q++) {
      const a = slot[q], V = OUT[q][0], G = OUT[q][1];
      if (!valid[a]) { G[r] = 2; continue; }
      V[r] = kinds[q] === "sum" ? sum[a] : mean[a];
      G[r] = 0;
    }
  }
}
return 0;`;
    await pwMap({ key: `pv:win4:${NM}:${range}`, src: phase4 }, {
      pool, n: groups.length, threads: groups.length, cols: mkeys,
      bufs: [...bufs, ...outs.flatMap(o => [sb(o.view, "f64"), sb(o.tag, "u8")])],
      args: { frame, parts, groups, seq: seqOps, mi: seqOps.map(i => mIndex[i]), kinds: seqOps.map(i => ops[i].op), keys: seqKeys },
    });
  }
  return outs;
}
