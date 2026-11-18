/**
 * Relations: the columnar form in which ParaVega's operators pass data to
 * each other.
 *
 * A relation describes the output of an operator without creating tuples:
 * a base table (the tuples of a data set, as resident shared columns), a
 * conjunction of predicates (from filter), and derived fields (from formula
 * and bin). Operators that consume relations (aggregate, extent, filter,
 * ...) compile the whole chain into one kernel, so a chain such as
 * filter -> bin -> aggregate runs as one pass over the resident columns,
 * which is ParaWeb's Pipeline pattern with fused stages. Tuples are created
 * only where an operator outside ParaVega, such as a mark, reads the data
 * (see Materializer).
 */
import { ColumnTable, ExprColumn } from "../table";
import { EPSILON } from "../kernel";
import { ExprInfo, emit, libraryPrelude } from "./expr";
import { WorkerPool } from "../pool";
import { FilterState } from "../filter";
import { filter as pwFilter, map as pwMap } from "paraweb-js/resident";
import { lib as workerLib } from "./workerlib-core";

/** Thrown when a relation cannot be compiled; the operator then falls back. */
export class Unsupported extends Error {}

export interface Base {
  /** Tuples of the data set; row i of the table is tuples[i]. */
  tuples: any[];
  table: ColumnTable;
  id: number;
  /**
   * The array the tuples came from (a Vega pulse source or a collect's
   * value). Vega's stream operators pass their input's source on unchanged,
   * with any properties set on it (such as the root of a tree), so the
   * materialized output of a relation carries this array as its source.
   */
  source: any[];
}

export interface Pred {
  info: ExprInfo;
  /** Values of the signals and parameters the expression reads. */
  P: Record<string, any>;
  /** Set when the predicate is a range test on a numeric field without missing values. */
  range?: { field: string; value: [number, number] | null };
}

interface DerivedBase {
  name: string;
  /** Derived fields visible to this one when it was defined. */
  env: Map<string, Derived>;
}

export type Derived =
  | DerivedBase & { kind: "expr"; info: ExprInfo; P: Record<string, any>; fn: (t: any, _: any) => any }
  | DerivedBase & { kind: "bin"; field: string; part: 0 | 1; start: number; stop: number; step: number;
      /** Vega's bin accessor, for evaluation on the main thread. */
      fn: (t: any) => any }
  | DerivedBase & { kind: "time"; field: string; part: 0 | 1; units: string[]; step: number; utc: boolean;
      /** Vega's timeunit floor and interval offset, for evaluation on the main thread. */
      floor: (v: any) => Date; offset: (d: Date, step: number) => Date }
  /** Values computed for every row into a resident column (joinaggregate, window). */
  | DerivedBase & { kind: "col"; col: { key: string; view: Float64Array; tagKey: string; tag: Uint8Array;
      /** Bumped when the column is rewritten in place. */
      version: number } }
  /** A value per distinct value of another field (lookup): table[code], code from the field's dictionary. */
  | DerivedBase & { kind: "map"; field: string; table: any[]; dict: { key: string; view: Int32Array };
      /** Unique per table contents (changes when the table changes). */
      version: number };

/** Value of a derived field for tuple t (row i), with Vega's own functions (main thread). */
export function evalDerived(d: Derived, t: any, i: number): any {
  if (d.kind === "col") { const g = d.col.tag[i]; return g === 0 ? d.col.view[i] : g === 1 ? null : undefined; }
  if (d.kind === "map") return d.table[d.dict.view[i]];
  if (d.kind === "expr") return d.fn(t, d.P);
  if (d.kind === "bin") {
    const v = d.fn(t);
    return d.part === 0 ? v : v == null ? null : d.start + d.step * (1 + (v - d.start) / d.step);
  }
  const v = t[d.field];
  if (v == null) return null;
  const a = d.floor(v);
  return d.part === 0 ? a : d.offset(a, d.step);
}

/**
 * Value of derived field d at row i, read as the kernels read it: a field
 * that d's expression (or bin, time unit) reads is the derived field of that
 * name visible when d was defined (d.env), otherwise the base field, with the
 * values it had before transforms overwrote it (ColumnTable.preserveField).
 * Vega's own functions evaluate it on the main thread.
 */
