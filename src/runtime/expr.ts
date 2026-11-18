/**
 * Vega expressions as ParaWeb kernels.
 *
 * Vega compiles every expression of a specification to JavaScript source
 * (vega-functions' codegen), such as
 *   ((!_["$r"])||((datum.a >= _["$r"][0])&&(datum.a <= _["$r"][1])))
 * in which `datum.f` reads a field, `_["$s"]` a signal or parameter, and
 * `this.f(...)` a function of Vega's expression library. ParaVega records
 * this source when the dataflow is built (see recordExpressionSource) and
 * rewrites it into the body of a row kernel: field reads become reads of
 * resident columns at row i, parameters are read from the call's args, and
 * library functions come from a small library with the same definitions as
 * Vega's. Expressions that use anything else (the whole datum, events,
 * scales, data sets) are not compiled, and the operator falls back to Vega.
 */

type Tok = { t: "id" | "num" | "str" | "punct" | "ws"; v: string };

const PUNCT3 = ["===", "!==", ">>>", "..."];
const PUNCT2 = ["==", "!=", "<=", ">=", "&&", "||", "<<", ">>", "**", "?."];

function tokenize(src: string): Tok[] | null {
  const out: Tok[] = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (/\s/.test(c)) {
      let j = i + 1;
      while (j < n && /\s/.test(src[j])) j++;
      out.push({ t: "ws", v: src.slice(i, j) });
      i = j;
    } else if (/[A-Za-z_$]/.test(c)) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_$]/.test(src[j])) j++;
      out.push({ t: "id", v: src.slice(i, j) });
      i = j;
    } else if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      let j = i + 1;
      while (j < n && /[0-9a-fA-FxXoObBeE.]/.test(src[j])) {
        if ((src[j] === "e" || src[j] === "E") && (src[j + 1] === "+" || src[j + 1] === "-")) j++;
        j++;
      }
      out.push({ t: "num", v: src.slice(i, j) });
      i = j;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c) j += src[j] === "\\" ? 2 : 1;
      if (j >= n) return null;
      out.push({ t: "str", v: src.slice(i, j + 1) });
      i = j + 1;
    } else if (c === "`" || c === "/") {
      // Template literals and regular expressions are not compiled.
      if (c === "/") { out.push({ t: "punct", v: c }); i++; continue; }
      return null;
    } else {
      const three = src.slice(i, i + 3), two = src.slice(i, i + 2);
      const p = PUNCT3.includes(three) ? three : PUNCT2.includes(two) ? two : c;
      out.push({ t: "punct", v: p });
      i += p.length;
    }
  }
  return out;
}

/**
 * Expression library for kernels: the same definitions as Vega's
 * expression functions (vega-util and vega-functions), for the functions
 * that need no other state.
 */
export const LIBRARY: Record<string, string> = {
  isValid: "(_) => _ != null && _ === _",
  isDefined: "(_) => _ !== undefined",
  isNumber: "(_) => typeof _ === 'number'",
  isString: "(_) => typeof _ === 'string'",
  isBoolean: "(_) => typeof _ === 'boolean'",
  isDate: "(_) => Object.prototype.toString.call(_) === '[object Date]'",
  isArray: "Array.isArray",
  toNumber: "(_) => _ == null || _ === '' ? null : +_",
  toString: "(_) => _ == null || _ === '' ? null : _ + ''",
  toBoolean: "(_) => _ == null || _ === '' ? null : !_ || _ === 'false' || _ === '0' ? false : !!_",
  toDate: "(_) => _ == null || _ === '' ? null : (typeof _ === 'number' ? _ : Object.prototype.toString.call(_) === '[object Date]' ? _ : Date.parse(_))",
  inrange: `(value, range, left, right) => {
    let r0 = range[0], r1 = range[range.length - 1], t;
    if (r0 > r1) { t = r0; r0 = r1; r1 = t; }
    left = left === undefined || left; right = right === undefined || right;
    return (left ? r0 <= value : r0 < value) && (right ? value <= r1 : value < r1); }`,
  indexof: "(seq, ...a) => (Array.isArray(seq) || typeof seq === 'string' ? seq : []).indexOf(...a)",
  lastindexof: "(seq, ...a) => (Array.isArray(seq) || typeof seq === 'string' ? seq : []).lastIndexOf(...a)",
  lerp: "(array, frac) => { const lo = array[0], hi = array[array.length - 1]; return lo + frac * (hi - lo); }",
  span: "(array) => array && array.length ? array[array.length - 1] - array[0] : 0",
  // Helpers of specialized Vega-Lite selection tests (see selection.ts).
  vlDnum: "(x) => Object.prototype.toString.call(x) === '[object Date]' ? +x : x",
  vlIncl: "(arr, x) => arr.includes(x)",
};

