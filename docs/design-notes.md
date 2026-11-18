# ParaVega: design and implementation log

Working notes for the design and implementation sections of the ParaVega
paper. Entries are in the order the work was done. Each entry records what
was built, why, what was measured, and what went wrong. Numbers are from one
machine (Apple M3 Max, 16 cores, headless Chrome 152, Node 22.19) unless
stated otherwise; raw results are in `benchmark-results/vega/`.

## 1. Goal and target

Use the ParaWeb patterns to speed up a real visualization toolkit, for a
submission to an information visualization venue. Vega was chosen because its
dataflow transforms (`filter`, `bin`, `aggregate`, `window`, `kde`, ...) map
directly onto ParaWeb patterns (Filter, Scatter/MapReduce, Scan, Stencil), it
is the runtime under Vega-Lite and Altair, and there are strong baselines to
compare against (Vega's own `crossfilter` transform, Falcon, Mosaic). The
first use case is crossfilter brushing over coordinated histograms, the
standard benchmark task in Falcon (Moritz et al., CHI 2019) and Mosaic
(Heer and Moritz, VIS 2023).

## 2. Why the existing browser variants could not be reused

The browser demos in `browser-demo/` create new workers on every call and
copy data from JS arrays into `Float64Array` and back on every call. That is
acceptable for one-shot pattern benchmarks but not for interaction, where the
same data is queried many times per second with different parameters.
Decision: a new runtime in which data is loaded into shared memory once and
each interaction sends only parameters.

## 3. Integration with Vega

Checked in the Vega source (vega-dataflow 5.x) before writing code:

- `Dataflow.evaluate` awaits an operator that returns a Promise
  (`if (next.then) next = await next`), so a transform can hand work to
  workers without patching Vega. The main thread is free while workers run.
- Transform parameters must be primitives, arrays or signals. Plain object
  literals are rejected ("Unsupported parameter object"). Object-shaped
  options are possible through nested parameter definitions (`type: "param"`
  with an empty key), the mechanism Vega's `force` transform uses for
  `forces`. Signals are allowed inside them, so a brush signal can drive a
  predicate directly.
- Transform parameters are cleared after `transform()` returns
  (`params.clear()`), so everything needed from `_` must be read
  synchronously before the first `await`.

Result: one custom transform, `pwaggregate`, registered with
`vega.transforms.pwaggregate`. It fuses `filter` + `bin` + `aggregate`:

```json
{ "type": "pwaggregate", "table": "flights",
  "filter": [{ "field": "delay", "range": { "signal": "delayBrush" } }],
  "bins": [{ "field": "distance", "maxbins": 40 }],
  "groupby": ["carrier"], "ops": ["count", "mean"], "fields": [null, "delay"] }
```

Two input modes: (a) read the tuples of the input pulse and convert the
referenced fields to columns once per data change (drop-in, Vega still holds
the rows); (b) read a table registered from JS as columns (Vega never holds
the rows; needed above about 5M rows, where Vega tuples exhaust memory).

## 4. Semantic parity with Vega

To claim a drop-in replacement, results must match stock Vega. Read
`vega-transforms` source and copied the behaviour:

- Bin boundaries: call Vega's own `bin()` helper (vega-statistics) and repeat
  the adjustment in `Bin._bins` (stop rounded up to a whole step, optional
  anchor shift). Bin index uses Vega's expression exactly:
  `floor(1e-14 + (clamp(v, start, stop - step) - start) / step)`; values
  outside `[start, stop]` map to `-Infinity` / `+Infinity` bins, null to a
  null bin. `bin1` is computed with Vega's formula
  `start + step * (1 + (v - start) / step)` (vega/vega#830).
- Missing values: Vega treats only `null` and `''` as missing; numeric
  coercion follows `toNumber` (`+v`).
- Mean and variance: Vega uses Welford's update. Each worker keeps a Welford
  state per group; partial states are merged with the pairwise formula of
  Chan et al. Results agree to rounding, not bit for bit.
- Range predicates are inclusive at both ends, the same as Vega-Lite interval
  selections and Vega's crossfilter (`bisectLeft` / `bisectRight`).

Documented differences: NaN is treated as missing (Vega counts it as valid);
missing values never pass a range predicate (in a Vega expression
`null >= 0` is true); groups are emitted in key order, not first-seen order;
ops that need the raw values (`median`, quantiles, `distinct`, `argmin`, ...)
are not supported.

## 5. Runtime design

Files in `paraweb-vega/src/`:

| File | Role |
|---|---|
| `kernel.ts` | Kernel specification, source generation, partial initialisation and merge, extent |
| `worker.ts` | Worker message handler; resident columns; compiled kernel cache |
| `pool.ts` | Persistent worker pool (Web Workers, `worker_threads`, or inline) |
| `table.ts` | `ColumnTable`: lazy shared columns, dictionary encoding, parallel extent |
| `aggregate.ts` | Planning and execution of a `pwaggregate` request |
| `transforms.ts` | The Vega transform |
| `index.ts` | `registerParaweb(vega, options)` and exports |

Design decisions:

- **Columns in SharedArrayBuffers, resident in workers.** A column is sent to
  each worker once (`ensureColumn`). Messages to one worker are delivered in
  order, so later requests can use the column without waiting for an
  acknowledgement. Columns are built lazily, only for fields a request uses.
  A `Float64Array` that already sits on a SharedArrayBuffer is used without a
  copy.
- **Group keys as dense integers.** Each key dimension has a fixed
  cardinality (bins: `nb + 3` for null, `-Inf`, `+Inf`; group-by fields:
  dictionary size + 1 for null). The composite key is a mixed-radix number,
  so groups are slots in a flat `Float64Array`, with no hashing in the loop.
- **One fused loop, generated as source.** For each request shape the main
  thread describes the loop (filters, dimensions, measured fields) and the
  worker generates and compiles it once with `new Function`, the same
  function-as-string approach used in ParaWeb. Runtime values (brush bounds,
  bin boundaries, set masks) are passed as parameters, so moving a brush
  never recompiles. The loop has no per-row branching on the request shape.
- **MapReduce with two merge strategies.** Each worker accumulates its row
  range into a private region of a shared partials buffer (Map). Partials
  are combined on the main thread when `T * K * A` is small, and in parallel
  by key range otherwise (Reduce). Partials buffers are reused across calls
  to avoid allocating SharedArrayBuffers on every interaction. Thread count
  is reduced if `T * K * A * 8` bytes would exceed 512 MB.
- **Worker code inlined into the library.** The build bundles the worker into
  a string and inlines it; the browser creates workers from a Blob URL, Node
  uses `worker_threads` with `eval: true`. A single file to ship, and the
  same worker code runs in tests and in the browser.

Pattern mapping:

| Step | ParaWeb pattern |
|---|---|
| Predicate evaluation | Filter (fused) |
| Bin index / dictionary key | Map (fused) |
| Per-worker group accumulation | MapReduce, map side |
| Combining partials | Reduce |
| Bin extent | Reduce (`extent` op) |
| Bucket index for pre-aggregation (section 9) | Map + Scan + Scatter (counting sort) |
| Prefix sums over the cube (section 9) | Scan |

## 6. Correctness testing

`test/correctness.cjs` (Node) runs each case as a stock Vega spec and as a
`pwaggregate` spec on the same 60K-row data with nulls, in both input modes,
with 1, 3 and 16 workers (covering single, main-thread and parallel merge),
and compares every group and measure (relative tolerance 1e-9). Cases: 1D
histogram; histogram under a range brush with signal updates (including a
brush that selects nothing); group-by with all 13 supported ops on a field
with nulls; 2D bins with mean; a large key space (2D bins times carrier,
17,567 groups) to force the parallel merge; set (`oneOf`) predicates with
updates; explicit extent, step and anchor with values outside the extent;
no group-by with two predicates. 78/78 checks pass.

`test/crossfilterModes.mjs` renders the benchmark dashboard under every
Vega-based backend and checks that the histograms are identical for a set of
brushes (including a reversed brush and a near-empty one).

Pitfall: the first run reported 6 failures, all in the case with values
outside the extent. The cause was the test, not the transform:
`JSON.stringify` turns `Infinity` into `null`, so the null, `-Infinity` and
`+Infinity` bins collapsed into one comparison key.

## 7. Benchmark harness

`demo/crossfilter.html` is both the interactive demo and the benchmark page;
`bench/driver.cjs` drives it in headless Chrome over a COOP/COEP server
(`browser-bench/server.js`), one fresh page per configuration. Dashboard:
three linked histograms (distance, delay, time; 40 bins) with an interval
brush each; each histogram is filtered by the other two brushes. Data:
deterministic synthetic flights-like columns (mulberry32), 100K to 10M rows.

Metrics per configuration:

- initial render time;
- first-brush latency on a fresh dashboard (includes any lazy index build);
- `sweep`: 20 sequential small brush moves, each awaited including render;
- `jump`: 20 sequential random brush positions (large deltas);
- `drag`: brush updates at 60 Hz for 1 s without waiting (as pointer events
  arrive), recording frame rate and the largest gap between animation frames.

Two workloads are needed because incremental designs (Vega's crossfilter)
are good at small deltas and poor at large ones. Long-task blocking time is
recorded but under-reports in headless Chrome (676 ms reported during a 10 s
freeze), so the frame gap is the responsiveness metric.

Benchmark hygiene: nothing else CPU-heavy runs during a benchmark. One
rebuild happened during a run; `src/` had not changed, and the results agreed
with the earlier quick pass, so the run was kept.

## 8. Baselines and first results

| Mode | What it isolates |
|---|---|
| `stock` | Vega `filter` + `bin` + `aggregate` on tuples |
| `crossfilter` | Vega's incremental `crossfilter` + `resolvefilter` |
| `inline` | ParaWeb's fused kernel on the main thread, no workers |
| `tuples` / `table` | `pwaggregate` on Vega tuples / on a registered table |
| `mosaic` | Mosaic + DuckDB-WASM (16 threads), pre-aggregation, default per-frame batching |
| `mosaic-noconsol` | as `mosaic`, per-frame query batching off |
| `mosaic-nopreagg` | Mosaic + DuckDB-WASM, plain SQL per update |

Mosaic setup: DuckDB-WASM threaded bundle loaded from local files (the CDN
default is blocked under cross-origin isolation), data passed as Arrow IPC
built with flechette, query cache disabled (the sweep revisits brush
positions), results rendered by the same Vega dashboard (`external` spec
mode). Histogram bins are computed in SQL with Vega's bin expression, so
without pre-aggregation Mosaic's counts match ParaWeb exactly (0 of 226 bins
differ). With pre-aggregation, Mosaic snaps brush edges to pixels: 166 of
226 bins differed, by up to 1.1%.

Median brush-update latency:

| Backend | 1M | 10M | First brush, 10M |
|---|---|---|---|
| Stock Vega | 456 ms | not run (5M did not finish in 30 min) | |
| Vega crossfilter (sweep / jump) | 32 / 167 ms | not run (5M: 230 / 1105 ms) | |
| ParaWeb kernel, main thread | 9.1 ms | 87 ms | |
| ParaWeb, 1 worker | 9.1 ms | 87 ms | 134 ms |
| ParaWeb, 16 workers | 1.8 ms | 9.0 to 11.7 ms (two runs) | 25 ms |
| Mosaic, no pre-aggregation | 50 ms | 431 ms | |
| Mosaic, pre-aggregation | 16.6 ms | 16.6 ms | 446 ms |
| Mosaic, pre-aggregation, no batching | 5.8 ms | 5.7 ms | 431 ms |

Findings:

1. Most of the gain over stock Vega comes from the fused columnar kernel, not
   from parallelism: one worker and the main-thread kernel take the same
   time. Parallelism adds 8 to 10 times at 10M rows.
2. Offloading costs almost nothing (main-thread kernel and one worker are
   equal), and it is what keeps the page responsive: the main-thread kernel
   drops to 44 fps at 1M rows and freezes for 3.5 s at 10M, while ParaWeb
   with workers holds 60 fps at every size.
3. Mosaic's pre-aggregation gives constant latency after an index build of
   about 440 ms per newly brushed view at 10M rows, at the cost of
   pixel-level approximation, and beats ParaWeb's scan above about 5M rows.
4. Mosaic's 16.6 ms floor is its per-frame query batching
   (`QueryConsolidator` waits for `requestAnimationFrame`), a design choice;
   both settings should be reported.

Run-to-run variation (9.0 vs 11.7 ms for the same configuration) means the
paper needs repeated runs with confidence intervals.

Other pitfalls in this step: a local variable named `settle` shadowed the
new latency hook in the drag test; `browser-bench/server.js` did not serve
`.wasm` with `application/wasm`, which DuckDB-WASM requires.

## 9. Exact pre-aggregation for brushing

Motivation: section 8 showed that Mosaic's data cubes give constant update
latency (about 5.7 ms) but cost about 440 ms to build per newly brushed view
at 10M rows and snap brush edges to pixels. Goal: build cubes with ParaWeb's
patterns fast enough that the build is hidden behind the first brush move,
and keep the results exact.

### Idea

While one range predicate (the active brush on field F) moves and all other
state is fixed, each view's counts are

    count(k) = #{ rows : key = k, lo <= F <= hi, other filters pass }.

Split the range of F into R fine buckets. Rows in buckets strictly between
the buckets of `lo` and `hi` all satisfy the predicate, because the bucket
function is monotone non-decreasing:

- `bucket(x) > bucket(lo)` implies `x > lo`;
- `bucket(x) < bucket(hi)` implies `x < hi`.

So an update is two prefix-sum lookups per group for the interior buckets
plus an exact scan of the rows in the two edge buckets. The result equals a
full scan exactly. Pixel-level cubes (Falcon, Mosaic) instead answer at
pixel resolution. The bucket resolution R is no longer tied to screen pixels:
it only trades cube size against the length of the edge scan (about
`2 n / R` rows for uniform data).

The bucket function, shared by the kernel and the main thread
(`kernel.ts: bucketOf`):

    bucket(x) = R                         if x is missing
              = 0                         if x <= lo
              = R - 1                     if x >= hi
              = min(R - 1, floor((x - lo) * scale))   otherwise, scale = R / (hi - lo)

Each step (subtraction, multiplication by a positive constant, floor, clamp)
is monotone in IEEE arithmetic, so the composition is monotone. Brush
endpoints outside the data range fall into bucket 0 or R - 1 and are handled
by the edge scan.

### Data structures and patterns

1. **Bucket index of F** (`table.ts: bucketIndex`), a parallel counting sort
   of row ids by bucket: per-worker bucket histograms (Map with a local
   Reduce), exclusive prefix sums over (bucket, worker) on the main thread
   (Scan; `R + 1` times `T` entries, small), then each worker writes its row
   ids at its offsets (Scatter). Row order within a bucket is kept. The index
   does not depend on any predicate, so it is cached per (field, R) and
   reused across brush sessions. Memory: one Int32 per row.
2. **Cube for one view** (`preagg.ts: buildPreagg`): a normal `pwaggregate`
   execution with the active predicate removed and an extra leading
   dimension, the bucket of F (`kind: "bucket"` in `kernel.ts`). Bucket
   first gives stride 1, so each group's buckets are contiguous. Same
   MapReduce and merge code as a normal query.
3. **Prefix sums** over the bucket axis for every group (Scan), done on the
   main thread because the cube is small (at most about 4M cells; R is
   reduced from 4096 down to 256 for large key spaces).
4. **Edge scan** (`answerPreagg`): the same generated kernel in an indexed
   variant (`for j in [start, end): i = perm[j]`), compiled once on the main
   thread and run over the rows of the two edge buckets with the full
   predicate set. Run on the main thread because the edge is small; a
   skewed field with a very dense bucket would make this the place to add
   workers.

Missing values of F go to bucket R. They are never counted while the brush
on F is active (missing values fail range predicates) and are included when
the brush is cleared (the full total `prefix[R + 1]`).

### Scope

Only `count` is answered from the cube. Prefix differences of floating-point
sums would not reproduce a direct sum exactly, and min/max are not
invertible. Other ops fall back to the full scan.

### Activation inside Vega

Mosaic gets an explicit `activate` event from its interactors before a
brush moves. A Vega transform does not, so each `pwaggregate` instance
detects the active brush itself (`preagg.ts: activeField`): it keeps a
snapshot of its predicates and, on each run, checks whether exactly one
range predicate changed. Policy:

- first move of a brush on a new field: answer with the normal scan and start
  the cube build in the background;
- later moves: wait for the build if it is still running (requests to a
  worker run in order, so a scan sent after the build would wait anyway),
  then answer from the cube;
- any other change (a different brush, a set predicate, the data): scan, and
  the cube is rebuilt on the next session. Cubes are keyed by everything
  except the active predicate.

Each view decides independently; no coordination between views is needed.
Enabled with `registerParaweb(vega, { preaggregate: true })` or per
transform with `"preagg": true`; `"preaggResolution"` overrides R.

### Testing

`test/preagg.cjs` compares a pre-aggregating dashboard with a scanning one
over randomized brush sessions on three fields (integers that fall exactly
on bucket boundaries; a continuous field with missing values; a skewed field
with many duplicates and a 2D key space of bins times carrier). Brushes
include reversed ranges, ranges narrower than one bucket, single integers,
ranges beyond the data extent, and cleared brushes. Run with R = 8 (large
edge buckets), R = 64 and the default: 675/675 views equal in each, with the
index path used for about 430 updates per run.

### Pitfall

The first quick benchmark of the new mode reported 0.06 ms per update. The
page passed the new mode name to the spec generator, which did not know it
and produced an empty dashboard. Since then every benchmark run checks that
the unfiltered histogram counts exactly `n` rows and fails the configuration
otherwise.

### Results

Run `crossfilter-2026-11-17T104938852Z-preagg+table+mosaic-noconsol.json`
(scan, pre-aggregation and Mosaic measured in the same session). Median
latency per brush update, and first/second move on a fresh dashboard:

| Rows | Scan, 16 workers | Pre-agg, 16 workers | Mosaic, pre-agg, no batching |
|---|---|---|---|
| 100K | 0.66 ms | 0.20 ms | 6.35 ms |
| 1M | 1.77 ms | 0.19 ms | 6.18 ms |
| 5M | 5.30 ms | 0.22 ms | 6.16 ms |
| 10M | 9.91 ms | 0.27 ms | 6.45 ms |
| 10M, first move | 22 ms | 27 ms (scan, build starts) | 460 ms (index build) |
| 10M, second move | 14 ms | 39 ms (waits for build) | 8 ms |

Per-update latency with pre-aggregation is flat in the data size, 24 to 33
times lower than Mosaic's, and exact. The update cost is the edge scan, the
prefix lookups and Vega's render; the 0.2 ms includes the render.

Build times at 10M rows (one brush session, two dependent views):

| Workers | Bucket index | Cube + prefix, per view | First and second move together |
|---|---|---|---|
| 1 | 243 ms | 36 to 79 ms | 348 ms |
| 4 | 63 ms | 13 to 30 ms | 95 ms |
| 8 | 37 ms | 10 to 19 ms | 58 ms |
| 16 | 40 ms | 11 to 25 ms | 66 ms |

(`buildMs` per view includes waiting for the shared bucket index, so the
per-view cube time is `buildMs - bucketIndexMs`.) The counting sort
dominates and scales with workers up to 8; 16 workers are no faster for the
build (the scatter step is bound by memory bandwidth and the M3 Max has 12
performance and 4 efficiency cores). The bucket index is cached per field,
so brushing the same field again later only pays for the cube.

Compared with Mosaic at 10M rows: the time before a brush session runs at
full speed is about 60 ms against 460 ms, the time before the dashboard is
ready is about 42 ms against 1.9 s, per-update latency is 0.27 ms against
6.45 ms, and results are exact against pixel-snapped.

Open issues: the second move is slower than a plain scan at 10M (39 ms
against 14 ms) because it waits for the build; building the cube with lower
priority, or answering from a scan until the build finishes, would remove
that step. Builds use the same worker pool as queries, so a build can delay
an unrelated query. Memory per indexed field is 4 bytes per row.

## 10. Scheduling: background builds must not delay queries

Problem from section 9: at 10M rows the second move of a brush took 39 ms,
against 14 ms for a plain scan, because it waited for the cube build.
Waiting was chosen because messages to a worker run in order, so a scan sent
during a build would have queued behind the whole build anyway.

Fix, in two parts:

1. **Per-worker priority queues** (`pool.ts`). The pool no longer posts a
   task to a worker immediately. Each worker has three queues (High for
   interactive queries, Low for background builds, Lowest for housekeeping
   such as dropping columns) and at most one task in flight. When a worker
   replies, the pool posts the next task, taking the highest priority first,
   before resolving the caller's promise, so the worker is not idle while the
   result is handled. Column uploads are still posted directly: they are
   issued before any task that uses them, so ordering holds.
2. **Chunked builds** (`aggregate.ts: executePlan` options, `table.ts:
   bucketIndex`). Background work is split into chunks of 2^18 rows per
   worker (about 1 to 2 ms each). The cube kernel accumulates across chunks
   of the same worker region (`init: false` after the first chunk), the
   bucket histogram accumulates (`reset: false`), and the scatter step
   advances its cursor in place so the next chunk continues where the last
   ended. A query therefore waits for at most one chunk per worker.

Policy change in the transform: while a build is running, a brush move is
answered with a scan at High priority instead of waiting for the build.

Correctness: `test/preagg.cjs` now also runs with 1,000-row chunks (the test
data is far below the default chunk size, so without this the chunked paths
would not be exercised); all runs remain exact. With small chunks the index
answers fewer updates (about 330 against 425 per run), as expected.

Effect at 1M rows (quick run, 2 repetitions): second move 6 to 14 ms,
equal to a plain scan, against 11 to 25 ms before.

## 11. Repetitions and confidence intervals

`bench/driver.cjs --reps=N` repeats every configuration N times, each in a
fresh page. Repetitions are the outer loop, so slow drift (thermal state,
background activity) is spread over all configurations instead of hitting a
few. Raw per-repetition results are written after every configuration, so a
crash keeps the measurements so far. The summary gives, per metric, the mean,
the standard deviation and a 95% confidence interval (Student's t, df = N - 1)
of the per-repetition values (each per-repetition value is itself a median of
20 updates).

Configuration limits: stock Vega up to 1M rows (5M did not finish within 30
minutes, twice); Vega tuple-based modes up to 5M (memory).

## 12. `pwfilter`: parallel filter returning rows

Aggregates cover histograms; scatterplots and tables need the matching rows
themselves. `pwfilter` is the Filter pattern as a Vega transform.

Kernel (`kernel.ts: generateFilterSource`): for each row of a worker's range,
the predicates are evaluated as one generated boolean expression, the 0/1
result is written to a shared mask, and compared with the mask of the
previous call. Changed rows are appended to the worker's own segment of a
shared change list (row id when newly selected, `-id - 1` when deselected),
so workers never write to the same location and no synchronisation is
needed. Two mask buffers alternate between calls, so there is no copy.

The main thread reads only the change lists and gives Vega an `add` and a
`rem` list. Downstream operators and marks are therefore updated
incrementally, the same contract as Vega's own `filter`, and the main-thread
cost is proportional to the number of changed rows, not to the table size.

Input modes as for `pwaggregate`: with Vega tuples the output tuples are the
input objects; with a registered table, one tuple is created per selected row
(holding the requested `fields`) and kept while the row stays selected, so a
row that remains selected keeps its identity.

Test (`test/filter.cjs`): stock Vega `filter` against `pwfilter` in both
modes with 1, 3 and 16 workers over a sequence of updates of two range
predicates and one set predicate (including reversed ranges, a set that
matches nothing, cleared predicates and repeated identical updates). After
each update the selected row ids and a downstream `aggregate` must match.

Benchmark hygiene note: `tsc` (type-check, a few seconds on one core) ran
once while the 3-repetition benchmark was running; no build or test was run
during the benchmark.

## 13. Full 3-repetition run and two problems it exposed

Run `crossfilter-2026-11-17T105626313Z-reps3.json`: all 76 configurations,
3 repetitions each.

**Problem 1: Vega crossfilter failed the row-count check (0 rows).** Vega's
`crossfilter` transform passes no tuples downstream, so in that mode the
grey background histograms (`bg_*`, data sourced directly from the
crossfilter's data set) had always been empty and the y-axis domain was
degenerate. Earlier latency numbers for this mode measured the filtering
correctly, but the dashboard was not equivalent. Fix: read the background
through `resolvefilter` with every filter ignored
(`ignore: (1 << fields) - 1`). The row-count check added in section 9 found
this; it would otherwise have gone unnoticed.

**Problem 2: pre-aggregation starved with few workers at large sizes.** With
strict priorities, background chunks ran only when no query was queued. In
the sequential sweep the next scan is sent right after the previous render,
so with 1 or 2 workers at 5M and 10M rows (and during the sweep with 4
workers at 10M) the build never finished and every update was a scan. From
8 workers on, the build finished and updates took 0.26 to 0.39 ms.

Fix, two parts:

1. **Fair share** (`pool.ts`, `LOW_SHARE = 0.5`). After a High task that ran
   d ms on a worker, Low tasks on that worker may use up to 0.5 d ms ahead of
   waiting High tasks. Credit only accrues while Low tasks are queued (so it
   cannot pile up while idle and later delay queries in a burst) and is
   capped at 1 s. During a build, queries can therefore be slowed by up to
   half; the build always makes progress.
2. **Cost rule** (`transforms.ts`). Each view keeps a moving average of its
   scan time. While its cube is being built, a brush move waits for the
   build if the pool's estimate of the remaining background work
   (`pool.lowPendingMs()`: queued and running Low tasks per worker times a
   moving average of Low task time) is no more than one scan; otherwise it
   scans. The estimate only sees tasks already queued, so during the
   bucket-index phase (cube chunks not yet queued) it is low; the cost is at
   most one wait for the remaining cube work.

All tests pass after both changes (correctness 78/78, pre-aggregation
675/675 in each of four configurations, crossfilter modes agree, pwfilter
66/66).

## 14. Re-run after the fixes

Run `crossfilter-2026-11-17T111533931Z-preagg+table+crossfilter-reps3.json`
(pre-aggregation, scan, crossfilter; 3 repetitions).

Pre-aggregation no longer starves: median update latency is 0.16 to 0.30 ms
at every size and worker count, including 1 worker at 10M rows (was 90 ms).

New cost: the second move of a brush now waits for the build when the cost
rule judges it cheaper, and the estimate is low during the bucket-index
phase. At 10M rows the second move takes 255 ms with 1 worker and 42 ms with
16 workers, against 115 ms and 13 ms for a scan. This is one slow move per
brush session (and none on later sessions for the same field, since the
bucket index is cached). A better estimate of the remaining build (counting
the cube work that is not yet queued) is the obvious next refinement.

The crossfilter fix in section 13 did not work: with every filter ignored,
`resolvefilter` returns `StopPropagation` on every update
(`(mask & ignore) === 0`) and never emits tuples. Second fix: the bins are
computed on the source data set, the `crossfilter` transform runs on a
derived data set (`xf`, same tuple objects, no copy), the filtered
histograms resolve against `xf`, and the background histograms aggregate
`src` directly. Checked: the background sums to n and the filtered
histograms still match every other backend. Crossfilter re-run separately.

## 15. Final measurements and report

Crossfilter re-run `crossfilter-2026-11-17T112414736Z-crossfilter-reps3.json`:
all 9 runs pass the row-count check. Sweep / jump latency: 1.3 / 4.9 ms at
100K, 31 / 141 ms at 1M, 195 / 928 ms at 5M; the page freezes for 8.5 s
(1M) and 50 s (5M) during the 60 Hz drag.

The report combines three runs, later files overriding earlier ones for the
same configuration: the full run (stock, main-thread kernel, Mosaic in three
settings, tuple scan), the re-run after the scheduling fixes (scan,
pre-aggregation) and the crossfilter re-run. Generated with

    node paraweb-vega/bench/report.cjs benchmark-results/vega/report.html \
      benchmark-results/vega/crossfilter-2026-11-17T105626313Z-reps3.json \
      benchmark-results/vega/crossfilter-2026-11-17T111533931Z-preagg+table+crossfilter-reps3.json \
      benchmark-results/vega/crossfilter-2026-11-17T112414736Z-crossfilter-reps3.json

It is a self-contained HTML file (inline SVG, no network requests), with log
axes, 95% CI whiskers clipped to the axis, tooltips per point, a
time-to-interactive table and all measurements.

Headline numbers (mean of 3 runs, small brush moves):

| Backend | 1M rows | 10M rows |
|---|---|---|
| ParaVega, exact pre-aggregation, 16 workers | 0.18 ms | 0.30 ms |
| ParaVega, scan, 16 workers | 1.8 ms | 9.5 ms |
| Mosaic, pre-aggregation, no batching (approximate) | 5.9 ms | 5.7 ms |
| Mosaic, pre-aggregation, default | 16.6 ms | 16.8 ms |
| Mosaic, no pre-aggregation | 51 ms | 434 ms |
| Main-thread kernel | 9.1 ms | 87 ms |
| Vega crossfilter | 31 ms | not run (5M: 195 ms) |
| Stock Vega | 648 ms | not run (5M did not finish) |

Caveats: the three runs were taken about an hour apart on the same machine,
so cross-file comparisons (for example scan in one file against Mosaic in
another) mix sessions; scan was measured in both runs and agreed within the
confidence intervals (10M, 16 workers: 10.4 ± 3.6 and 9.5 ± 0.6 ms).

## 16. Build-time estimate that sees future work

The cost rule (section 13) compared one scan against `pool.lowPendingMs()`,
which only counted queued and running Low tasks. Two phases of a build queue
their tasks late: the bucket index's scatter step (after its histogram step)
and the cube (after the bucket index). The estimate was therefore too low
early in a build, the view waited, and the second move was slower than a
scan (10M rows: 255 ms with 1 worker against a 115 ms scan).

Fix: the pool keeps a count of announced but not yet queued Low tasks
(`reserveLow` / `releaseLow`). The bucket index reserves its scatter chunks
before starting the histogram step and releases them when it queues them;
each cube build reserves its chunks when it starts and releases them right
after `executePlan` has queued them (synchronously, before its first
`await`). `lowPendingMs()` includes the reservations. Errors release them.

Effect at 10M rows (2 repetitions): second move 156 / 42 / 19 ms with
1 / 4 / 16 workers, against 255 / 73 / 42 ms before and 115 / 31 / 12 ms for
a plain scan. The remaining gap is the fair share: while a build runs,
queries share the workers with it. Exactness tests unchanged (675/675).

## 17. Linked scatterplot suite (pwfilter)

`demo/scatter.html` with `scatterSpec.js`: a histogram of departure time with
an interval brush, linked to a scatterplot (distance x delay) of the rows
inside the brush. Brushes are 3 px wide (about 0.25 hours), selecting about
1% of the rows; only selected rows are drawn. An empty brush selects nothing
in every mode (`sel_range = time_range || [1e300, 1e300]`), so the page never
tries to draw all rows. Modes: stock Vega `filter` expression,
`pwfilter` on Vega tuples, `pwfilter` on a registered table.

Metrics as in the crossfilter suite, plus `computeMedianMs` (the pwfilter
transform's own time, from `onStats`) and the number of selected rows, which
must be equal across modes. Driver: `--suite=scatter`.

First check at 1M rows: all three modes select the same 12,249 rows; drawing
them takes about 15 to 18 ms and dominates the end-to-end time for the
parallel modes (pwfilter compute 2.5 ms with 16 workers, 4.7 ms with 1);
stock Vega takes 76 ms per move and freezes the page during a drag (9 fps).

## 18. Real data: flights-10m

The standard data set of Falcon and Mosaic evaluations: 10M US domestic
flights, published by the Mosaic project as Parquet
(`https://idl.uw.edu/mosaic-datasets/data/flights-10m.parquet`,
75,164,715 bytes, sha256 `36e970c1...e2418`, full hash in
`paraweb-vega/data/flights/meta.json`). Downloaded into its own directory
(`paraweb-vega/data/raw/`, git-ignored) and converted by
`bench/convert-flights.mjs` (pure-JS Parquet reader hyparquet 1.33.1) into
raw Float64 column files.

Field mapping: delay = `ARR_DELAY` (minutes, as in Falcon), distance =
`DISTANCE` (miles), time = `DEP_TIME` (hours). Rows with a missing value in
any of the three would be dropped (stock Vega and ParaVega treat nulls
differently in range predicates); there are none (10,000,000 rows kept).
Rows are shuffled once (Fisher-Yates, mulberry32, seed 20261117), so the
first n rows are a random sample and the 1M and 5M sizes are fair subsets.

Bin extents follow Vega's crossfilter-flights example: delay [-60, 180],
distance [0, 2400], time [0, 24], 40 bins. Values outside fall into Vega's
-Infinity / +Infinity bins (not drawn); the row-count check counts them.
Data extents: delay [-592, 1779], distance [11, 4962], time [0, 23.98].

The Mosaic adapter's SQL binning clamped out-of-range values into the edge
bins (harmless on the synthetic data, where no value fell outside). It now
follows Vega exactly (`CASE WHEN x < start THEN -Infinity WHEN x > stop
THEN Infinity ELSE ... END`).

`test/backends-browser.cjs` runs the dashboard under every backend in the
browser on both data sets and compares all histograms with ParaVega's scan
for a set of brushes; Mosaic with pre-aggregation is reported separately as
approximate.

## 19. Campaign script

`bench/run-campaign.sh` follows ParaWeb's `scripts/run-ijpp-campaign.sh`: waits for
sustained low foreign CPU (with a deadline, since the editor and this
session count as foreign; the outcome is logged), requires AC power,
captures `scripts/capture-env.sh` before and after, and samples the thermal
warning state, load, foreign CPU and the top foreign processes every 30 s
into `machine-state.csv`, so contamination is visible afterwards. It runs
both suites on both data sets with the chosen repetition count and collects
everything in `benchmark-results/vega/campaign-<timestamp>/`.

## 20. Campaign of 17 Nov, 15:11 (superseded by section 27)

Directory: `benchmark-results/vega/campaign-20261117T151124/` (15:15 to
16:29, 17 Nov 2026). Report: `benchmark-results/vega/report.html`, made by
`node paraweb-vega/bench/report.cjs <out.html> <campaign-dir>`.

Two earlier attempts the same day are not used:

- `campaign-20261117T130836-DISCARDED-enospc`: crossfilter on flights stopped in rep 3 with
  ENOSPC (disk full). The three other suites completed.
- `campaign-20261117T142005-DISCARDED-enospc`: rerun of crossfilter on flights only; it
  stopped at the same point, so the cause was the benchmark itself, not
  noise.

Cause and fix. The driver used one browser process for a whole suite.
Each flights page loads the full 10M-row columns (240 MB) plus copies,
DuckDB-WASM and Vega tuples, and memory from closed pages was not given
back fast enough; swap grew until the data volume (about 17 GB free) was
full. The driver now starts a fresh browser for every configuration
(`env.browserPerConfig: true` in the JSON). Data loading happens before the
timers start on both pages, so the lost HTTP cache does not affect any
metric. To keep a single protocol, the whole campaign was rerun with the
new driver. The sampler now also records swap use and free disk: swap
stayed at 5225 MB for the whole run and free disk between 33 and 35 GB.

Sampler fix: `ps -o comm=` prints full paths with spaces, so the old awk
saw the benchmark's own "Google Chrome for Testing" as a foreign process
called "Google". The filter now matches the whole line; truncated names of
the form "(Google Chrome fo)" are also excluded. The foreign CPU figures in
the report are an upper bound for this reason.

Conditions: AC power, no thermal warnings in 146 samples, foreign CPU
median 181% (of 1600%), short peaks from peopled, contactsd, mediaanalysisd
and corespotlightd. 5 reps per configuration, 860 runs, 0 errors, all
sanity checks passed. Confidence intervals are narrow (for example 10M scan
with 16 workers 10.0 +/- 1.2 ms), so the peaks did not visibly affect the
results.

Headline numbers (mean of per-run medians, 95% CI):

| | synthetic 1M | synthetic 10M | flights 1M | flights 10M |
|---|---|---|---|---|
| Stock Vega, small moves | 443 +/- 30 | n/a | 402 +/- 22 | n/a |
| Vega crossfilter, small moves / jumps | 32 / 160 | n/a | 43 / 214 | n/a |
| Main-thread kernel | 9.2 | 87.6 | 9.9 | 97.5 |
| ParaVega scan, 16 workers | 1.90 | 10.0 | 1.74 | 10.4 |
| ParaVega exact preagg, 16 workers | 0.20 | 0.35 | 0.23 | 0.46 |
| Mosaic preagg, no batching (approximate) | 6.2 | 6.4 | 6.0 | 6.2 |
| Mosaic preagg, default | 16.7 | 16.8 | 16.7 | 16.7 |
| Mosaic, no preagg | 56.7 | 479 | 59.8 | 520 |
| Ready (ms): ParaVega / Mosaic | 29 / 816 | 47 / 1983 | 29 / 831 | 53 / 2093 |

All values are in ms; small moves unless stated. Drag at 60 Hz: every worker
backend keeps the largest frame gap at one frame (16.7 ms) at all sizes;
stock Vega at 1M has a 19.5 s gap, Vega crossfilter 8.7 s, the main-thread
kernel 0.4 s at 1M and 4.3 s at 10M.

Findings that hold on both data sets:

1. The fused kernel alone (one pass, no tuples) is 40x (flights) to 48x (synthetic)
   faster than stock Vega at 1M; the main-thread kernel and one worker give the same
   latency. Workers add 8.7x (synthetic) and 9.4x (flights) at 10M, and
   take the work off the main thread, which is what keeps the drag smooth.
2. Exact pre-aggregation answers in 0.2 to 0.5 ms at every size, 13x to 18x
   below Mosaic's approximate pre-aggregation with batching turned off and
   36x to 48x below its default. The cost is on the second move of a new
   brush (index build): 23 ms at 10M with 16 workers, 158 to 174 ms with
   one worker, where the scan answers in 120 to 133 ms.
3. Time to interactive is about 40x lower than Mosaic at 10M, mostly because
   DuckDB-WASM must start and ingest the data.

Linked scatterplot (pwfilter): all modes select the same rows at every size
on both data sets. At 1M rows, 16 workers, the update takes 21 to 26 ms
against 73 to 74 ms for stock Vega (about 3x), and the drag keeps one frame
per update. The filter itself takes 2.4 to 2.8 ms (tuples) or 5.9 to 6.0 ms
(table; it also has to create tuples for the selected rows). Most of the
remaining time is drawing the selected points, which is the same work in
every mode. From 5M rows the selection is 60K to 150K points and rendering
dominates (drag gaps of 70 to 300 ms), so the scatter suite should be
reported as the case where the filter stops being the bottleneck, not as a
headline speedup.

Caveats for the write-up: stock Vega is capped at 1M (5M did not finish in
30 min) and Vega crossfilter and tuple modes at 5M (tab memory); preagg
supports count only; Mosaic numbers include its approximation (up to 64%
off in one bin on synthetic data and 133% on flights for a 2 px brush, see
`test/backends-browser.cjs`); one machine (Apple M3 Max, Chrome 152
headless).

## 21. Moving the runtime into ParaWeb

ParaVega first had its own worker (`worker.ts`) and pool. Everything in it
that does not know about Vega moved to ParaWeb as `src/resident/`:
`ResidentPool` (persistent workers from a Blob URL, worker_threads or
inline; High/Low/Lowest queues with fair share; `reserveLow`/`releaseLow`,
`lowPendingMs`), resident SharedArrayBuffer columns (`ensureColumn`, ordered
delivery, no ack), string kernels `(cols, bufs, args, start, end, idx)`
compiled once per worker, and the patterns over resident data. ParaVega now
has no worker code; `pool.ts` re-exports `ResidentPool`. Rule used for the
split: ParaWeb receives code and buffer layouts, never domain knowledge.
Latency of the scan was unchanged within noise after the move.

Two fixes to ParaWeb's GPU core came out of this: the pipeline cache is
keyed by device (it previously kept pipelines of a lost device) and is
cleared on device loss; `getGPUDevice()` requests the adapter's
`maxBufferSize` (a 10M-row column exceeds the 256 MB default).

## 22. Resident forms of the existing patterns (interface decision)

The first version exposed separate functions (`residentMap`,
`residentMapReduce`, `residentFilter`, `residentExtent`). That reads as a
second API next to ParaWeb's patterns. They are now forms of the existing
calls, chosen by argument types (not a flag, since a flag would change the
type of every other argument):

- `{ pool, key }` in place of the thread count: per-element functions as
  before, input uploaded once per key (`refresh: true` to re-upload, SAB
  typed arrays used in place, a string input names a resident column).
  MapReduce and Reduce are fused into one pass per worker.
- A kernel in place of the function: `map(kernel, call)`,
  `reduce(kernel, { combine, identity })`, `mapReduce({ map, combine }, call)`,
  `filter(predicate, FilterState, call)`.

Routing is in `src/index.ts` for the default, `mp` and `shared` namespaces;
resident forms always use shared memory. Browser clients import the same
functions from `src/resident/residentApi.ts` without the per-call variants.
Refreshing a key uses a new internal column name, because `dropColumns` is
queued at Lowest priority and would otherwise remove the new upload.
Counting sort (Map + Scan + Scatter) and `ResidentGPU.groupCount` stay
runtime calls, since they are compositions, not one pattern.

Cost at 10M rows, 16 threads (`bench/copycost.cjs`): copying three columns
19 ms; the original `shared.mapReduce` counting one range 162 ms; the same
call with `{ pool, key }` 4.2 ms (39x); the kernel form computing a
40-bin histogram with two range filters 5.4 ms. Tests: 257 resident checks
(168 of them through the public entry points, compared with references and
with the per-call patterns).

## 23. Pre-aggregation for all mergeable ops (segment tree)

Prefix sums only work for invertible aggregates (count, sum). The cube now
holds full partial records (count, valid, sum, min, max, Welford mean, M2)
per (bucket x group), and a segment tree over the R buckets per group (R a
power of two; the missing-value bucket kept apart). A query merges
O(log R) nodes for the interior and scans the two edge buckets exactly with
an indexed kernel. Covers every op in SUPPORTED_OPS. `defaultResolution`
caps R * groups * slots at 4M. `test/preagg.cjs` has a measures mode:
675/675 views exact.

## 24. Falcon baseline and the six-view dashboard

FalconVis 0.17.4 with ArrowDB (main thread) and DuckDB-WASM, bundled with
its own apache-arrow 12 by an esbuild alias. `View1D.select` does not await
the passive views (`forEach(async ...)`), so the adapter waits until all
passive views delivered before the update counts as done. Falcon snaps
brushes to pixels and treats out-of-extent values differently, so its
counts are approximate (accuracy check: up to 583% off in a bin on flights).

Six-view dashboard (`--dashboard=wide`, flights only): histograms of
distance, delay, time, dep_delay, air_time, arr_time and the mean delay per
departure hour (24 bins), filtered by all brushes. The crossfilter-mode mean
bins on the source field to avoid Vega dataflow errors.

## 25. WebGPU backend

`ResidentGPU` uploads Float64 columns as order-preserving u32 key pairs
(flip all bits of negatives, set the sign bit of positives, -0 -> +0, NaN
max), so range predicates are exact in 32-bit integer arithmetic.
`groupCount` fuses Filter + Map + MapReduce with workgroup-local atomic
histograms (K <= 4096) or global atomics, grid-stride over 1024 x 256
threads. Bin indexes are computed once on the CPU with the scan's own bin
rules (Map, kernel form) and uploaded as u32. Counts only: WebGPU has no
64-bit or float atomics for exact sums, so other views stay on workers.
Dawn's `writeBuffer` rejects SAB-backed sources; slices are copied first.
`test/gpu.cjs`: 480/480 views equal the CPU.

## 26. Firefox and second machine

`--browser=firefox` exists in the driver and the campaign script, and the
script runs on Linux (keep-awake, thermal, swap and disk columns). Firefox
under puppeteer did not start here (versions 154 and 160:
"sandbox_extension ... Operation not permitted", also with the sandbox
disabled). Safari needs `safaridriver --enable`, which only the user can
run. Both are open.

## 27. Final campaign (the one to report)

Directory: `benchmark-results/vega/campaign-20261117T203156/` (20:31 to
22:52, 17 Nov 2026), all five suites, 5 reps, 1205 runs, 0 failed, fresh
browser per config. Accuracy check (`accuracy.txt`) before the idle wait;
copy-cost and test logs saved next to it. Paper numbers come from it via
`paper/gen-results.cjs`.

Conditions: AC power, no thermal warnings in 264 samples, swap constant at
5225 MB. Foreign CPU median 158% (mean 184%) of 1600%, mostly Spotlight
indexing (spotlightknowledged about one core throughout) and contactsd, with
peaks up to 700%. The headline numbers match the 15:11 campaign (10M scan,
16 workers: 10.2 vs 10.4 ms; preagg 0.46 vs 0.46 ms) and the CIs are
narrow, so the run is kept; the load is reported in the paper.

Flights, 10M rows, 16 workers unless noted (ms):

| | three-view | six-view |
|---|---|---|
| ParaVega exact preagg | 0.46 | 1.05 |
| ParaVega WebGPU | 1.72 | 11.1 |
| ParaVega scan | 10.2 | 31.1 |
| Main-thread kernel | 96.1 | 294 |
| Mosaic preagg (default / no batching) | 16.7 / 6.0 | 17.8 / 17.7 |
| Falcon ArrowDB / DuckDB | 0.22 / 0.22 | 0.44 / 0.46 |
| Stock Vega at 1M | 393 | 1721 |
| Ready: ParaVega / Mosaic / Falcon Arrow | 52 / 2078 / 669 | 86 / 3658 / 1778 |
| First brush: ParaVega / Mosaic / Falcon Arrow | 25 / 524 / 332 | 86 / 1560 / 956 |

Observations for the write-up:

- The exact index is also the fastest to build (first brush), against
  both approximate indexes.
- Preagg drag gap: 26.7 ms (three-view) and 96.7 ms (six-view) at 10M.
  Cause: `finishPreagg` builds the segment trees on the main thread after
  the workers return the cubes. Fix to try: build tree levels in the
  workers (one Map per level over a resident cube).
- Scatter at 10M: filter 52 ms, update 286 ms; drawing about 150K points
  dominates. Report as the case where the transform stops being the limit.
- Falcon ArrowDB blocks the main thread on the first brush (gap 957 ms
  three-view, 2.2 s six-view at 10M).


## 28. Whole runtime: Farm, dense marks, more transforms (18 Nov)

Goal (user, 18 Nov): the whole Vega runtime in parallel on ParaWeb, not a
brushing backend; unchanged specs.

**Farm loop** (`runtime/farm.ts`). Vega awaits every async operator before
the next. The replacement loop lets queued ParaVega operators start while
others are pending, unless they depend on a pending or held operator through
pulse sources or operator parameters. Non-reactive parameters have no
`_targets` edge, so the check walks upstream. Vega's own operators run only
when nothing is pending: `ViewLayout` reads scenegraph state that marks write,
which is ordered by rank alone (first version, which let them run, broke
layout). Effect at 16 workers is small (each aggregate already uses all
workers): -18 ms on the box plot, +10 ms on the moving average, about 1 ms
elsewhere. Assigning worker subsets to concurrent operators is open.

**Dense marks** (`runtime/dense.ts`). Findings that shaped the design:
- Bit-identical pixels are impossible with any decomposition: Chrome's
  antialiasing of a path depends on the draw calls before it on the same
  canvas (a 1x1 `drawImage` before drawing changes 434 px by up to 40
  levels; drawing only a stripe's items on a full-size canvas with the same
  coordinates changes edges by up to 56). A layer composited over a
  background rounds by up to 3 levels. `demo/raster-experiment.html`.
  Worker OffscreenCanvas with the same draw sequence is bit-identical.
- Exact parts, tested: item values and bounds (Node), layout, item order,
  picks (browser). Pixels: PSNR >= 20 dB, no 4x4 block mean off by >= 96.
- Bugs found by the browser test: raster clamped to a canvas not yet sized
  (vconcat); group bounds not updated because an empty pulse stops at the
  mark's sieve (fix: placeholder mod item); stale `globalAlpha`; item order
  must follow Vega's incremental collect (survivors, then entering rows).
- GPU-backed worker canvases are drawn one after the other by the GPU
  process; software canvases (`willReadFrequently`) scale to about 8 workers
  (3, 4, 9 us per symbol with 4, 8, 16 drawing at once). Stripes are cut at
  symbol quantiles (equal heights put 22K symbols in middle stripes and 100
  at the edges).
- 1M rows (Chrome): linked scatterplot update 999 ms (stock) / 834 (items)
  / 311 (dense); scatterplot first view 2307 / 2107 / 844.

**Transforms added**: density (`runtime/density.ts`, sampleCurve in rounds,
then Vega's own sampleCurve over memoized values); window frames and
lag/lead/first/last/nth; lookup (derived kind `map`); median/q1/q3 in
aggregate and joinaggregate. Window sum/mean/average run sequentially per
partition in Vega's add/remove order: prefix differences flipped a
`datum.ma > 20` filter at 1M rows (checksum off by 10).

**Vega's incremental box plot is wrong after several brush moves**: whisker
ends of 3 of 10 carriers stay stale; a fresh stock view in the same state
agrees with ParaVega. The bench now also computes a fresh-state stock
checksum (exact Shewchuk sum, order-free).

**Derived measures with strings**: Vega counts a non-numeric string as a
valid value and its sum becomes NaN; derived numeric columns now report such
values (`poison`) and the measure falls back.
