/**
 * Columnar, SharedArrayBuffer-backed view of a dataset.
 *
 * Columns are built lazily, only for fields a request touches, and cached.
 * Numeric columns use Vega's toNumber coercion (null and '' become missing,
 * stored as NaN). Group-by fields are dictionary encoded into Int32 codes;
 * the last code is reserved for null/undefined.
 */
import { Priority, PriorityLevel, WorkerPool } from "./pool";
import { residentCountingSort } from "paraweb-js/resident";
import { reduce as pwReduce } from "paraweb-js/resident";

/** Range kernel for the extent (ParaWeb Reduce, kernel form); NaN fails both comparisons. */
const EXTENT_KERNEL = { key: "pv:extent", src: "const c = cols[0]; let lo = Infinity, hi = -Infinity;\nfor (let i = start; i < end; i++) { const v = c[i]; if (v < lo) lo = v; if (v > hi) hi = v; }\nreturn [lo, hi];" };
const extentOf = (a: [number, number], b: [number, number]): [number, number] => [Math.min(a[0], b[0]), Math.max(a[1], b[1])];

export interface F64Column {
  key: string;
  view: Float64Array;
  extent?: [number, number];
}

export interface DictColumn {
  key: string;
  view: Int32Array;
  /** code -> value; values[card - 1] is null. */
  values: any[];
  codes: Map<any, number>;
  card: number;
}

/**
 * Row ids grouped by fine bucket of one numeric field (a counting sort).
 * Rows of bucket b are perm[offsets[b] .. offsets[b + 1]); bucket R holds
 * missing values. Independent of any predicate, so it is built once per
 * (field, R) and reused across brush sessions.
 */
export interface BucketIndex {
  field: string;
  R: number;
  lo: number;
  hi: number;
  scale: number;
  perm: Int32Array;
  offsets: Int32Array;
  buildMs: number;
}

type Getter = (field: string) => (i: number) => any;

/**
 * A field as kernels read it in a compiled Vega expression, with the same
 * value as datum[field] in Vega:
 *  - "num": numbers in a Float64 column; when some rows hold null or
 *    undefined, a Uint8 tag column marks them (0 number, 1 null, 2 undefined);
 *  - "dict": any other primitive values (strings, booleans, dates, mixed),
 *    as Int32 codes into `values`, which kernels embed as a literal.
 */
export type ExprColumn =
  /** Dates (and null/undefined) as epoch milliseconds; kernels read new Date(ms). */
  | { kind: "date"; key: string; view: Float64Array; tagKey: string; tag: Uint8Array }
  | { kind: "num"; key: string; view: Float64Array; tagKey?: string; tag?: Uint8Array;
      /** Some number is NaN (Vega bins it as NaN, not as null). */
      hasNaN: boolean }
  | { kind: "dict"; key: string; view: Int32Array; values: any[] };

/** Largest dictionary that kernels embed as a literal. */
export const MAX_EXPR_DICT = 1 << 16;

let tableCounter = 0;

function sharedF64(n: number): Float64Array {
  return new Float64Array(new SharedArrayBuffer(Float64Array.BYTES_PER_ELEMENT * n));
}

function sharedI32(n: number): Int32Array {
  return new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * n));
}

export class ColumnTable {
  readonly id: string;
  readonly length: number;
  private getter: Getter;
  private raw: Record<string, ArrayLike<any>> | null;
  private f64 = new Map<string, F64Column>();
  private dict = new Map<string, DictColumn>();
  private exprCols = new Map<string, ExprColumn | null>();
  private extentPending = new Map<string, Promise<[number, number]>>();
  private bucketIndexes = new Map<string, Promise<BucketIndex>>();

  private constructor(length: number, getter: Getter, raw: Record<string, ArrayLike<any>> | null) {
    this.id = "t" + (++tableCounter);
    this.length = length;
    this.getter = getter;
    this.raw = raw;
  }

  /** Row-oriented input, as found in a Vega pulse. */
  static fromTuples(tuples: any[]): ColumnTable {
    const preserved = new Map<string, any[]>();
    const t = new ColumnTable(tuples.length, field => {
      const p = preserved.get(field);
      return p ? i => p[i] : i => tuples[i][field];
    }, null);
    const checked = new Set<string>();
    t.preserveField = field => {
      if (checked.has(field)) return;
      checked.add(field);
      // Snapshot only fields the tuples have; a new field has no original value to keep.
      let present = false;
      for (let i = 0; i < tuples.length && !present; i++) present = tuples[i][field] !== undefined;
      if (present) preserved.set(field, tuples.map(r => r[field]));
    };
    t.isPreserved = field => preserved.has(field);
    return t;
  }

  /**
   * Keeps the current values of a field of the tuples (tuple tables only).
   * Vega's formula and other transforms write their output fields into the
   * input tuples in place; when a derived field overwrites an input field,
   * every read of the input field (columns, kernels, main thread) must still
   * see the value it had before, as Vega's own operators do when they run in
   * order. Called before the first write of such a field.
   */
  preserveField: (field: string) => void = () => {};

