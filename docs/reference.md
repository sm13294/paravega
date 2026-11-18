# ParaVega reference

A parallel runtime for Vega built on the ParaWeb execution model. After
`registerParaweb(vega)`, unchanged Vega and Vega-Lite specifications run on
parallel forms of Vega's own operators: they pass columnar relations instead
of tuples, compile chains of transforms into kernels over SharedArrayBuffer
columns that stay resident in a persistent Web Worker pool, evaluate
independent operators concurrently, and encode and draw large symbol marks in
the workers. An interaction sends only new parameters to the workers. The
explicit `pwaggregate` and `pwfilter` transforms (below) remain for
registered columnar tables.

## Parallel operators

`registerParaweb(vega)` replaces these operator types with subclasses of
Vega's classes (`terminate()` restores Vega's):

| Vega operator | ParaWeb patterns |
|---|---|
| `filter` (expressions, Vega-Lite selections) | Filter with change detection |
| `formula`, `bin`, `timeunit` | Map, fused into the consumer's kernel |
| `lookup` | Map over a table indexed by dictionary code |
| `extent` | Reduce |
| `aggregate` (incl. `median`, `q1`, `q3`) | MapReduce; quantiles with a parallel sort |
| `joinaggregate` | MapReduce, then Map writing group results to rows |
| sorted `collect` | Divide and Conquer (sample sort: Map, Scan, Scatter, Map) |
| `window` (ranks, aggregates, frames, lag/lead/first/last/nth) | sort, then a three-phase Scan; sums and means per partition in Vega's order |
| `kde` (density) | MapReduce in rounds, sort for quartiles |
| `relay`, `sieve` | pass relations; tuples only on demand |
| `datajoin`, `encode`, `bound` of symbol marks | Map (encode, bounds), Map over canvas stripes (draw) |
| the dataflow's evaluation loop | Farm (independent parallel operators run concurrently) |

Every operator falls back to Vega's implementation (sticky, reported through
`onFallback`) for small data (`minRows`, default 10000), expressions it cannot
compile, and unsupported parameters. Options: `operators` (default true),
`farm` (default true), `denseMarks` (rows, default 20000, or false),
`minRows`, `onFallback`, `onFarmStats`.

Tests: `test/operators.cjs` (differential, 21 cases vs stock Vega),
`test/dense.cjs` and `test/dense-browser.cjs` (dense marks). Benchmarks:
`bench/operators.cjs` (unchanged specs, Node), `bench/dense-browser.cjs`
(dense marks, Chrome).

## Usage

```js
import * as vega from "vega";
import { registerParaweb } from "paravega";

const pw = registerParaweb(vega, { threads: 8, preaggregate: true, gpu: true });
await pw.ready; // resolves once the WebGPU device is acquired (or gpu is unavailable)

// Optional: register columnar data so Vega never materialises the rows.
pw.registerTable("flights", { delay, distance, time }); // Float64Array over a SharedArrayBuffer is zero-copy

const view = new vega.View(vega.parse(spec));
await view.runAsync();
```

The page must be cross-origin isolated (`Cross-Origin-Opener-Policy: same-origin`,
`Cross-Origin-Embedder-Policy: require-corp`); `bench/serve.cjs` does this.

## `pwaggregate`

```json
{
  "type": "pwaggregate",
  "table": "flights",
  "filter": [
    { "field": "delay", "range": { "signal": "delayBrush" } },
    { "field": "carrier", "oneOf": { "signal": "carrierSel" } }
  ],
  "bins": [{ "field": "distance", "maxbins": 40, "as": ["bin0", "bin1"] }],
  "groupby": ["carrier"],
  "ops": ["count", "mean"],
  "fields": [null, "delay"],
  "as": ["n", "avg_delay"]
}
```

| Parameter | Meaning |
|---|---|
| `table` | Name of a registered table. Without it, the transform reads its input tuples and builds columns once per data change. |
| `filter` | Conjunction of predicates. `range: [lo, hi]` is inclusive; `oneOf: [...]` is set membership. A `null` range or set disables the predicate (an empty brush). |
| `bins` | Same options as Vega's `bin` transform (`extent`, `maxbins`, `step`, `steps`, `minstep`, `nice`, `anchor`, `base`, `divide`, `span`, `as`). Without `extent`, the full-table extent is computed in parallel and cached. |
| `groupby` | Fields to group by (dictionary encoded). |
| `ops` / `fields` / `as` | As in Vega's `aggregate`. Supported: `count valid missing sum mean average variance variancep stdev stdevp stderr min max`. |
| `name` | Label passed to the `onStats` callback. |
| `preagg` | Answer brush moves from an exact pre-aggregated cube (all supported ops). Defaults to the `preaggregate` option of `registerParaweb`. |
| `preaggResolution` | Number of fine buckets R for pre-aggregation (default 4096, reduced for large key spaces). |

### Exact pre-aggregation

