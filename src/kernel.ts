/**
 * Kernel definitions shared by the main thread and the workers.
 *
 * A pwaggregate request is compiled into one fused loop over a row range:
 *   filter (Filter pattern) -> key computation (bin / dictionary code)
 *   -> per-group accumulation into a worker-private partial (Map phase of
 *   MapReduce). Partials are then combined (Reduce phase), either on the
 *   main thread or, for large key spaces, in parallel by key range.
 *
 * The loop body is generated as source text and compiled with new Function
 * in the worker, the same function-as-string approach ParaWeb uses for user
 * callbacks. Runtime values (brush ranges, bin boundaries) are passed in as
 * parameters, so moving a brush never triggers recompilation.
 */

/** Same constant as vega-transforms/src/Bin.js. */
import type { Kernel, Predicate } from "paraweb-js/resident";

export const EPSILON = 1e-14;

/** Slots per measured field: valid, sum, min, max, mean, m2. */
export const FIELD_SLOTS = 6;
export const S_VALID = 0;
export const S_SUM = 1;
export const S_MIN = 2;
export const S_MAX = 3;
export const S_MEAN = 4;
export const S_M2 = 5;

/** Extra key slots appended to a bin dimension. */
export const BIN_NULL = 0;
export const BIN_NEG_INF = 1;
export const BIN_POS_INF = 2;
export const BIN_SPECIALS = 3;

export type FilterSpec =
  /** lo <= x <= hi on a Float64 column (missing values fail). */
  | { kind: "range"; col: number }
  /** membership mask indexed by dictionary code. */
  | { kind: "set"; col: number };

export type DimSpec =
  /** Vega-compatible binning of a Float64 column into nb regular bins. */
  | { kind: "bin"; col: number; nb: number }
  /** Int32 dictionary codes; card includes the null code. */
  | { kind: "dict"; col: number; card: number }
  /**
   * Fine equal-width buckets used by pre-aggregation: R buckets over
   * [lo, hi] plus one bucket (index R) for missing values. See bucketOf().
   */
  | { kind: "bucket"; col: number; R: number };

export interface KernelSpec {
  filters: FilterSpec[];
  dims: DimSpec[];
  /** Column slot for each measured field. */
  measures: number[];
  /** Maintain Welford mean/m2 (needed for variance, stdev, ...). */
  variance: boolean;
  /**
   * A compiled Vega expression that rows must also satisfy (see
   * runtime/relation.ts); its prelude reads parameters from args.P.
   */
  where?: { prelude: string; cond: string };
}

export function dimCard(d: DimSpec): number {
  if (d.kind === "bin") return d.nb + BIN_SPECIALS;
  if (d.kind === "bucket") return d.R + 1;
  return d.card;
}

/**
 * Bucket of value x for R buckets over [lo, hi] (scale = R / (hi - lo)).
 * The function is monotone non-decreasing in x, which pre-aggregation relies
 * on: if bucket(x) > bucket(a) then x > a, and if bucket(x) < bucket(b) then
 * x < b. The kernel inlines the same expressions.
 */
export function bucketOf(x: number, lo: number, hi: number, scale: number, R: number): number {
  if (x !== x) return R;
  if (x <= lo) return 0;
  if (x >= hi) return R - 1;
  const b = Math.floor((x - lo) * scale);
  return b > R - 1 ? R - 1 : b;
}

export function keyCount(spec: KernelSpec): number {
  let k = 1;
  for (const d of spec.dims) k *= dimCard(d);
  return k;
}

export function slotCount(spec: KernelSpec): number {
  return 1 + spec.measures.length * FIELD_SLOTS;
}

/** Stable cache key for a compiled kernel. */
export function kernelSignature(spec: KernelSpec, indexed = false): string {
  return (indexed ? "idx:" : "") + JSON.stringify(spec);
}

/**
 * Layout of the runtime Float64 parameter vector `fp`:
 *   for each range filter j: lo, hi
 *   for each bin dimension d: start, stop, last (= stop - step), step
 *   for each bucket dimension d: lo, hi, scale
 */
export function paramCount(spec: KernelSpec): number {
  let n = 0;
  for (const f of spec.filters) if (f.kind === "range") n += 2;
  for (const d of spec.dims) n += d.kind === "bin" ? 4 : d.kind === "bucket" ? 3 : 0;
  return n;
}