/** Globals that generated Vega code may use and that behave the same in a worker. */
const GLOBALS = new Set([
  "Math", "Number", "String", "Boolean", "Date", "NaN", "Infinity", "undefined", "null",
  "true", "false", "new", "typeof", "in", "void", "isNaN", "isFinite", "parseInt", "parseFloat",
]);

export interface ExprInfo {
  /** Vega's generated source. */
  code: string;
  /** Fields of datum that are read. */
  fields: string[];
  /** Keys of `_` that are read (signals and parameters). */
  params: string[];
  /** Library functions that are called. */
  fns: string[];
  /** Why the expression cannot run as a kernel, or null. */
  unsupported: string | null;
  tokens: Tok[];
}

function strValue(tok: Tok): string {
  return JSON.parse(tok.v[0] === "'" ? '"' + tok.v.slice(1, -1).replace(/"/g, '\\"') + '"' : tok.v);
}

/** Parse Vega's generated source and decide whether it can run as a kernel. */
export function analyze(code: string): ExprInfo {
  const info: ExprInfo = { code, fields: [], params: [], fns: [], unsupported: null, tokens: [] };
  const toks = tokenize(code);
  if (!toks) { info.unsupported = "literal"; return info; }
  info.tokens = toks;
  const sig = toks.filter(t => t.t !== "ws");
  const add = (a: string[], v: string) => { if (!a.includes(v)) a.push(v); };
  for (let k = 0; k < sig.length; k++) {
    const tk = sig[k];
    if (tk.t !== "id") continue;
    const prev = sig[k - 1];
    if (prev && prev.t === "punct" && (prev.v === "." || prev.v === "?.")) continue; // property name
    const next = sig[k + 1], next2 = sig[k + 2], next3 = sig[k + 3];
    if (tk.v === "datum") {
      if (next && next.v === "." && next2 && next2.t === "id") add(info.fields, next2.v);
      else if (next && next.v === "[" && next2 && next2.t === "str" && next3 && next3.v === "]") add(info.fields, strValue(next2));
      else { info.unsupported = "datum"; return info; }
    } else if (tk.v === "_") {
      if (next && next.v === "[" && next2 && next2.t === "str" && next3 && next3.v === "]") add(info.params, strValue(next2));
      else { info.unsupported = "params"; return info; }
    } else if (tk.v === "this") {
      if (next && next.v === "." && next2 && next2.t === "id" && LIBRARY[next2.v]) add(info.fns, next2.v);
      else { info.unsupported = "function " + (next2 ? next2.v : "this"); return info; }
    } else if (!GLOBALS.has(tk.v)) {
      // A free identifier: the event, item, or a helper of the codegen.
      info.unsupported = "identifier " + tk.v; return info;
    }
  }
  return info;
}

/**
 * Rewrite the expression into kernel source. `field(name)` returns the
 * source that reads the field at row i; parameters are read from P and
 * library functions from F (see kernelPrelude).
 */
export function emit(info: ExprInfo, field: (name: string) => string): string {
  const toks = info.tokens;
  const out: string[] = [];
  const sigIdx: number[] = [];
  toks.forEach((t, i) => { if (t.t !== "ws") sigIdx.push(i); });
  const at = (s: number) => (s < sigIdx.length ? toks[sigIdx[s]] : undefined);
  let s = 0;
  while (s < sigIdx.length) {
    const tk = at(s)!;
    const prev = at(s - 1);
    const isProp = prev && prev.t === "punct" && (prev.v === "." || prev.v === "?.");
    if (tk.t === "id" && !isProp && tk.v === "datum") {
      const nx = at(s + 1)!;
      if (nx.v === ".") { out.push("(" + field(at(s + 2)!.v) + ")"); s += 3; continue; }
      out.push("(" + field(strValue(at(s + 2)!)) + ")"); s += 4; continue;
    }
    if (tk.t === "id" && !isProp && tk.v === "_") {
      out.push("P[" + at(s + 2)!.v + "]"); s += 4; continue;
    }
    if (tk.t === "id" && !isProp && tk.v === "this") {
      out.push("F." + at(s + 2)!.v); s += 3; continue;
    }
    out.push(tk.t === "id" || tk.t === "num" ? " " + tk.v + " " : tk.v);
    s++;
  }
  return out.join("");
}

/** Source that defines F with the library functions an expression uses. */
export function libraryPrelude(fns: Iterable<string>): string {
  const parts: string[] = [];
  for (const f of fns) parts.push(`${f}: ${LIBRARY[f]}`);
  return `const F = {${parts.join(",\n")}};`;
}

// ---------------------------------------------------------------------------
// Range predicates
// ---------------------------------------------------------------------------

/** Split the source at top-level && into conjuncts (outer parentheses removed). */
export function conjuncts(code: string): string[] {
  const strip = (s: string): string => {
    s = s.trim();
    while (s.startsWith("(") && s.endsWith(")") && matching(s) === s.length - 1) s = s.slice(1, -1).trim();
    return s;
  };
  const matching = (s: string): number => {
    let d = 0, q: string | null = null;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (q) { if (c === "\\") i++; else if (c === q) q = null; continue; }
      if (c === '"' || c === "'") q = c;
      else if (c === "(") d++;
      else if (c === ")") { d--; if (d === 0) return i; }
    }
    return -1;
  };
  const split = (s: string): string[] => {
    const parts: string[] = [];
    let d = 0, q: string | null = null, last = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (q) { if (c === "\\") i++; else if (c === q) q = null; continue; }
      if (c === '"' || c === "'") q = c;
      else if (c === "(" || c === "[" || c === "{") d++;
      else if (c === ")" || c === "]" || c === "}") d--;
      else if (d === 0 && c === "&" && s[i + 1] === "&") { parts.push(s.slice(last, i)); last = i + 2; i++; }
      else if (d === 0 && (c === "|" && s[i + 1] === "|" || c === "?")) return [s];
    }
    parts.push(s.slice(last));
    return parts;
  };
  const out: string[] = [];
  const walk = (s: string) => {
    const t = strip(s);
    const p = split(t);
    if (p.length === 1) out.push(t);
    else p.forEach(walk);
  };
  walk(code);
  return out;
}

