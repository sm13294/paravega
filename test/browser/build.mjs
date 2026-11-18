// Browser bundles of the tests and measurements that were written for Node.js,
// so that they run in Chromium (see run.cjs):
//   correctness  test/correctness.cjs, unchanged (kernels against stock Vega)
//   operators    test/operators.cjs, unchanged except that it imports its demo
//                specification module statically instead of by file path
//   resident     src/test/testResident.ts, unchanged except that its pools use
//                browser Web Workers instead of worker_threads, and ParaWeb's
//                per-call patterns are the browser ones (shims/paraweb.js)
//   copycost     copycost.js (bench/copycost.cjs for the browser)
//   scenes       scenes.js (test/vega-scenes.cjs for the browser)
// Output: dist/browser-tests/<name>.js
import * as esbuild from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const out = path.resolve(here, "../../dist/browser-tests");
const shim = p => path.join(here, "shims", p);

const nodeToBrowser = {
  name: "node-to-browser",
  setup(b) {
    b.onResolve({ filter: /^\.\.\/dist\/paraweb-vega\.cjs$/ }, () => ({ path: path.join(root, "src/index.ts") }));
    b.onResolve({ filter: /^\.\/vega-env\.cjs$/ }, () => ({ path: shim("vega-env.js") }));
    b.onResolve({ filter: /^\.\.\/index$/ }, a => (a.importer.endsWith("testResident.ts") ? { path: shim("paraweb.js") } : undefined));
    b.onLoad({ filter: /test\/operators\.cjs$/ }, a => ({
      contents: fs.readFileSync(a.path, "utf8")
        .replace('const path = require("path");', "")
        .replace('await import(path.join(__dirname, "../demo/crossfilterSpec.js"))', 'await import("../demo/crossfilterSpec.js")'),
      loader: "js",
    }));
    b.onLoad({ filter: /testResident\.ts$/ }, a => ({
      contents: fs.readFileSync(a.path, "utf8").replace(/\bnodeWorkerFactory\b/g, "browserWorkerFactory"),
      loader: "ts",
    }));
  },
};

const entries = {
  correctness: path.join(root, "test/correctness.cjs"),
  operators: path.join(root, "test/operators.cjs"),
  // ParaWeb's own resident tests, from the installed paraweb-js package (its TypeScript sources).
  resident: path.join(root, "node_modules/paraweb-js/src/test/testResident.ts"),
  copycost: path.join(here, "copycost.js"),
  scenes: path.join(here, "scenes.js"),
  memprobe: path.join(here, "memprobe.js"),
};
for (const [name, entry] of Object.entries(entries)) {
  await esbuild.build({
    entryPoints: [entry], bundle: true, format: "esm", platform: "browser", target: "es2022",
    outfile: path.join(out, name + ".js"), inject: [shim("process.js")], plugins: [nodeToBrowser],
    external: ["webgpu", "crypto", "node:worker_threads", "worker_threads"],
    logOverride: { "direct-eval": "silent" }, logLevel: "warning",
  });
}
console.log("built browser tests: " + Object.keys(entries).join(", "));
