/**
 * Fused filter -> bin -> group-by aggregate, executed as a MapReduce over
 * resident shared columns.
 *
 * Semantics follow Vega's `filter`, `bin` and `aggregate` transforms, with
 * these documented differences:
 *  - NaN in a numeric field is treated as missing (Vega counts it as valid).
 *  - Missing values never satisfy a range predicate (in a Vega expression,
 *    null >= 0 is true).
 *  - Output groups are ordered by key, not by first appearance.
 *  - Only the ops in SUPPORTED_OPS are available.
 */
import { bin as vegaBin } from "vega-statistics";
import {
  BIN_NEG_INF, BIN_NULL, BIN_POS_INF, DimSpec, FIELD_SLOTS, FilterSpec,
  KernelSpec, S_M2, S_MAX, S_MEAN, S_MIN, S_SUM, S_VALID, dimCard,
  combineKernel, keyCount, mapKernel, slotCount,
} from "./kernel";
import { ColumnTable } from "./table";
import { Priority, PriorityLevel, WorkerPool } from "./pool";
import { mapReduce } from "paraweb-js/resident";
import type { GpuBackend } from "./gpu";
import { gpuEligible } from "./gpu";

/** Scheduling of one execution: background work runs at low priority in short chunks. */
export interface ExecOptions {
  priority?: PriorityLevel;
  /** Split each worker's row range into chunks of this many rows (0 = no split). */
  chunkRows?: number;
}


export interface BinParam {
  field: string;
  extent?: [number, number] | null;
  maxbins?: number;
  step?: number;
  steps?: number[];
  minstep?: number;
  nice?: boolean;
  anchor?: number;
  base?: number;
  divide?: number[];
  span?: number;
  /** Second name may be null when only the bin start is a group-by field. */
  as?: [string, string | null];
  /** Bin boundaries already resolved (by Vega's bin transform); extent is then ignored. */
  resolved?: { start: number; stop: number; step: number };
  /** Values to bin, in place of the table's column for `field` (a derived field). */
  column?: { key: string; view: Float64Array };
}

export interface PredicateParam {
  field: string;
  /** Inclusive interval; null/undefined disables the predicate. */
  range?: [number, number] | null;
  /** Set membership on raw values; null/undefined disables, [] matches nothing. */
  oneOf?: any[] | null;
}

export interface AggregateParams {
  groupby?: string[];
  bins?: BinParam[];
  ops?: string[];
  fields?: (string | null | undefined)[];
  as?: (string | null | undefined)[];
  filter?: PredicateParam[];
  /**
   * Further row predicate as kernel source, built with the plan's column
   * numbering (from a compiled Vega expression, see runtime/relation.ts).
   */
  where?: (slot: (key: string, type: "f64" | "i32" | "u8", buffer: SharedArrayBuffer) => number) =>
    { prelude: string; cond: string; P: Record<string, any> };
  /** Group-by columns in place of the table's dictionary of a field (derived fields). */
  groupCols?: Record<string, import("./table").DictColumn>;
  /** Measure columns in place of the table's numeric column of a field (derived fields). */
  measureCols?: Record<string, { key: string; view: Float64Array }>;
}

export const SUPPORTED_OPS = new Set([
  "count", "valid", "missing", "sum", "mean", "average", "variance",
  "variancep", "stdev", "stdevp", "stderr", "min", "max",
]);
const VARIANCE_OPS = new Set(["variance", "variancep", "stdev", "stdevp", "stderr"]);

/** Reusable shared buffers, owned by the caller (one per transform instance). */
export interface Scratch {
  parts?: SharedArrayBuffer;
  dst?: SharedArrayBuffer;
}

export interface AggregateStats {
  rows: number;
  threads: number;
  groups: number;
  keys: number;
  mergeMode: "single" | "main" | "parallel";
  /** "scan": full pass; "index": answered from a pre-aggregated cube. */
  path?: "scan" | "index" | "gpu";
  /** GPU path: time to upload missing columns (first use) and to run the dispatch. */
  gpuUploadMs?: number;
  gpuDispatchMs?: number;
  /** Rows scanned exactly at the brush edges (index path). */
  boundaryRows?: number;
}

