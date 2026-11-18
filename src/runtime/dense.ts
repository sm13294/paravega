/**
 * Dense marks: symbol marks with many items, encoded and drawn in the
 * workers.
 *
 * For a mark, Vega creates one scenegraph item per tuple (DataJoin), runs
 * the encoders on every item (Encode), bounds every item (Bound), and the
 * canvas renderer draws the items one by one, all on the main thread. For a
 * symbol mark over a relation (see relation.ts), ParaVega instead:
 *
 *  1. DataJoin: creates no items; the relation is the mark's data, so the
 *     upstream operators stay lazy and no tuple is created either.
 *  2. Encode, Map: every worker evaluates the mark's encoders for its rows
 *     (Vega's encoder channels compiled as kernels, with the scales rebuilt
 *     in the worker from vega-scale) and bounds each item with Vega's own
 *     symbol bound; the per-row bounds stay in shared buffers, and their
 *     union is the mark's bounds.
 *  3. Encode, Map: every worker draws one horizontal stripe of the mark on
 *     an OffscreenCanvas, with Vega's own symbol drawing code, in row order,
 *     and returns it as an ImageBitmap.
 *  4. Rendering: Vega's canvas renderer draws the stripes in place of the
 *     items (Marks.symbol.draw), and picking tests the per-row bounds, then
 *     encodes the candidate item with Vega's own encoder and tests it with
 *     Vega's own pick (Marks.symbol.pick), so event handlers, selections
 *     and tooltips receive a real item with its datum.
 *
 * Marks with hover or other named encoding sets, z-index, a mark sort or
 * key, encoders that cannot be compiled, or scales that cannot be rebuilt
 * exactly keep Vega's items (the relation is then materialized for the
 * DataJoin). Rows are drawn in Vega's item order: row order when the view
 * is created, and after an update the rows that stay keep their order and
 * the rows that enter are appended in row order, as Vega's Collect does with
 * the items of a mark. The rows that enter and leave come from ParaWeb's
 * Filter with change detection (one FilterState per mark).
 */
import { analyze, ExprInfo } from "./expr";
import { Base, Changes, Materializer, Relation, RowCode, Unsupported, baseRelation, cloneable, evalDerived, kernelKey, mainEvaluator, makeBase, predicateCode } from "./relation";
import { Runtime } from "../transforms";
import { FilterState } from "../filter";
import { WorkerPool } from "../pool";
import { filter as pwFilter, map as pwMap } from "paraweb-js/resident";
import { rebuildScale } from "./workerlib-core";

export const ENC = "$pwenc";

/** Channels that affect how a symbol is drawn. */
const VISUAL = new Set([
  "x", "y", "size", "shape", "angle", "fill", "stroke", "opacity", "fillOpacity", "strokeOpacity", "strokeWidth",
  "strokeDash", "strokeDashOffset", "strokeCap", "strokeJoin", "strokeMiterLimit", "blend",
]);
/** Channels that do not change pixels (they are applied to picked items only). */
const NONVISUAL = new Set(["description", "ariaRoleDescription", "aria", "ariaRole", "tooltip", "href", "cursor"]);
const SETS = new Set(["enter", "update", "exit"]);

/** Properties of a scale that are copied to the worker's rebuilt scale. */
const SCALE_PROPS = ["clamp", "unknown", "padding", "paddingInner", "paddingOuter", "align", "round", "base", "exponent", "constant"];

export interface DenseOptions {
  /** Smallest number of input rows for a dense mark. */
  minRows: number;
  onFallback?: (type: string, reason: string) => void;
}

interface StaticInfo {
  collect: any; mark: any; encode: any;
  /** Visual channels after merging enter and update: name -> analyzed code. */
  channels: [string, ExprInfo][];
  params: string[];
}

