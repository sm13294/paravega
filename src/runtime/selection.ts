/**
 * Vega-Lite selections in compiled expressions.
 *
 * Vega-Lite compiles a selection filter, such as { filter: { param: "brush" } },
 * to an expression that calls vlSelectionTest("brush_store", datum), which
 * reads the entries of the selection's store data set. A kernel cannot read
 * a data set, so ParaVega specializes the call, at every evaluation, into
 * plain expression code for the entries the store holds at that moment,
 * with the same semantics as vega-selections' selectionTest: the entry
 * values become parameters, so moving a brush changes only parameters and
 * reuses the compiled kernel. When the store holds one interval, the test
 * is also returned as range predicates, which the pre-aggregation index can
 * answer.
 */

const TEST_RE = /this\.vlSelectionTest\("([^"\\]+)",datum(?:,"(union|intersect)")?\)/g;
const DATA_RE = /this\.data\("([^"\\]+)"\)/g;
const BRUSH_RE = /^\(?\(!this\.data\("([^"\\]+)"\)\.length\)\|\|this\.vlSelectionTest\("([^"\\]+)",datum(?:,"(union|intersect)")?\)\)?$/;

const isDate = (x: any) => Object.prototype.toString.call(x) === "[object Date]";
const dnum = (x: any) => (isDate(x) ? +x : x);

interface Entry { unit: any; fields: { field: string; type: string }[]; values: any[] }

function entriesOf(_: any, store: string): Entry[] | null {
  const tuples = _[":" + store];
  if (!Array.isArray(tuples)) return null;
  const out: Entry[] = [];
  for (const t of tuples) {
    if (!t || !Array.isArray(t.fields) || !Array.isArray(t.values)) return null;
    const fields = t.fields.map((f: any) => ({ field: f.field, type: f.type ?? "E" }));
    if (fields.some((f: any) => typeof f.field !== "string" || /[.[\]\\]/.test(f.field))) return null;
    // Vega converts dates to numbers in place when it tests a store entry.
    const values = t.values.map((v: any) => (Array.isArray(v) ? v.map(dnum) : dnum(v)));
    out.push({ unit: t.unit, fields, values });
  }
  return out;
}

function fieldTest(type: string, d: string, V: string, isArray: boolean): string | null {
  switch (type) {
    case "E": return isArray ? `this.vlIncl(${V},${d})` : `(${d} === ${V})`;
    case "R": return `this.inrange(${d},${V})`;
    case "R-RE": return `this.inrange(${d},${V},true,false)`;
    case "R-E": return `this.inrange(${d},${V},false,false)`;
    case "R-LE": return `this.inrange(${d},${V},false,true)`;
    case "E-LT": return `(!(${d} >= ${V}))`;
    case "E-LTE": return `(!(${d} > ${V}))`;
    case "E-GT": return `(!(${d} <= ${V}))`;
    case "E-GTE": return `(!(${d} < ${V}))`;
    case "E-VALID": return `(!(${d} === null || isNaN(${d})))`;
    case "E-ONE": return `(${V}.indexOf(${d}) !== -1)`;
    default: return null;
  }
}

export interface Specialized {
  code: string;
  /** Parameter values for the generated `_["#..."]` reads. */
  extra: Record<string, any>;
}

/**
 * Replace vlSelectionTest and data() calls by code for the current store
 * entries. Returns null when the code reads a store that is not available
 * as a parameter, or a store entry that cannot be specialized.
 */
export function specializeSelections(code: string, _: any): Specialized | null {
  const extra: Record<string, any> = {};
  let failed = false;
  const store = (name: string) => {
    const k = "#sel:" + name;
    if (!(k in extra)) {
      const e = entriesOf(_, name);
      if (!e) { failed = true; return null; }
      extra[k] = e.map(x => x.values);
      extra["#data:" + name] = e.map(x => ({ unit: x.unit, fields: x.fields, values: x.values }));
    }
    return extra["#data:" + name] as Entry[];
  };
  let out = code.replace(TEST_RE, (_m, name: string, op?: string) => {
    const entries = store(name);
    if (!entries) return "false";
    if (!entries.length) return "0";
    const V = (e: number, i: number) => `_[${JSON.stringify("#sel:" + name)}][${e}][${i}]`;
    const tests = entries.map((en, e) => {
      const parts = en.fields.map((f, i) => fieldTest(f.type, `this.vlDnum(datum[${JSON.stringify(f.field)}])`, V(e, i), Array.isArray(en.values[i])));
      if (parts.some(p => p === null)) { failed = true; return "false"; }
      return parts.length ? "(" + parts.join("&&") + ")" : "true";
    });
    if (op !== "intersect") return "(" + tests.join("||") + ")";
    // Union within a unit, intersection across units (selectionTest with a unit index).
    const units = new Map<any, string[]>();
    entries.forEach((en, e) => {
      const u = units.get(en.unit) || [];
      u.push(tests[e]);
      units.set(en.unit, u);
    });
    return "(" + [...units.values()].map(t => "(" + t.join("||") + ")").join("&&") + ")";
  });
  out = out.replace(DATA_RE, (_m, name: string) => {
    store(name);
    return `_[${JSON.stringify("#data:" + name)}]`;
  });
  return failed ? null : { code: out, extra };
}

export function readsSelection(code: string): boolean {
  return code.includes("this.vlSelectionTest(") || code.includes("this.data(");
}

export interface BrushRange { field: string; value: [number, number] }

/**
 * The Vega-Lite brush filter `!length(data(S)) || vlSelectionTest(S, datum)`
 * with one store entry of inclusive ranges: the ranges per field (an empty
 * array when the store is empty, which passes every row). Null for any
 * other form.
 */
export function brushRanges(conj: string, _: any): BrushRange[] | null {
  const m = BRUSH_RE.exec(conj);
  if (!m || m[1] !== m[2]) return null;
  const entries = entriesOf(_, m[1]);
  if (!entries) return null;
  if (entries.length === 0) return [];
  if (entries.length !== 1) return null;
  const e = entries[0];
  const out: BrushRange[] = [];
  for (let i = 0; i < e.fields.length; i++) {
    const v = e.values[i];
    if (e.fields[i].type !== "R" || !Array.isArray(v) || v.length < 1) return null;
    let lo = v[0], hi = v[v.length - 1];
    if (typeof lo !== "number" || typeof hi !== "number") return null;
    if (lo > hi) { const t = lo; lo = hi; hi = t; }
    out.push({ field: e.fields[i].field, value: [lo, hi] });
  }
  return out;
}
