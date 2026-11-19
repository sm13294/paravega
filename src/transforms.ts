/**
 * Vega transform definitions backed by the ParaWeb worker pool.
 *
 *   { "type": "pwaggregate",
 *     "table": "flights",                       // optional: registered columnar table
 *     "filter": [{ "field": "delay", "range": { "signal": "brushDelay" } }],
 *     "bins":   [{ "field": "distance", "maxbins": 40, "as": ["bin0", "bin1"] }],
 *     "groupby": ["carrier"],
 *     "ops": ["count", "mean"], "fields": [null, "delay"], "as": ["n", "avg"] }
 *
 * Without `table`, the transform reads the tuples of its input pulse and
 * converts the referenced fields to shared columns once per data change.
 * With `table`, it reads a table registered through registerTable() and
 * Vega never holds the raw rows.
 *
 * Vega awaits a transform that returns a Promise, so the main thread stays
 * free while the workers compute.
 */
import { AggregateParams, AggregateStats, Scratch, SUPPORTED_OPS, runAggregate } from "./aggregate";
import {
  PreaggState, activeField, answerPreagg, buildPreagg, filterSnapshot, otherSignature, preaggEligible,
} from "./preagg";
import { ColumnTable } from "./table";
import { FilterState, runFilter } from "./filter";
import { WorkerPool } from "./pool";
import type { GpuBackend } from "./gpu";

export interface PreaggBuildInfo {
  name?: string;
  field: string;
  R: number;
  /** Total cube build time, including the bucket index if it was not cached. */
  buildMs: number;
  /** Time of the bucket index build (cached per field afterwards). */
  bucketIndexMs: number;
}

export interface Runtime {
  pool(): WorkerPool;
  table(name: string): ColumnTable | undefined;
  /** Default for the per-transform `preagg` parameter. */
  preagg: boolean;
  onBuild?: (b: PreaggBuildInfo) => void;
  onStats?: (s: AggregateStats & { ms: number; name?: string }) => void;
  /** WebGPU backend, when enabled and ready. */
  gpu?: () => GpuBackend | null;
  /** Run float sums (density estimates) on the GPU in 32 bits; results then differ in the last digits. */
  gpuApprox?: boolean;
}

const BIN_PARAMS = [
  { name: "field", type: "string", required: true },
  { name: "extent", type: "number", array: true, length: 2 },
  { name: "maxbins", type: "number" },
  { name: "step", type: "number" },
  { name: "steps", type: "number", array: true },
  { name: "minstep", type: "number" },
  { name: "nice", type: "boolean" },
  { name: "anchor", type: "number" },
  { name: "base", type: "number" },
  { name: "divide", type: "number", array: true },
  { name: "span", type: "number" },
  { name: "as", type: "string", array: true, length: 2 },
];

const FILTER_PARAMS = [
  { name: "field", type: "string", required: true },
  { name: "range", type: "number", array: true, length: 2 },
  { name: "oneOf", type: "string", array: true },
];

/** Strip Vega's Params bookkeeping, keeping the user-visible keys. */
function plain(obj: any, keys: string[]): any {
  if (obj == null) return obj;
  const out: any = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}


/**
 * Aggregation state of one operator: the scan time estimate and the
 * pre-aggregation index for the brush being moved. Shared by pwaggregate
 * and the parallel form of Vega's own aggregate operator.
 */
export class AggregateEngine {
  scratch = {} as Scratch;
  private prevFilter: Map<string, string> | null = null;
  private pre: PreaggState | null = null;
  private preBuild: { field: string; sig: string; promise: Promise<PreaggState | null> } | null = null;
  private preScratch = {} as Scratch;
  private preTable: ColumnTable | null = null;
  /** Moving average of this view's scan time (ms). */
  scanMs = 0;

  constructor(private rt: Runtime) {}

  reset() { this.pre = null; this.preBuild = null; this.prevFilter = null; }