interface DenseState {
  rows: Int32Array;
  m: number;
  X1: Float64Array; Y1: Float64Array; X2: Float64Array; Y2: Float64Array;
  bounds: { x1: number; y1: number; x2: number; y2: number };
  /**
   * Raster: device pixel (p, q) of the stripes is s * (x, y) - (X0, Y0) + (fx, fy)
   * in the mark's coordinates, where (fx, fy) is the fractional part of the
   * canvas translation at the mark, so the stripes are copied to whole pixels.
   */
  X0: number; Y0: number; s: number; fx: number; fy: number;
  stripes: [number, any][] | null;
  rel: Relation;
  encode: any;
  df: any;
  tuples: Map<number, any>;
  rerequested?: boolean;
  /** Milliseconds of the phases of the last update: rows, bounds (Map), draw (Map). */
  ms: { rows: number; bound: number; draw: number };
}

/** Vega leaves the paint state of the last item on the context; the stripes already contain it. */
function resetPaint(g: any) {
  g.globalAlpha = 1;
  g.globalCompositeOperation = "source-over";
  if ("filter" in g) g.filter = "none";
  g.shadowColor = "rgba(0,0,0,0)";
}

const MAX_STRIPES = 8;

/**
 * Stripe boundaries (raster rows) with about the same number of symbols per
 * stripe: quantiles of the symbols' vertical centers, from a sample of at
 * most 65536 rows. The first stripe starts at 0 and the last ends at H.
 */
function stripeCuts(Y1: Float64Array, Y2: Float64Array, m: number, S: number, H: number, s: number, off: number): number[] {
  const step = Math.max(1, Math.floor(m / 65536));
  const ys: number[] = [];
  for (let j = 0; j < m; j += step) {
    const c = ((Y1[j] + Y2[j]) / 2) * s + off;
    if (c === c) ys.push(c);
  }
  ys.sort((a, b) => a - b);
  const cuts = [0];
  for (let q = 1; q < S; q++) {
    const v = ys.length ? Math.round(ys[Math.min(ys.length - 1, Math.floor((q * ys.length) / S))]) : Math.round((q * H) / S);
    cuts.push(Math.min(H, Math.max(cuts[q - 1], v)));
  }
  cuts.push(H);
  return cuts;
}

interface RowOrder { base: Base; state: FilterState; order: Int32Array }

/**
 * The rows of the relation in Vega's item order (see above), in a shared
 * array: the previous order without the rows that left, then the rows that
 * entered.
 */
async function orderedRows(st: RowOrder, rel: Relation, pool: WorkerPool): Promise<Int32Array> {
  const rc = new RowCode(rel, pool);
  const cond = predicateCode(rc, rel.preds);
  const prelude = rc.prelude();
  const d = await pwFilter({ key: kernelKey("pv:sel:", prelude, cond), prelude, cond }, st.state, { pool, cols: rc.cols, args: { P: rc.P } });
  if (!d.add.length && !d.rem.length) return st.order;
  const m = st.state.selected;
  const out = new Int32Array(new SharedArrayBuffer(4 * Math.max(1, m)));
  let w = 0;
  if (d.rem.length) {
    const mask = st.state.mask;
    for (let j = 0; j < st.order.length; j++) { const r = st.order[j]; if (mask[r]) out[w++] = r; }
  } else {
    out.set(st.order);
    w = st.order.length;
  }
  out.set(d.add, w);
  st.order = out.subarray(0, m);
  return st.order;
}

const frac = (v: number) => { const f = v - Math.floor(v); return f > 1 - 1e-9 ? 0 : f; };

function changesetPulse(pulse: any, ch: Changes, source?: any[]) {
  const p = pulse.fork(pulse.NO_FIELDS | (source ? pulse.NO_SOURCE : 0));
  p.add = ch.add; p.rem = ch.rem; p.mod = ch.mod;
  if (source) p.source = source;
  if (ch.fields.length) p.modifies(ch.fields);
  return p;
}

const MOD_CACHE = "_:mod:_";
function keepModified(_: any): any {
  const s = Object.create(_);
  Object.defineProperty(s, MOD_CACHE, { value: _[MOD_CACHE], writable: true });
  return s;
}