/**
 * Generate the body of
 *   function(cols, sets, fp, out, base, start, end, idx)
 * which accumulates rows [start, end) into out[base .. base + K*A).
 * With `indexed`, the loop instead visits rows idx[start .. end).
 * The region must be initialised with initRegion() first.
 */
export function generateKernelSource(spec: KernelSpec, indexed = false): string {
  const A = slotCount(spec);
  const lines: string[] = [];
  const used = new Set<number>();
  spec.filters.forEach(f => used.add(f.col));
  spec.dims.forEach(d => used.add(d.col));
  spec.measures.forEach(c => used.add(c));
  for (const c of used) lines.push(`const c${c} = cols[${c}];`);

  let p = 0;
  let setIdx = 0;
  const filterCode: string[] = [];
  if (spec.where) {
    lines.push(spec.where.prelude);
    filterCode.push(`if (!(${spec.where.cond})) continue;`);
  }
  spec.filters.forEach((f, j) => {
    if (f.kind === "range") {
      lines.push(`const lo${j} = fp[${p}], hi${j} = fp[${p + 1}];`);
      p += 2;
      filterCode.push(`x = c${f.col}[i]; if (!(x >= lo${j} && x <= hi${j})) continue;`);
    } else {
      lines.push(`const m${j} = sets[${setIdx++}];`);
      filterCode.push(`if (m${j}[c${f.col}[i]] === 0) continue;`);
    }
  });

  let stride = 1;
  const keyCode: string[] = [];
  spec.dims.forEach((d, j) => {
    if (d.kind === "bin") {
      lines.push(
        `const bs${j} = fp[${p}], bp${j} = fp[${p + 1}], bl${j} = fp[${p + 2}], bt${j} = fp[${p + 3}];`,
      );
      p += 4;
      const nb = d.nb;
      // Mirrors Bin._bins in vega-transforms: values outside [start, stop]
      // map to +/-Infinity, values inside are clamped to the last bin.
      keyCode.push(
        `x = c${d.col}[i];` +
          ` if (x !== x) k += ${(nb + BIN_NULL) * stride};` +
          // Bins without a finite start (an empty extent): Vega's bin gives NaN, kept in the +Infinity slot.
          ` else if (bs${j} !== bs${j}) k += ${(nb + BIN_POS_INF) * stride};` +
          ` else if (x < bs${j}) k += ${(nb + BIN_NEG_INF) * stride};` +
          ` else if (x > bp${j}) k += ${(nb + BIN_POS_INF) * stride};` +
          ` else { x = Math.max(bs${j}, Math.min(x, bl${j}));` +
          ` b = Math.floor(${EPSILON} + (x - bs${j}) / bt${j});` +
          ` if (b > ${nb - 1}) b = ${nb - 1};` +
          ` k += b * ${stride}; }`,
      );
    } else if (d.kind === "bucket") {
      lines.push(`const ul${j} = fp[${p}], uh${j} = fp[${p + 1}], us${j} = fp[${p + 2}];`);
      p += 3;
      const R = d.R;
      // Same expressions as bucketOf().
      keyCode.push(
        `x = c${d.col}[i];` +
          ` if (x !== x) b = ${R};` +
          ` else if (x <= ul${j}) b = 0;` +
          ` else if (x >= uh${j}) b = ${R - 1};` +
          ` else { b = Math.floor((x - ul${j}) * us${j}); if (b > ${R - 1}) b = ${R - 1}; }` +
          ` k += b * ${stride};`,
      );
    } else {
      keyCode.push(`k += c${d.col}[i] * ${stride};`);
    }
    stride *= dimCard(d);
  });

  const measureCode: string[] = [];
  spec.measures.forEach((c, j) => {
    const off = 1 + j * FIELD_SLOTS;
    let m =
      `x = c${c}[i]; if (x === x) { q = o + ${off};` +
      ` n = ++out[q + ${S_VALID}]; out[q + ${S_SUM}] += x;` +
      ` if (x < out[q + ${S_MIN}]) out[q + ${S_MIN}] = x;` +
      ` if (x > out[q + ${S_MAX}]) out[q + ${S_MAX}] = x;`;
    if (spec.variance) {
      m +=
        ` d = x - out[q + ${S_MEAN}]; out[q + ${S_MEAN}] += d / n;` +
        ` out[q + ${S_M2}] += d * (x - out[q + ${S_MEAN}]);`;
    }
    m += " }";
    measureCode.push(m);
  });

  lines.push("let x, k, b, o, q, n, d;");
  if (indexed) {
    lines.push("for (let j = start; j < end; j++) {");
    lines.push("  const i = idx[j];");
  } else {
    lines.push("for (let i = start; i < end; i++) {");
  }
  lines.push(...filterCode.map(s => "  " + s));
  lines.push("  k = 0;");
  lines.push(...keyCode.map(s => "  " + s));
  lines.push(`  o = base + k * ${A};`);
  lines.push("  out[o] += 1;");
  lines.push(...measureCode.map(s => "  " + s));
  lines.push("}");
  return lines.join("\n");
}

