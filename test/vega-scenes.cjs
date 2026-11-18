/**
 * Vega's own scenegraph test (packages/vega/test/scene-test.js of the Vega
 * repository) with ParaVega's operators: every valid example specification
 * of Vega's test suite is run, and its scenegraph is compared with Vega's
 * expected scenegraph by vega.sceneEqual, as in Vega's test.
 *
 *   git clone --depth 1 --branch v5.33.1 https://github.com/vega/vega.git <dir>
 *   npm run vega:build && node test/vega-scenes.cjs <dir>/packages/vega/test [minRows]
 *
 * minRows defaults to 0, so that every operator ParaVega supports runs on
 * the parallel path even though the example data sets are small. Dense
 * marks are off: they replace a symbol mark's items by stripes, which
 * changes the scenegraph by design. Also run without ParaVega (STOCK=1) as
 * the baseline, since some scenes differ on other machines (fonts, canvas).
 */
const path = require("path");
const fs = require("fs");
const ROOT = path.resolve(__dirname, "..");
let vega, vl; // loaded in the main function (see test/vega-env.cjs)
const { registerParaweb } = require(path.join(ROOT, "dist/paraweb-vega.cjs"));

const dir = process.argv[2];
if (!dir) { console.error("usage: vega-scenes.cjs <vega>/packages/vega/test [minRows]"); process.exit(1); }
const minRows = Number(process.argv[3] ?? 0);
const stock = !!process.env.STOCK;

const specs = require(path.join(dir, "specs-valid.json")).filter(s => s !== "wordcloud")
  .filter(s => !process.env.SPECS || process.env.SPECS.split(",").includes(s));

(async () => {
  ({ vega, vl } = await require("./vega-env.cjs").loadVega());
  vega.textMetrics.canvas(false);
  const loader = vega.loader({ baseURL: dir + "/" });
  const fallbacks = new Map(), parallel = new Map();
  const pw = stock ? null : registerParaweb(vega, {
    threads: 4, minRows, denseMarks: false,
    onFallback: (t, r) => { const k = `${t}: ${r}`; fallbacks.set(k, (fallbacks.get(k) || 0) + 1); },
  });
  let pass = 0;
  const failed = [];
  for (const name of specs) {
    // Same seeded random numbers for every specification, as when Vega's test runs it alone.
    vega.setRandom(vega.randomLCG(123456789));
    try {
      const spec = JSON.parse(fs.readFileSync(path.join(dir, "specs-valid", name + ".vg.json"), "utf8"));
      const view = new vega.View(vega.parse(spec), { loader, renderer: "none" }).finalize();
      // A specification that does not finish within 20 s counts as a failure (and is named).
      let timer;
      const done = await Promise.race([view.runAsync().then(() => true), new Promise(r => { timer = setTimeout(() => r(false), 20000); })]);
      clearTimeout(timer);
      if (!done) { failed.push(name + " (timeout)"); continue; }
      // Operators that ran on the parallel path (produced a relation or a parallel result).
      for (const op of Object.values(view._runtime.nodes)) {
        if (!op._pwParallel || op._pwFallback) continue;
        if (op._pwRel || op._pwLastSig || op._pwDenseRel) {
          const t = Object.keys(vega.transforms).find(k => vega.transforms[k] === op.constructor) || "?";
          parallel.set(t, (parallel.get(t) || 0) + 1);
        }
      }
      const actual = JSON.parse(view.scenegraph().toJSON(2));
      const expect = JSON.parse(fs.readFileSync(path.join(dir, "scenegraphs", name + ".json"), "utf8"));
      if (vega.sceneEqual(actual, expect)) pass++; else failed.push(name);
    } catch (e) {
      failed.push(name + " (error: " + String(e && e.message).slice(0, 80) + ")");
    }
  }
  if (pw) pw.terminate();
  console.log(`${stock ? "stock Vega" : "ParaVega, minRows " + minRows}: ${pass}/${specs.length} scenegraphs equal to Vega's expected ones`);
  if (failed.length) console.log("differ: " + failed.join(", "));
  if (parallel.size) console.log("ran in parallel (operator: count): " + [...parallel].sort((a, b) => b[1] - a[1]).map(([k, c]) => `${k} ${c}`).join(", "));
  if (fallbacks.size) {
    console.log("fallbacks (operator: reason, count):");
    for (const [k, c] of [...fallbacks].sort((a, b) => b[1] - a[1])) console.log("  " + c + "  " + k);
  }
  process.exit(0);
})();