With `registerParaweb(vega, { preaggregate: true })`, a `pwaggregate` that
sees only one range predicate change builds, in the background, a cube of
partial records (count, valid, sum, min, max, Welford mean and M2) by (fine
bucket of the brushed field x the view's groups), and a segment tree over the
buckets per group. Later moves of that brush merge O(log R) tree nodes per
group plus an exact scan of the rows in the two edge buckets, so results
equal a full scan for every supported op. See `docs/design-notes.md`, sections 9
and 23.

### WebGPU backend

With `gpu: true`, count views whose predicates are ranges and whose keys are
bins or dictionary fields run on the GPU (`ResidentGPU.groupCount` in
ParaWeb). Columns are uploaded once as order-preserving 32-bit key pairs, so
range predicates are exact; other views use the workers. See section 25.

### Differences from stock Vega

These apply to the explicit `pwaggregate` transform. The replaced operators
(above) follow Vega's semantics; their known differences are: aggregate sums
and means are combined across workers, so they can differ from Vega in the
last bits (window sums and means do not: they follow Vega's order);
materialized data sets list rows in row order, where Vega's incremental
collect may list them in another order; dense marks match Vega's pixels up to
antialiasing.

- NaN in a numeric field is treated as missing; Vega counts NaN as valid.
- Missing values never satisfy a range predicate; in a Vega expression `null >= 0` is true.
- Output groups are ordered by key, not by first appearance.
- Mean and variance merge per-worker Welford states (Chan et al.), so results
  agree with Vega within floating-point rounding (the test checks 1e-9 relative), not bit for bit.
- Ops that need the raw values (`median`, `q1`, `q3`, `distinct`, `values`, `argmin`, `argmax`, `ci0`, `ci1`) are not supported
  by `pwaggregate`; the replaced `aggregate` operator supports `median`, `q1` and `q3`.

## How it maps to ParaWeb patterns

ParaVega has no worker code of its own: it calls the kernel forms of
ParaWeb's patterns on a `ResidentPool` (`paraweb-js/resident`, ParaWeb 1.1), and
ParaWeb's generic worker compiles the kernels.

| Step | ParaWeb call | Where in ParaVega |
|---|---|---|
| Filter + bin/key + group accumulation, fused | `mapReduce({ map, combine }, { pool, ... })` | `kernel.ts` generates both kernels, `aggregate.ts` calls it |
| Combining partials | combine kernel of the same call | main thread or parallel by key range, chosen by ParaWeb |
| Bin extent | `reduce(kernel, { pool, combine })` | `table.ts` |
| `pwfilter` selection with change lists | `filter(predicate, state, { pool })` | `filter.ts` |
| Bucket index for pre-aggregation | `residentCountingSort` (Map + Scan + Scatter) | `table.ts`, `preagg.ts` |
| GPU bin indexes | `map(kernel, { pool, ... })` | `gpu.ts` |
| GPU counts | `ResidentGPU.groupCount` | `gpu.ts` |

Kernels are generated as source and compiled once per request shape in each
worker. Runtime values such as brush bounds are parameters, so interaction
never recompiles.

## Build, test, benchmark

```bash
node build.mjs                 # dist/paraweb-vega.mjs (browser) + .cjs (Node)
npx tsc -p tsconfig.json       # type-check
node test/correctness.cjs      # differential test against stock Vega
node test/preagg.cjs           # pre-aggregation equals full scan, randomized brushes (counts and measures)
node test/filter.cjs           # pwfilter selections and change lists
node test/gpu.cjs              # WebGPU backend equals the CPU scan (Node, Dawn)
node test/backends-browser.cjs # all backends in Chrome vs stock Vega; DASHBOARD=wide for six views
node test/browser/run.cjs resident          # ParaWeb resident runtime in Chromium (after node test/browser/build.mjs)
node bench/serve.cjs                        # then open http://localhost:8790/demo/crossfilter.html
node bench/driver.cjs [--quick]   # headless Chrome benchmark -> benchmark-results/vega/
bash bench/run-campaign.sh --reps=5   # full campaign: both suites, both data sets, machine-state log
node bench/report.cjs out.html benchmark-results/vega/campaign-<stamp>   # HTML report
```

The correctness test runs every case as a stock Vega spec and as a
`pwaggregate` spec, in both input modes, with 1, 3 and 16 workers, and
compares all groups and measures.

`test/crossfilterModes.mjs` checks that the crossfilter dashboard shows
identical histograms under every Vega-based backend for the same brushes.

### Backends compared (`--modes=` accepts any subset)

| Mode | What it isolates |
|---|---|
| `stock` | Vega `filter` + `bin` + `aggregate` on tuples |
| `crossfilter` | Vega's incremental `crossfilter` + `resolvefilter` (sorted indexes, bitmaps) |
| `inline` | ParaWeb's fused kernel on the main thread, no workers: separates kernel design from parallelism and offloading |
| `tuples` | `pwaggregate` over Vega tuples (columns extracted on load) |
| `table` | `pwaggregate` over a registered columnar table |
| `mosaic` | Mosaic + DuckDB-WASM (threaded, 16), pre-aggregation on, default per-frame query batching |
| `mosaic-noconsol` | as `mosaic`, with query batching off (removes the one-frame floor) |
| `mosaic-nopreagg` | Mosaic + DuckDB-WASM, plain SQL per update |
| `falcon-arrow` | FalconVis 0.17.4, ArrowDB engine (main thread), pixel-resolution index |
| `falcon-duckdb` | FalconVis 0.17.4, DuckDB-WASM engine |
| `preagg` | `table` with exact pre-aggregation |
| `gpu` | `table` with the WebGPU backend for count views |

Mosaic results are rendered by the same Vega dashboard (`crossfilterSpec("external")`),
its query cache is disabled (the sweep revisits brush positions), and DuckDB
receives the same columns through Arrow IPC. With pre-aggregation, Mosaic
snaps brush edges to pixels, so its counts are approximate; without it, they
match ParaWeb exactly.

### Metrics

Per backend, row count and worker count: initial render time; first-brush
latency on a fresh dashboard (includes lazy index builds); median latency of
sequential small brush moves (`sweep`) and of random brush jumps (`jump`),
each awaited including render; and a 60 Hz simulated drag that records frame
rate and the largest gap between animation frames. Long-task blocking time is
also recorded but under-reports in headless Chrome; use the frame gap.
