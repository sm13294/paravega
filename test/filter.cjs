/**
 * pwfilter must select exactly the rows Vega's filter selects, after every
 * update, in both input modes. A downstream aggregate checks that the
 * incremental add/rem output keeps Vega's dataflow consistent.
 *
 *   node test/filter.cjs
 */
let vega, vl; // loaded in the main function (see test/vega-env.cjs)
const seedrandom = require("seedrandom");
const { registerParaweb } = require("../dist/paraweb-vega.cjs");

const N = 80000;
const rng = seedrandom("filter");
const cats = ["a", "b", "c", "d"];
const rows = Array.from({ length: N }, (_, id) => ({
  id,
  x: Math.round(rng() * 1000) / 10,
  y: (rng() - 0.5) * 200,
  c: cats[Math.floor(rng() * cats.length)],
}));
const columns = {
  id: Float64Array.from(rows, r => r.id),
  x: Float64Array.from(rows, r => r.x),
  y: Float64Array.from(rows, r => r.y),
  c: rows.map(r => r.c),
};

// Updates of the two brushes and the category set, including empty results,
// everything selected, cleared brushes and repeated identical values.
const updates = [
  { bx: [10, 20], by: null, sel: null },
  { bx: [10, 25], by: null, sel: null },
  { bx: [10, 25], by: [-50, 0], sel: null },
  { bx: [10, 25], by: [-50, 0], sel: ["a", "c"] },
  { bx: [200, 300], by: [-50, 0], sel: ["a", "c"] },
  { bx: null, by: null, sel: null },
  { bx: [0, 100], by: [-100, 100], sel: ["a", "b", "c", "d"] },
  { bx: [55.5, 55.5], by: null, sel: ["b"] },
  { bx: [55.5, 55.5], by: null, sel: ["b"] },
  { bx: [30, 70], by: [20, -20], sel: [] },
  { bx: [30, 70], by: [20, -20], sel: null },
];

const signals = [{ name: "bx", value: null }, { name: "by", value: null }, { name: "sel", value: null }];

function stockSpec() {
  const pred =
    "(!bx || (datum.x >= min(bx[0], bx[1]) && datum.x <= max(bx[0], bx[1]))) && " +
    "(!by || (datum.y >= min(by[0], by[1]) && datum.y <= max(by[0], by[1]))) && " +
    "(!sel || indexof(sel, datum.c) >= 0)";
  return {
    signals,
    data: [
      { name: "src", values: rows.map(r => ({ ...r })) },
      { name: "out", source: "src", transform: [{ type: "filter", expr: pred }] },
      { name: "agg", source: "out", transform: [{ type: "aggregate", groupby: ["c"] }] },
    ],
  };
}

function pwSpec(mode) {
  const t = {
    type: "pwfilter",
    filter: [
      { field: "x", range: { signal: "bx" } },
      { field: "y", range: { signal: "by" } },
      { field: "c", oneOf: { signal: "sel" } },
    ],
  };
  const data = mode === "table"
    ? [{ name: "out", transform: [{ ...t, table: "t", fields: ["id", "x", "y", "c"] }] }]
    : [{ name: "src", values: rows.map(r => ({ ...r })) }, { name: "out", source: "src", transform: [t] }];
  data.push({ name: "agg", source: "out", transform: [{ type: "aggregate", groupby: ["c"] }] });
  return { signals, data };
}

const ids = view => view.data("out").map(r => r.id).sort((a, b) => a - b).join(",");
const agg = view => view.data("agg").map(r => `${r.c}:${r.count}`).sort().join(",");

async function evaluate(spec) {
  const view = new vega.View(vega.parse(spec), { renderer: "none" });
  await view.runAsync();
  const out = [];
  for (const u of updates) {
    view.signal("bx", u.bx); view.signal("by", u.by); view.signal("sel", u.sel);
    await view.runAsync();
    out.push({ ids: ids(view), agg: agg(view), n: view.data("out").length });
  }
  view.finalize();
  return out;
}

(async () => {
  ({ vega, vl } = await require("./vega-env.cjs").loadVega());
  const ref = await evaluate(stockSpec());
  let fails = 0, checks = 0;
  for (const threads of [1, 3, 16]) {
    const pw = registerParaweb(vega, { threads, operators: false });
    pw.registerTable("t", columns);
    for (const mode of ["tuples", "table"]) {
      const got = await evaluate(pwSpec(mode));
      got.forEach((g, s) => {
        checks++;
        if (g.ids !== ref[s].ids || g.agg !== ref[s].agg) {
          fails++;
          console.log(`FAIL threads=${threads} ${mode} update ${s}: ${g.n} rows (expected ${ref[s].n}); agg ${g.agg} vs ${ref[s].agg}`);
        }
      });
      console.log(`threads=${threads} ${mode}: selections ${got.map(g => g.n).join(" ")}`);
    }
    pw.terminate();
  }
  console.log(`${checks - fails}/${checks} checks passed`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
