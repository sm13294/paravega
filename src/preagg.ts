/**
 * Exact pre-aggregation for brushing.
 *
 * While one range predicate (the "active" brush on field F) is being moved
 * and everything else stays fixed, a view's groups are
 *
 *   agg(k) = aggregate of { rows r : key(r) = k, lo <= F(r) <= hi, other filters(r) }.
 *
 * Build (once per brush session and view):
 *   1. bucket index of F: row ids grouped by R fine buckets (ParaWeb's
 *      residentCountingSort; shared by all views, independent of predicates);
 *   2. cube[k][b] = partial record (count, valid, sum, min, max, Welford
 *      mean and M2 per measured field) of the rows in bucket b with key k
 *      that pass the other filters: a normal MapReduce with an extra bucket
 *      dimension, run at low priority in chunks;
 *   3. per key k, a segment tree over the R buckets whose nodes are the
 *      merged records of their children (the same merge as the scan's
 *      Reduce step). Missing values of F (bucket R) are kept apart.
 *
 * Update for [lo, hi]:
 *   bl = bucket(lo), bh = bucket(hi)
 *   agg(k) = merge of O(log R) tree nodes covering buckets bl + 1 .. bh - 1
 *          + exact scan of the rows in buckets bl and bh.
 *
 * bucket() is monotone, so every row in a bucket strictly between bl and bh
 * satisfies lo < F < hi; only the two edge buckets need the exact predicate.
 * Counts are therefore exact, unlike pixel-snapped data cubes, and the
 * bucket resolution R only trades cube size against edge-scan length.
 * Floating-point measures are merged, never subtracted (a prefix-sum
 * difference would cancel), so their rounding is that of a pairwise
 * summation, as in the parallel scan itself.
 */
import {
  AggregateParams, Plan, PredicateParam, SUPPORTED_OPS, Scratch, emitRows, executePlan, planAggregate,
} from "./aggregate";
import { CompiledKernel, bucketOf, compileKernel, initRegion, kernelSignature, mergeRecord, treeKernel } from "./kernel";
import { map as pwMap } from "paraweb-js/resident";
import { BucketIndex, ColumnTable } from "./table";
import { Priority, WorkerPool } from "./pool";

/** Background builds run at low priority in chunks of `chunkRows` rows per worker. */
export const buildConfig = { chunkRows: 1 << 18 };

export interface PreaggState {
  field: string;
  /** Signature of everything except the active predicate. */
  sig: string;
  R: number;
  /** Groups of the view (keys without the bucket dimension). */
  Kv: number;
  /** Slots per record (1 + measures * FIELD_SLOTS). */
  A: number;
  nm: number;
  variance: boolean;
  /** Per key kv: segment tree over R buckets, nodes 1 .. 2R - 1, record at ((kv * 2R) + node) * A. */
  tree: Float64Array;
  /** Per key kv: record of the rows whose F is missing (bucket R), at kv * A. */
  missing: Float64Array;
  bidx: BucketIndex;
  buildMs: number;
  kernels: Map<string, CompiledKernel>;
}

/** Every supported op is mergeable, so all of them can use the cube. */
export function preaggEligible(params: AggregateParams): boolean {
  if (params.where || params.groupCols || params.measureCols) return false;
  if ((params.bins ?? []).some(b => b.column)) return false;
  const ops = params.ops && params.ops.length ? params.ops : ["count"];
  return ops.every(op => SUPPORTED_OPS.has(op));
}

function predKey(p: PredicateParam | undefined): string {
  if (!p) return "none";
  if (p.range != null && p.range.length >= 2) {
    const a = +p.range[0], b = +p.range[1];
    return `r:${Math.min(a, b)}:${Math.max(a, b)}`;
  }
  if (p.oneOf != null) return "s:" + JSON.stringify(p.oneOf);
  return "none";
}

export function filterSnapshot(params: AggregateParams): Map<string, string> {
  const m = new Map<string, string>();
  for (const p of params.filter ?? []) if (p && p.field) m.set(p.field, predKey(p));
  return m;
}

/**
 * The field of the single range predicate that changed since `prev`, or
 * null when nothing, several things, or a set predicate changed.
 */
export function activeField(prev: Map<string, string> | null, cur: Map<string, string>,
                            params: AggregateParams): string | null {
  if (!prev) return null;
  const changed: string[] = [];
  for (const k of new Set([...prev.keys(), ...cur.keys()])) {
    if (prev.get(k) !== cur.get(k)) changed.push(k);
  }
  if (changed.length !== 1) return null;
  const f = changed[0];
  const a = prev.get(f) ?? "none", b = cur.get(f) ?? "none";
  if (a.startsWith("s:") || b.startsWith("s:")) return null;
  const p = (params.filter ?? []).find(q => q && q.field === f);
  return p ? f : null;
}

