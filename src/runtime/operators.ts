/**
 * Parallel forms of Vega's own dataflow operators.
 *
 * registerParaweb() replaces Vega's operator types (filter, formula, bin,
 * aggregate, extent, collect, relay) with subclasses that run on ParaWeb, so
 * an unchanged Vega specification, or the output of the Vega-Lite compiler,
 * runs in parallel. Each subclass keeps Vega's implementation as its
 * fallback and uses it for small data, for expressions that cannot be
 * compiled, and for parameters it does not support.
 *
 * Operators pass relations (see relation.ts) to each other instead of
 * tuples. An operator whose targets are all parallel operators that read it
 * as their input creates no tuples at all ("lazy"); otherwise it
 * materializes its output as a Vega changeset. Sinks, such as aggregate and
 * extent, compile the relation of their input into one kernel.
 */
import { ExprInfo, analyze, conjuncts, matchRange } from "./expr";
import {
  Base, Changes, Derived, Materializer, Pred, Relation, RowCode, Unsupported,
  baseRelation, cloneable, kernelKey, makeBase, materializeSync, predicateCode, preserveBase, relationSig, selectRows,
} from "./relation";
import { AggregateEngine, Runtime } from "../transforms";
import { brushRanges, readsSelection, specializeSelections } from "./selection";
import { SortKey, sortRows } from "./sort";
const QUANTILE_OPS = new Set(["median", "q1", "q3"]);
import { MAX_SCAN_FRAME, WINDOW_AGG_OPS, WINDOW_RANK_OPS, WINDOW_VALUE_OPS, WindowOp, computeWindow } from "./window";
import {
  AggregateParams, AggregateStats, BinParam, SUPPORTED_OPS, emitRows, executePlan, planAggregate, resolveBin, runAggregate,
} from "../aggregate";
import { groupKeySource } from "../kernel";
import { map as pwMap } from "paraweb-js/resident";
import type { DictColumn } from "../table";
import { derivedDictionary, derivedNumeric } from "./derived";
import { lib as workerLib } from "./workerlib-core";
import { computeDensity } from "./density";

export interface OperatorOptions {
  /** Data sets with fewer rows stay on Vega's own operators. */
  minRows: number;
  /** Called when an operator falls back to Vega, with the reason. */
  onFallback?: (type: string, reason: string) => void;
}

/** Property set on expression functions by the patched codegen. */
export const CODE = "$pwcode";
/** Property set on comparators by the patched codegen: { paths, orders }. */
export const SORT = "$pwsort";

const infoCache = new WeakMap<object, ExprInfo>();
export function exprInfo(fn: any): ExprInfo | null {
  if (!fn || typeof fn[CODE] !== "string") return null;
  let info = infoCache.get(fn);
  if (!info) { info = analyze(fn[CODE]); infoCache.set(fn, info); }
  return info;
}

const conjCache = new WeakMap<object, { code: string; info: ExprInfo; range: ReturnType<typeof matchRange> }[]>();
function exprConjuncts(fn: any) {
  let c = conjCache.get(fn);
  if (!c) {
    c = conjuncts(fn[CODE]).map(code => ({ code, info: analyze(code), range: matchRange(code) }));
    conjCache.set(fn, c);
  }
  return c;
}

const codeInfo = new Map<string, ExprInfo>();
function analyzeCached(code: string): ExprInfo {
  let i = codeInfo.get(code);
  if (!i) {
    if (codeInfo.size > 4096) codeInfo.clear();
    i = analyze(code);
    codeInfo.set(code, i);
  }
  return i;
}

/** Expression that a filter or formula can run as a kernel (selection tests are specialized per evaluation). */
function compilable(fn: any): boolean {
  const info = exprInfo(fn);
  return !!info && (!info.unsupported || readsSelection(info.code));
}

/** Snapshot of the parameters an expression reads; throws when they cannot go to a worker. */
function params(info: ExprInfo, _: any, extra?: Record<string, any>): Record<string, any> {
  const P: Record<string, any> = {};
  for (const k of info.params) {
    const v = extra && k in extra ? extra[k] : _[k];
    if (!cloneable(v)) throw new Unsupported("parameter " + k);
    P[k] = v;
  }
  return P;
}

/** Name of a plain field accessor, or null (nested fields and expressions). */
function plainField(vega: any, f: any): string | null {
  if (!f) return null;
  const name = vega.accessorName(f);
  const fields = vega.accessorFields(f);
  if (!name || fields.length !== 1 || fields[0] !== name) return null;
  if (f[CODE] !== undefined) return null;
  return /[.[\]\\]/.test(name) ? null : name;
}

/**
 * A group-by accessor that reads one plain field, possibly under another
 * output name, such as the field("c", "key") of the aggregates that Vega's
 * parser creates for scale domains.
 */