export type CompiledKernel = (
  cols: ArrayLike<number>[],
  sets: Uint8Array[],
  fp: Float64Array,
  out: Float64Array,
  base: number,
  start: number,
  end: number,
  idx?: Int32Array,
) => void;

export function compileKernel(spec: KernelSpec, indexed = false): CompiledKernel {
  return new Function(
    "cols", "sets", "fp", "out", "base", "start", "end", "idx",
    generateKernelSource(spec, indexed),
  ) as CompiledKernel;
}

/** Initialise K groups of A slots each, starting at base. */
export function initRegion(
  out: Float64Array, base: number, K: number, nm: number,
): void {
  const A = 1 + nm * FIELD_SLOTS;
  const end = base + K * A;
  out.fill(0, base, end);
  if (nm === 0) return;
  for (let o = base; o < end; o += A) {
    for (let j = 0; j < nm; j++) {
      const q = o + 1 + j * FIELD_SLOTS;
      out[q + S_MIN] = Infinity;
      out[q + S_MAX] = -Infinity;
    }
  }
}

/**
 * Map kernel for ParaWeb's residentMapReduce: the fused filter + key +
 * accumulate loop of generateKernelSource, preceded by the initialisation
 * of the worker's region on its first chunk (args.first). Runtime values
 * (args.fp, args.sets, args.K) are parameters, so moving a brush reuses
 * the compiled kernel.
 */
export function mapKernel(spec: KernelSpec): Kernel {
  const nm = spec.measures.length;
  const A = slotCount(spec);
  const init =
    `if (args.first) {\n` +
    `  const e0 = base + args.K * ${A};\n  out.fill(0, base, e0);\n` +
    (nm ? `  for (let o = base; o < e0; o += ${A}) {\n` +
      Array.from({ length: nm }, (_, j) =>
        `    out[o + ${1 + j * FIELD_SLOTS + S_MIN}] = Infinity; out[o + ${1 + j * FIELD_SLOTS + S_MAX}] = -Infinity;\n`).join("") +
      `  }\n` : "") +
    `}\n`;
  return {
    key: "agg:" + kernelSignature(spec),
    src: "const sets = args.sets, fp = args.fp, out = bufs[0], base = args.base;\n" + init + generateKernelSource(spec),
  };
}

/**
 * Combine kernel for residentMapReduce: merges args.T partial regions of
 * bufs[0] (each args.region values, laid out back to back) into bufs[1] for
 * keys [start, end). Welford states are merged with Chan et al.'s pairwise
 * formula.
 */