export interface RangeConjunct {
  field: string;
  /** Signal holding [lo, hi] or null (null disables the predicate). */
  param: string;
}

const FIELD = String.raw`datum(?:\.([A-Za-z_$][\w$]*)|\["([^"\\]+)"\])`;
const PARAM = String.raw`_\["([^"\\]+)"\]`;
const RANGE_RE = new RegExp(
  String.raw`^\(?\s*!\s*${PARAM}\s*\)?\s*\|\|\s*\(\s*\(\s*${FIELD}\s*>=\s*${PARAM}\s*\[\s*0\s*\]\s*\)\s*&&\s*\(\s*${FIELD}\s*<=\s*${PARAM}\s*\[\s*1\s*\]\s*\)\s*\)$`,
);

/**
 * Recognise `!s || (datum.f >= s[0] && datum.f <= s[1])`, the brush test that
 * Vega specifications write by hand. With a numeric column without missing
 * values, it is the same predicate as a range filter, which the
 * pre-aggregation index can answer.
 */
export function matchRange(conj: string): RangeConjunct | null {
  const m = RANGE_RE.exec(conj.replace(/\s+/g, " ").trim());
  if (!m) return null;
  const p0 = m[1], f1 = m[2] ?? m[3], p1 = m[4], f2 = m[5] ?? m[6], p2 = m[7];
  if (p0 !== p1 || p1 !== p2 || f1 !== f2) return null;
  return { field: f1, param: p0 };
}