export function otherSignature(params: AggregateParams, field: string): string {
  return JSON.stringify({
    groupby: params.groupby, bins: params.bins, ops: params.ops,
    filter: (params.filter ?? []).filter(p => p && p.field !== field),
  });
}

function withoutPredicate(params: AggregateParams, field: string): AggregateParams {
  return { ...params, filter: (params.filter ?? []).filter(p => p && p.field !== field) };
}

export function defaultResolution(Kv: number, A = 1): number {
  // Keep the cube at no more than ~4M values (the tree doubles it), between
  // 256 and 4096 buckets. R is a power of two, so the tree is perfect.
  let R = 4096;
  while (R > 256 && R * Kv * A > 4 * 1024 * 1024) R >>= 1;
  return R;
}

export async function buildPreagg(
  pool: WorkerPool, table: ColumnTable, params: AggregateParams, field: string,
  scratch: Scratch, resolution?: number,
): Promise<PreaggState> {
  const t0 = performance.now();
  // Announce the cube chunks now: they are queued only after the bucket
  // index is built, and the transform's cost rule needs to see them.
  const n = table.length, T = Math.min(pool.size, Math.max(1, n));
  const perWorker = Math.ceil(n / T);
  const cubeChunks = buildConfig.chunkRows ? T * Math.ceil(perWorker / buildConfig.chunkRows) : T;
  pool.reserveLow(cubeChunks);
  let released = false;
  const release = () => { if (!released) { released = true; pool.releaseLow(cubeChunks); } };
  try {
    const base = withoutPredicate(params, field);
    const viewPlan = await planAggregate(pool, table, base);
    const R = resolution ?? defaultResolution(viewPlan.K, viewPlan.A);
    const bidx = await table.bucketIndex(field, R, pool, Priority.Low, buildConfig.chunkRows);
    const plan = await planAggregate(pool, table, base, {
      field, R, lo: bidx.lo, hi: bidx.hi, scale: bidx.scale,
    });
    // Own scratch buffers: the cube must not be overwritten by queries that run while the
    // trees are built in the workers (finishPreagg reads it there, without a copy).
    void scratch;
    const running = executePlan(pool, table, plan, {}, { priority: Priority.Low, chunkRows: buildConfig.chunkRows });
    release(); // executePlan queues its chunks synchronously before its first await
    const ex = await running;
    return await finishPreagg(pool, params, field, R, plan, ex.final, bidx, t0);
  } finally {
    release();
  }
}

/** Below this many tree values, the trees are built on the main thread (dispatch would cost more). */
const TREE_MAIN_VALUES = 1 << 14;
/** Tree values per background chunk in the workers. */
const TREE_CHUNK_VALUES = 1 << 18;

async function finishPreagg(
  pool: WorkerPool, params: AggregateParams, field: string, R: number, plan: Plan, final: Float64Array,
  bidx: BucketIndex, t0: number,
): Promise<PreaggState> {
  const B = R + 1;
  const Kv = plan.K / B;
  const A = plan.A;
  const nm = plan.spec.measures.length, variance = plan.spec.variance;
  // Leaves are nodes R .. 2R - 1 (any R works for the iterative tree; a
  // power of two makes node 1 the root over all buckets).
  const size = Kv * 2 * R * A;
  if (size < TREE_MAIN_VALUES || pool.size < 2) {
    const tree = new Float64Array(size);
    initRegion(tree, 0, Kv * 2 * R, nm);
    const missing = new Float64Array(Kv * A);
    for (let kv = 0; kv < Kv; kv++) {
      const base = kv * 2 * R;
      for (let b = 0; b < R; b++) tree.set(final.subarray((kv * B + b) * A, (kv * B + b + 1) * A), (base + R + b) * A);
      missing.set(final.subarray((kv * B + R) * A, (kv * B + R + 1) * A), kv * A);
      for (let i = R - 1; i >= 1; i--) {
        const o = (base + i) * A;
        mergeRecord(tree, o, tree, (base + 2 * i) * A, nm, variance);
        mergeRecord(tree, o, tree, (base + 2 * i + 1) * A, nm, variance);
      }
    }
    return { field, sig: otherSignature(params, field), R, Kv, A, nm, variance, tree, missing, bidx, buildMs: performance.now() - t0, kernels: new Map() };
  }
  // The trees of different keys are independent: build them in the workers (a Map over keys),
  // at low priority and in chunks, like the rest of the index.
  const shared = (len: number) => new Float64Array(new SharedArrayBuffer(8 * Math.max(1, len)));
  // The cube comes from the build's own scratch (buildPreagg), so the workers read it in place
  // when it starts a shared buffer; otherwise (combined on the main thread) it is copied.
  let fin = final;
  if (!(final.buffer instanceof SharedArrayBuffer) || final.byteOffset !== 0) { fin = shared(final.length); fin.set(final); }
  const tree = shared(size), missing = shared(Kv * A);
  const keysPerChunk = Math.max(1, Math.floor(TREE_CHUNK_VALUES / (2 * R * A)));
  await pwMap(treeKernel(nm, variance), {
    pool: pool as any, n: Kv, args: { R },
    bufs: [
      { buffer: fin.buffer as SharedArrayBuffer, type: "f64" },
      { buffer: tree.buffer as SharedArrayBuffer, type: "f64" },
      { buffer: missing.buffer as SharedArrayBuffer, type: "f64" },
    ],
    priority: Priority.Low, chunkRows: keysPerChunk,
  });
  return { field, sig: otherSignature(params, field), R, Kv, A, nm, variance, tree, missing, bidx, buildMs: performance.now() - t0, kernels: new Map() };
}