export function combineKernel(nm: number, variance: boolean): Kernel {
  const A = 1 + nm * FIELD_SLOTS;
  const fields = Array.from({ length: nm }, (_, j) => {
    const q = 1 + j * FIELD_SLOTS;
    return `
      { const q = o + ${q}, r = src + ${q}; const nb = parts[r + ${S_VALID}];
        if (nb !== 0) {
          const na = dst[q + ${S_VALID}], n = na + nb;
          dst[q + ${S_VALID}] = n; dst[q + ${S_SUM}] += parts[r + ${S_SUM}];
          if (parts[r + ${S_MIN}] < dst[q + ${S_MIN}]) dst[q + ${S_MIN}] = parts[r + ${S_MIN}];
          if (parts[r + ${S_MAX}] > dst[q + ${S_MAX}]) dst[q + ${S_MAX}] = parts[r + ${S_MAX}];` +
      (variance ? `
          const delta = parts[r + ${S_MEAN}] - dst[q + ${S_MEAN}];
          dst[q + ${S_MEAN}] += (delta * nb) / n;
          dst[q + ${S_M2}] += parts[r + ${S_M2}] + (delta * delta * na * nb) / n;` : "") + `
        } }`;
  }).join("");
  return {
    key: `combine:${nm}:${variance}`,
    src: `const parts = bufs[0], dst = bufs[1], T = args.T, region = args.region;
for (let k = start; k < end; k++) {
  const o = k * ${A};
  for (let s = 0; s < ${A}; s++) dst[o + s] = parts[o + s];
  for (let t = 1; t < T; t++) {
    const src = t * region + o;
    const cnt = parts[src];
    if (cnt === 0) continue;
    dst[o] += cnt;${fields}
  }
}`,
  };
}

/**
 * Map kernel that builds the segment trees of the pre-aggregation index for
 * keys [start, end): for every key, the leaves are copied from the cube
 * (bufs[0], args.B = R + 1 buckets per key, the last one for missing values,
 * which goes to bufs[2]), and the inner nodes R - 1 .. 1 of the tree
 * (bufs[1], 2R nodes per key) are merged from their children with the rules
 * of mergeRecord. Keys are independent, so the trees are built in parallel.
 */
export function treeKernel(nm: number, variance: boolean): Kernel {
  const A = 1 + nm * FIELD_SLOTS;
  const fields = Array.from({ length: nm }, (_, j) => {
    const q = 1 + j * FIELD_SLOTS;
    return `
      { const q = d + ${q}, r = s + ${q}; const nb = t[r + ${S_VALID}];
        if (nb !== 0) {
          const na = t[q + ${S_VALID}], n = na + nb;
          t[q + ${S_VALID}] = n; t[q + ${S_SUM}] += t[r + ${S_SUM}];
          if (t[r + ${S_MIN}] < t[q + ${S_MIN}]) t[q + ${S_MIN}] = t[r + ${S_MIN}];
          if (t[r + ${S_MAX}] > t[q + ${S_MAX}]) t[q + ${S_MAX}] = t[r + ${S_MAX}];` +
      (variance ? `
          const delta = t[r + ${S_MEAN}] - t[q + ${S_MEAN}];
          t[q + ${S_MEAN}] += (delta * nb) / n;
          t[q + ${S_M2}] += t[r + ${S_M2}] + (delta * delta * na * nb) / n;` : "") + `
        } }`;
  }).join("");
  const initMeasures = Array.from({ length: nm }, (_, j) =>
    `t[o + ${1 + j * FIELD_SLOTS + S_MIN}] = Infinity; t[o + ${1 + j * FIELD_SLOTS + S_MAX}] = -Infinity;`).join(" ");
  return {
    key: `tree:${nm}:${variance}`,
    src: `const fin = bufs[0], t = bufs[1], miss = bufs[2], R = args.R, B = R + 1;
for (let kv = start; kv < end; kv++) {
  const base = kv * 2 * R;
  for (let i = 1; i < R; i++) { const o = (base + i) * ${A}; for (let x = 0; x < ${A}; x++) t[o + x] = 0; ${initMeasures} }
  t.set(fin.subarray(kv * B * ${A}, (kv * B + R) * ${A}), (base + R) * ${A});
  miss.set(fin.subarray((kv * B + R) * ${A}, (kv * B + R + 1) * ${A}), kv * ${A});
  for (let i = R - 1; i >= 1; i--) {
    const d = (base + i) * ${A};
    { const s = (base + 2 * i) * ${A}; const cnt = t[s]; if (cnt !== 0) { t[d] += cnt;${fields} } }
    { const s = (base + 2 * i + 1) * ${A}; const cnt = t[s]; if (cnt !== 0) { t[d] += cnt;${fields} } }
  }
}
return 0;`,
  };
}

/**
 * Row predicate for ParaWeb's residentFilter, from the filter part of a
 * KernelSpec (args.fp holds lo, hi per range filter; args.sets the masks).
 */