/** Upper bound on partial-buffer memory before reducing the thread count. */
const MAX_PARTIAL_BYTES = 512 * 1024 * 1024;
/** Below this many partial slots, merging on the main thread is cheaper. */
const PARALLEL_MERGE_SLOTS = 1 << 16;

interface ResolvedBin {
  start: number;
  stop: number;
  step: number;
  nb: number;
  as: [string, string | null];
}

/** Bin boundaries exactly as vega-transforms' Bin._bins computes them. */
export function resolveBin(p: BinParam, extent: [number, number]): ResolvedBin {
  const opts: any = { extent };
  for (const k of ["maxbins", "step", "steps", "minstep", "nice", "base", "divide", "span"] as const) {
    if ((p as any)[k] != null) opts[k] = (p as any)[k];
  }
  const b = vegaBin(opts);
  const step = b.step;
  let start = b.start;
  const nb = Math.ceil((b.stop - start) / step);
  let stop = start + nb * step;
  if (p.anchor != null) {
    const d = p.anchor - (start + step * Math.floor((p.anchor - start) / step));
    start += d;
    stop += d;
  }
  return { start, stop, step, nb, as: p.as ?? ["bin0", "bin1"] };
}

function measureName(op: string, field: string | null | undefined, as: string | null | undefined) {
  return as || (op + (!field ? "" : "_" + field));
}



/** Leading fine-bucket dimension, used only when building pre-aggregates. */
export interface BucketDimParam {
  field: string;
  R: number;
  lo: number;
  hi: number;
  scale: number;
}

interface Output { op: string; m: number; name: string }

/** A compiled-ready description of one request (filters, keys, measures). */
export interface Plan {
  spec: KernelSpec;
  cols: string[];
  fp: Float64Array;
  sets: Uint8Array[];
  K: number;
  A: number;
  dims: DimSpec[];
  decoders: ((idx: number, row: Record<string, any>) => void)[];
  outputs: Output[];
  /** Parameters of the `where` predicate. */
  P?: Record<string, any>;
}