/** Descriptor of a Vega scale, rebuilt in the worker with vega-scale. */
function scaleDescriptor(s: any): any {
  const props: [string, any][] = [];
  for (const k of SCALE_PROPS) {
    if (typeof s[k] !== "function") continue;
    const v = s[k]();
    if (typeof v === "symbol" || typeof v === "function" || !cloneable(v)) continue;
    props.push([k, v]);
  }
  const domain = s.domain(), range = s.range();
  if (!cloneable(domain) || !cloneable(range)) throw new Unsupported("scale " + s.type + " (domain or range)");
  return { type: s.type, domain, range, props };
}

const sameValue = (a: any, b: any) => a === b || (a !== a && b !== b) || (a instanceof Date && b instanceof Date && +a === +b);

/** The rebuilt scale must give Vega's outputs on the domain (and around it, for continuous scales). */
function validateScale(vega: any, s: any, desc: any) {
  let r: any;
  try { r = rebuildScale(vega.scale, desc); } catch { throw new Unsupported("scale " + desc.type); }
  const d = desc.domain;
  const samples: any[] = [];
  const num = (v: any) => typeof v === "number" || v instanceof Date;
  if (d.length >= 2 && d.every(num) && typeof s.invert === "function") {
    const lo = +d[0], hi = +d[d.length - 1];
    const date = d[0] instanceof Date;
    for (let k = 0; k <= 40; k++) {
      const v = lo + (hi - lo) * (k / 40 * 1.2 - 0.1);
      samples.push(date ? new Date(v) : v);
    }
    for (const v of d) samples.push(v);
  } else {
    for (const v of d) samples.push(v);
  }
  for (const v of samples) if (!sameValue(s(v), r(v))) throw new Unsupported("scale " + desc.type + " (outputs differ)");
}