/** Merge the tree nodes covering buckets [l, r] of key kv into out at o. */
function rangeInto(state: PreaggState, kv: number, l: number, r: number, out: Float64Array, o: number) {
  const { R, A, nm, variance, tree } = state;
  const base = kv * 2 * R;
  for (l += R, r += R + 1; l < r; l >>= 1, r >>= 1) {
    if (l & 1) mergeRecord(out, o, tree, (base + l++) * A, nm, variance);
    if (r & 1) mergeRecord(out, o, tree, (base + --r) * A, nm, variance);
  }
}

export interface PreaggAnswer {
  rows: Record<string, any>[];
  boundaryRows: number;
}

export async function answerPreagg(
  state: PreaggState, pool: WorkerPool, table: ColumnTable, params: AggregateParams,
): Promise<PreaggAnswer> {
  const plan: Plan = await planAggregate(pool, table, params);
  const { R, Kv, bidx } = state;
  if (plan.K !== Kv) throw new Error("pre-aggregate does not match the view's key space");
  const A = plan.A, nm = plan.spec.measures.length, variance = plan.spec.variance;
  if (A !== state.A) throw new Error("pre-aggregate does not match the view's measures");
  const out = new Float64Array(Kv * A);
  initRegion(out, 0, Kv, nm);
  const pred = (params.filter ?? []).find(p => p && p.field === state.field);
  const active = pred && pred.range != null && pred.range.length >= 2;

  if (!active) {
    // Brush cleared: all buckets, including missing values.
    for (let kv = 0; kv < Kv; kv++) {
      rangeInto(state, kv, 0, R - 1, out, kv * A);
      mergeRecord(out, kv * A, state.missing, kv * A, nm, variance);
    }
    return { rows: emitRows(plan, out), boundaryRows: 0 };
  }

  const a = +pred!.range![0], b = +pred!.range![1];
  const lo = Math.min(a, b), hi = Math.max(a, b);
  const bl = bucketOf(lo, bidx.lo, bidx.hi, bidx.scale, R);
  const bh = bucketOf(hi, bidx.lo, bidx.hi, bidx.scale, R);
  if (bh > bl + 1) for (let kv = 0; kv < Kv; kv++) rangeInto(state, kv, bl + 1, bh - 1, out, kv * A);

  // Exact scan of the edge buckets, on the main thread with the same kernel.
  const sig = kernelSignature(plan.spec, true);
  let kernel = state.kernels.get(sig);
  if (!kernel) { kernel = compileKernel(plan.spec, true); state.kernels.set(sig, kernel); }
  const cols = plan.cols.map(k => table.viewByKey(k));
  const edge = new Float64Array(Kv * A);
  initRegion(edge, 0, Kv, nm);
  const { perm, offsets } = bidx;
  kernel(cols, plan.sets, plan.fp, edge, 0, offsets[bl], offsets[bl + 1], perm);
  let boundaryRows = offsets[bl + 1] - offsets[bl];
  if (bh !== bl) {
    kernel(cols, plan.sets, plan.fp, edge, 0, offsets[bh], offsets[bh + 1], perm);
    boundaryRows += offsets[bh + 1] - offsets[bh];
  }
  for (let kv = 0; kv < Kv; kv++) mergeRecord(out, kv * A, edge, kv * A, nm, variance);
  return { rows: emitRows(plan, out), boundaryRows };
}
