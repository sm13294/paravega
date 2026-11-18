/**
 * Derived fields as resident columns.
 *
 * A group-by or a measure on a field that a formula or timeunit computes
 * needs the field's value for every row before the aggregation kernel runs.
 * The values are computed in the workers into new resident columns:
 *  - numeric: Vega's toNumber of the value, as aggregate measures read it
 *    (ParaWeb Map);
 *  - dictionary: every worker encodes the distinct values of its range
 *    with local codes and returns them; the main thread merges them into
 *    one dictionary, and a second pass rewrites the local codes into global
 *    ones (ParaWeb Map, Reduce of the dictionaries, Map).
 * Columns are cached per base table and definition.
 */
import { DictColumn, F64Column } from "../table";
import { WorkerPool, Priority } from "../pool";
import { Relation, RowCode, Unsupported, derivedSig, kernelKey } from "./relation";
import { map as pwMap } from "paraweb-js/resident";
import { WORKER_LIBRARY, WORKER_LIBRARY_V5 } from "./workerlib.generated";

/**
 * Install the Vega library code for kernels (globalThis.__pwvt) in every
 * worker, before any other task; the library of Vega 5 when the view runs on
 * Vega 5 (vegaVersion "5.x"), otherwise that of Vega 6.
 */
export function installWorkerLibrary(pool: WorkerPool, vegaVersion = ""): void {
  const lib = String(vegaVersion).startsWith("5.") ? WORKER_LIBRARY_V5 : WORKER_LIBRARY;
  const src = `${lib}\nglobalThis.__pwvt = __pwlib.lib;\nreturn 0;`;
  for (let t = 0; t < pool.size; t++) {
    pool.run(t, { op: "kernel", key: "pv:lib", src, cols: [], bufs: [], args: {}, start: 0, end: 0 }, Priority.High)
      .catch(err => { if (!/terminated/.test(String(err && err.message))) console.warn("paraweb-vega: worker library failed to load:", err); });
  }
}

/** Largest dictionary of a derived group-by field. */
const MAX_DICT = 1 << 16;
/** Derived columns kept per base table. */
const MAX_CACHED = 16;

const caches = new WeakMap<object, Map<string, Promise<any>>>();

function cached<T>(rel: Relation, pool: WorkerPool, sig: string, make: () => Promise<T>, keys: (c: T) => string[]): Promise<T> {
  let m = caches.get(rel.base);
  if (!m) { m = new Map(); caches.set(rel.base, m); }
  let p = m.get(sig);
  if (p) { m.delete(sig); m.set(sig, p); return p; }
  p = make();
  m.set(sig, p);
  if (m.size > MAX_CACHED) {
    const [oldSig, old] = m.entries().next().value!;
    m.delete(oldSig);
    old.then((c: T) => pool.dropColumns(keys(c)), () => {});
  }
  p.catch(() => m!.delete(sig));
  return p;
}

/** Definition of a derived field, with the definitions it depends on. */
function fieldSig(rel: Relation, name: string): string {
  const d = rel.derived.get(name);
  if (!d) return name;
  const deps = d.kind === "expr" ? d.info.fields : d.kind === "col" ? [] : [d.field];
  if (d.kind === "map") return derivedSig(d);
  return derivedSig(d) + "{" + deps.map(f => fieldSig({ ...rel, derived: d.env }, f)).join(",") + "}";
}

let derivedCounter = 0;

/**
 * Vega's toNumber of a derived field, for every row of the base table.
 * `poison` is set when some value is valid for Vega's aggregates but not a
 * number (a string such as "n/a"): Vega adds it as NaN, this column skips it.
 */