export function defineDense(vega: any, rt: Runtime, opts: DenseOptions) {
  const T = vega.transforms;
  const OrigDataJoin = T.datajoin, OrigEncode = T.encode, OrigBound = T.bound;
  const OrigMark = T.mark, OrigCollect = T.collect;
  const symbol = vega.Marks.symbol;
  const origDraw = symbol.draw, origPick = symbol.pick;
  const isParallel = (op: any) => !!(op && op._pwParallel);
  const infoCache = new Map<string, ExprInfo>();
  const analyzeCached = (code: string) => {
    let i = infoCache.get(code);
    if (!i) { i = analyze(code); infoCache.set(code, i); }
    return i;
  };
  const validated = new Set<string>();

  /** The mark chain below a DataJoin, if it is a symbol mark the dense path supports. */
  function staticInfo(dj: any): StaticInfo | null {
    if (dj._pwStatic !== undefined) return dj._pwStatic;
    const find = (op: any, C: any) => (op._targets || []).find((x: any) => x.source === op && x instanceof C);
    let s: StaticInfo | null = null;
    const collect = find(dj, OrigCollect);
    const mark = collect && find(collect, OrigMark);
    const encode = mark && find(mark, OrigEncode);
    const def = mark && mark._argval && mark._argval.markdef;
    const ok = encode && def && def.marktype === "symbol" && !(dj._argval && dj._argval.key)
      && !(collect._argval && collect._argval.sort) && (dj._targets || []).length === 1;
    if (ok) {
      const encoders = encode._argval.encoders || {};
      const merged = new Map<string, string>();
      let good = Object.keys(encoders).every(k => SETS.has(k));
      for (const set of ["enter", "update"]) {
        const e = encoders[set];
        if (!e) continue;
        const rec = e[ENC];
        if (!rec || rec.marktype !== "symbol") { good = false; break; }
        for (const [name, code] of Object.entries(rec.channels as Record<string, string>)) {
          if (NONVISUAL.has(name)) continue;
          if (!VISUAL.has(name)) { good = false; break; }
          merged.set(name, code);
        }
      }
      if (good) {
        const channels: [string, ExprInfo][] = [...merged].map(([n, c]) => [n, analyzeCached(c)]);
        if (channels.every(([, i]) => !i.unsupported)) {
          const params = [...new Set(channels.flatMap(([, i]) => i.params))];
          s = { collect, mark, encode, channels, params };
        }
      }
    }
    dj._pwStatic = s;
    return s;
  }

  // ------------------------------------------------------------------ datajoin
  function DataJoin(this: any, params: any) {
    OrigDataJoin.call(this, params);
    this._pwDenseRel = null;
    this._pwFallback = false;
    this._pwInMat = null;
    this._pwBase = null;
  }
  vega.inherits(DataJoin, OrigDataJoin, {
    _pwParallel: true,
    _pwLazy: false,
    _pwConsumes(this: any) { return !this._pwFallback && !!staticInfo(this); },
    _pwRelation() { return null; },
    transform(this: any, _: any, pulse: any) {
      const src = this.source;
      let rel: Relation | null = null;
      if (isParallel(src)) {
        rel = src._pwRelation();
      } else if (Array.isArray(pulse.source) && pulse.source.length >= opts.minRows && src && src.value === pulse.source) {
        if (this._pwBaseSrc !== pulse.source || pulse.changed()) {
          if (this._pwBase) this._pwBase.table.dispose(rt.pool());
          this._pwBase = makeBase(pulse.source.slice(), pulse.source);
          this._pwBaseSrc = pulse.source;
        }
        rel = baseRelation(this._pwBase);
      }
      const df = pulse.dataflow;
      const dense = !!rel && !this._pwFallback && !!staticInfo(this) && rel.base.tuples.length >= opts.minRows
        && df._renderType !== "svg" && !rel.orderCmp;
      if (dense) {
        const out = pulse.fork(pulse.NO_SOURCE | pulse.NO_FIELDS);
        if (this.value) {
          // Items created before: remove them.
          const rem: any[] = [];
          this.value.forEach((x: any) => { if (!x.exit) rem.push(x); });
          out.rem = rem;
          this.value = null;
        }
        this._pwInMat = null;
        this._pwDenseRel = rel;
        return out;
      }
      this._pwDenseRel = null;
      if (rel && isParallel(src) && src._pwLazy) {
        // The upstream operator created no tuples: materialize the relation for Vega's DataJoin.
        const mat: Materializer = this._pwInMat || (this._pwInMat = new Materializer(vega));
        const k = keepModified(_);
        return mat.update(rel, rt.pool()).then(ch => OrigDataJoin.prototype.transform.call(this, k, changesetPulse(pulse, ch, ch.source())));
      }
      return OrigDataJoin.prototype.transform.call(this, _, pulse);
    },
  });

  /** Give up the dense path for this mark (sticky) and re-run it with items. */
  function fallback(dj: any, df: any, reason: string) {
    dj._pwFallback = true;
    dj._pwDenseRel = null;
    if (opts.onFallback) opts.onFallback("mark", reason);
    df.touch(dj);
    // Not awaited: evaluate awaits its runAfter callbacks, and runAsync waits for the running evaluation.
    df.runAfter((v: any) => { v.runAsync(); });
  }

  function dirty(df: any, scene: any, b: any) {
    if (b && b.x1 <= b.x2 && b.y1 <= b.y2) df.dirty({ bounds: b, mark: scene });
  }

  function clearDense(df: any, scene: any) {
    const d: DenseState | undefined = scene && scene._pwDense;
    if (!d) return;
    dirty(df, scene, d.bounds);
    if (d.stripes) for (const [, b] of d.stripes) if (b && b.close) b.close();
    scene._pwDense = null;
  }

  // ------------------------------------------------------------------ encode
  function Encode(this: any, params: any) {
    OrigEncode.call(this, params);
    this._pwDJ = undefined;
    this._pwLastSig = null;
    this._pwBufs = null;
  }
  vega.inherits(Encode, OrigEncode, {
    transform(this: any, _: any, pulse: any) {
      if (this._pwDJ === undefined) {
        const mark = this.source, collect = mark && mark.source, dj = collect && collect.source;
        this._pwDJ = dj instanceof DataJoin && staticInfo(dj) && staticInfo(dj)!.encode === this ? dj : null;
      }
      const dj = this._pwDJ;
      const scene = this.source && this.source.value;
      if (!dj || !dj._pwDenseRel) {
        if (scene && scene._pwDense) { clearDense(pulse.dataflow, scene); this._pwLastSig = null; }
        this._pwOrder = null;
        return OrigEncode.prototype.transform.call(this, _, pulse);
      }
      const enc = pulse.encode;
      if (enc && enc !== "enter" && enc !== "update" && !Array.isArray(enc)) return pulse.StopPropagation;
      let job: Promise<any> | null;
      try {
        job = this._pwDense(_, dj, scene, pulse);
      } catch (e) {
        if (!(e instanceof Unsupported)) throw e;
        fallback(dj, pulse.dataflow, e.message);
        return pulse.StopPropagation;
      }
      if (!job) return pulse.StopPropagation;
      return job.then(() => pulse.fork(pulse.NO_SOURCE | pulse.NO_FIELDS), e => {
        if (!(e instanceof Unsupported)) throw e;
        fallback(dj, pulse.dataflow, e.message);
        return pulse.StopPropagation;
      });
    },

    _pwDense(this: any, _: any, dj: any, scene: any, pulse: any): Promise<void> | null {
      const info = staticInfo(dj)!;
      const rel: Relation = dj._pwDenseRel;
      const df = pulse.dataflow;
      const pool = rt.pool();
      const r = df._renderer;
      const g = df._renderType === "canvas" && r && r.context ? r.context() : null;
      const s = (g && g.pixelRatio) || 1;
      // Parameters of the channels: signals as values, scales as descriptors.
      const P: Record<string, any> = {};
      const scaleKeys: string[] = [];
      for (const k of info.params) {
        const v = _[k];
        if (k[0] === "%" && typeof v === "function") {
          const desc = scaleDescriptor(v);
          const dk = JSON.stringify(desc);
          if (!validated.has(dk)) { validateScale(vega, v, desc); validated.add(dk); }
          P[k] = desc;
          scaleKeys.push(k);
        } else {
          if (!cloneable(v)) throw new Unsupported("encode parameter " + k);
          P[k] = v;
        }
      }
      const raster = !!g;
      // Fractional device offset of the mark: the canvas translation (origin and group offsets) times the pixel ratio.
      let fx = 0, fy = 0;
      if (raster) {
        if (scene._pwFrac) [fx, fy] = scene._pwFrac;
        else {
          const o = r._origin || [0, 0];
          let ox = o[0], oy = o[1];
          for (let gi = scene.group; gi; gi = gi.mark && gi.mark.group) { ox += gi.x || 0; oy += gi.y || 0; }
          fx = frac(ox * s); fy = frac(oy * s);
        }
      }
      const sig = rel.sig + "|" + JSON.stringify(P) + "|" + s + "|" + raster + "|" + fx + "|" + fy;
      if (sig === this._pwLastSig && scene._pwDense) return null;

      const rc = new RowCode(rel, pool);
      const lines = info.channels.map(([name, ci]) => `o[${JSON.stringify(name)}] = ${rc.expr(ci, P)};`);
      const checkPaint = info.channels.some(([n]) => n === "fill" || n === "stroke")
        ? `if ((o.fill !== null && typeof o.fill === "object") || (o.stroke !== null && typeof o.stroke === "object")) return 1;` : "";
      const prelude = `${rc.prelude()}
const L = globalThis.__pwvt, M = L.symbol;
for (const k of args.SK) P[k] = L.scale(P[k]);
const o = {}, scene = { items: [o] };
function enc(i) {
${lines.join("\n")}
${checkPaint}
return 0;
}`;
      return (async () => {
        const t0 = performance.now();
        let st: RowOrder = this._pwOrder;
        if (!st || st.base !== rel.base) {
          st = this._pwOrder = { base: rel.base, state: new FilterState(rel.base.tuples.length), order: new Int32Array(0) };
        }
        const rows = await orderedRows(st, rel, pool);
        const t1 = performance.now();
        const m = rows.length;
        let bufs = this._pwBufs;
        if (!bufs || bufs.cap < m) {
          const cap = Math.max(m, 1024);
          const f = () => new Float64Array(new SharedArrayBuffer(8 * cap));
          bufs = this._pwBufs = { cap, X1: f(), Y1: f(), X2: f(), Y2: f() };
        }
        const sb = (a: Float64Array | Int32Array, type: "f64" | "i32") => ({ buffer: a.buffer as SharedArrayBuffer, type });
        const MAXV = Number.MAX_VALUE;
        const boundSrc = `${prelude}
const R = bufs[0], X1 = bufs[1], Y1 = bufs[2], X2 = bufs[3], Y2 = bufs[4], B = new L.Bounds();
let x1 = ${MAXV}, y1 = ${MAXV}, x2 = -${MAXV}, y2 = -${MAXV};
for (let j = start; j < end; j++) {
  if (enc(R[j])) return null;
  M.bound(B.clear(), o);
  X1[j] = B.x1; Y1[j] = B.y1; X2[j] = B.x2; Y2[j] = B.y2;
  if (B.x1 < x1) x1 = B.x1; if (B.y1 < y1) y1 = B.y1; if (B.x2 > x2) x2 = B.x2; if (B.y2 > y2) y2 = B.y2;
}
return [x1, y1, x2, y2];`;
        const common = { pool, cols: rc.cols, args: { P: rc.P, SK: scaleKeys } };
        const parts = m ? (await pwMap({ key: kernelKey("pv:dense:b:", boundSrc), src: boundSrc }, {
          ...common, n: m, bufs: [sb(rows, "i32"), sb(bufs.X1, "f64"), sb(bufs.Y1, "f64"), sb(bufs.X2, "f64"), sb(bufs.Y2, "f64")],
        })).flat() : [];
        if (parts.some(p => p === null)) throw new Unsupported("gradient paint");
        const t2 = performance.now();
        const b = { x1: MAXV, y1: MAXV, x2: -MAXV, y2: -MAXV };
        for (const p of parts) {
          if (p[0] < b.x1) b.x1 = p[0]; if (p[1] < b.y1) b.y1 = p[1];
          if (p[2] > b.x2) b.x2 = p[2]; if (p[3] > b.y2) b.y2 = p[3];
        }

        let stripes: [number, any][] | null = null;
        let X0 = 0, Y0 = 0;
        if (raster && m && b.x1 <= b.x2 && b.y1 <= b.y2) {
          // Raster area in device pixels: the mark bounds, limited to a range around the mark's
          // origin (the canvas may not have its final size yet when the view is first laid out).
          const LIM = 16384;
          X0 = Math.max(Math.floor(b.x1 * s + fx), -LIM);
          Y0 = Math.max(Math.floor(b.y1 * s + fy), -LIM);
          const W = Math.min(Math.ceil(b.x2 * s + fx), LIM) - X0, H = Math.min(Math.ceil(b.y2 * s + fy), LIM) - Y0;
          if (W > 0 && H > 0) {
            // Chrome's 2D canvases in workers stop scaling at about 8 (measured: 3, 4 and 9 us per
            // symbol with 4, 8 and 16 workers drawing at once), and each extra stripe draws the
            // symbols on its boundaries again.
            const S = Math.min(pool.size, MAX_STRIPES, H);
            const cuts = stripeCuts(bufs.Y1, bufs.Y2, m, S, H, s, fy - Y0);
            const drawSrc = `${prelude}
if (typeof OffscreenCanvas === "undefined") return null;
const R = bufs[0], Y1 = bufs[1], Y2 = bufs[2], s = args.s, out = [];
for (let q = start; q < end; q++) {
  const t0 = args.cuts[q], t1 = args.cuts[q + 1];
  if (t1 <= t0) continue;
  // Software rasterization: GPU-backed canvases of all workers are drawn one after the other by the GPU process.
  const cv = new OffscreenCanvas(args.W, t1 - t0), g = cv.getContext("2d", { willReadFrequently: true });
  g.pixelRatio = s;
  g.setTransform(s, 0, 0, s, args.fx - args.X0, args.fy - (args.Y0 + t0));
  const lo = (args.Y0 + t0 - args.fy) / s, hi = (args.Y0 + t1 - args.fy) / s;
  for (let j = 0; j < args.m; j++) {
    if (!(Y2[j] >= lo && Y1[j] <= hi)) continue;
    enc(R[j]);
    M.draw(g, scene, null);
  }
  out.push([t0, cv.transferToImageBitmap()]);
}
return out;`;
            const res = await pwMap({ key: kernelKey("pv:dense:d:", drawSrc), src: drawSrc }, {
              ...common, n: S, threads: S, bufs: [sb(rows, "i32"), sb(bufs.Y1, "f64"), sb(bufs.Y2, "f64")],
              args: { ...common.args, s, X0, Y0, fx, fy, W, cuts, m },
            });
            const flat = res.flat();
            if (flat.every(x => x !== null)) stripes = flat.flat() as [number, any][];
          }
        }
        const t3 = performance.now();
        clearDense(df, scene);
        const d: DenseState = {
          ms: { rows: t1 - t0, bound: t2 - t1, draw: t3 - t2 },
          rows, m, X1: bufs.X1, Y1: bufs.Y1, X2: bufs.X2, Y2: bufs.Y2, bounds: b, X0, Y0, s, fx, fy, stripes,
          rel, encode: this, df, tuples: new Map(),
        };
        scene._pwDense = d;
        this._pwLastSig = sig;
      })();
    },
  });

  // ------------------------------------------------------------------ bound
  function Bound(this: any, params: any) { OrigBound.call(this, params); }
  vega.inherits(Bound, OrigBound, {
    transform(this: any, _: any, pulse: any) {
      const out = OrigBound.prototype.transform.call(this, _, pulse);
      const mark = _.mark, d: DenseState | null = mark && mark._pwDense;
      if (d && out && out !== pulse.StopPropagation) {
        mark.bounds.clear().union(d.bounds);
        const clip = mark.clip;
        if (clip && typeof clip !== "function") mark.bounds.intersect(new vega.Bounds().set(0, 0, mark.group.width, mark.group.height));
        // A placeholder item with the mark's bounds, as modified: Vega's Render marks its region
        // dirty, and the pulse continues to the enclosing group, which then re-bounds.
        out.mod = [{ mark, bounds: new vega.Bounds().union(mark.bounds), _pwPlaceholder: true }];
      }
      return out;
    },
  });

  // ------------------------------------------------------------------ renderer
  symbol.draw = function (this: any, context: any, scene: any, bounds: any) {
    const d: DenseState | null = scene._pwDense;
    if (!d) return origDraw.call(this, context, scene, bounds);
    if (!d.stripes) return;
    const tr = context.getTransform ? context.getTransform() : null;
    const s = d.s;
    if (tr && tr.a === s && tr.d === s && tr.b === 0 && tr.c === 0
      && Math.abs(frac(tr.e) - d.fx) < 1e-6 && Math.abs(frac(tr.f) - d.fy) < 1e-6) {
      // Device pixels of the stripes align with the canvas: copy them without resampling.
      const ox = Math.round(tr.e - d.fx) + d.X0, oy = Math.round(tr.f - d.fy) + d.Y0;
      context.save();
      resetPaint(context);
      context.setTransform(1, 0, 0, 1, 0, 0);
      for (const [t0, bmp] of d.stripes) context.drawImage(bmp, ox, oy + t0);
      context.restore();
      return;
    }
    // The canvas transform differs from the one the stripes were drawn for
    // (first layout, another pixel ratio, or an export): draw them scaled now,
    // and draw them again for this transform.
    context.save();
    resetPaint(context);
    for (const [t0, bmp] of d.stripes) {
      context.drawImage(bmp, (d.X0 - d.fx) / s, (d.Y0 + t0 - d.fy) / s, bmp.width / s, bmp.height / s);
    }
    context.restore();
    if (tr && tr.a === s && tr.d === s && tr.b === 0 && tr.c === 0 && !d.rerequested && context === d.df._renderer?.context()) {
      d.rerequested = true;
      scene._pwFrac = [frac(tr.e), frac(tr.f)];
      setTimeout(() => { d.df.touch(d.encode); d.df.runAsync(); }, 0);
    }
  };

  /** A real Vega item for row j of a dense mark: its datum, Vega's encoders and bounds. */
  function itemOf(scene: any, d: DenseState, j: number): any {
    const i = d.rows[j];
    let t = d.tuples.get(i);
    if (!t) {
      t = d.rel.base.tuples[i];
      if (d.rel.derive) { const c = vega.ingest({}); for (const k in t) c[k] = t[k]; t = c; }
      { const ev = mainEvaluator(d.rel); for (const dv of d.rel.derived.values()) t[dv.name] = ev(dv, t, i); }
      if (d.tuples.size > 256) d.tuples.clear();
      d.tuples.set(i, t);
    }
    const item: any = { mark: scene, datum: t, bounds: new vega.Bounds() };
    const _ = d.encode._argval, encoders = _.encoders;
    if (encoders.enter) encoders.enter(item, _);
    if (encoders.update) encoders.update(item, _);
    symbol.bound(item.bounds, item);
    return item;
  }

  symbol.pick = function (this: any, context: any, scene: any, x: number, y: number, gx: number, gy: number) {
    const d: DenseState | null = scene._pwDense;
    if (!d) return origPick.call(this, context, scene, x, y, gx, gy);
    const { X1, Y1, X2, Y2 } = d;
    for (let j = d.m - 1; j >= 0; j--) {
      if (!(X1[j] <= gx && gx <= X2[j] && Y1[j] <= gy && gy <= Y2[j])) continue;
      const item = itemOf(scene, d, j);
      const hit = origPick.call(this, context, { items: [item], marktype: "symbol" }, x, y, gx, gy);
      if (hit) return hit;
    }
    return null;
  };

  const replaced = { datajoin: DataJoin, encode: Encode, bound: Bound };
  const originals = { datajoin: OrigDataJoin, encode: OrigEncode, bound: OrigBound };
  const restore = () => {
    symbol.draw = origDraw;
    symbol.pick = origPick;
  };
  return { replaced, originals, restore };
}

/** Record the channels of every encoder Vega compiles (property ENC). */
export function recordEncoderSource(vega: any): () => void {
  const ctx = vega.runtimeContext(new vega.Dataflow(), vega.transforms, {});
  const proto = Object.getPrototypeOf(ctx);
  const orig = proto.encodeExpression;
  if (orig.$pwPatched) return () => {};
  const patched = function (this: any, encode: any) {
    const fn = orig.call(this, encode);
    try {
      const channels: Record<string, string> = {};
      for (const name in encode.channels) channels[name] = encode.channels[name].code;
      fn[ENC] = { marktype: encode.marktype, channels };
    } catch { /* frozen function */ }
    return fn;
  };
  (patched as any).$pwPatched = true;
  proto.encodeExpression = patched;
  return () => { proto.encodeExpression = orig; };
}