export async function planAggregate(
  pool: WorkerPool,
  table: ColumnTable,
  params: AggregateParams,
  bucket?: BucketDimParam,
): Promise<Plan> {
  const cols: string[] = [];
  const colIndex = new Map<string, number>();
  const slot = (key: string, type: "f64" | "i32" | "u8", buffer: SharedArrayBuffer) => {
    let s = colIndex.get(key);
    if (s === undefined) {
      s = cols.length;
      cols.push(key);
      colIndex.set(key, s);
      pool.ensureColumn(key, type, buffer);
    }
    return s;
  };
  const f64Slot = (field: string) => {
    const c = params.measureCols?.[field] ?? table.numeric(field);
    return slot(c.key, "f64", c.view.buffer as SharedArrayBuffer);
  };

  // --- predicates (Filter) ---
  const filters: FilterSpec[] = [];
  const fp: number[] = [];
  const sets: Uint8Array[] = [];
  for (const p of params.filter ?? []) {
    if (p == null || !p.field) continue;
    if (p.range != null && p.range.length >= 2) {
      const a = +p.range[0], b = +p.range[1];
      filters.push({ kind: "range", col: f64Slot(p.field) });
      fp.push(Math.min(a, b), Math.max(a, b));
    } else if (p.oneOf != null) {
      const d = table.dictionary(p.field);
      const mask = new Uint8Array(d.card);
      for (const v of p.oneOf) {
        if (v == null) { mask[d.card - 1] = 1; continue; }
        const c = d.codes.get(v instanceof Date ? +v : v);
        if (c !== undefined) mask[c] = 1;
      }
      filters.push({ kind: "set", col: slot(d.key, "i32", d.view.buffer as SharedArrayBuffer) });
      sets.push(mask);
    }
  }

  // --- key dimensions (optional bucket, then bins, then group-by fields) ---
  const dims: DimSpec[] = [];
  const decoders: ((idx: number, row: Record<string, any>) => void)[] = [];
  if (bucket) {
    dims.push({ kind: "bucket", col: f64Slot(bucket.field), R: bucket.R });
    fp.push(bucket.lo, bucket.hi, bucket.scale);
    decoders.push(() => {});
  }
  for (const bp of params.bins ?? []) {
    let rb: ResolvedBin;
    if (bp.resolved) {
      const { start, stop, step } = bp.resolved;
      const nb = Math.round((stop - start) / step);
      rb = { start, stop, step, nb: Number.isFinite(nb) && nb > 0 ? nb : 0, as: bp.as ?? ["bin0", "bin1"] };
    } else {
      const extent = bp.extent && bp.extent.length >= 2
        ? [+bp.extent[0], +bp.extent[1]] as [number, number]
        : await table.extent(bp.field, pool);
      if (!(extent[0] <= extent[1])) {
        throw new Error(`pwaggregate: field ${bp.field} has no numeric values to bin`);
      }
      rb = resolveBin(bp, extent);
    }
    const bcol = bp.column ? slot(bp.column.key, "f64", bp.column.view.buffer as SharedArrayBuffer) : f64Slot(bp.field);
    dims.push({ kind: "bin", col: bcol, nb: rb.nb });
    fp.push(rb.start, rb.stop, rb.stop - rb.step, rb.step);
    const [a0, a1] = rb.as;
    decoders.push((idx, row) => {
      if (idx < rb.nb) {
        const v = rb.start + rb.step * idx;
        row[a0] = v;
        // Same expression as Vega's Bin transform (vega/vega#830).
        if (a1) row[a1] = rb.start + rb.step * (1 + (v - rb.start) / rb.step);
      } else if (idx === rb.nb + BIN_NULL) {
        row[a0] = null; if (a1) row[a1] = null;
      } else if (idx === rb.nb + BIN_NEG_INF) {
        row[a0] = -Infinity; if (a1) row[a1] = -Infinity;
      } else if (idx === rb.nb + BIN_POS_INF) {
        const v = rb.start === rb.start ? Infinity : NaN;
        row[a0] = v; if (a1) row[a1] = v;
      }
    });
  }
  for (const g of params.groupby ?? []) {
    const d = params.groupCols?.[g] ?? table.dictionary(g);
    dims.push({ kind: "dict", col: slot(d.key, "i32", d.view.buffer as SharedArrayBuffer), card: d.card });
    decoders.push((idx, row) => { row[g] = d.values[idx]; });
  }

  // --- measures ---
  const ops = params.ops && params.ops.length ? params.ops : ["count"];
  const fields = params.fields ?? [];
  const asNames = params.as ?? [];
  const measureFields: string[] = [];
  const measureOf = new Map<string, number>();
  let variance = false;
  const outputs = ops.map((op, i) => {
    if (!SUPPORTED_OPS.has(op)) throw new Error(`pwaggregate: unsupported op "${op}"`);
    const field = fields[i] && fields[i] !== "*" ? fields[i]! : null;
    if (op !== "count" && !field) throw new Error(`pwaggregate: op "${op}" requires a field`);
    let m = -1;
    if (field && op !== "count") {
      m = measureOf.get(field) ?? -1;
      if (m < 0) { m = measureFields.length; measureFields.push(field); measureOf.set(field, m); }
    }
    if (VARIANCE_OPS.has(op)) variance = true;
    return { op, m, name: measureName(op, field, asNames[i]) };
  });
  const measures = measureFields.map(f64Slot);

  const spec: KernelSpec = { filters, dims, measures, variance };
  let P: Record<string, any> | undefined;
  if (params.where) {
    const w = params.where(slot);
    spec.where = { prelude: w.prelude, cond: w.cond };
    P = w.P;
  }
  return {
    spec, cols, fp: Float64Array.from(fp), sets, K: keyCount(spec), A: slotCount(spec),
    dims, decoders, outputs, P,
  };
}

export interface Execution {
  final: Float64Array;
  threads: number;
  mergeMode: AggregateStats["mergeMode"];
}

/**
 * Run a plan over the whole table with ParaWeb's MapReduce (kernel form): the
 * fused kernel accumulates each worker's rows into its own region (Map),
 * then the regions are combined (Reduce), on the main thread when small and
 * in parallel by key range otherwise.
 */