export function evalDerivedRow(table: ColumnTable, d: Derived, i: number): any {
  if (d.kind === "col" || d.kind === "map") return evalDerived(d, null, i);
  const read = (f: string): any => {
    const e = d.env.get(f);
    return e ? evalDerivedRow(table, e, i) : table.value(f, i);
  };
  const datum = new Proxy({}, { get: (_t, f) => (typeof f === "string" ? read(f) : undefined) });
  return evalDerived(d, datum, i);
}

/**
 * Main-thread evaluation of the derived fields of a relation on tuple t: when
 * no derived field overwrites a field of the input tuples, the tuple holds the
 * base values and the earlier derived fields, written in definition order, so
 * Vega's functions can read it directly; otherwise every field is resolved as
 * the kernels resolve it (evalDerivedRow).
 */
export function mainEvaluator(rel: Relation): (d: Derived, t: any, i: number) => any {
  for (const name of rel.derived.keys()) {
    if (rel.base.table.isPreserved(name)) return (d, _t, i) => evalDerivedRow(rel.base.table, d, i);
  }
  return evalDerived;
}

export interface Relation {
  base: Base;
  preds: Pred[];
  /** Derived fields in definition order. */
  derived: Map<string, Derived>;
  /** Output tuples are derived copies of the base tuples (Vega's relay with derive). */
  derive: boolean;
  /** Changes whenever the rows or values of the relation may change. */
  sig: string;
  /** Comparator of an upstream sorted collect (a window without sort follows its order). */
  orderCmp?: any;
  /**
   * Number of predicates that applied at the nearest upstream collect, if
   * there is one: in Vega, a pulse's source is that collect's value (its
   * rows at that point), otherwise the array the base came from.
   */
  collectAt?: number;
}

/**
 * Called where a transform defines derived field `name` on `rel`: when the
 * name is not yet a derived field, it may overwrite a field of the input
 * tuples, so the base keeps that field's values (ColumnTable.preserveField).
 */
export function preserveBase(rel: Relation, name: string): void {
  if (!rel.derived.has(name)) rel.base.table.preserveField(name);
}

let baseCounter = 0;

export function makeBase(tuples: any[], source: any[] = tuples): Base {
  return { tuples, table: ColumnTable.fromTuples(tuples), id: ++baseCounter, source };
}

export function baseRelation(base: Base): Relation {
  return { base, preds: [], derived: new Map(), derive: false, sig: "b" + base.id };
}

function hash(s: string): string {
  let h1 = 0x811c9dc5, h2 = 0x12345;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619);
    h2 = Math.imul(h2 ^ c, 2246822519) + 0x9e3779b9;
  }
  return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36) + s.length.toString(36);
}

export function predSig(p: Pred): string {
  return p.info.code + "|" + JSON.stringify(p.P);
}

export function derivedSig(d: Derived): string {
  if (d.kind === "expr") return `${d.name}=${d.info.code}|${JSON.stringify(d.P)}`;
  if (d.kind === "bin") return `${d.name}=bin(${d.field},${d.part},${d.start},${d.stop},${d.step})`;
  if (d.kind === "col") return `${d.name}=col(${d.col.key}#${d.col.version})`;
  if (d.kind === "map") return `${d.name}=map(${d.field},${d.dict.key}#${d.version})`;
  return `${d.name}=time(${d.field},${d.part},${d.units.join(",")},${d.step},${d.utc})`;
}

export function relationSig(r: Omit<Relation, "sig">): string {
  return hash(["b" + r.base.id, r.derive ? "d" : "", ...r.preds.map(predSig), ...[...r.derived.values()].map(derivedSig)].join("\n"));
}

function literal(v: any): string {
  if (v === undefined) return "undefined";
  if (v instanceof Date) return `new Date(${+v})`;
  if (typeof v === "number") return Object.is(v, -0) ? "-0" : String(v);
  return JSON.stringify(v);
}

/** Values that can be passed to a worker unchanged. */
export function cloneable(v: any, depth = 0): boolean {
  if (v == null || typeof v === "number" || typeof v === "string" || typeof v === "boolean") return true;
  if (v instanceof Date) return true;
  if (typeof v !== "object" || depth > 4) return false;
  if (Array.isArray(v)) return v.every(x => cloneable(x, depth + 1));
  if (Object.getPrototypeOf(v) !== Object.prototype) return false;
  return Object.values(v).every(x => cloneable(x, depth + 1));
}

/**
 * Compiles field reads and expressions of a relation into kernel source.
 * Columns are numbered in the order they are first read.
 */
