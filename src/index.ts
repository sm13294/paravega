/**
 * paraweb-vega: parallel Vega transforms on the ParaWeb execution model.
 *
 *   import * as vega from "vega";
 *   import { registerParaweb } from "paraweb-vega";
 *   const pw = registerParaweb(vega, { threads: 8 });
 *   pw.registerTable("flights", { delay, distance, time });  // optional
 *   new vega.View(vega.parse(spec)).runAsync();
 */
import { PreaggBuildInfo, definePwAggregate, definePwFilter, Runtime } from "./transforms";
import { ColumnTable } from "./table";
import { WorkerFactory, WorkerPool, browserWorkerFactory, defaultThreads, nodeWorkerFactory } from "./pool";
import type { AggregateStats } from "./aggregate";
import { GpuBackend } from "./gpu";
import { defineOperators, recordExpressionSource } from "./runtime/operators";
import { installWorkerLibrary } from "./runtime/derived";
import { FarmStats, installFarm } from "./runtime/farm";
import { defineDense, recordEncoderSource } from "./runtime/dense";

export { runAggregate, resolveBin, SUPPORTED_OPS } from "./aggregate";
export type { PreaggBuildInfo } from "./transforms";
export type { AggregateParams, AggregateStats, BinParam, PredicateParam, Scratch } from "./aggregate";
export { ColumnTable } from "./table";
export { WorkerPool, Priority, browserWorkerFactory, nodeWorkerFactory, inlineWorkerFactory, defaultThreads } from "./pool";
export { generateKernelSource, bucketOf } from "./kernel";
export { buildPreagg, answerPreagg, buildConfig } from "./preagg";
export { runFilter, FilterState } from "./filter";
export { GpuBackend, gpuEligible } from "./gpu";

export interface ParawebOptions {
  /** Worker count; defaults to the number of logical cores. */
  threads?: number;
  /** Override worker creation (defaults: Web Workers in browsers, worker_threads in Node). */
  workerFactory?: WorkerFactory;
  /**
   * Answer brush moves from exact pre-aggregated cubes (count only).
   * Can be overridden per transform with the `preagg` parameter. Default false.
   */
  preaggregate?: boolean;
  /** Called when a pre-aggregated cube has been built. */
  onPreaggBuild?: (b: PreaggBuildInfo) => void;
  /** Called after every pwaggregate evaluation. */
  onStats?: (s: AggregateStats & { ms: number; name?: string }) => void;
  /**
   * Run eligible pwaggregate scans (count only, range filters, bin and
   * group-by keys) on the GPU with WebGPU; others stay on the workers.
   * Await handle.ready before the first evaluation. Default false.
   */
  gpu?: boolean;
  /**
   * Replace Vega's own operators (filter, formula, bin, aggregate, extent,
   * collect, relay) with parallel forms, so that unchanged specifications
   * run on ParaWeb. Default true; terminate() restores Vega's operators.
   */
  operators?: boolean;
  /** Data sets with fewer rows stay on Vega's operators. Default 10000. */
  minRows?: number;
  /** Called when a parallel operator falls back to Vega's implementation. */
  onFallback?: (type: string, reason: string) => void;
  /**
   * Evaluate independent operators of a pulse concurrently (Farm), so that
   * the views of a dashboard are computed at the same time. Default true.
   */
  farm?: boolean;
  /** Called after every evaluation with the Farm loop. */
  onFarmStats?: (s: FarmStats) => void;
  /**
   * Symbol marks over at least this many rows are encoded and drawn in the
   * workers (dense marks; see runtime/dense.ts); false keeps Vega's items
   * for every mark. Default 20000. Needs `operators`.
   */
  denseMarks?: number | false;
}

export interface ParawebHandle {
  readonly pool: WorkerPool;
  /** Resolves when optional backends (GPU) are initialised. */
  readonly ready: Promise<void>;
  /** True once the GPU backend is in use. */
  readonly gpu: boolean;
  /** False when the page has no SharedArrayBuffer (not cross-origin isolated) and Vega runs unchanged. */
  readonly active?: boolean;
  registerTable(name: string, columns: Record<string, ArrayLike<any>> | ColumnTable): ColumnTable;
  unregisterTable(name: string): void;
  terminate(): void;
}