function groupField(vega: any, f: any): { field: string; name: string } | null {
  const plain = plainField(vega, f);
  if (plain) return { field: plain, name: plain };
  if (!f || f[CODE] !== undefined) return null;
  const fields = vega.accessorFields(f), name = vega.accessorName(f);
  if (!name || fields.length !== 1 || /[.[\]\\]/.test(fields[0])) return null;
  const m = /^function[^{]*\{\s*return _\[("(?:[^"\\]|\\.)*")\];\s*\}$/.exec(String(f));
  return m && JSON.parse(m[1]) === fields[0] ? { field: fields[0], name } : null;
}

/** Key of the modified-flags cache of vega-dataflow's Parameters. */
const MOD_CACHE = "_:mod:_";
let joinCounter = 0;

/**
 * The operator's parameters with their modified flags as they are now.
 * Vega clears the flags when transform() returns, so a call of Vega's
 * transform after an await must see a snapshot.
 */
function keepModified(_: any): any {
  const s = Object.create(_);
  Object.defineProperty(s, MOD_CACHE, { value: _[MOD_CACHE], writable: true });
  return s;
}

interface StreamImpl {
  kind: "stream";
  /** Static check, from the operator's current parameter values. */
  consumes(op: any): boolean;
  next(op: any, _: any, rel: Relation): Relation;
  /** Materialize by passing the input changes to Vega's operator (collect). */
  viaVega?: boolean;
  /**
   * Asynchronous part of the operator: computes its value (extent), or
   * returns the output relation when it depends on a computation over the
   * input (joinaggregate, window).
   */
  effect?(op: any, _: any, rel: Relation, pulse: any): Promise<Relation | void> | void;
  /** The operator's value is its tuples, so readers of the value need them (collect, sieve). */
  valueIsTuples?: boolean;
}

interface SinkImpl {
  kind: "sink";
  consumes(op: any): boolean;
  run(op: any, _: any, rel: Relation, pulse: any): any;
}

type Impl = StreamImpl | SinkImpl;

export function defineOperators(vega: any, rt: Runtime, opts: OperatorOptions): Record<string, any> {
  const originals: Record<string, any> = {};
  const replaced: Record<string, any> = {};

  const isParallel = (op: any) => !!(op && op._pwParallel);

  /** Relation of the operator's input, or null when the input is small or not columnar. */
  function inputRelation(op: any, pulse: any): Relation | null {
    const src = op.source;
    if (isParallel(src)) {
      const r = src._pwRelation();
      if (r) return r;
      if (src._pwLazy) throw new Error("paraweb-vega: lazy operator without relation");
    }
    // A Vega operator upstream: its pulse's source is the input set only when it is a collect,
    // whose value is its source (other operators, such as filter or resolvefilter, pass their
    // input's source on and signal their set through added and removed tuples).
    const tuples = pulse.source;
    if (!Array.isArray(tuples) || tuples.length < opts.minRows || !src || src.value !== tuples) return null;
    if (op._pwBaseSrc !== tuples || pulse.changed()) {
      if (op._pwBase) op._pwBase.table.dispose(rt.pool());
      op._pwBase = makeBase(tuples.slice(), tuples);
      op._pwBaseSrc = tuples;
    }
    return baseRelation(op._pwBase);
  }

  /**
   * True when no target needs this operator's tuples: every target that
   * reads it as its pulse source is a parallel operator that takes a
   * relation, and other targets read only its value, which is not a set of
   * tuples (the bins of bin, the extent of extent).
   */
  function lazyTargets(op: any, valueIsTuples: boolean): boolean {
    for (const x of op.targets()) {
      const src = x.source;
      if (src === op) {
        if (!isParallel(x) || !x._pwConsumes()) return false;
      } else if (Array.isArray(src) && src.includes(op)) {
        return false;
      } else if (valueIsTuples) {
        return false;
      }
    }
    return true;
  }

  /** As Vega's collect: a tree root set on the original source travels with the arrays made from it. */
  function withRoot(arr: any[], rel: Relation): any[] {
    const root = rel.base.source && (rel.base.source as any).root;
    if (root && arr && arr !== rel.base.source) (arr as any).root = root;
    return arr;
  }

  /**
   * The pulse of a lazy operator: empty, but an operator that attaches later
   * in the same evaluation (such as a mark of a group sub-dataflow) reads its
   * source and added tuples, which are then created from the relation.
   */
  function lazyPulse(op: any, pulse: any, out: Relation) {
    const r = pulse.fork(pulse.NO_SOURCE | pulse.NO_FIELDS);
    let cache: any[] | null = null;
    const tuples = () => {
      if (!cache) { cache = withRoot(materializeSync(out, rt.pool(), vega), out); op._pwGiven = out; }
      return cache;
    };
    // Only within the evaluation that created the pulse: later evaluations copy the previous
    // pulse's source when they build pulses (Vega's singlePulse), which must not create tuples.
    const current = () => pulse.dataflow._clock === r.stamp;
    for (const f of ["source", "add"]) {
      Object.defineProperty(r, f, {
        configurable: true, enumerable: true,
        get: () => (!current() ? (f === "add" ? [] : null) : f === "add" ? tuples().slice() : tuples()),
        set: (v: any) => { Object.defineProperty(r, f, { value: v, writable: true, configurable: true, enumerable: true }); },
      });
    }
    return r;
  }

  /** Compile the predicates and derived fields of a relation (throws Unsupported if one cannot run as a kernel). */
  function checkRelation(rel: Relation) {
    const rc = new RowCode(rel, rt.pool());
    predicateCode(rc, rel.preds);
    for (const name of rel.derived.keys()) rc.field(name);
  }

  function changesetPulse(pulse: any, ch: { add: any[]; rem: any[]; mod: any[]; fields: string[] }, source?: any[]) {
    const p = pulse.fork(pulse.NO_FIELDS | (source ? pulse.NO_SOURCE : 0));
    p.add = ch.add; p.rem = ch.rem; p.mod = ch.mod;
    if (source) p.source = source;
    if (ch.fields.length) p.modifies(ch.fields);
    return p;
  }

  function define(type: string, impl: Impl) {
    const Orig = vega.transforms[type];
    if (!Orig) return;
    originals[type] = Orig;
    const fallbackTransform = Orig.prototype.transform;

    function P(this: any, params: any) {
      Orig.call(this, params);
      this._pwRel = null;
      this._pwLazy = false;
      this._pwFallback = false;
      this._pwOutMat = null;
      this._pwInMat = null;
      this._pwOut = [];
      this._pwLastSig = null;
    }
    P.Definition = Orig.Definition;

    vega.inherits(P, Orig, {
      _pwParallel: true,
      _pwConsumes(this: any) { return !this._pwFallback && impl.consumes(this); },
      _pwRelation(this: any) { return this._pwRel; },

      /** Run Vega's operator on the materialized input relation (sticky). */
      _pwVega(this: any, _: any, pulse: any, rel: Relation, reason: string): any {
        if (!this._pwFallback) {
          this._pwFallback = true;
          if (opts.onFallback) opts.onFallback(type, reason);
          // Vega's aggregate keeps its cells in its value; it must not find ParaVega's.
          if (type === "aggregate") this.value = null;
        }
        this._pwRel = null;
        this._pwLazy = false;
        const mat = this._pwInMat || (this._pwInMat = new Materializer(vega));
        const k = keepModified(_);
        return mat.update(rel, rt.pool()).then((ch: Changes) => {
          const p = changesetPulse(pulse, ch, withRoot(ch.source(), rel));
          return fallbackTransform.call(this, k, p);
        });
      },

      transform(this: any, _: any, pulse: any) {
        const rel = inputRelation(this, pulse);
        if (!rel) {
          if (this._pwRel || this._pwInMat) {
            // The input is no longer columnar (it became small): start Vega's operator afresh.
            this._pwRel = null; this._pwInMat = null;
          }
          return fallbackTransform.call(this, _, pulse);
        }
        if (this._pwFallback) return this._pwVega(_, pulse, rel, "");

        if (impl.kind === "sink") {
          try {
            return impl.run(this, _, rel, pulse);
          } catch (e) {
            if (!(e instanceof Unsupported)) throw e;
            return this._pwVega(_, pulse, rel, e.message);
          }
        }

        let out: Relation;
        try {
          out = impl.next(this, _, rel);
          // Every predicate and derived field must compile against the base table now: once the
          // operator has emitted a pulse, it can no longer hand its input to Vega's operator.
          checkRelation(out);
        } catch (e) {
          if (!(e instanceof Unsupported)) throw e;
          return this._pwVega(_, pulse, rel, e.message);
        }
        this._pwRel = out;
        this._pwLazy = lazyTargets(this, !!impl.viaVega || !!impl.valueIsTuples);
        if (impl.effect) {
          const lazy = this._pwLazy;
          const k = keepModified(_);
          return Promise.resolve(impl.effect(this, _, out, pulse)).then(r => {
            if (r) { out = r; this._pwRel = r; checkRelation(r); }
            return this._pwEmit(k, pulse, out, lazy);
          }).catch(e => {
            if (!(e instanceof Unsupported)) throw e;
            return this._pwVega(k, pulse, rel, e.message);
          });
        }
        const emitted = this._pwEmit(_, pulse, out, this._pwLazy);
        if (!emitted || typeof emitted.then !== "function") return emitted;
        const k2 = keepModified(_);
        return emitted.catch((e: any) => {
          if (!(e instanceof Unsupported)) throw e;
          return this._pwVega(k2, pulse, rel, e.message);
        });
      },

      _pwEmit(this: any, _: any, pulse: any, out: Relation, lazy: boolean) {
        if (lazy) {
          this._pwOutMat = null;
          this._pwGiven = null;
          return lazyPulse(this, pulse, out);
        }
        if ((impl as StreamImpl).viaVega) {
          // Collect: Vega keeps the list of tuples; feed it the changes of the relation.
          const mat = this._pwInMat || (this._pwInMat = new Materializer(vega));
          const k = keepModified(_);
          return mat.update(out, rt.pool()).then((ch: Changes) => fallbackTransform.call(this, k, changesetPulse(pulse, ch)));
        }
        const fresh = !this._pwOutMat;
        const mat = this._pwOutMat || (this._pwOutMat = new Materializer(vega));
        // Tuples handed out by an earlier lazy pulse (to an operator that attached later) are the
        // starting point, so that the rows that left them are removed.
        const given = fresh ? this._pwGiven : null;
        this._pwGiven = null;
        const primed = given ? mat.update(given, rt.pool()) : Promise.resolve();
        // As in Vega, the source is the value of the nearest upstream collect, or the array the base
        // came from (derived copies are new tuples, so they are their own source).
        return primed.then(() => mat.update(out, rt.pool())).then(async (ch: Changes) => {
          let source: any[];
          if (out.derive || out.collectAt === out.preds.length) source = ch.source();
          else if (out.collectAt === undefined) source = out.base.source;
          else {
            const sm: Materializer = this._pwSrcMat || (this._pwSrcMat = new Materializer(vega));
            source = (await sm.update({ ...out, preds: out.preds.slice(0, out.collectAt), derived: new Map() }, rt.pool())).source();
          }
          return changesetPulse(pulse, ch, withRoot(source, out));
        });
      },
    });
    replaced[type] = P;
  }

  /**
   * Sort keys of a Vega comparator over a relation: numeric and date fields
   * as they are, other fields by the rank of their distinct values under
   * Vega's ascending order (computed on the main thread, then mapped in the
   * workers).
   */
  async function sortKeys(rel: Relation, cmp: any): Promise<SortKey[]> {
    const info = cmp && cmp[SORT];
    if (!info) throw new Unsupported("comparator");
    const pool = rt.pool();
    const keys: SortKey[] = [];
    for (let i = 0; i < info.paths.length; i++) {
      const path: string | null = info.paths[i];
      const m = path && /^\[("(?:[^"\\]|\\.)*")\]$/.exec(path);
      if (!m) throw new Unsupported("sort field");
      const name = JSON.parse(m[1]);
      const order = (info.orders[i] < 0 ? -1 : 1) as 1 | -1;
      const d = rel.derived.get(name);
      if (d) {
        if (d.kind === "expr") throw new Unsupported("sort by an expression field");
        const c = await derivedNumeric(rel, name, pool);
        for (let j = 0; j < c.view.length; j++) if (c.view[j] !== c.view[j]) throw new Unsupported("sort field with missing values");
        keys.push({ key: c.key, view: c.view, order });
        continue;
      }
      const col = rel.base.table.exprColumn(name);
      if (!col) throw new Unsupported("sort field " + name);
      if (col.kind === "num" && !col.tag && !col.hasNaN) { keys.push({ key: col.key, view: col.view, order }); continue; }
      if (col.kind === "date" && col.tag.every(g => g === 0)) { keys.push({ key: col.key, view: col.view, order }); continue; }
      // Rank of every distinct value under Vega's ascending comparison.
      const dict = col.kind === "dict" ? col : null;
      if (!dict) throw new Unsupported("sort field with missing values");
      const asc = (u: any, v: any) => (u < v || u == null) && v != null ? -1 : (u > v || v == null) && u != null ? 1
        : ((v = v instanceof Date ? +v : v), (u = u instanceof Date ? +u : u)) !== u && v === v ? -1 : v !== v && u === u ? 1 : 0;
      const idx = dict.values.map((_v, j) => j).sort((a, b) => asc(dict.values[a], dict.values[b]));
      const rank = new Float64Array(dict.values.length);
      let r = 0;
      idx.forEach((j, q) => { if (q > 0 && asc(dict.values[idx[q - 1]], dict.values[j]) !== 0) r = q; rank[j] = r; });
      const n = rel.base.tuples.length;
      const view = new Float64Array(new SharedArrayBuffer(8 * Math.max(1, n)));
      const src = "const c = cols[0], out = bufs[0], rank = args.rank;\nfor (let i = start; i < end; i++) out[i] = rank[c[i]];";
      pool.ensureColumn(dict.key, "i32", dict.view.buffer as SharedArrayBuffer);
      if (n) await pwMap({ key: "pv:sort:rank", src }, { pool, n, cols: [dict.key], bufs: [{ buffer: view.buffer as SharedArrayBuffer, type: "f64" }], args: { rank: Array.from(rank) } });
      const key = `${rel.base.table.id}:rank:${name}:${++joinCounter}`;
      keys.push({ key, view, order });
    }
    return keys;
  }

  // ------------------------------------------------------------------ collect
  // The root collect of a data set holds its tuples; its relation is their base table.
  {
    const Orig = vega.transforms.collect;
    define("collect", {
      kind: "stream",
      viaVega: true,
      // A sorted collect takes a relation too, but always creates its tuples (see below).
      consumes: () => true,
      next: (_op, _, rel) => {
        if (_.sort) throw new Unsupported("sort");
        return { ...rel, collectAt: rel.preds.length };
      },
    });
    const P = replaced.collect;
    const t = P.prototype.transform;
    P.prototype.transform = function (this: any, _: any, pulse: any) {
      if (isParallel(this.source) && this.source._pwRelation() && _.sort && !this._pwFallback) {
        // Sorted collect: materialize the relation, sort its rows in parallel (Divide and Conquer).
        const rel: Relation = this.source._pwRelation();
        if (lazyTargets(this, true)) {
          // Only parallel operators read the sorted rows: pass the order on, sort where it is needed.
          this._pwRel = { ...rel, orderCmp: _.sort, collectAt: rel.preds.length };
          this._pwLazy = true;
          return pulse.fork(pulse.NO_SOURCE | pulse.NO_FIELDS);
        }
        let keys: Promise<SortKey[]>;
        try { keys = sortKeys(rel, _.sort); } catch (e) {
          if (!(e instanceof Unsupported)) throw e;
          return this._pwVega(_, pulse, rel, e.message);
        }
        const mat: Materializer = this._pwInMat || (this._pwInMat = new Materializer(vega));
        const k = keepModified(_);
        const pool = rt.pool();
        return Promise.all([keys, mat.update(rel, pool)]).then(async ([ks, ch]) => {
          const sorted = await sortRows(pool, mat.selectedShared(), ks);
          const ranks = ks.filter(x => x.key.includes(":rank:")).map(x => x.key);
          if (ranks.length) pool.dropColumns(ranks);
          const value = new Array(sorted.length);
          for (let j = 0; j < sorted.length; j++) value[j] = mat.tuple(sorted[j]);
          const out = changesetPulse(pulse, ch, value);
          this.value = value;
          this.modified(true);
          this._pwRel = { ...rel, orderCmp: _.sort };
          this._pwLazy = false;
          return out;
        }, e => {
          if (!(e instanceof Unsupported)) throw e;
          return this._pwVega(k, pulse, rel, e.message);
        });
      }
      if (isParallel(this.source) && this.source._pwRelation()) return t.call(this, _, pulse);
      // A root collect (or one after a Vega operator): Vega's collect, plus its tuples as a base.
      const r = Orig.prototype.transform.call(this, _, pulse);
      if (pulse.changed() || !this._pwBase || this._pwBaseSrc !== this.value) {
        this._pwStale = true;
      }
      this._pwRel = null;
      return r;
    };
    P.prototype._pwRelation = function (this: any) {
      if (this._pwRel) return this._pwRel;
      const tuples = this.value;
      if (!Array.isArray(tuples) || tuples.length < opts.minRows) return null;
      if (this._pwStale || !this._pwBase) {
        if (this._pwBase) this._pwBase.table.dispose(rt.pool());
        this._pwBase = makeBase(tuples.slice(), tuples);
        this._pwBaseSrc = tuples;
        this._pwStale = false;
      }
      return baseRelation(this._pwBase as Base);
    };
  }

  // ------------------------------------------------------------------ relay
  define("relay", {
    kind: "stream",
    consumes: () => true,
    next: (_op, _, rel) => {
      if (!_.derive || rel.derive) return rel;
      const r = { ...rel, derive: true };
      return { ...r, sig: relationSig(r) };
    },
  });

  // ------------------------------------------------------------------ filter (Filter)
  define("filter", {
    kind: "stream",
    consumes: op => !!op._argval && compilable(op._argval.expr),
    next: (_op, _, rel) => {
      const info = exprInfo(_.expr);
      if (!info) throw new Unsupported("expression source");
      if (info.unsupported && !readsSelection(info.code)) throw new Unsupported(info.unsupported);
      const preds: Pred[] = [...rel.preds];
      const numeric = (f: string) => {
        if (rel.derived.has(f)) return false;
        const col = rel.base.table.exprColumn(f);
        return !!col && col.kind === "num" && !col.tag;
      };
      for (const c of exprConjuncts(_.expr)) {
        if (readsSelection(c.code)) {
          // Vega-Lite selection: one interval as range predicates, anything else specialized.
          const br = brushRanges(c.code, _);
          if (br && br.every(b => numeric(b.field))) {
            for (const b of br) {
              const k = "#brush:" + b.field;
              preds.push({
                info: analyzeCached(`this.inrange(datum[${JSON.stringify(b.field)}],_[${JSON.stringify(k)}])`),
                P: { [k]: b.value }, range: { field: b.field, value: b.value },
              });
            }
            continue;
          }
          const sp = specializeSelections(c.code, _);
          if (!sp) throw new Unsupported("selection store");
          const si = analyzeCached(sp.code);
          if (si.unsupported) throw new Unsupported(si.unsupported);
          preds.push({ info: si, P: params(si, _, sp.extra) });
          continue;
        }
        if (c.info.unsupported) throw new Unsupported(c.info.unsupported);
        const P = params(c.info, _);
        const pred: Pred = { info: c.info, P };
        if (c.range && numeric(c.range.field)) {
          const v = P[c.range.param];
          if (!v) pred.range = { field: c.range.field, value: null };
          else if (Array.isArray(v) && typeof v[0] === "number" && typeof v[1] === "number" && v[0] <= v[1]) {
            pred.range = { field: c.range.field, value: [v[0], v[1]] };
          }
        }
        preds.push(pred);
      }
      const r = { ...rel, preds };
      return { ...r, sig: relationSig(r) };
    },
  });

  // ------------------------------------------------------------------ formula (Map)
  define("formula", {
    kind: "stream",
    consumes: op => {
      const info = op._argval && exprInfo(op._argval.expr);
      return !!info && !info.unsupported;
    },
    // (Selection tests in formulas are rare; they run on Vega.)
    next: (_op, _, rel) => {
      const info = exprInfo(_.expr);
      if (!info) throw new Unsupported("expression source");
      if (info.unsupported) throw new Unsupported(info.unsupported);
      if (_.initonly && info.params.length) throw new Unsupported("initonly");
      const d: Derived = { kind: "expr", name: _.as, env: rel.derived, info, P: params(info, _), fn: _.expr };
      const derived = new Map(rel.derived);
      preserveBase(rel, _.as);
      derived.delete(_.as);
      derived.set(_.as, d);
      const r = { ...rel, derived };
      return { ...r, sig: relationSig(r) };
    },
  });

  // ------------------------------------------------------------------ bin (Map)
  define("bin", {
    kind: "stream",
    consumes: op => !!(op._argval && plainField(vega, op._argval.field)),
    next: (op, _, rel) => {
      const field = plainField(vega, _.field);
      if (!field) throw new Unsupported("bin field");
      if (!_.extent || _.extent.length < 2) throw new Unsupported("bin extent");
      const f = originals.bin.prototype._bins.call(op, _);
      const rb = resolveBin(_ as BinParam, [+_.extent[0], +_.extent[1]]);
      const same = (a: number, b: number) => a === b || (a !== a && b !== b);
      if (!same(rb.start, f.start) || !same(rb.step, f.step)) throw new Unsupported("bin parameters");
      const as = _.as || ["bin0", "bin1"];
      const band = _.interval !== false;
      const derived = new Map(rel.derived);
      const parts: (0 | 1)[] = band ? [0, 1] : [0];
      for (const part of parts) {
        const d: Derived = {
          kind: "bin", name: as[part], env: rel.derived, field, part,
          start: rb.start, stop: rb.stop, step: rb.step, fn: f,
        };
        derived.delete(as[part]);
        preserveBase(rel, as[part]);
        derived.set(as[part], d);
      }
      const r = { ...rel, derived };
      return { ...r, sig: relationSig(r) };
    },
  });

  // ------------------------------------------------------------------ timeunit (Map)
  define("timeunit", {
    kind: "stream",
    consumes: op => !!(op._argval && op._argval.units && plainField(vega, op._argval.field)),
    next: (op, _, rel) => {
      const field = plainField(vega, _.field);
      if (!field) throw new Unsupported("timeunit field");
      if (!_.units) throw new Unsupported("timeunit without units");
      const utc = _.timezone === "utc";
      const step = _.step || 1;
      // Vega's floor (also the operator's value), and the same functions for the kernels.
      originals.timeunit.prototype._floor.call(op, _, null);
      const fn = workerLib.timeunit(_.units, step, utc);
      const as = _.as || ["unit0", "unit1"];
      const band = _.interval !== false;
      const derived = new Map(rel.derived);
      for (const part of (band ? [0, 1] : [0]) as (0 | 1)[]) {
        const d: Derived = { kind: "time", name: as[part], env: rel.derived, field, part, units: _.units, step, utc,
          floor: fn.floor, offset: fn.offset };
        derived.delete(as[part]);
        preserveBase(rel, as[part]);
        derived.set(as[part], d);
      }
      const r = { ...rel, derived };
      return { ...r, sig: relationSig(r) };
    },
  });

  /**
   * Translate a relation into the parameters of the fused aggregation
   * kernel: range predicates, compiled expression predicates, bins, group-by
   * fields and measures. Group-by fields and measures that a formula or
   * timeunit derives become resident columns first (see derived.ts).
   */
  async function aggregateParams(rel: Relation, groupby: string[], ops: string[], fields: (string | null)[], as: (string | null)[]): Promise<AggregateParams> {
    const pool = rt.pool();
    const table = rel.base.table;
    const filter = rel.preds.filter(p => p.range).map(p => ({ field: p.range!.field, range: p.range!.value }));
    const others = rel.preds.filter(p => !p.range);
    const bins: BinParam[] = [];
    const binOf = new Map<string, BinParam>();
    const group: string[] = [];
    const groupCols: Record<string, DictColumn> = {};
    const measureCols: Record<string, { key: string; view: Float64Array }> = {};
    for (const g of groupby) {
      const d = rel.derived.get(g);
      if (!d) {
        if (!table.exprColumn(g)) throw new Unsupported("group-by field " + g);
        group.push(g);
        continue;
      }
      if (d.kind === "bin") {
        let column: { key: string; view: Float64Array } | undefined;
        if (d.env.has(d.field)) {
          column = await derivedNumeric({ ...rel, derived: d.env }, d.field, pool);
        } else {
          const col = table.exprColumn(d.field);
          if (!col || col.kind !== "num") throw new Unsupported("bin of non-numeric field " + d.field);
          // The kernel bins NaN with null; Vega gives NaN its own bin.
          if (col.hasNaN) throw new Unsupported("bin of a field with NaN values");
        }
        if (column) for (let i = 0; i < column.view.length; i++) {
          if (column.view[i] !== column.view[i]) { column = undefined; break; }
        }
        if (d.env.has(d.field) && !column) {
          // A derived field with missing or NaN values: group by its dictionary instead.
          groupCols[g] = await derivedDictionary(rel, g, pool);
          group.push(g);
          continue;
        }
        const k = `${d.field}|${d.start}|${d.stop}|${d.step}|${column ? column.key : ""}`;
        let b = binOf.get(k);
        if (!b) {
          b = { field: d.field, resolved: { start: d.start, stop: d.stop, step: d.step }, as: [null as any, null], column };
          binOf.set(k, b);
          bins.push(b);
        }
        b.as![d.part] = g;
        continue;
      }
      groupCols[g] = await derivedDictionary(rel, g, pool);
      group.push(g);
    }
    for (const b of bins) if (!b.as![0]) throw new Unsupported("bin end without bin start");
    for (const f of fields) {
      if (f && rel.derived.has(f) && !measureCols[f]) {
        const c = await derivedNumeric(rel, f, pool);
        if (c.poison) throw new Unsupported("measure " + f + " with values that are not numbers");
        measureCols[f] = c;
      }
    }
    const params: AggregateParams = { groupby: group, bins, ops, fields, as, filter };
    if (Object.keys(groupCols).length) params.groupCols = groupCols;
    if (Object.keys(measureCols).length) params.measureCols = measureCols;
    if (others.length) {
      params.where = slot => {
        const rc = new RowCode(rel, pool, slot);
        const cond = predicateCode(rc, others);
        return { prelude: rc.prelude(), cond, P: rc.P };
      };
    }
    return params;
  }

  // ------------------------------------------------------------------ aggregate (MapReduce)
  define("aggregate", {
    kind: "sink",
    consumes: op => {
      const a = op._argval;
      if (!a || a.cross || a.drop === false || a.key) return false;
      if (vega.array(a.groupby).some((g: any) => !groupField(vega, g))) return false;
      if (vega.array(a.fields).some((f: any) => f && !plainField(vega, f))) return false;
      return (a.ops || ["count"]).every((o: string) => SUPPORTED_OPS.has(o) || QUANTILE_OPS.has(o));
    },
    run: (op, _, rel, pulse) => {
      if (_.cross || _.drop === false || _.key) throw new Unsupported("cross, drop or key");
      const gf = vega.array(_.groupby).map((g: any) => {
        const n = groupField(vega, g); if (!n) throw new Unsupported("group-by accessor"); return n;
      });
      const groupby: string[] = gf.map((g: { field: string }) => g.field);
      if (new Set(groupby).size !== groupby.length) throw new Unsupported("group-by field read twice");
      // Output names of renamed group-by fields.
      const renames = gf.filter((g: { field: string; name: string }) => g.name !== g.field);
      const ops: string[] = _.ops && _.ops.length ? _.ops : ["count"];
      const fields = vega.array(_.fields).map((f: any) => {
        if (!f) return null;
        const n = plainField(vega, f); if (!n) throw new Unsupported("field accessor"); return n;
      });
      for (const o of ops) if (!SUPPORTED_OPS.has(o) && !QUANTILE_OPS.has(o)) throw new Unsupported("op " + o);
      const as = (_.as || []).map((a: any) => a ?? null);
      const sig = rel.sig + "|" + JSON.stringify([groupby, ops, fields, as]);
      if (sig === op._pwLastSig) return pulse.StopPropagation;
      const engine: AggregateEngine = op._pwEngine || (op._pwEngine = new AggregateEngine(rt));
      const stats = {} as AggregateStats;
      const out = pulse.fork(pulse.NO_SOURCE | pulse.NO_FIELDS);
      const k = keepModified(_);
      let aparams: AggregateParams;
      return aggregateParams(rel, groupby, ops, fields, as).then(params => {
        op._pwLastSig = sig;
        aparams = params;
        if (ops.some(o => QUANTILE_OPS.has(o))) return aggregateWithQuantiles(op, rel, params).then(r => r.rows);
        return engine.run(rel.base.table, params, { name: _.name }, stats);
      }, e => {
        if (!(e instanceof Unsupported)) throw e;
        op.value = null; // Vega's aggregate starts with its own cells
        return op._pwVega(k, pulse, rel, e.message).then((p: any) => {
          // Vega's aggregate takes over: retract the groups emitted so far.
          if (op._pwOut.length && p && p.rem) { p.rem = p.rem.concat(op._pwOut); op._pwOut = []; }
          return { fallback: p };
        });
      }).then(async (rows: any) => {
        if (rows && rows.fallback) return rows.fallback;
        // As Vega's aggregate: a group that stays keeps its tuple (modified, so it keeps its place
        // downstream), groups that are now empty are removed, and new groups are added in the order
        // of their first row (Vega creates groups while it visits the rows in order).
        // Typed key of a group (JSON would write NaN, -Infinity and +Infinity bins as null).
        const keyOf = (r: any) => groupby.map(g => {
          const v = r[g];
          return v === null ? "N" : v === undefined ? "U" : v instanceof Date ? "d" + +v
            : typeof v === "number" ? "n" + (Object.is(v, -0) ? "-0" : String(v)) : typeof v + ":" + String(v);
        }).join("\u0000");
        const prev: Map<string, any> = op._pwGroups || new Map();
        const next = new Map<string, any>();
        const fresh: [string, any][] = [];
        out.mod = [];
        for (const r of rows) {
          const key = keyOf(r), t = prev.get(key);
          if (t) {
            for (const f in t) if (f !== "_vgsid_" && !(f in r)) delete t[f];
            Object.assign(t, r);
            out.mod.push(t);
            next.set(key, t);
          } else fresh.push([key, r]);
        }
        if (fresh.length > 1) {
          const first = await firstRows(rel, aparams, keyOf);
          fresh.sort((a, b) => (first.get(a[0]) ?? Infinity) - (first.get(b[0]) ?? Infinity));
        }
        out.add = fresh.map(([key, r]) => { const t = vega.ingest(r); next.set(key, t); return t; });
        out.rem = [...prev].filter(([key]) => !next.has(key)).map(([, t]) => t);
        op._pwGroups = next;
        op._pwOut = [...next.values()];
        // The value of Vega's aggregate is its map of cells by group key (String of the value, or
        // the values joined by "|"), each with its output tuple; facets read their parent tuple from it.
        const cells: Record<string, { tuple: any }> = Object.create(null);
        const outNames = gf.map((g: { name: string }) => g.name);
        for (const t of op._pwOut) {
          const key = outNames.length === 0 ? "" : outNames.length === 1 ? String(t[outNames[0]]) : outNames.map((n: string) => t[n]).join("|");
          cells[key] = { tuple: t };
        }
        op.value = cells;
        if (renames.length) for (const t of [...out.add, ...out.mod]) {
          for (const g of renames) { t[g.name] = t[g.field]; if (!as.includes(g.field)) delete t[g.field]; }
        }
        if (rows.length) out.modifies(Object.keys(out.add[0] || out.mod[0]));
        else out.modifies([...gf.map((g: { name: string }) => g.name), ...ops.map((o, i) => as[i] || o)]);
        return out;
      });
    },
  });

  /**
   * Aggregate with median, q1 or q3 (vega-statistics' quartiles of the
   * valid values of every group): the other ops run as usual; every selected
   * row gets its group key (Map); the valid rows are sorted by group key and
   * value (parallel sample sort); and the quartiles of every group are read
   * from its run of the sorted rows, with Vega's (R-7) interpolation.
   */
  async function aggregateWithQuantiles(op: any, rel: Relation, params: AggregateParams): Promise<{ rows: Record<string, any>[]; keys: number[]; plan: any; names: string[] }> {
    const pool = rt.pool();
    const table = rel.base.table;
    const ops = params.ops!, fields = params.fields!, as = params.as!;
    const qi = ops.map((o, i) => (QUANTILE_OPS.has(o) ? i : -1)).filter(i => i >= 0);
    const bi = ops.map((o, i) => (QUANTILE_OPS.has(o) ? -1 : i)).filter(i => i >= 0);
    const COUNT = "\u0000pwcount";
    const bparams: AggregateParams = { ...params,
      ops: bi.length ? bi.map(i => ops[i]) : ["count"], fields: bi.length ? bi.map(i => fields[i]) : [null], as: bi.length ? bi.map(i => as[i]) : [COUNT] };
    const plan = await planAggregate(pool, table, bparams);
    if (plan.spec.dims.some(d => d.kind === "bucket")) throw new Unsupported("group count");
    const ex = await executePlan(pool, table, plan, op._pwScratchQ || (op._pwScratchQ = {}));
    const keys: number[] = [];
    const rows = emitRows(plan, ex.final, keys);
    if (!bi.length) for (const r of rows) delete r[COUNT];
    const rowOf = new Map<number, Record<string, any>>();
    keys.forEach((k, j) => rowOf.set(k, rows[j]));
    // Group key of every selected row.
    const sel = await selectRows(rel, pool);
    const n = table.length;
    const gk = new Float64Array(new SharedArrayBuffer(8 * Math.max(1, n)));
    const src = `const fp = args.fp;\n${groupKeySource(plan.spec)}\nconst R = bufs[0], out = bufs[1];\nfor (let j = start; j < end; j++) { const i = R[j]; out[i] = groupKey(i); }`;
    if (sel.length) await pwMap({ key: kernelKey("pv:qgk:", src), src }, {
      pool, n: sel.length, cols: plan.cols, args: { fp: plan.fp },
      bufs: [{ buffer: sel.buffer as SharedArrayBuffer, type: "i32" }, { buffer: gk.buffer as SharedArrayBuffer, type: "f64" }],
    });
    const gkey = `${table.id}:qgk:${++joinCounter}`;
    pool.ensureColumn(gkey, "f64", gk.buffer as SharedArrayBuffer);
    const P = { q1: 0.25, median: 0.5, q3: 0.75 } as Record<string, number>;
    try {
      for (const i of qi) {
        const f = fields[i];
        if (!f) throw new Unsupported("quantile without field");
        const name = as[i] || ops[i] + "_" + f;
        for (const r of rows) r[name] = undefined;
        let view: Float64Array, key: string, tag: Uint8Array | null = null;
        const mc = params.measureCols && params.measureCols[f];
        if (mc) { view = mc.view; key = mc.key; }
        else {
          const c = table.exprColumn(f);
          if (!c || c.kind !== "num") throw new Unsupported("quantile of a non-numeric field");
          view = c.view; key = c.key; tag = c.tag || null;
        }
        // Valid values only (vega-statistics' numbers: not null, not NaN).
        const valid = new Int32Array(new SharedArrayBuffer(4 * Math.max(1, sel.length)));
        let w = 0;
        for (let j = 0; j < sel.length; j++) { const r = sel[j]; if ((!tag || tag[r] === 0) && view[r] === view[r]) valid[w++] = r; }
        const sorted = await sortRows(pool, valid.subarray(0, w), [{ key: gkey, view: gk, order: 1 }, { key, view, order: 1 }]);
        const p = P[ops[i]];
        for (let s0 = 0; s0 < sorted.length;) {
          const k = gk[sorted[s0]];
          let e = s0 + 1;
          while (e < sorted.length && gk[sorted[e]] === k) e++;
          const cnt = e - s0, at = (q: number) => view[sorted[s0 + q]];
          let v: number;
          if (cnt < 2) v = at(0);
          else { const h = (cnt - 1) * p, i0 = Math.floor(h), v0 = at(i0); v = v0 + (at(i0 + 1) - v0) * (h - i0); }
          const row = rowOf.get(k);
          if (row) row[name] = v;
          s0 = e;
        }
      }
    } finally {
      pool.dropColumns([gkey]);
    }
    const names = ops.map((o, i) => as[i] || o + (fields[i] ? "_" + fields[i] : ""));
    return { rows, keys, plan, names };
  }

  /** Row index of every base row, as a resident column (for the first row of groups). */
  const rowIndex = new WeakMap<object, { key: string; view: Float64Array }>();
  /**
   * The first row of every group of an aggregate (a MapReduce of the minimum
   * of the row index), keyed like the output rows.
   */
  async function firstRows(rel: Relation, params: AggregateParams, keyOf: (r: any) => string): Promise<Map<string, number>> {
    const table = rel.base.table;
    let col = rowIndex.get(table);
    if (!col) {
      const n = table.length, view = new Float64Array(new SharedArrayBuffer(8 * Math.max(1, n)));
      for (let i = 0; i < n; i++) view[i] = i;
      col = { key: `${table.id}:rowindex`, view };
      rt.pool().ensureColumn(col.key, "f64", view.buffer as SharedArrayBuffer);
      rowIndex.set(table, col);
    }
    const ROW = "\u0000row", FIRST = "\u0000first";
    const rows = await runAggregate(rt.pool(), table, {
      ...params, ops: ["min"], fields: [ROW], as: [FIRST], measureCols: { ...(params.measureCols || {}), [ROW]: col },
    }, {}, undefined, null);
    return new Map(rows.map(r => [keyOf(r), r[FIRST]]));
  }

  // ------------------------------------------------------------------ joinaggregate (MapReduce + Map)
  // Aggregates per group over the input relation, then writes each group's
  // results to its rows as resident columns (derived fields).
  const MAX_JOIN_KEYS = 1 << 20;
  define("joinaggregate", {
    kind: "stream",
    consumes: op => {
      const a = op._argval;
      if (!a || a.key) return false;
      if (vega.array(a.groupby).some((g: any) => !plainField(vega, g))) return false;
      if (vega.array(a.fields).some((f: any) => f && !plainField(vega, f))) return false;
      return (a.ops || ["count"]).every((o: string) => SUPPORTED_OPS.has(o) || QUANTILE_OPS.has(o));
    },
    next: (_op, _, rel) => {
      if (_.key) throw new Unsupported("key");
      for (const g of vega.array(_.groupby)) if (!plainField(vega, g)) throw new Unsupported("group-by accessor");
      for (const f of vega.array(_.fields)) if (f && !plainField(vega, f)) throw new Unsupported("field accessor");
      for (const o of _.ops || ["count"]) if (!SUPPORTED_OPS.has(o) && !QUANTILE_OPS.has(o)) throw new Unsupported("op " + o);
      return rel;
    },
    effect: async (op, _, rel) => {
      const pool = rt.pool();
      const table = rel.base.table;
      const groupby = vega.array(_.groupby).map((g: any) => plainField(vega, g)!);
      const ops: string[] = _.ops && _.ops.length ? _.ops : ["count"];
      const fields = vega.array(_.fields).map((f: any) => (f ? plainField(vega, f) : null));
      const as = (_.as || []).map((a: any) => a ?? null);
      const params = await aggregateParams(rel, groupby, ops, fields, as);
      let plan: any, keys: number[] = [], rows: Record<string, any>[], names: string[];
      if (ops.some(o => QUANTILE_OPS.has(o))) {
        ({ plan, keys, rows, names } = await aggregateWithQuantiles(op, rel, params));
        if (plan.K > MAX_JOIN_KEYS) throw new Unsupported("group count");
      } else {
        plan = await planAggregate(pool, table, params);
        if (plan.K > MAX_JOIN_KEYS || plan.spec.dims.some((d: any) => d.kind === "bucket")) throw new Unsupported("group count");
        const ex = await executePlan(pool, table, plan, op._pwScratch || (op._pwScratch = {}));
        rows = emitRows(plan, ex.final, keys);
        names = plan.outputs.map((o: any) => o.name);
      }
      const vals = names.map(() => new Array(plan.K));
      rows.forEach((r, j) => names.forEach((name, m) => { vals[m][keys[j]] = r[name]; }));
      const n = table.length;
      // Columns are reused (rewritten in place) while the table and outputs stay the same.
      let jc = op._pwJoin;
      if (!jc || jc.table !== table || jc.names.join("\u0000") !== names.join("\u0000")) {
        if (jc) pool.dropColumns(jc.cols.flatMap((c: any) => [c.key, c.tagKey]));
        const id = ++joinCounter;
        jc = op._pwJoin = {
          table, names, version: 0,
          cols: names.map((_n, m) => {
            const key = `${table.id}:join${id}:${m}`;
            const c = {
              key, tagKey: key + ":tag",
              view: new Float64Array(new SharedArrayBuffer(8 * Math.max(1, n))),
              tag: new Uint8Array(new SharedArrayBuffer(Math.max(1, n))),
            };
            pool.ensureColumn(c.key, "f64", c.view.buffer as SharedArrayBuffer);
            pool.ensureColumn(c.tagKey, "u8", c.tag.buffer as SharedArrayBuffer);
            return c;
          }),
        };
      }
      const src = `const fp = args.fp, vals = args.vals;\n${groupKeySource(plan.spec)}\n` +
        `for (let i = start; i < end; i++) { const k = groupKey(i);\n` +
        `  for (let m = 0; m < vals.length; m++) { const v = vals[m][k], o = bufs[2 * m], g = bufs[2 * m + 1];\n` +
        `    if (typeof v === "number") { o[i] = v; g[i] = 0; } else g[i] = v === null ? 1 : 2; } }`;
      if (n) await pwMap({ key: kernelKey("pv:join:", src), src }, {
        pool, n, cols: plan.cols, args: { fp: plan.fp, vals },
        bufs: jc.cols.flatMap((c: any) => [
          { buffer: c.view.buffer as SharedArrayBuffer, type: "f64" as const },
          { buffer: c.tag.buffer as SharedArrayBuffer, type: "u8" as const },
        ]),
      });
      const version = ++jc.version;
      const derived = new Map(rel.derived);
      names.forEach((name, m) => {
        derived.delete(name);
        preserveBase(rel, name);
        derived.set(name, { kind: "col", name, env: rel.derived, col: { ...jc.cols[m], version } });
      });
      const r = { ...rel, derived };
      return { ...r, sig: relationSig(r) };
    },
  });

  // ------------------------------------------------------------------ window (Scan)
  /** Why a window cannot run in parallel, from its parameters, or null. */
  const windowProblem = (a: any): string | null => {
    const f = a.frame || [null, 0];
    if (!Array.isArray(f) || f.length !== 2 || f.some((x: any) => x != null && !Number.isFinite(+x))) return "window frame";
    const ops: string[] = a.ops || [];
    for (const o of ops) if (!WINDOW_RANK_OPS.has(o) && !WINDOW_AGG_OPS.has(o) && !WINDOW_VALUE_OPS.has(o)) return "window op " + o;
    const dflt = f[0] == null && f[1] === 0;
    if (!dflt && ops.some(o => o === "min" || o === "max")
      && (f[0] == null || f[1] == null || Math.abs(+f[0]) + Math.abs(+f[1]) + 1 > MAX_SCAN_FRAME)) return "window min or max over an unbounded or wide frame";
    if (vega.array(a.groupby).some((g: any) => !plainField(vega, g))) return "group-by accessor";
    if (vega.array(a.fields).some((x: any) => x && !plainField(vega, x))) return "field accessor";
    const prm = vega.array(a.params);
    if (ops.some((o, i) => o === "nth_value" && !(+prm[i] > 0))) return "nth_value";
    return null;
  };
  define("window", {
    kind: "stream",
    consumes: op => !!op._argval && windowProblem(op._argval) === null,
    next: (_op, _, rel) => {
      const why = windowProblem(_);
      if (why) throw new Unsupported(why);
      return rel;
    },
    effect: async (op, _, rel) => {
      const pool = rt.pool();
      const table = rel.base.table;
      const n = rel.base.tuples.length;
      const groupby = vega.array(_.groupby).map((g: any) => plainField(vega, g)!);
      const ops: string[] = _.ops || [];
      const fields = vega.array(_.fields).map((x: any) => (x ? plainField(vega, x) : null));
      const prm = vega.array(_.params);
      const as = _.as || [];
      // Partitions: dictionary codes of the group-by fields as numeric keys.
      const groupKeys: SortKey[] = [];
      for (const g of groupby) {
        const d = await derivedDictionary(rel, g, pool);
        const view = new Float64Array(new SharedArrayBuffer(8 * Math.max(1, n)));
        const src = "const c = cols[0], out = bufs[0];\nfor (let i = start; i < end; i++) out[i] = c[i];";
        pool.ensureColumn(d.key, "i32", d.view.buffer as SharedArrayBuffer);
        if (n) await pwMap({ key: "pv:win:codes", src }, { pool, n, cols: [d.key], bufs: [{ buffer: view.buffer as SharedArrayBuffer, type: "f64" }] });
        groupKeys.push({ key: `${table.id}:wg:${g}:${++joinCounter}`, view, order: 1 });
      }
      // Without a sort, rows keep the order of an upstream sorted collect, without peers.
      const orderOnly = !_.sort && !!rel.orderCmp;
      const sortK = _.sort ? await sortKeys(rel, _.sort) : rel.orderCmp ? await sortKeys(rel, rel.orderCmp) : [];
      const wops: WindowOp[] = [];
      for (let i = 0; i < ops.length; i++) {
        const o = ops[i], f = fields[i];
        if (WINDOW_VALUE_OPS.has(o)) {
          // Values of a numeric field, with Vega's null and undefined.
          if (!f) throw new Unsupported("window value op without field");
          const param = o === "nth_value" ? +prm[i] : (+prm[i] || 1);
          const d = rel.derived.get(f);
          if (d) {
            if (d.kind !== "col") throw new Unsupported("window value op on a derived field");
            wops.push({ op: o, param, value: { key: d.col.key, view: d.col.view, tagKey: d.col.tagKey, tag: d.col.tag } });
            continue;
          }
          const c = table.exprColumn(f);
          if (!c || c.kind !== "num") throw new Unsupported("window value op on a non-numeric field");
          wops.push({ op: o, param, value: { key: c.key, view: c.view, tagKey: c.tag ? c.tagKey! : null, tag: c.tag || null } });
          continue;
        }
        if (WINDOW_AGG_OPS.has(o) && o !== "count") {
          if (!f) throw new Unsupported("window aggregate without field");
          const c = rel.derived.has(f) ? await derivedNumeric(rel, f, pool) : table.numeric(f);
          if ((c as any).poison) throw new Unsupported("window measure " + f + " with values that are not numbers");
          wops.push({ op: o, measure: { key: c.key, view: c.view } });
        } else wops.push({ op: o });
      }
      const rows = await selectRows(rel, pool);
      const fr = _.frame || [null, 0];
      const frame: [number | null, number | null] = [fr[0] == null ? null : +fr[0], fr[1] == null ? null : +fr[1]];
      const outs = await computeWindow(pool, n, rows, groupKeys, sortK, wops, !!_.ignorePeers, orderOnly, frame);
      pool.dropColumns([...groupKeys, ...sortK].map(k => k.key).filter(k => k.includes(":wg:") || k.includes(":rank:")));
      if (op._pwWinKeys) pool.dropColumns(op._pwWinKeys);
      op._pwWinKeys = [];
      const id = ++joinCounter;
      const derived = new Map(rel.derived);
      ops.forEach((o, i) => {
        const name = as[i] || (o + (fields[i] ? "_" + fields[i] : ""));
        const key = `${table.id}:win${id}:${i}`;
        pool.ensureColumn(key, "f64", outs[i].view.buffer as SharedArrayBuffer);
        pool.ensureColumn(key + ":tag", "u8", outs[i].tag.buffer as SharedArrayBuffer);
        op._pwWinKeys.push(key, key + ":tag");
        derived.delete(name);
        preserveBase(rel, name);
        derived.set(name, { kind: "col", name, env: rel.derived, col: { key, view: outs[i].view, tagKey: key + ":tag", tag: outs[i].tag, version: 0 } });
      });
      const r = { ...rel, derived };
      return { ...r, sig: relationSig(r) };
    },
  });

  // ------------------------------------------------------------------ lookup (Map)
  // For every distinct value of a key field, Vega's own index gives the
  // looked-up tuple and the value accessors give the output values (main
  // thread, once per distinct key); every row then reads its value from the
  // table by the key's dictionary code (a derived field of kind "map").
  let lookupVersion = 0;
  const lookupKeys = new Map<string, number>();
  define("lookup", {
    kind: "stream",
    consumes: op => {
      const a = op._argval;
      return !!a && !!a.values && vega.array(a.fields).every((f: any) => !!plainField(vega, f));
    },
    next: (_op, _, rel) => {
      if (!_.values) throw new Unsupported("lookup without values");
      if (!_.index || typeof _.index.get !== "function") throw new Unsupported("lookup index");
      for (const f of vega.array(_.fields)) if (!plainField(vega, f)) throw new Unsupported("lookup key accessor");
      return rel;
    },
    effect: async (_op, _, rel) => {
      const pool = rt.pool();
      const keys = vega.array(_.fields).map((f: any) => plainField(vega, f)!);
      const values = vega.array(_.values);
      const n = keys.length, m = values.length;
      let as = _.as;
      if (n > 1 && !as) throw new Unsupported("lookup without as");
      if (as && as.length !== n * m) throw new Unsupported("lookup as");
      as = as || values.map((f: any) => vega.accessorName(f));
      const dflt = _.default == null ? null : _.default;
      const derived = new Map(rel.derived);
      let k = 0;
      for (let i = 0; i < n; i++) {
        const dict = await derivedDictionary(rel, keys[i], pool);
        pool.ensureColumn(dict.key, "i32", dict.view.buffer as SharedArrayBuffer);
        const tables = values.map(() => new Array(dict.values.length));
        dict.values.forEach((kv, c) => {
          const u = _.index.get(kv);
          values.forEach((f: any, j: number) => { tables[j][c] = u == null ? dflt : f(u); });
        });
        for (let j = 0; j < m; j++, k++) {
          const name = as[k], table = tables[j];
          for (const x of table) {
            if (!(x == null || typeof x === "number" || typeof x === "string" || typeof x === "boolean" || x instanceof Date)) {
              throw new Unsupported("lookup value that is not a number, string, boolean or date");
            }
          }
          // The same table gets the same version, so unchanged lookups keep the relation's signature.
          const tk = dict.key + "\u0000" + JSON.stringify(table.map((x: any) => (x instanceof Date ? { $d: +x } : x === undefined ? { $u: 1 } : x)));
          let version = lookupKeys.get(tk);
          if (version === undefined) {
            if (lookupKeys.size > 4096) lookupKeys.clear();
            version = ++lookupVersion;
            lookupKeys.set(tk, version);
          }
          derived.delete(name);
          preserveBase(rel, name);
          derived.set(name, { kind: "map", name, env: rel.derived, field: keys[i], table, dict: { key: dict.key, view: dict.view }, version });
        }
      }
      const r = { ...rel, derived };
      return { ...r, sig: relationSig(r) };
    },
  });

  // ------------------------------------------------------------------ kde (MapReduce, sort, rounds of MapReduce)
  // Vega's density transform; see density.ts.
  define("kde", {
    kind: "sink",
    consumes: op => {
      const a = op._argval;
      return !!a && !!plainField(vega, a.field) && vega.array(a.groupby).every((g: any) => !!plainField(vega, g));
    },
    run: (op, _, rel, pulse) => {
      const field = plainField(vega, _.field);
      if (!field) throw new Unsupported("density field accessor");
      const groupby = vega.array(_.groupby).map((g: any) => {
        const n = plainField(vega, g); if (!n) throw new Unsupported("group-by accessor"); return n;
      });
      const as = _.as || ["value", "density"];
      const params = {
        field, groupby, method: (_.cumulative ? "cdf" : "pdf") as "pdf" | "cdf", counts: !!_.counts, bandwidth: _.bandwidth || 0,
        extent: _.extent ? [+_.extent[0], +_.extent[1]] as [number, number] : null, shared: _.resolve === "shared",
        minsteps: _.steps || _.minsteps || 25, maxsteps: _.steps || _.maxsteps || 200, as: [as[0], as[1]] as [string, string],
      };
      const sig = rel.sig + "|" + JSON.stringify(params);
      if (sig === op._pwLastSig) return pulse.StopPropagation;
      const out = pulse.fork(pulse.NO_SOURCE | pulse.NO_FIELDS);
      const k = keepModified(_);
      return computeDensity(vega, rel, rt.pool(), params).then(rows => {
        op._pwLastSig = sig;
        const values = rows.map(r => vega.ingest(r));
        if (op.value) out.rem = op.value;
        op.value = out.add = out.source = values;
        op._pwOut = values;
        return out;
      }, e => {
        if (!(e instanceof Unsupported)) throw e;
        // Vega's KDE removes its previous value (the tuples emitted so far) itself.
        op._pwOut = [];
        return op._pwVega(k, pulse, rel, e.message);
      });
    },
  });

  // ------------------------------------------------------------------ extent (Reduce)
  // Passes its input through, like Vega's extent, and computes [min, max] as its value.
  define("extent", {
    kind: "stream",
    consumes: op => !!(op._argval && plainField(vega, op._argval.field)),
    next: (_op, _, rel) => {
      if (!plainField(vega, _.field)) throw new Unsupported("extent field");
      return rel;
    },
    effect: (op, _, rel, pulse) => {
      const field = plainField(vega, _.field)!;
      const sig = rel.sig + "|" + field;
      if (sig === op._pwLastSig) return;
      return aggregateParams(rel, [], ["min", "max"], [field, field], ["min", "max"])
        .then(params => runAggregate(rt.pool(), rel.base.table, params, op._pwScratch || (op._pwScratch = {}), undefined, null)).then(rows => {
        let min = rows.length ? rows[0].min : undefined, max = rows.length ? rows[0].max : undefined;
        if (!Number.isFinite(min) || !Number.isFinite(max)) {
          if (rows.length || rel.base.tuples.length) pulse.dataflow.warn(`Infinite extent for field "${field}": [${min ?? Infinity}, ${max ?? -Infinity}]`);
          min = max = undefined;
        }
        op._pwLastSig = sig;
        op.value = [min, max];
      });
    },
  });

  // ------------------------------------------------------------------ sieve
  // The values of a named data set. When no operator reads them, they are
  // created only if the application asks for them (view.data).
  {
    const Orig = vega.transforms.sieve;
    define("sieve", {
      kind: "stream",
      valueIsTuples: true,
      // Only a sieve that no operator reads, neither as pulse nor as value.
      consumes: op => op.targets().length === 0,
      next: (_op, _, rel) => rel,
    });
    const P = replaced.sieve;
    const t = P.prototype.transform;
    P.prototype.transform = function (this: any, _: any, pulse: any) {
      if (isParallel(this.source) && this.source._pwLazy) {
        const r = t.call(this, _, pulse);
        const rel: Relation = this._pwRel;
        let cache: any[] | null = null;
        const tuples = () => cache || (cache = withRoot(materializeSync(rel, rt.pool(), vega), rel));
        Object.defineProperty(this, "value", {
          configurable: true, enumerable: true,
          get: tuples,
          set: (v: any) => { delete this.value; this.value = v; },
        });
        // Operators can attach to this sieve after it ran, such as the marks of group
        // sub-dataflows that Vega creates during evaluation; they read its pulse, whose
        // tuples are therefore created when they are first read.
        if (r && r !== pulse.StopPropagation) for (const f of ["source", "add"]) {
          Object.defineProperty(r, f, {
            configurable: true, enumerable: true,
            get: () => {
              if (pulse.dataflow._clock !== r.stamp) return f === "add" ? [] : null;
              const v = tuples(); return f === "add" ? v.slice() : v;
            },
            set: (v: any) => { Object.defineProperty(r, f, { value: v, writable: true, configurable: true, enumerable: true }); },
          });
        }
        return r;
      }
      if (Object.getOwnPropertyDescriptor(this, "value")?.get) delete this.value;
      return Orig.prototype.transform.call(this, _, pulse);
    };
  }

  return { originals, replaced };
}

/**
 * Record the generated source of every expression parameter on the
 * function Vega compiles from it (property CODE), so that the parallel
 * operators can compile it into kernels.
 */
export function recordExpressionSource(vega: any): () => void {
  const ctx = vega.runtimeContext(new vega.Dataflow(), vega.transforms, {});
  const proto = Object.getPrototypeOf(ctx);
  const orig = proto.parameterExpression;
  if (orig.$pwPatched) return () => {};
  const patched = function (this: any, expr: any) {
    const fn = orig.call(this, expr);
    try { fn[CODE] = expr.code; } catch { /* frozen function */ }
    return fn;
  };
  (patched as any).$pwPatched = true;
  proto.parameterExpression = patched;
  // Comparators: record the field paths and orders (for the parallel sort).
  const cg = ctx.expr && ctx.expr.codegen;
  const origCmp = cg && cg.comparator;
  if (cg && origCmp && !origCmp.$pwPatched) {
    const cmp = function (this: any, fields: any[], orders: number[]) {
      const fn = origCmp.call(this, fields, orders);
      try { fn[SORT] = { paths: fields.map(f => (f && f.path) || null), orders: orders.slice(0, fields.length) }; } catch { /* frozen */ }
      return fn;
    };
    (cmp as any).$pwPatched = true;
    cg.comparator = cmp;
  }
  return () => {
    proto.parameterExpression = orig;
    if (cg && origCmp) cg.comparator = origCmp;
  };
}