export class RowCode {
  readonly cols: string[] = [];
  private colIdx = new Map<string, number>();
  private lines: string[] = [];
  private fns = new Set<string>();
  readonly P: Record<string, any> = {};
  private bins = new Map<Derived, number>();
  private times = new Map<string, number>();

  constructor(readonly rel: Relation, readonly pool: WorkerPool,
    /** Use an existing slot numbering (shared with another kernel generator). */
    private slotFn?: (key: string, type: "f64" | "i32" | "u8", buffer: SharedArrayBuffer) => number) {}

  /** Buffer and type of every column slot, for running the same code on the main thread. */
  readonly buffers: { buffer: SharedArrayBuffer; type: "f64" | "i32" | "u8" }[] = [];

  slot(key: string, type: "f64" | "i32" | "u8", buffer: SharedArrayBuffer): number {
    if (this.slotFn) return this.slotFn(key, type, buffer);
    let s = this.colIdx.get(key);
    if (s === undefined) {
      s = this.cols.length;
      this.cols.push(key);
      this.buffers.push({ buffer, type });
      this.colIdx.set(key, s);
      this.pool.ensureColumn(key, type, buffer);
    }
    return s;
  }

  /** Main-thread views of the column slots. */
  views(): ArrayLike<number>[] {
    return this.buffers.map(b => (b.type === "f64" ? new Float64Array(b.buffer) : b.type === "i32" ? new Int32Array(b.buffer) : new Uint8Array(b.buffer)));
  }

  private declared = new Set<string>();
  private declare(name: string, src: string) {
    if (this.declared.has(name)) return;
    this.declared.add(name);
    this.lines.push(`const ${name} = ${src};`);
  }

  private baseField(name: string): string {
    const c: ExprColumn | null = this.rel.base.table.exprColumn(name);
    if (!c) throw new Unsupported(`field ${name}`);
    const s = this.slot(c.key, c.kind === "dict" ? "i32" : "f64", c.view.buffer as SharedArrayBuffer);
    this.declare(`w${s}`, `cols[${s}]`);
    if (c.kind === "date") {
      const t = this.slot(c.tagKey, "u8", c.tag.buffer as SharedArrayBuffer);
      this.declare(`w${t}`, `cols[${t}]`);
      return `(w${t}[i] === 0 ? new Date(w${s}[i]) : w${t}[i] === 1 ? null : undefined)`;
    }
    if (c.kind === "num") {
      if (!c.tag) return `w${s}[i]`;
      const t = this.slot(c.tagKey!, "u8", c.tag.buffer as SharedArrayBuffer);
      this.declare(`w${t}`, `cols[${t}]`);
      return `(w${t}[i] === 0 ? w${s}[i] : w${t}[i] === 1 ? null : undefined)`;
    }
    this.declare(`W${s}`, `[${c.values.map(literal).join(",")}]`);
    return `W${s}[w${s}[i]]`;
  }

  /** Source that reads `name` at row i, as seen by an expression with derived fields `env`. */
  field(name: string, env: Map<string, Derived> = this.rel.derived): string {
    const d = env.get(name);
    if (!d) return this.baseField(name);
    if (d.kind === "expr") return "(" + this.expr(d.info, d.P, d.env) + ")";
    if (d.kind === "col") {
      const s = this.slot(d.col.key, "f64", d.col.view.buffer as SharedArrayBuffer);
      const t = this.slot(d.col.tagKey, "u8", d.col.tag.buffer as SharedArrayBuffer);
      this.declare(`w${s}`, `cols[${s}]`);
      this.declare(`w${t}`, `cols[${t}]`);
      return `(w${t}[i] === 0 ? w${s}[i] : w${t}[i] === 1 ? null : undefined)`;
    }
    if (d.kind === "map") {
      const s = this.slot(d.dict.key, "i32", d.dict.view.buffer as SharedArrayBuffer);
      this.declare(`w${s}`, `cols[${s}]`);
      const t = `MT${d.version}`;
      this.declare(t, `[${d.table.map(literal).join(",")}]`);
      return `${t}[w${s}[i]]`;
    }
    if (d.kind === "time") {
      const tk = JSON.stringify([d.units, d.step, d.utc]);
      let k = this.times.get(tk);
      if (k === undefined) {
        k = this.times.size;
        this.times.set(tk, k);
        const key = `#tu${k}`;
        this.P[key] = { units: d.units, step: d.step, utc: d.utc };
        // Vega's own timeunit functions (vega-time), installed in every worker.
        this.lines.push(
          `const tu${k} = globalThis.__pwvt.timeunit(P[${JSON.stringify(key)}].units, P[${JSON.stringify(key)}].step, P[${JSON.stringify(key)}].utc);`,
          `function tu0_${k}(v) { return v == null ? null : tu${k}.floor(v); }`,
          `function tu1_${k}(v) { return v == null ? null : tu${k}.offset(tu${k}.floor(v), ${d.step}); }`,
        );
      }
      return `tu${d.part}_${k}(${this.field(d.field, d.env)})`;
    }
    let b = this.bins.get(d);
    if (b === undefined) {
      b = this.bins.size;
      this.bins.set(d, b);
      const key = `#bin${b}`;
      this.P[key] = { start: d.start, stop: d.stop, step: d.step };
      // Vega's Bin accessor (vega-transforms/src/Bin.js), with the same constants.
      this.lines.push(
        `const bk${b} = P[${JSON.stringify(key)}];`,
        `function bin0_${b}(x) { let v = x == null || x === '' ? null : +x; const s = bk${b}.start, e = bk${b}.stop, t = bk${b}.step;` +
        ` return v == null ? null : v < s ? -Infinity : v > e ? Infinity : (v = Math.max(s, Math.min(v, e - t)), s + t * Math.floor(${EPSILON} + (v - s) / t)); }`,
        `function bin1_${b}(x) { const v = bin0_${b}(x); const s = bk${b}.start, t = bk${b}.step; return v == null ? null : s + t * (1 + (v - s) / t); }`,
      );
    }
    return `bin${d.part}_${b}(${this.field(d.field, d.env)})`;
  }