  /** True when the original values of `field` are kept (it was overwritten in the tuples). */
  isPreserved: (field: string) => boolean = () => false;

  /** Column-oriented input; Float64Arrays over a SharedArrayBuffer are used without copying. */
  static fromColumns(columns: Record<string, ArrayLike<any>>): ColumnTable {
    const names = Object.keys(columns);
    const length = names.length ? columns[names[0]].length : 0;
    for (const n of names) {
      if (columns[n].length !== length) {
        throw new Error(`column ${n} has length ${columns[n].length}, expected ${length}`);
      }
    }
    return new ColumnTable(length, field => {
      const c = columns[field];
      if (!c) throw new Error(`unknown column: ${field}`);
      return i => c[i];
    }, columns);
  }

  numeric(field: string): F64Column {
    let col = this.f64.get(field);
    if (col) return col;
    const raw = this.raw && this.raw[field];
    let view: Float64Array;
    if (raw instanceof Float64Array && raw.buffer instanceof SharedArrayBuffer) {
      view = raw;
    } else if (raw && ArrayBuffer.isView(raw)) {
      view = sharedF64(this.length);
      view.set(raw as any);
    } else {
      view = sharedF64(this.length);
      const get = this.getter(field);
      for (let i = 0; i < this.length; i++) {
        const v = get(i);
        view[i] = v == null || v === "" ? NaN : +v;
      }
    }
    col = { key: `${this.id}:f64:${field}`, view };
    this.f64.set(field, col);
    return col;
  }

  /**
   * The field as a compiled expression reads it (see ExprColumn), or null
   * when its values cannot be represented exactly (objects, or more than
   * MAX_EXPR_DICT distinct non-numeric values).
   */
  exprColumn(field: string): ExprColumn | null {
    if (this.exprCols.has(field)) return this.exprCols.get(field)!;
    const col = this.buildExprColumn(field);
    this.exprCols.set(field, col);
    return col;
  }

  private buildExprColumn(field: string): ExprColumn | null {
    const raw = this.raw && this.raw[field];
    const nanIn = (v: Float64Array) => { for (let i = 0; i < v.length; i++) if (v[i] !== v[i]) return true; return false; };
    if (raw && ArrayBuffer.isView(raw) && !(raw instanceof BigInt64Array) && !(raw instanceof BigUint64Array)) {
      // Registered columns: NaN stands for a missing value, as in ColumnTable.numeric.
      const c = this.numeric(field);
      if (nanIn(c.view)) {
        const tag = new Uint8Array(new SharedArrayBuffer(Math.max(1, c.view.length)));
        for (let i = 0; i < c.view.length; i++) if (c.view[i] !== c.view[i]) tag[i] = 1;
        return { kind: "num", key: c.key, view: c.view, tag, tagKey: c.key + ":tag", hasNaN: false };
      }
      return { kind: "num", key: c.key, view: c.view, hasNaN: false };
    }
    const get = this.getter(field);
    const n = this.length;
    let numeric = true, missing = false;
    for (let i = 0; i < n; i++) {
      const v = get(i);
      if (typeof v === "number") continue;
      if (v == null) { missing = true; continue; }
      numeric = false; break;
    }
    if (numeric && !missing) {
      const c = this.numeric(field);
      return { kind: "num", key: c.key, view: c.view, hasNaN: nanIn(c.view) };
    }
    if (numeric) {
      const view = sharedF64(n);
      const tag = new Uint8Array(new SharedArrayBuffer(Math.max(1, n)));
      let hasNaN = false;
      for (let i = 0; i < n; i++) {
        const v = get(i);
        if (typeof v === "number") { view[i] = v; if (v !== v) hasNaN = true; }
        else { view[i] = NaN; tag[i] = v === null ? 1 : 2; }
      }
      const key = `${this.id}:xnum:${field}`;
      return { kind: "num", key, view, tag, tagKey: key + ":tag", hasNaN };
    }
    let dates0 = true;
    for (let i = 0; i < n; i++) {
      const v = get(i);
      if (v != null && !(v instanceof Date)) { dates0 = false; break; }
    }
    if (dates0) {
      const view = sharedF64(n);
      const tag = new Uint8Array(new SharedArrayBuffer(Math.max(1, n)));
      for (let i = 0; i < n; i++) {
        const v = get(i);
        if (v instanceof Date) view[i] = +v;
        else { view[i] = NaN; tag[i] = v === null ? 1 : 2; }
      }
      const key = `${this.id}:xdate:${field}`;
      return { kind: "date", key, view, tag, tagKey: key + ":tag" };
    }
    const codes = new Map<any, number>();
    const values: any[] = [];
    const dates = new Map<number, number>();
    const view = sharedI32(n);
    for (let i = 0; i < n; i++) {
      const v = get(i);
      let c: number | undefined;
      if (v instanceof Date) {
        const t = +v;
        c = dates.get(t);
        if (c === undefined) { c = values.length; dates.set(t, c); values.push(new Date(t)); }
      } else {
        if (v !== null && typeof v === "object") return null;
        if (typeof v === "function" || typeof v === "symbol" || typeof v === "bigint") return null;
        c = codes.get(v);
        if (c === undefined) { c = values.length; codes.set(v, c); values.push(v); }
      }
      if (values.length > MAX_EXPR_DICT) return null;
      view[i] = c;
    }
    return { kind: "dict", key: `${this.id}:xdict:${field}`, view, values };
  }

