// test/vega-scenes.cjs in the browser: Vega's own scenegraph test with
// ParaVega's operators. The driver serves Vega's test directory
// (packages/vega/test of the Vega repository) at /vegatest/. Every valid
// example specification runs, and its scenegraph is compared with Vega's
// expected one by vega.sceneEqual, as in Vega's test. ?stock=1 runs without
// ParaVega; ?minRows=0 (default) puts every supported operator on the
// parallel path; dense marks are off (they replace items by stripes).
import { registerParaweb } from "../../src/index";

const q = new URLSearchParams(location.search);
const stock = q.get("stock") === "1";
const minRows = Number(q.get("minRows") ?? 0);
const vega = globalThis.vega;
const get = async p => { const r = await fetch("/vegatest/" + p); if (!r.ok) throw new Error(p + ": " + r.status); return r.json(); };

vega.textMetrics.canvas(false);
const loader = vega.loader({ baseURL: location.origin + "/vegatest/" });
const specs = (await get("specs-valid.json")).filter(s => s !== "wordcloud").filter(s => !q.get("specs") || q.get("specs").split(",").includes(s));
const fallbacks = new Map(), parallel = new Map();
const pw = stock ? null : registerParaweb(vega, {
  threads: 4, minRows, denseMarks: false,
  onFallback: (t, r) => { const k = `${t}: ${r}`; fallbacks.set(k, (fallbacks.get(k) || 0) + 1); },
});
let pass = 0;
const failed = [];
for (const name of specs) {
  vega.setRandom(vega.randomLCG(123456789));
  try {
    const spec = await get(`specs-valid/${name}.vg.json`);
    const view = new vega.View(vega.parse(spec), { loader, renderer: "none" }).finalize();
    let timer;
    const done = await Promise.race([view.runAsync().then(() => true), new Promise(r => { timer = setTimeout(() => r(false), 20000); })]);
    clearTimeout(timer);
    if (!done) { failed.push(name + " (timeout)"); continue; }
    for (const op of Object.values(view._runtime.nodes)) {
      if (!op._pwParallel || op._pwFallback) continue;
      if (op._pwRel || op._pwLastSig || op._pwDenseRel) {
        const t = Object.keys(vega.transforms).find(k => vega.transforms[k] === op.constructor) || "?";
        parallel.set(t, (parallel.get(t) || 0) + 1);
      }
    }
    const actual = JSON.parse(view.scenegraph().toJSON(2));
    const expect = await get(`scenegraphs/${name}.json`);
    if (vega.sceneEqual(actual, expect)) pass++; else failed.push(name);
    if (q.get("dump") === name) globalThis.__pwDump = { actual, expect };
  } catch (e) {
    failed.push(name + " (error: " + String(e && e.message).slice(0, 80) + ")");
  }
}
if (pw) pw.terminate();
console.log(`${stock ? "stock Vega" : "ParaVega, minRows " + minRows} (Vega ${vega.version}, browser): ${pass}/${specs.length} scenegraphs equal to Vega's expected ones`);
if (failed.length) console.log("differ: " + failed.join(", "));
if (parallel.size) console.log("ran in parallel (operator: count): " + [...parallel].sort((a, b) => b[1] - a[1]).map(([k, c]) => `${k} ${c}`).join(", "));
if (fallbacks.size) { console.log("fallbacks (operator: reason, count):"); for (const [k, c] of [...fallbacks].sort((a, b) => b[1] - a[1])) console.log("  " + c + "  " + k); }
globalThis.__pwResult = { pass, total: specs.length, failed, ...(globalThis.__pwDump ? { dump: globalThis.__pwDump } : {}) };
globalThis.__pwExit = 0;