  run(table: ColumnTable, params: AggregateParams, opts: { name?: string; preagg?: boolean; resolution?: number },
    stats: AggregateStats): Promise<any[]> {
    const rt = this.rt;
    const pool = rt.pool();
    const name = opts.name;
    const t0 = performance.now();
    const usePre = (opts.preagg ?? rt.preagg) && preaggEligible(params);
    const snap = filterSnapshot(params);
    const field = usePre ? activeField(this.prevFilter, snap, params) : null;
    this.prevFilter = snap;
    if (table !== this.preTable) { this.pre = null; this.preBuild = null; this.preTable = table; }
    const gpu = rt.gpu ? rt.gpu() : null;
    const index = (state: PreaggState) => answerPreagg(state, pool, table, params).then(ans => {
      Object.assign(stats, {
        rows: table.length, threads: 0, groups: ans.rows.length, keys: state.Kv,
        mergeMode: "single", path: "index", boundaryRows: ans.boundaryRows,
      });
      return ans.rows;
    });
    const scan = () => runAggregate(pool, table, params, this.scratch, stats, gpu);

    let compute: Promise<any[]>;
    if (field) {
      const sig = otherSignature(params, field);
      const ready = this.pre && this.pre.field === field && this.pre.sig === sig ? this.pre : null;
      const building = this.preBuild && this.preBuild.field === field && this.preBuild.sig === sig
        ? this.preBuild.promise : null;
      if (ready) {
        compute = index(ready);
      } else if (building && this.scanMs > 0 && pool.lowPendingMs() <= this.scanMs) {
        // The rest of the build is expected to take less than a scan:
        // waiting for it and answering from the cube is faster.
        compute = building.then(state => (state ? index(state) : scan()));
      } else if (building) {
        // Build still running (at low priority): answer with a scan, which
        // the workers take ahead of the remaining build chunks.
        compute = scan();
      } else {
        // First move of a new brush: answer with a scan, build the cube behind it.
        compute = scan();
        const promise = buildPreagg(pool, table, params, field, this.preScratch, opts.resolution)
          .then(st => {
            this.pre = st;
            if (rt.onBuild) rt.onBuild({ name, field, R: st.R, buildMs: st.buildMs, bucketIndexMs: st.bidx.buildMs });
            return st;
          })
          .catch(err => { console.warn("paraweb-vega: pre-aggregation failed:", err); return null; });
        this.preBuild = { field, sig, promise };
      }
    } else {
      compute = scan();
    }
    return compute.then(rows => {
      if (stats.path === "scan" || stats.path === "gpu") {
        const ms = performance.now() - t0;
        this.scanMs = this.scanMs ? 0.7 * this.scanMs + 0.3 * ms : ms;
      }
      if (rt.onStats) rt.onStats({ ...stats, ms: performance.now() - t0, name });
      return rows;
    });
  }
}

export function definePwAggregate(vega: any, rt: Runtime): any {
  function PwAggregate(this: any, params: any) {
    vega.Transform.call(this, null, params);
    this._table = null as ColumnTable | null;
    this._tableSource = null as any;
    this._out = [] as any[];
    this._engine = new AggregateEngine(rt);
  }

  PwAggregate.Definition = {
    type: "PwAggregate",
    metadata: { generates: true, changes: true },
    params: [
      { name: "table", type: "string" },
      { name: "name", type: "string" },
      { name: "groupby", type: "string", array: true },
      { name: "bins", type: "param", array: true, params: [{ key: {}, params: BIN_PARAMS }] },
      { name: "ops", type: "enum", array: true, values: [...SUPPORTED_OPS] },
      { name: "fields", type: "string", array: true },
      { name: "as", type: "string", array: true },
      { name: "filter", type: "param", array: true, params: [{ key: {}, params: FILTER_PARAMS }] },
      { name: "preagg", type: "boolean" },
      { name: "preaggResolution", type: "number" },
    ],
  };

  vega.inherits(PwAggregate, vega.Transform, {
    transform(this: any, _: any, pulse: any) {
      const pool = rt.pool();

      // Resolve the input table synchronously: params are cleared once
      // this method returns.
      let table: ColumnTable;
      if (_.table) {
        const t = rt.table(_.table);
        if (!t) throw new Error(`pwaggregate: no table registered as "${_.table}"`);
        table = t;
      } else {
        if (!this._table || pulse.changed()) {
          const p = pulse.materialize(pulse.SOURCE);
          let src: any[] = p.source;
          if (!src) { src = []; pulse.visit(pulse.SOURCE, (t: any) => { src.push(t); }); }
          if (src !== this._tableSource || pulse.changed()) {
            if (this._table) this._table.dispose(pool);
            this._table = ColumnTable.fromTuples(src);
            this._tableSource = src;
            this._engine.reset();
          }
        }
        table = this._table;
      }

      const params: AggregateParams = {
        groupby: _.groupby,
        bins: (_.bins ?? []).map((b: any) => plain(b, BIN_PARAMS.map(p => p.name))),
        ops: _.ops,
        fields: _.fields,
        as: _.as,
        filter: (_.filter ?? []).map((f: any) => plain(f, FILTER_PARAMS.map(p => p.name))),
      };
      const name = _.name;
      const out = pulse.fork(pulse.NO_SOURCE | pulse.NO_FIELDS);
      const stats = {} as AggregateStats;
      const compute = this._engine.run(table, params, { name, preagg: _.preagg, resolution: _.preaggResolution }, stats);

      return compute.then((rows: any[]) => {
        out.rem = this._out;
        this._out = out.add = rows.map((r: any) => vega.ingest(r));
        if (rows.length) out.modifies(Object.keys(rows[0]));
        return out;
      });
    },
  });

  return PwAggregate;
}

