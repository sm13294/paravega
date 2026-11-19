# ParaVega

ParaVega runs unchanged [Vega](https://vega.github.io/vega/) and
[Vega-Lite](https://vega.github.io/vega-lite/) specifications in parallel, on
all cores of the browser. It replaces Vega's dataflow operators with parallel
forms that pass columnar relations instead of tuples, evaluates every
transform with the parallel programming patterns of
[ParaWeb](https://github.com/sm13294/paraweb-js) (Filter, MapReduce, Scan,
Divide and Conquer, Farm), keeps the data resident in shared memory between
interactions, and draws large symbol marks in Web Workers. Moving brushes can
be answered from an exact pre-aggregation index.

**Live demo:** <https://sm13294.github.io/paravega/>. The same crossfilter
dashboard on stock Vega and on ParaVega, with a live view of how long the page
stops responding.

On ten unchanged Vega and Vega-Lite specifications with one million rows,
ParaVega reduces the latency of an interaction in Chrome by a factor of 7.9 to
241 compared with stock Vega 6.4, with the same results, and needs less
memory.

## Usage

```js
import * as vega from "vega";
import * as vl from "vega-lite";
import { registerParaweb } from "paravega"; // added

registerParaweb(vega);                        // added: once per page

const spec = vl.compile(myVegaLiteSpec).spec; // unchanged
const view = new vega.View(vega.parse(spec), { container: "#chart" });
await view.runAsync();
```

The specification, the creation of the view and every interaction with it stay
as they are. The page must be served with cross-origin isolation, which
browsers require for shared memory:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Without these headers, ParaVega leaves Vega unchanged and the page runs on stock
Vega. Operators that ParaVega cannot run in parallel run on Vega's own
implementation, so a view keeps its semantics. ParaVega works with Vega 6 and
Vega 5.33.

Install from GitHub (ParaWeb 1.1 is installed with it):

```bash
npm install github:sm13294/paravega vega
```

## What runs in parallel

| Vega operator | ParaWeb patterns |
|---|---|
| `filter` (expressions, Vega-Lite selections) | Filter with change detection |
| `formula`, `bin`, `timeunit` | Map, fused into the consumer's kernel |
| `lookup` | Map over a table indexed by dictionary code |
| `extent` | Reduce |
| `aggregate` (incl. `median`, `q1`, `q3`) | MapReduce; quantiles with a parallel sort |
| `joinaggregate` | MapReduce, then Map writing group results to rows |
| sorted `collect` | Divide and Conquer (sample sort) |
| `window` | sort, then a three-phase Scan |
| `kde` (density) | MapReduce in rounds |
| symbol marks (`datajoin`, `encode`, `bound`) | Map, drawn in canvas stripes in the workers |
| the dataflow's evaluation loop | Farm (independent operators run concurrently) |

Options of `registerParaweb(vega, options)`: `threads`, `preaggregate`
(exact index for brushes), `gpu` (WebGPU backend for counts), `denseMarks`,
`minRows`, `farm`, `onFallback`. See [docs/reference.md](docs/reference.md)
and [docs/design-notes.md](docs/design-notes.md).

## Repository

| Folder | Contents |
|---|---|
| `src/` | ParaVega (TypeScript); built into `dist/paraweb-vega.mjs` and `.cjs` |
| `showcase/` | The live demo (static site; deployed to GitHub Pages) |
| `demo/` | Benchmark pages: crossfilter dashboards, scatterplot, unchanged specifications, dense marks |
| `bench/` | Benchmark drivers (headless Chrome) and the campaign script |
| `test/` | Differential tests against stock Vega; `test/browser/` runs them in Chromium |
| `benchmark-results/` | The results reported in the paper |

```bash
npm install
npm run build            # dist/ and the benchmark bundles
npm test                 # differential tests against stock Vega (Node.js)
npm run test:browser     # the same tests, and ParaWeb's resident runtime, in Chromium
npm run serve            # http://localhost:8790/demo/crossfilter.html (cross-origin isolated)
npm run showcase         # builds the demo into showcase/site/
node bench/operators-browser.cjs   # unchanged specifications in Chrome
bash bench/run-campaign.sh --reps=5   # brushing benchmark against Vega, Mosaic and Falcon
```

The brushing benchmark on real data needs the flights-10m data set, converted
with `node bench/convert-flights.mjs <flights-10m.parquet> data/flights`.

## License

[MIT](LICENSE). Vega's browser build in the showcase is
distributed under its own BSD-3-Clause license (`LICENSE-vega.txt`).