export function derivedNumeric(rel: Relation, name: string, pool: WorkerPool): Promise<F64Column & { poison: boolean }> {
  const sig = "num:" + fieldSig(rel, name);
  return cached(rel, pool, sig, async () => {
    const n = rel.base.tuples.length;
    const view = new Float64Array(new SharedArrayBuffer(8 * Math.max(1, n)));
    const rc = new RowCode(rel, pool);
    const v = rc.field(name);
    const src = `${rc.prelude()}\nconst out = bufs[0];\nlet poison = 0;\nfor (let i = start; i < end; i++) { const r = ${v}; const x = r == null || r === '' ? NaN : +r; out[i] = x; if (x !== x && r != null && r === r && typeof r !== "number") poison = 1; }\nreturn poison;`;
    const flags = n ? (await pwMap({ key: kernelKey("pv:dnum:", src), src }, {
      pool, n, cols: rc.cols, bufs: [{ buffer: view.buffer as SharedArrayBuffer, type: "f64" }], args: { P: rc.P },
    })).flat() : [];
    const key = `${rel.base.table.id}:dnum${++derivedCounter}`;
    pool.ensureColumn(key, "f64", view.buffer as SharedArrayBuffer);
    return { key, view, poison: flags.some(f => f) };
  }, c => [c.key]);
}

/** Dictionary encoding of a derived field (codes into values; null and undefined are values too). */
export function derivedDictionary(rel: Relation, name: string, pool: WorkerPool): Promise<DictColumn> {
  const sig = "dict:" + fieldSig(rel, name);
  return cached(rel, pool, sig, async () => {
    const n = rel.base.tuples.length;
    const view = new Int32Array(new SharedArrayBuffer(4 * Math.max(1, n)));
    const rc = new RowCode(rel, pool);
    const v = rc.field(name);
    // Dates are keyed by time, as equal dates are one group in Vega's aggregate.
    const src = `${rc.prelude()}\nconst codes = bufs[0], D = new Map(), vals = [], L = ${MAX_DICT};
for (let i = start; i < end; i++) {
  const r = ${v};
  const k = r instanceof Date ? "\\u0001D" + (+r) : r;
  let c = D.get(k);
  if (c === undefined) {
    if (r !== null && typeof r === "object" && !(r instanceof Date)) return null;
    c = vals.length; if (c >= L) return null;
    D.set(k, c); vals.push(r);
  }
  codes[i] = c;
}
return vals;`;
    const parts = n ? (await pwMap({ key: kernelKey("pv:ddict:", src), src }, {
      pool, n, cols: rc.cols, bufs: [{ buffer: view.buffer as SharedArrayBuffer, type: "i32" }], args: { P: rc.P },
    })).map(c => c[0]) : [];
    if (parts.some(p => p === null)) throw new Unsupported("derived group-by field " + name + " (values)");
    const codes = new Map<any, number>();
    const values: any[] = [];
    const keyOf = (r: any) => (r instanceof Date ? "\u0001D" + +r : r);
    const remaps = parts.map((vals: any[]) => Int32Array.from(vals, r => {
      const k = keyOf(r);
      let c = codes.get(k);
      if (c === undefined) { c = values.length; codes.set(k, c); values.push(r); }
      return c;
    }));
    if (values.length > MAX_DICT) throw new Unsupported("derived group-by field " + name + " (cardinality)");
    if (parts.length > 1 || remaps.some(r => r.some((g, l) => g !== l))) {
      const remap = `const codes = bufs[0], m = args.remaps[args.t];\nfor (let i = start; i < end; i++) codes[i] = m[codes[i]];`;
      await pwMap({ key: "pv:remap", src: remap }, {
        pool, n, bufs: [{ buffer: view.buffer as SharedArrayBuffer, type: "i32" }], args: { remaps },
      });
    }
    const key = `${rel.base.table.id}:ddict${++derivedCounter}`;
    pool.ensureColumn(key, "i32", view.buffer as SharedArrayBuffer);
    // Dictionary lookups by value: dates by time, as in the kernel.
    return { key, view, values, codes, card: Math.max(1, values.length) };
  }, c => [c.key]);
}
