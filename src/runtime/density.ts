/**
 * Vega's density transform (kde) over a relation, in the workers.
 *
 * Vega partitions the rows by the group-by fields, estimates a bandwidth per
 * group from the deviation and the quartiles of its values (Scott's rule),
 * and samples the density curve of every group adaptively (sampleCurve):
 * every sample is a sum of a Gaussian kernel over all values of the group,
 * and the curve is refined where it bends. ParaVega computes:
 *
 *  1. Map: per worker, the first row, count, extent and sum of every group,
 *     merged in row order (groups keep Vega's order of first appearance);
 *  2. the bandwidth: Map and Reduce of the squared deviations from the
 *     group means, and one parallel sort of the rows by group and value
 *     (Divide and Conquer, see sort.ts) for exact quartiles;
 *  3. the samples, in rounds: whether sampleCurve subdivides an interval
 *     depends only on the density at its ends and its midpoint, so each
 *     round evaluates, for every group at once, the points the next level
 *     of subdivision needs, as one Map and Reduce over the rows (each worker
 *     sums the kernel over its rows for all points); there are at most
 *     log2(maxsteps / minsteps) + 2 rounds;
 *  4. Vega's own sampleCurve over the computed values, so the sampled
 *     points are Vega's.
 * Kernel sums are added in another order than Vega's, so densities can
 * differ in the last bits. Null values count as rows and enter Vega's
 * kernel sum as 0 (x - null is x), but not the extent, deviation or
 * quartiles, as in Vega; fields with undefined or NaN values (which make
 * Vega's sums NaN) run on Vega.
 */
import { Relation, Unsupported, kernelKey, selectRows } from "./relation";
import { WorkerPool } from "../pool";
import { map as pwMap } from "paraweb-js/resident";
import { derivedDictionary, derivedNumeric } from "./derived";
import { sortRows } from "./sort";

export interface DensityParams {
  field: string;
  groupby: string[];
  method: "pdf" | "cdf";
  counts: boolean;
  bandwidth: number;
  extent: [number, number] | null;
  shared: boolean;
  minsteps: number;
  maxsteps: number;
  as: [string, string];
}

/** Largest number of combined group keys. */
const MAX_KEYS = 1 << 20;
const MIN_RADIANS = 0.5 * Math.PI / 180;

function scaleY(init: number, points: number[][]): number {
  let ymin = init, ymax = init;
  for (const p of points) { const y = p[1]; if (y < ymin) ymin = y; if (y > ymax) ymax = y; }
  return 1 / (ymax - ymin);
}
function angleDelta(p: number[], q: number[], r: number[], sx: number, sy: number): number {
  const a0 = Math.atan2(sy * (r[1] - p[1]), sx * (r[0] - p[0])), a1 = Math.atan2(sy * (q[1] - p[1]), sx * (q[0] - p[0]));
  return Math.abs(a0 - a1);
}

/**
 * The points that Vega's sampleCurve evaluates next, given the values known
 * so far: the same traversal (vega-statistics sampleCurve), where an
 * interval whose midpoint is not known yet is skipped for this round.
 */
function needed(get: (x: number) => number | undefined, extent: [number, number], minSteps: number, maxSteps: number): number[] {
  const need = new Set<number>();
  minSteps = minSteps || 25;
  maxSteps = Math.max(minSteps, maxSteps || 200);
  const point = (x: number): [number, number | undefined] => { const y = get(x); if (y === undefined) need.add(x); return [x, y]; };
  const minX = extent[0], maxX = extent[1], span = maxX - minX, stop = span / maxSteps;
  const prev = [point(minX)], next: [number, number | undefined][] = [];
  if (minSteps === maxSteps) {
    for (let i = 1; i < maxSteps; ++i) point(minX + i / minSteps * span);
    point(maxX);
    return [...need];
  }
  next.push(point(maxX));
  for (let i = minSteps; --i > 0;) next.push(point(minX + i / minSteps * span));
  if (need.size) return [...need];
  let p0 = prev[0] as number[];
  let p1 = next[next.length - 1] as number[] | undefined;
  const sx = 1 / span, sy = scaleY(p0[1], next as number[][]);
  while (p1) {
    const pm = point((p0[0] + p1[0]) / 2);
    if (pm[1] === undefined) { p0 = p1; next.pop(); p1 = next[next.length - 1] as number[] | undefined; continue; }
    const dx = pm[0] - p0[0] >= stop;
    if (dx && angleDelta(p0, pm as number[], p1, sx, sy) > MIN_RADIANS) next.push(pm);
    else { p0 = p1; next.pop(); }
    p1 = next[next.length - 1] as number[] | undefined;
  }
  return [...need];
}