export function filterPredicate(filters: FilterSpec[]): Predicate {
  const lines: string[] = ["const fp = args.fp, sets = args.sets;", "let x;"];
  const used = new Set(filters.map(f => f.col));
  for (const c of used) lines.push(`const c${c} = cols[${c}];`);
  let p = 0, setIdx = 0;
  const conds: string[] = [];
  filters.forEach((f, j) => {
    if (f.kind === "range") {
      lines.push(`const lo${j} = fp[${p}], hi${j} = fp[${p + 1}];`);
      p += 2;
      conds.push(`(x = c${f.col}[i], x >= lo${j} && x <= hi${j})`);
    } else {
      lines.push(`const m${j} = sets[${setIdx++}];`);
      conds.push(`m${j}[c${f.col}[i]] === 1`);
    }
  });
  return { key: "f:" + JSON.stringify(filters), prelude: lines.join("\n"), cond: conds.length ? conds.join(" && ") : "true" };
}

/**
 * Merge one partial record (count + nm measure blocks) into another, on the
 * calling thread: the same rules as combineKernel (sum, min, max, and Chan
 * et al.'s merge of Welford states).
 */
export function mergeRecord(
  dst: Float64Array, d: number, src: Float64Array, s: number, nm: number, variance: boolean,
): void {
  const cnt = src[s];
  if (cnt === 0) return;
  dst[d] += cnt;
  for (let j = 0; j < nm; j++) {
    const q = d + 1 + j * FIELD_SLOTS, r = s + 1 + j * FIELD_SLOTS;
    const nb = src[r + S_VALID];
    if (nb === 0) continue;
    const na = dst[q + S_VALID], n = na + nb;
    dst[q + S_VALID] = n;
    dst[q + S_SUM] += src[r + S_SUM];
    if (src[r + S_MIN] < dst[q + S_MIN]) dst[q + S_MIN] = src[r + S_MIN];
    if (src[r + S_MAX] > dst[q + S_MAX]) dst[q + S_MAX] = src[r + S_MAX];
    if (variance) {
      const delta = src[r + S_MEAN] - dst[q + S_MEAN];
      dst[q + S_MEAN] += (delta * nb) / n;
      dst[q + S_M2] += src[r + S_M2] + (delta * delta * na * nb) / n;
    }
  }
}

/**
 * Source of `function groupKey(i)`, which computes the group key of row i
 * exactly as the aggregation kernel of `spec` does (bin and dictionary
 * dimensions; fp as in paramCount). Used to write per-group results back
 * to every row (joinaggregate).
 */
export function groupKeySource(spec: KernelSpec): string {
  const lines: string[] = [];
  const used = new Set<number>();
  spec.dims.forEach(d => used.add(d.col));
  for (const c of used) lines.push(`const g${c} = cols[${c}];`);
  let p = 0;
  for (const f of spec.filters) if (f.kind === "range") p += 2;
  let stride = 1;
  const body: string[] = [];
  spec.dims.forEach((d, j) => {
    if (d.kind === "bin") {
      lines.push(`const gbs${j} = fp[${p}], gbp${j} = fp[${p + 1}], gbl${j} = fp[${p + 2}], gbt${j} = fp[${p + 3}];`);
      p += 4;
      const nb = d.nb;
      body.push(
        `x = g${d.col}[i];` +
          ` if (x !== x) k += ${(nb + BIN_NULL) * stride};` +
          ` else if (gbs${j} !== gbs${j}) k += ${(nb + BIN_POS_INF) * stride};` +
          ` else if (x < gbs${j}) k += ${(nb + BIN_NEG_INF) * stride};` +
          ` else if (x > gbp${j}) k += ${(nb + BIN_POS_INF) * stride};` +
          ` else { x = Math.max(gbs${j}, Math.min(x, gbl${j}));` +
          ` b = Math.floor(${EPSILON} + (x - gbs${j}) / gbt${j});` +
          ` if (b > ${nb - 1}) b = ${nb - 1};` +
          ` k += b * ${stride}; }`,
      );
    } else if (d.kind === "dict") {
      body.push(`k += g${d.col}[i] * ${stride};`);
    } else {
      throw new Error("groupKeySource: bucket dimensions are not supported");
    }
    stride *= dimCard(d);
  });
  return `${lines.join("\n")}\nfunction groupKey(i) { let x, b, k = 0; ${body.join(" ")} return k; }`;
}