function isNode(): boolean {
  const p = (globalThis as any).process;
  return !!(p && p.versions && p.versions.node) && typeof (globalThis as any).window === "undefined";
}

export function registerParaweb(vega: any, options: ParawebOptions = {}): ParawebHandle {
  if (typeof SharedArrayBuffer === "undefined") {
    // Without cross-origin isolation there is no shared memory: leave Vega as it is, so the
    // page runs on stock Vega instead of failing.
    console.warn(
      "paraweb-vega: SharedArrayBuffer is unavailable, so Vega runs unchanged; serve the page with " +
      "Cross-Origin-Opener-Policy: same-origin and Cross-Origin-Embedder-Policy: require-corp to run it in parallel.",
    );
    const none = (): never => { throw new Error("paraweb-vega is inactive (no SharedArrayBuffer)"); };
    return {
      get pool() { return none(); }, ready: Promise.resolve(), gpu: false, active: false,
      registerTable: none, unregisterTable() {}, terminate() {},
    } as ParawebHandle;
  }
  let pool: WorkerPool | null = null;
  const tables = new Map<string, ColumnTable>();

  const getPool = () => {
    if (!pool) {
      const factory = options.workerFactory ?? (isNode() ? nodeWorkerFactory() : browserWorkerFactory());
      pool = new WorkerPool(options.threads ?? defaultThreads(), factory);
      installWorkerLibrary(pool, vega.version);
    }
    return pool;
  };

  let gpu: GpuBackend | null = null;
  const ready = options.gpu
    ? GpuBackend.create().then(g => { gpu = g; }, err => { console.warn("paraweb-vega: WebGPU unavailable, using workers:", err && err.message || err); })
    : Promise.resolve();

  const rt: Runtime = {
    pool: getPool,
    gpu: () => gpu,
    table: name => tables.get(name),
    preagg: options.preaggregate ?? false,
    onBuild: options.onPreaggBuild,
    onStats: options.onStats,
  };

  vega.transforms["pwaggregate"] = definePwAggregate(vega, rt);
  vega.transforms["pwfilter"] = definePwFilter(vega, rt);

  let restore: (() => void) | null = null;
  if (options.operators ?? true) {
    const unpatch = recordExpressionSource(vega);
    const { originals, replaced } = defineOperators(vega, rt, {
      minRows: options.minRows ?? 10000, onFallback: options.onFallback,
    });
    Object.assign(vega.transforms, replaced);
    restore = () => { Object.assign(vega.transforms, originals); unpatch(); };
    const denseMin = options.denseMarks ?? 20000;
    if (denseMin !== false) {
      const unrecord = recordEncoderSource(vega);
      const dense = defineDense(vega, rt, { minRows: denseMin, onFallback: options.onFallback });
      Object.assign(vega.transforms, dense.replaced);
      const prev = restore;
      restore = () => { Object.assign(vega.transforms, dense.originals); dense.restore(); unrecord(); prev(); };
    }
  }
  // ParaVega's evaluation loop (always: it also orders nested evaluations, see farm.ts); the
  // farm option turns the concurrent evaluation of independent operators on or off.
  {
    const unfarm = installFarm(vega, options.onFarmStats, options.farm ?? true);
    const prev = restore;
    restore = () => { if (prev) prev(); unfarm(); };
  }

  return {
    get pool() { return getPool(); },
    ready,
    get gpu() { return gpu !== null; },
    registerTable(name, columns) {
      const t = columns instanceof ColumnTable ? columns : ColumnTable.fromColumns(columns);
      const old = tables.get(name);
      if (old && old !== t) old.dispose(pool);
      tables.set(name, t);
      return t;
    },
    unregisterTable(name) {
      const old = tables.get(name);
      if (old) old.dispose(pool);
      tables.delete(name);
    },
    terminate() {
      if (restore) { restore(); restore = null; }
      if (pool) pool.terminate();
      pool = null;
      if (gpu) gpu.destroy();
      gpu = null;
    },
  };
}