  expr(info: ExprInfo, P: Record<string, any>, env: Map<string, Derived> = this.rel.derived): string {
    if (info.unsupported) throw new Unsupported(info.unsupported);
    for (const k of info.params) {
      if (k in this.P && JSON.stringify(this.P[k]) !== JSON.stringify(P[k])) throw new Unsupported("parameter " + k);
      this.P[k] = P[k];
    }
    info.fns.forEach(f => this.fns.add(f));
    return emit(info, f => this.field(f, env));
  }

  /** Declarations to put before the row loop; reads parameters from args.P. */
  prelude(): string {
    return ["const P = args.P;", libraryPrelude(this.fns), ...this.lines].join("\n");
  }
}

/** Conjunction of the relation's predicates as a kernel condition (or "true"). */
export function predicateCode(rc: RowCode, preds: Pred[]): string {
  return preds.length ? preds.map(p => `(${rc.expr(p.info, p.P)})`).join(" && ") : "true";
}

export function kernelKey(prefix: string, ...parts: string[]): string {
  return prefix + hash(parts.join("\u0000"));
}

// ---------------------------------------------------------------------------
// Materialization
// ---------------------------------------------------------------------------

export interface Changes {
  add: any[];
  rem: any[];
  mod: any[];
  /** Fields written to the tuples. */
  fields: string[];
  /** The tuples of the relation after the change, created on demand. */
  source: () => any[];
}

/** Below this many rows, derived fields are computed on the main thread with Vega's own functions. */
const MAIN_THREAD_ROWS = 1 << 15;

const T_NUM = 0, T_NULL = 1, T_UNDEF = 2, T_TRUE = 3, T_FALSE = 4, T_OTHER = 5;

/**
 * Turns successive versions of a relation into Vega changesets: the rows
 * that entered or left the relation, and the rows whose derived fields
 * changed. The selection is kept in a FilterState, so each update runs
 * ParaWeb's Filter with change detection over the resident columns.
 */
export class Materializer {
  private base: Base | null = null;
  private derive = false;
  private state: FilterState | null = null;
  private lut: any[] | null = null;
  private written = "";

  constructor(private vega: any) {}

  tuple(i: number): any {
    const b = this.base!;
    if (!this.lut) return b.tuples[i];
    let d = this.lut[i];
    if (!d) {
      // Vega's derive(): a new tuple with a copy of the source's fields.
      const t = b.tuples[i];
      d = this.vega.ingest({});
      for (const k in t) d[k] = t[k];
      this.lut[i] = d;
    }
    return d;
  }

  private selectedRows(): Int32Array {
    const m = this.state!.mask;
    const out = new Int32Array(this.state!.selected);
    let w = 0;
    for (let i = 0; i < this.state!.n; i++) if (m[i]) out[w++] = i;
    return out;
  }