interface Group { key: number; first: number; count: number; valid: number; min: number; max: number; sum: number; dims: any[] }

export async function computeDensity(vega: any, rel: Relation, pool: WorkerPool, p: DensityParams): Promise<any[]> {
  const table = rel.base.table;
  // Values: a numeric column, with a tag column when some values are null.
  let value: { key: string; view: Float64Array };
  let tag: { key: string; view: Uint8Array } | null = null;
  if (rel.derived.has(p.field)) {
    const c = await derivedNumeric(rel, p.field, pool);
    if (c.poison) throw new Unsupported("density field with values that are not numbers");
    value = c;
  } else {
    const col = table.exprColumn(p.field);
    if (!col || col.kind !== "num" || col.hasNaN) throw new Unsupported("density field " + p.field);
    value = { key: col.key, view: col.view };
    if (col.tag) {
      if (col.tag.some(g => g === 2)) throw new Unsupported("density field with undefined values");
      tag = { key: col.tagKey!, view: col.tag };
      pool.ensureColumn(tag.key, "u8", tag.view.buffer as SharedArrayBuffer);
    }
  }
  pool.ensureColumn(value.key, "f64", value.view.buffer as SharedArrayBuffer);
  const dicts = await Promise.all(p.groupby.map(g => derivedDictionary(rel, g, pool)));
  const cards = dicts.map(d => d.card);
  if (cards.reduce((a, b) => a * b, 1) > MAX_KEYS) throw new Unsupported("density groups");
  dicts.forEach(d => pool.ensureColumn(d.key, "i32", d.view.buffer as SharedArrayBuffer));
  const rows = await selectRows(rel, pool);
  const m = rows.length;
  if (!m) throw new Unsupported("density of no rows");
  const sb = (a: Int32Array | Float64Array, type: "i32" | "f64") => ({ buffer: a.buffer as SharedArrayBuffer, type });
  const cols = [value.key, ...dicts.map(d => d.key), ...(tag ? [tag.key] : [])];
  // A null value (tag 1): a row of the group, 0 in the kernel sum, skipped by the statistics.
  const isNull = tag ? `cols[${cols.length - 1}][i] !== 0` : "false";
  // Combined group key of row i.
  let keyExpr = "0", mul = 1;
  const terms: string[] = [];
  dicts.forEach((_d, j) => { terms.push(mul === 1 ? `cols[${j + 1}][i]` : `cols[${j + 1}][i] * ${mul}`); mul *= cards[j]; });
  if (terms.length) keyExpr = terms.join(" + ");

  // 1. Groups: first row (in row order), count, extent, sum.
  const statSrc = `const R = bufs[0], V = cols[0], G = new Map();
for (let j = start; j < end; j++) {
  const i = R[j], v = V[i], nul = ${isNull};
  if (!nul && v !== v) return null;
  const k = ${keyExpr};
  let e = G.get(k);
  if (!e) { e = [j, 0, Infinity, -Infinity, 0, 0]; G.set(k, e); }
  e[1]++;
  if (!nul) { if (v < e[2]) e[2] = v; if (v > e[3]) e[3] = v; e[4] += v; e[5]++; }
}
return [...G];`;
  const parts = (await pwMap({ key: kernelKey("pv:kde:stat:", statSrc), src: statSrc }, { pool, n: m, cols, bufs: [sb(rows, "i32")] })).flat();
  if (parts.some(x => x === null)) throw new Unsupported("density field with missing values");
  const byKey = new Map<number, Group>();
  for (const part of parts as [number, number[]][][]) for (const [k, e] of part) {
    const g = byKey.get(k);
    if (!g) byKey.set(k, { key: k, first: e[0], count: e[1], min: e[2], max: e[3], sum: e[4], valid: e[5], dims: [] });
    else { g.first = Math.min(g.first, e[0]); g.count += e[1]; if (e[2] < g.min) g.min = e[2]; if (e[3] > g.max) g.max = e[3]; g.sum += e[4]; g.valid += e[5]; }
  }
  const groups = [...byKey.values()].sort((a, b) => a.first - b.first);
  if (groups.some(g => !g.valid)) throw new Unsupported("density group without values");
  // Group values, and Vega's grouping by the string of the values.
  const strings = new Set<string>();
  for (const g of groups) {
    let k = g.key;
    g.dims = dicts.map((d, j) => { const c = k % cards[j]; k = Math.floor(k / cards[j]); return d.values[c]; });
    const s = g.dims.map(v => (v == null ? "" : String(v))).join(",");
    if (strings.has(s)) throw new Unsupported("density groups with equal names");
    strings.add(s);
  }
  const gidx = new Int32Array(Math.max(1, mul)).fill(-1);
  groups.forEach((g, j) => { gidx[g.key] = j; });
  const G = groups.length;

  // 2. Bandwidth per group (Scott's rule, as vega-statistics' estimateBandwidth).
  let bw: number[];
  if (p.bandwidth) bw = groups.map(() => p.bandwidth);
  else {
    const means = groups.map(g => g.sum / g.valid);
    const devSrc = `const R = bufs[0], V = cols[0], gidx = args.gidx, mean = args.mean, acc = new Float64Array(args.G);
for (let j = start; j < end; j++) { const i = R[j]; if (${isNull}) continue; const v = V[i], g = gidx[${keyExpr}], d = v - mean[g]; acc[g] += d * d; }
return acc;`;
    const dev = (await pwMap({ key: kernelKey("pv:kde:dev:", devSrc), src: devSrc }, {
      pool, n: m, cols, bufs: [sb(rows, "i32")], args: { gidx, mean: means, G },
    })).flat() as Float64Array[];
    const m2 = new Float64Array(G);
    for (const a of dev) for (let g = 0; g < G; g++) m2[g] += a[g];
    // Rows sorted by group (order of first appearance), then value: exact quartiles.
    const gcol = new Float64Array(new SharedArrayBuffer(8 * Math.max(1, table.length)));
    const gSrc = `const R = bufs[0], out = bufs[1], gidx = args.gidx;\nfor (let j = start; j < end; j++) { const i = R[j]; out[i] = gidx[${keyExpr}]; }`;
    await pwMap({ key: kernelKey("pv:kde:g:", gSrc), src: gSrc }, { pool, n: m, cols, bufs: [sb(rows, "i32"), sb(gcol, "f64")], args: { gidx } });
    const gkey = `${table.id}:kdeg:${Math.random().toString(36).slice(2)}`;
    pool.ensureColumn(gkey, "f64", gcol.buffer as SharedArrayBuffer);
    let valid = rows;
    if (tag) {
      const t = tag.view, out = new Int32Array(new SharedArrayBuffer(4 * Math.max(1, m)));
      let w = 0;
      for (let j = 0; j < m; j++) if (t[rows[j]] === 0) out[w++] = rows[j];
      valid = out.subarray(0, w);
    }
    const sorted = await sortRows(pool, valid, G > 1 ? [{ key: gkey, view: gcol, order: 1 }, { key: value.key, view: value.view, order: 1 }]
      : [{ key: value.key, view: value.view, order: 1 }]);
    pool.dropColumns([gkey]);
    let off = 0;
    bw = groups.map((g, j) => {
      const n = g.valid;
      const variance = n > 1 ? m2[j] / (n - 1) : undefined;
      const d = variance ? Math.sqrt(variance) : variance;
      const at = (q: number) => value.view[sorted[off + q]];
      const quant = (pr: number) => {
        if (n < 2) return at(0);
        const h = (n - 1) * pr, i0 = Math.floor(h), v0 = at(i0), v1 = at(i0 + 1);
        return v0 + (v1 - v0) * (h - i0);
      };
      const q0 = quant(0.25), q2 = quant(0.75);
      off += n;
      const h = (q2 - q0) / 1.34;
      const v = Math.min(d as number, h) || (d as number) || Math.abs(q0) || 1;
      // Vega's n is the length of the group, null values included.
      return 1.06 * v * Math.pow(g.count, -0.2);
    });
  }

  // 3. Samples of the curves, in rounds.
  let minsteps = p.minsteps, maxsteps = p.maxsteps;
  let domain = p.extent;
  if (p.shared) {
    if (!domain) domain = [Math.min(...groups.map(g => g.min)), Math.max(...groups.map(g => g.max))];
    minsteps = maxsteps;
  }
  const local = groups.map(g => (domain || [g.min, g.max]) as [number, number]);
  const memo = groups.map(() => new Map<number, number>());
  const kernel = p.method === "pdf" ? "L.densityNormal" : "L.cumulativeNormal";
  const evalSrc = `const L = globalThis.__pwvt, K = ${kernel};
const R = bufs[0], V = cols[0], gidx = args.gidx, X = args.X, OFF = args.off, BW = args.bw, acc = new Float64Array(args.tot);
for (let j = start; j < end; j++) {
  const i = R[j], v = ${isNull} ? 0 : V[i], g = gidx[${keyExpr}], xs = X[g];
  if (!xs.length) continue;
  const o = OFF[g], b = BW[g];
  for (let q = 0; q < xs.length; q++) acc[o + q] += K((xs[q] - v) / b, 0, 1);
}
return acc;`;
  for (let round = 0; round < 64; round++) {
    const X = groups.map((_g, j) => needed(x => memo[j].get(x), local[j], minsteps, maxsteps));
    const tot = X.reduce((s, xs) => s + xs.length, 0);
    if (!tot) break;
    const off: number[] = [];
    let o = 0;
    for (const xs of X) { off.push(o); o += xs.length; }
    const res = (await pwMap({ key: kernelKey("pv:kde:eval:", evalSrc), src: evalSrc }, {
      pool, n: m, cols, bufs: [sb(rows, "i32")], args: { gidx, X, off, bw, tot },
    })).flat() as Float64Array[];
    const y = new Float64Array(tot);
    for (const a of res) for (let q = 0; q < tot; q++) y[q] += a[q];
    X.forEach((xs, j) => xs.forEach((x, q) => {
      const s = y[off[j] + q], n = groups[j].count;
      memo[j].set(x, p.method === "pdf" ? s / bw[j] / n : s / n);
    }));
  }

  // 4. Vega's sampleCurve over the computed values.
  const out: any[] = [];
  const names = p.groupby;
  groups.forEach((g, j) => {
    const scale = p.counts ? g.count : 1;
    const f = (x: number) => {
      const v = memo[j].get(x);
      if (v === undefined) throw new Unsupported("density sample outside the computed points");
      return v;
    };
    for (const v of vega.sampleCurve(f, local[j], minsteps, maxsteps)) {
      const t: any = {};
      for (let i = 0; i < names.length; ++i) t[names[i]] = g.dims[i];
      t[p.as[0]] = v[0];
      t[p.as[1]] = v[1] * scale;
      out.push(t);
    }
  });
  return out;
}