export async function executePlan(
  pool: WorkerPool,
  table: ColumnTable,
  plan: Plan,
  scratch: Scratch = {},
  opts: ExecOptions = {},
): Promise<Execution> {
  const { spec, cols, sets, K, A } = plan;
  // ParaWeb MapReduce, kernel form: fused map kernel + combine kernel over resident columns.
  const r = await mapReduce({ map: mapKernel(spec), combine: combineKernel(spec.measures.length, spec.variance) }, {
    pool, n: table.length, keys: K, slots: A, cols,
    args: { sets, fp: plan.fp, K, P: plan.P },
    scratch, priority: opts.priority ?? Priority.High, chunkRows: opts.chunkRows ?? 0,
    parallelCombineMin: PARALLEL_MERGE_SLOTS, maxPartialBytes: MAX_PARTIAL_BYTES,
  });
  return { final: r.final, threads: r.threads, mergeMode: r.combine };
}

/** One tuple per non-empty group of `final` (K groups of A slots). */
export function emitRows(plan: Plan, final: Float64Array, keys?: number[]): Record<string, any>[] {
  const { dims, decoders, outputs, K, A } = plan;
  const variance = plan.spec.variance;
  const cards = dims.map(dimCard);
  const rows: Record<string, any>[] = [];
  for (let k = 0; k < K; k++) {
    const o = k * A;
    const count = final[o];
    if (count === 0) continue;
    const row: Record<string, any> = {};
    let rem = k;
    for (let d = 0; d < dims.length; d++) {
      const idx = rem % cards[d];
      rem = (rem - idx) / cards[d];
      decoders[d](idx, row);
    }
    for (const out of outputs) {
      if (out.op === "count") { row[out.name] = count; continue; }
      const q = o + 1 + out.m * FIELD_SLOTS;
      const valid = final[q + S_VALID];
      switch (out.op) {
        case "valid": row[out.name] = valid; break;
        case "missing": row[out.name] = count - valid; break;
        case "sum": row[out.name] = valid ? final[q + S_SUM] : undefined; break;
        case "mean":
        case "average":
          row[out.name] = valid
            ? (variance ? final[q + S_MEAN] : final[q + S_SUM] / valid)
            : undefined;
          break;
        case "min": row[out.name] = valid ? final[q + S_MIN] : undefined; break;
        case "max": row[out.name] = valid ? final[q + S_MAX] : undefined; break;
        case "variance": row[out.name] = valid > 1 ? final[q + S_M2] / (valid - 1) : undefined; break;
        case "variancep": row[out.name] = valid > 1 ? final[q + S_M2] / valid : undefined; break;
        case "stdev": row[out.name] = valid > 1 ? Math.sqrt(final[q + S_M2] / (valid - 1)) : undefined; break;
        case "stdevp": row[out.name] = valid > 1 ? Math.sqrt(final[q + S_M2] / valid) : undefined; break;
        case "stderr": row[out.name] = valid > 1 ? Math.sqrt(final[q + S_M2] / (valid * (valid - 1))) : undefined; break;
      }
    }
    rows.push(row);
    if (keys) keys.push(k);
  }
  return rows;
}

export async function runAggregate(
  pool: WorkerPool,
  table: ColumnTable,
  params: AggregateParams,
  scratch: Scratch = {},
  stats?: AggregateStats,
  gpu?: GpuBackend | null,
): Promise<Record<string, any>[]> {
  const plan = await planAggregate(pool, table, params);
  if (gpu && gpuEligible(plan)) {
    const final = await gpu.aggregate(pool, table, plan);
    const rows = emitRows(plan, final);
    if (stats) {
      Object.assign(stats, {
        rows: table.length, threads: 0, groups: rows.length, keys: plan.K, mergeMode: "single", path: "gpu",
        gpuUploadMs: gpu.last.uploadMs, gpuDispatchMs: gpu.last.dispatchMs,
      });
    }
    return rows;
  }
  const ex = await executePlan(pool, table, plan, scratch);
  const rows = emitRows(plan, ex.final);
  if (stats) {
    Object.assign(stats, {
      rows: table.length, threads: ex.threads, groups: rows.length, keys: plan.K,
      mergeMode: ex.mergeMode, path: "scan",
    });
  }
  return rows;
}