  /** Row ids of the current output, in a shared array (for kernels). */
  selectedShared(): Int32Array {
    const m = this.state!.mask;
    const out = new Int32Array(new SharedArrayBuffer(4 * Math.max(1, this.state!.selected)));
    let w = 0;
    for (let i = 0; i < this.state!.n; i++) if (m[i]) out[w++] = i;
    return out.subarray(0, w);
  }

  /** Forget the previous output (for instance when the operator falls back to Vega). */
  reset() {
    this.base = null; this.state = null; this.lut = null; this.written = "";
  }

  async update(rel: Relation, pool: WorkerPool): Promise<Changes> {
    const add: any[] = [], rem: any[] = [], mod: any[] = [];
    if (this.base !== rel.base || this.derive !== rel.derive) {
      if (this.base && this.state) for (const i of this.selectedRows()) rem.push(this.tuple(i));
      this.base = rel.base;
      this.derive = rel.derive;
      this.lut = rel.derive ? new Array(rel.base.tuples.length) : null;
      this.state = new FilterState(rel.base.tuples.length);
      this.written = "";
    }
    const state = this.state!;
    const n = state.n;

    // Selection: ParaWeb Filter with change detection.
    const rc = new RowCode(rel, pool);
    const cond = predicateCode(rc, rel.preds);
    const prelude = rc.prelude();
    const delta = n === 0 ? { add: new Int32Array(0), rem: new Int32Array(0) } : await pwFilter(
      { key: kernelKey("pv:sel:", prelude, cond), prelude, cond }, state,
      { pool, cols: rc.cols, args: { P: rc.P } });
    for (const i of delta.rem) rem.push(this.tuple(i));

    // Derived fields: all selected rows when their definitions changed, else the added rows.
    const derived = [...rel.derived.values()];
    const dsig = derived.map(derivedSig).join("\n");
    let rows: Int32Array;
    const rewrite = dsig !== this.written && derived.length > 0;
    if (rewrite) rows = this.selectedRows();
    else rows = delta.add;
    if (derived.length && rows.length) await this.writeDerived(rel, pool, derived, rows);
    this.written = dsig;
    for (const i of delta.add) add.push(this.tuple(i));
    if (rewrite) {
      const added = new Set<number>(delta.add);
      for (const i of rows) if (!added.has(i)) mod.push(this.tuple(i));
    }
    // A new base can hold the same tuple objects as the previous one (an upstream operator that
    // keeps its tuples, such as an aggregate whose groups stay). Such a tuple is modified, not
    // removed and added: Vega's DataJoin would mark its item as exiting after updating it.
    if (rem.length && add.length) {
      const removed = new Set(rem);
      const both = new Set(add.filter(t => removed.has(t)));
      if (both.size) {
        const inMod = new Set(mod);
        for (const t of both) if (!inMod.has(t)) mod.push(t);
        let w = 0;
        for (const t of add) if (!both.has(t)) add[w++] = t;
        add.length = w;
        w = 0;
        for (const t of rem) if (!both.has(t)) rem[w++] = t;
        rem.length = w;
      }
    }
    let src: any[] | null = null;
    return {
      add, rem, mod, fields: derived.map(d => d.name),
      source: () => src || (src = Array.from(this.selectedRows(), i => this.tuple(i))),
    };
  }