/**
 *   { "type": "pwfilter",
 *     "table": "flights",                          // optional
 *     "filter": [{ "field": "delay", "range": { "signal": "brush" } }],
 *     "fields": ["delay", "distance"] }            // table mode: fields of output tuples
 *
 * Without `table`, outputs the matching input tuples (same objects), like
 * Vega's filter. With `table`, creates one tuple per selected row holding
 * `fields` (default: all columns) and keeps it while the row stays selected.
 * Only changed rows are added or removed on each update.
 */
export function definePwFilter(vega: any, rt: Runtime): any {
  function PwFilter(this: any, params: any) {
    vega.Transform.call(this, null, params);
    this._table = null as ColumnTable | null;
    this._src = null as any[] | null;
    this._state = null as FilterState | null;
    this._rows = new Map<number, any>();
  }

  PwFilter.Definition = {
    type: "PwFilter",
    metadata: { changes: true, generates: true },
    params: [
      { name: "table", type: "string" },
      { name: "name", type: "string" },
      { name: "filter", type: "param", array: true, params: [{ key: {}, params: FILTER_PARAMS }] },
      { name: "fields", type: "string", array: true },
    ],
  };

  vega.inherits(PwFilter, vega.Transform, {
    transform(this: any, _: any, pulse: any) {
      const pool = rt.pool();
      const out = pulse.fork(pulse.NO_FIELDS);
      let table: ColumnTable;
      let tuples: any[] | null = null;

      if (_.table) {
        const t = rt.table(_.table);
        if (!t) throw new Error(`pwfilter: no table registered as "${_.table}"`);
        if (t !== this._table) {
          for (const tup of this._rows.values()) out.rem.push(tup);
          this._rows.clear();
          this._table = t;
          this._state = new FilterState(t.length);
        }
        table = t;
      } else {
        if (!this._table || pulse.changed()) {
          // Data changed: drop the previous selection and start over.
          if (this._src && this._state) {
            const m = this._state.mask;
            for (let i = 0; i < this._src.length; i++) if (m[i]) out.rem.push(this._src[i]);
          }
          const p = pulse.materialize(pulse.SOURCE);
          let src: any[] = p.source;
          if (!src) { src = []; pulse.visit(pulse.SOURCE, (t: any) => { src.push(t); }); }
          if (this._table) this._table.dispose(pool);
          this._table = ColumnTable.fromTuples(src);
          this._src = src;
          this._state = new FilterState(src.length);
        }
        table = this._table;
        tuples = this._src;
      }

      const filter = (_.filter ?? []).map((f: any) => plain(f, FILTER_PARAMS.map(p => p.name)));
      const fields: string[] = _.fields && _.fields.length ? _.fields : table.fieldNames();
      const name = _.name;
      const state = this._state as FilterState;
      const t0 = performance.now();

      return runFilter(pool, table, filter, state).then(delta => {
        if (tuples) {
          for (const i of delta.add) out.add.push(tuples[i]);
          for (const i of delta.rem) out.rem.push(tuples[i]);
        } else {
          for (const i of delta.rem) {
            const tup = this._rows.get(i);
            if (tup) { out.rem.push(tup); this._rows.delete(i); }
          }
          for (const i of delta.add) {
            const row: any = {};
            for (const f of fields) row[f] = table.value(f, i);
            const tup = vega.ingest(row);
            this._rows.set(i, tup);
            out.add.push(tup);
          }
        }
        if (rt.onStats) {
          rt.onStats({
            rows: table.length, threads: delta.threads, groups: state.selected, keys: 0,
            mergeMode: "single", path: "scan", ms: performance.now() - t0, name,
            added: delta.add.length, removed: delta.rem.length,
          } as any);
        }
        return out;
      });
    },
  });

  return PwFilter;
}