  dictionary(field: string): DictColumn {
    let col = this.dict.get(field);
    if (col) return col;
    const get = this.getter(field);
    const codes = new Map<any, number>();
    const values: any[] = [];
    const view = sharedI32(this.length);
    let sawNull = false;
    const NULL = -1;
    // As Vega's group keys (the string of the value): null and undefined are different groups,
    // and equal dates are one group whose value is the first Date seen (looked up by time).
    for (let i = 0; i < this.length; i++) {
      const v = get(i);
      if (v === null) { view[i] = NULL; sawNull = true; continue; }
      const k = v instanceof Date ? +v : v;
      let c = codes.get(k);
      if (c === undefined) {
        c = values.length;
        codes.set(k, c);
        values.push(v);
      }
      view[i] = c;
    }
    const nullCode = values.length;
    if (sawNull) {
      for (let i = 0; i < this.length; i++) if (view[i] === NULL) view[i] = nullCode;
    }
    values.push(null);
    col = { key: `${this.id}:i32:${field}`, view, values, codes, card: values.length };
    this.dict.set(field, col);
    return col;
  }

  /** Min/max of a numeric field, computed in parallel and cached. */
  extent(field: string, pool: WorkerPool): Promise<[number, number]> {
    const col = this.numeric(field);
    if (col.extent) return Promise.resolve(col.extent);
    let p = this.extentPending.get(field);
    if (p) return p;
    pool.ensureColumn(col.key, "f64", col.view.buffer as SharedArrayBuffer);
    p = (pwReduce(EXTENT_KERNEL, { pool, n: this.length, cols: [col.key], combine: extentOf, identity: [Infinity, -Infinity] as [number, number] }) as Promise<[number, number]>).then(([lo, hi]) => {
      col.extent = [lo, hi];
      this.extentPending.delete(field);
      return col.extent;
    });
    this.extentPending.set(field, p);
    return p;
  }

  /** Column names of a table registered from columns (empty for tuple tables). */
  fieldNames(): string[] {
    return this.raw ? Object.keys(this.raw) : [];
  }

  /** Raw value of `field` in row i (as given at registration, not coerced). */
  value(field: string, i: number): any {
    return this.getter(field)(i);
  }

  /** Main-thread view of a column by its key (for boundary scans). */
  viewByKey(key: string): Float64Array | Int32Array {
    for (const c of this.f64.values()) if (c.key === key) return c.view;
    for (const c of this.dict.values()) if (c.key === key) return c.view;
    for (const c of this.exprCols.values()) {
      if (!c) continue;
      if (c.key === key) return c.view as any;
      if (c.kind !== "dict" && c.tagKey === key) return c.tag as any;
    }
    throw new Error(`unknown column key: ${key}`);
  }

  /**
   * Parallel counting sort of row ids by bucket of `field`:
   * per-worker bucket histograms (Map), exclusive prefix sums over
   * (bucket, worker) on the main thread (Scan), then each worker writes its
   * row ids at its offsets (Scatter).
   */
  bucketIndex(
    field: string, R: number, pool: WorkerPool,
    priority: PriorityLevel = Priority.High, chunkRows = 0,
  ): Promise<BucketIndex> {
    const cacheKey = `${field}:${R}`;
    let p = this.bucketIndexes.get(cacheKey);
    if (p) return p;
    p = (async () => {
      const t0 = performance.now();
      const col = this.numeric(field);
      const [lo, ext1] = await this.extent(field, pool);
      const hi = ext1 > lo ? ext1 : lo + 1;
      const scale = R / (hi - lo);
      const n = this.length;
      pool.ensureColumn(col.key, "f64", col.view.buffer as SharedArrayBuffer);
      const { perm, offsets } = await residentCountingSort(pool, col.key, n, { lo, hi, scale, R }, { priority, chunkRows });
      return { field, R, lo, hi, scale, perm, offsets, buildMs: performance.now() - t0 };
    })();
    this.bucketIndexes.set(cacheKey, p);
    return p;
  }

  columnKeys(): string[] {
    const keys = [...this.f64.values(), ...this.dict.values()].map(c => c.key);
    for (const c of this.exprCols.values()) {
      if (!c) continue;
      keys.push(c.key);
      if (c.kind !== "dict" && c.tagKey) keys.push(c.tagKey);
    }
    return [...new Set(keys)];
  }

  /** Release worker-side references; call when the table is replaced. */
  dispose(pool: WorkerPool | null) {
    if (pool) pool.dropColumns(this.columnKeys());
    this.f64.clear();
    this.dict.clear();
    this.exprCols.clear();
    this.bucketIndexes.clear();
  }
}