  private async writeDerived(rel: Relation, pool: WorkerPool, derived: Derived[], rows: Int32Array) {
    const evalMain = mainEvaluator(rel);
    if (rows.length < MAIN_THREAD_ROWS) {
      for (const i of rows) { const t = this.tuple(i); for (const d of derived) t[d.name] = evalMain(d, t, i); }
      return;
    }
    // Workers compute every derived field into a Float64 value and a type tag (ParaWeb Map).
    const m = rows.length;
    const idx = new Int32Array(new SharedArrayBuffer(4 * m));
    idx.set(rows);
    const outs = derived.map(() => ({
      v: new Float64Array(new SharedArrayBuffer(8 * m)),
      t: new Uint8Array(new SharedArrayBuffer(Math.max(1, m))),
    }));
    let rc: RowCode | null = new RowCode(rel, pool);
    let body: string[] = [];
    try {
      derived.forEach((d, j) => {
        const src = rc!.field(d.name, new Map([...d.env, [d.name, d]]));
        body.push(`{ const r = ${src}; const o = bufs[${2 * j}], g = bufs[${2 * j + 1}];` +
          ` if (typeof r === 'number') { o[j] = r; g[j] = ${T_NUM}; } else if (r === null) g[j] = ${T_NULL};` +
          ` else if (r === undefined) g[j] = ${T_UNDEF}; else if (r === true) g[j] = ${T_TRUE};` +
          ` else if (r === false) g[j] = ${T_FALSE}; else g[j] = ${T_OTHER}; }`);
      });
    } catch (e) {
      if (!(e instanceof Unsupported)) throw e;
      rc = null;
    }
    if (!rc) {
      for (const i of rows) { const t = this.tuple(i); for (const d of derived) t[d.name] = evalMain(d, t, i); }
      return;
    }
    const prelude = rc.prelude();
    const src = `${prelude}\nconst rowIds = bufs[${2 * derived.length}];\n` +
      `for (let j = start; j < end; j++) { const i = rowIds[j];\n${body.join("\n")}\n}`;
    const bufs: { buffer: SharedArrayBuffer; type: "f64" | "u8" | "i32" }[] = outs.flatMap(o => [
      { buffer: o.v.buffer as SharedArrayBuffer, type: "f64" as const },
      { buffer: o.t.buffer as SharedArrayBuffer, type: "u8" as const },
    ]);
    bufs.push({ buffer: idx.buffer as SharedArrayBuffer, type: "i32" as const });
    await pwMap({ key: kernelKey("pv:der:", src), src }, { pool, n: m, cols: rc.cols, bufs, args: { P: rc.P } });
    for (let j = 0; j < m; j++) {
      const t = this.tuple(rows[j]);
      for (let k = 0; k < derived.length; k++) {
        const g = outs[k].t[j];
        const d = derived[k];
        t[d.name] = g === T_NUM ? outs[k].v[j] : g === T_NULL ? null : g === T_UNDEF ? undefined
          : g === T_TRUE ? true : g === T_FALSE ? false : evalMain(d, t, rows[j]);
      }
    }
  }
}

/**
 * The tuples of a relation, computed synchronously on the calling thread
 * from the same kernel source (for reads such as view.data of a data set
 * whose tuples were never created). Derived tuples are new copies on every
 * call.
 */
export function materializeSync(rel: Relation, pool: WorkerPool, vega: any): any[] {
  if (!(globalThis as any).__pwvt) (globalThis as any).__pwvt = workerLib;
  const rc = new RowCode(rel, pool);
  const cond = predicateCode(rc, rel.preds);
  const prelude = rc.prelude();
  const fn = new Function("cols", "args", "n", `${prelude}\nconst out = [];\nfor (let i = 0; i < n; i++) if (${cond}) out.push(i);\nreturn out;`);
  const cols = rc.views();
  const rows: number[] = fn(cols, { P: rc.P }, rel.base.tuples.length);
  const derived = [...rel.derived.values()];
  const evalMain = mainEvaluator(rel);
  const out = rows.map(i => {
    let t = rel.base.tuples[i];
    if (rel.derive) {
      const d = vega.ingest({});
      for (const k in t) d[k] = t[k];
      t = d;
    }
    for (const d of derived) t[d.name] = evalMain(d, t, i);
    return t;
  });
  if (rel.orderCmp) {
    // The order of an upstream sorted collect, stable as Vega's (ties in row order).
    const pos = new Map<any, number>();
    out.forEach((t, j) => pos.set(t, j));
    out.sort((a, b) => rel.orderCmp(a, b) || pos.get(a)! - pos.get(b)!);
  }
  return out;
}

/** Row ids that satisfy the relation's predicates, in a shared array (ParaWeb Filter). */
export async function selectRows(rel: Relation, pool: WorkerPool): Promise<Int32Array> {
  const n = rel.base.tuples.length;
  if (!rel.preds.length) {
    const all = new Int32Array(new SharedArrayBuffer(4 * Math.max(1, n)));
    for (let i = 0; i < n; i++) all[i] = i;
    return all.subarray(0, n);
  }
  const state = new FilterState(n);
  const rc = new RowCode(rel, pool);
  const cond = predicateCode(rc, rel.preds);
  const prelude = rc.prelude();
  const d = await pwFilter({ key: kernelKey("pv:sel:", prelude, cond), prelude, cond }, state, { pool, cols: rc.cols, args: { P: rc.P } });
  const out = new Int32Array(new SharedArrayBuffer(4 * Math.max(1, d.add.length)));
  out.set(d.add);
  return out.subarray(0, d.add.length);
}
