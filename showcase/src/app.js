// ParaVega showcase: the three-view crossfilter dashboard of the paper (Vega
// specification from demo/crossfilterSpec.js, unchanged), on stock Vega or on
// ParaVega, with a live view of the page's responsiveness.
import { registerParaweb, inlineWorkerFactory } from "./paraweb-vega.mjs";
import { crossfilterSpec, FIELDS } from "./crossfilterSpec.js";
import { makeDistRows, distVegaLite } from "./distSpec.js";

// Two pages share this script: the crossfilter dashboard of the paper (index.html) and the
// distribution explorer (distributions.html), which sets window.SHOWCASE_PAGE.
const PAGE = window.SHOWCASE_PAGE === "distributions" ? "distributions" : "crossfilter";

const $ = id => document.getElementById(id);
const q = new URLSearchParams(location.search);
const ENGINES = { stock: "Stock Vega", paravega: "ParaVega", index: "ParaVega + index", gpu: "ParaVega + WebGPU" };
if (PAGE === "distributions") delete ENGINES.index; // the index answers counts only
// WebGPU on the distribution explorer: exact (quartiles on the GPU) or approximate (also the
// density sums, in 32-bit floats).
const gpuMode = q.get("gpumode") === "approx" ? "approx" : "exact";
const engine = ENGINES[q.get("engine")] ? q.get("engine") : "stock";
const rows = Number(q.get("rows")) || 1000000;
const cores = navigator.hardwareConcurrency || 4;
// Workers: 1, 2, 4, 8, 16, or all cores (default).
const threadsParam = q.get("threads") || "auto";
// "0": ParaVega's kernels and columns, but computed on the main thread (no workers), as the
// Main column of the paper's Table 5; it separates the effect of the workers from that of the layout.
const mainThread = threadsParam === "0";
const threads = mainThread ? 1 : threadsParam === "auto" ? cores : Math.max(1, Number(threadsParam) || cores);
const workersText = mainThread ? "the main thread (no workers)" : `${threads} worker${threads > 1 ? "s" : ""}`;
const BINS = { distance: { extent: [0, 4000], maxbins: 40 }, delay: { extent: [-60, 180], maxbins: 40 }, time: { extent: [0, 24], maxbins: 24 } };

// ---- controls (every change reloads the page, so each engine starts clean)
const go = p => { const u = new URLSearchParams(q); for (const [k, v] of Object.entries(p)) u.set(k, v); location.search = u.toString(); };
for (const b of $("engines").querySelectorAll("button")) {
  b.setAttribute("aria-pressed", String(b.dataset.engine === engine));
  b.onclick = () => go({ engine: b.dataset.engine });
}
$("rows").value = String(rows);
if (!$("rows").value) { $("rows").value = "1000000"; }
$("rows").onchange = () => go({ rows: $("rows").value });
$("threads").value = ["0", "1", "2", "4", "8", "16"].includes(threadsParam) ? threadsParam : "auto";
$("threads").disabled = engine === "stock";
$("threads").onchange = () => go({ threads: $("threads").value });
if ($("gpumode")) {
  $("gpumode").value = gpuMode;
  $("gpumode").disabled = engine !== "gpu";
  $("gpumode").onchange = () => go({ gpumode: $("gpumode").value });
}
$("engineName").textContent = ENGINES[engine];
$("engineName").className = "engine " + (engine === "stock" ? "stock" : "pv");
$("engineNote").textContent = PAGE === "distributions" ? {
  stock: "Vega filters the rows, estimates the densities and sorts the delays for the quartiles tuple by tuple on the main thread.",
  paravega: mainThread
    ? "ParaVega's operators over shared columns, but computed on the main thread without workers: faster than stock Vega, yet the page still stops while it computes."
    : `The same operators in parallel: the densities as MapReduce in rounds and the quartiles with a parallel sort, on ${workersText}.`,
  gpu: gpuMode === "approx"
    ? `WebGPU, approximate: the quartiles from an exact GPU histogram, and the density sums on the GPU in 32-bit floats (the curves differ from Vega's by about one part in a million); the rest on ${workersText}.`
    : `WebGPU, exact: the quartiles from a GPU histogram of the selected values, then the few values of each quartile's bucket; the density sums on ${workersText}. The results equal stock Vega's.`,
}[engine] : {
  stock: "Vega evaluates the filters, bins and counts tuple by tuple on the main thread.",
  paravega: mainThread
    ? "The same operators as fused kernels over shared columns, but on the main thread without workers, so the page stops while they compute."
    : `The same operators, evaluated as fused kernels over shared columns on ${workersText}.`,
  index: "ParaVega with its exact pre-aggregation index: after the first move of a brush, a move costs a lookup and two edge scans.",
  gpu: "ParaVega with its WebGPU backend: the counts of the three views run as compute shaders over columns kept in GPU buffers.",
}[engine];

// ---- responsiveness: a dot moved by requestAnimationFrame, and the gaps between frames
const gaps = []; // [time, gap]
let lastFrame = performance.now(), dragMax = 0, dragging = false;
const dot = $("dot"), beat = $("beat"), cv = $("gaps"), cx = cv.getContext("2d");
function frame(ts) {
  const gap = ts - lastFrame; lastFrame = ts;
  gaps.push([ts, gap]);
  while (gaps.length && gaps[0][0] < ts - 5000) gaps.shift();
  if (dragging) dragMax = Math.max(dragMax, gap);
  const w = beat.clientWidth - 28, p = (ts / 1600) % 2;
  dot.style.transform = `translateX(${(p < 1 ? p : 2 - p) * w + 4}px)`;
  drawGaps(ts);
  requestAnimationFrame(frame);
}
function drawGaps(now) {
  const W = cv.width, H = cv.height, max = 1000; // log scale from 10 ms to 10 s
  const y = g => H - (Math.log10(Math.max(10, Math.min(g, 10000))) - 1) / 3 * (H - 8) - 4;
  cx.clearRect(0, 0, W, H);
  cx.strokeStyle = "#9aa3ad"; cx.setLineDash([5, 4]); cx.beginPath(); cx.moveTo(0, y(16.7)); cx.lineTo(W, y(16.7)); cx.stroke(); cx.setLineDash([]);
  cx.fillStyle = "#5d6673"; cx.font = "20px system-ui"; cx.fillText("1 s", 4, y(1000) - 4); cx.fillText("100 ms", 4, y(100) - 4);
  for (const [t, g] of gaps) {
    const x = W - (now - t) / 5000 * W;
    cx.fillStyle = g > 100 ? "#b3261e" : g > 34 ? "#c77d0a" : "#1f7a4d";
    cx.fillRect(x - 2, y(g), 4, H - y(g));
  }
  void max;
}
requestAnimationFrame(frame);

// ---- are the results keeping up? The age of the oldest brush input that the drawn histograms
// do not include yet. The dot shows whether the page can draw; this meter shows whether the
// results arrive in time (with ParaVega on few workers the page draws, but the results lag).
// A brush position is shown once the evaluations it started have finished: when the next
// brush position starts to evaluate, or when the dataflow is idle. (One position can take
// several evaluations, for example when results arrive from the workers.)
const pendingInputs = []; // times of brush inputs not yet in the drawn results
let lagView = null, lagMax = 0, lagWatch = false, openStart = null; // openStart: start of the position being computed
const lagFill = $("lagfill"), lagText = $("lagMs");
const noteInput = t => { pendingInputs.push(t); };
// When inputs are drawn, their age at that moment is the lag they had (with stock Vega the page
// cannot draw while it computes, so this is the only moment the lag can be seen).
let drawnLag = 0, drawnAt = -Infinity;
function drawn(n) {
  if (!n) return;
  const now = performance.now(), age = now - pendingInputs[0];
  pendingInputs.splice(0, n);
  drawnLag = age; drawnAt = now;
  if (dragging || lagWatch) lagMax = Math.max(lagMax, age);
}
const shownUpTo = t => { let n = 0; while (n < pendingInputs.length && pendingInputs[n] <= t) n++; drawn(n); };
function updateLag() {
  const now = performance.now();
  if (lagView && !lagView._running) { // idle: everything is drawn
    drawn(pendingInputs.length);
    if (openStart !== null) { record(now - openStart); openStart = null; }
  }
  // The age of the oldest input not drawn yet; just after a drawing, the lag that input had.
  const lag = pendingInputs.length ? Math.max(0, now - pendingInputs[0]) : now - drawnAt < 400 ? drawnLag : 0;
  const p = lag <= 10 ? 0 : Math.min(1, (Math.log10(lag) - 1) / 3);
  lagFill.style.width = `${(p * 100).toFixed(1)}%`;
  lagFill.style.background = lag > 300 ? "var(--bad)" : lag > 100 ? "#c77d0a" : "var(--good)";
  lagText.textContent = lag ? fmt(lag) : "up to date";
  if (dragging || lagWatch) lagMax = Math.max(lagMax, lag);
  if (lagWatch && !dragging && lag === 0) { lagWatch = false; $("lagMax").textContent = fmt(lagMax); }
  requestAnimationFrame(updateLag);
}
const startLagWatch = () => { lagMax = 0; lagWatch = true; };
const nextFrame = () => new Promise(r => requestAnimationFrame(() => r()));
const fmt = ms => (ms >= 1000 ? (ms / 1000).toFixed(1) + " s" : ms >= 10 ? ms.toFixed(0) + " ms" : ms.toFixed(1) + " ms");

// ---- data: synthetic flights-like rows (seeded, as in the paper's synthetic data)
function makeTuples(n, seed = 42) {
  let s = seed >>> 0;
  const rand = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const distance = Math.round(50 + 2400 * rand() * rand());
    const u = rand() + rand() + rand() + rand() - 2;
    const delay = Math.round((u * 45 + (rand() < 0.08 ? 90 * rand() : 0)) * 10) / 10;
    const peak = rand() < 0.5 ? 8 : 17;
    const time = Math.min(23.99, Math.max(0, peak + (rand() + rand() + rand() - 1.5) * 5));
    out[i] = { distance, delay, time };
  }
  return out;
}

// ---- the dashboard
const lat = [];
async function main() {
  $("status").textContent = `generating ${rows.toLocaleString()} rows…`;
  await nextFrame();
  let spec;
  if (PAGE === "distributions") {
    spec = vegaLite.compile(distVegaLite()).spec;
    spec.data.find(d => d.name === "flights").values = makeDistRows(rows);
  } else {
    spec = crossfilterSpec("stock", BINS, FIELDS);
    spec.data.find(d => d.name === "src").values = makeTuples(rows);
  }
  let handle = null;
  if (engine !== "stock") handle = registerParaweb(vega, { threads, ...(mainThread ? { workerFactory: inlineWorkerFactory() } : {}), preaggregate: engine === "index", gpu: engine === "gpu", gpuApproximate: engine === "gpu" && gpuMode === "approx" });
  if (handle && engine === "gpu") {
    await handle.ready;
    if (!handle.gpu) $("engineNote").innerHTML = '<span class="warn">WebGPU is not available in this browser, so everything runs on the workers.</span>';
  }
  const active = !!(handle && handle.active !== false);
  if (engine !== "stock" && !active) {
    $("engineNote").innerHTML = '<span class="warn">ParaVega is inactive: this page is not cross-origin isolated, so the browser provides no shared memory and the dashboard runs on stock Vega.</span>';
  }
  $("status").textContent = "building the view…";
  await nextFrame();
  const t0 = performance.now();
  const view = new vega.View(vega.parse(spec), { renderer: "canvas", container: "#view", hover: false });
  await view.runAsync();
  await nextFrame();
  firstViewMs = performance.now() - t0;
  $("initMs").textContent = fmt(firstViewMs);

  // Latency of a brush update: from the first evaluation of a new brush position until the next
  // position starts to evaluate or the dataflow is idle (measured to the frame).
  // The distribution explorer's brush is a Vega-Lite selection: its value is the top-level signal b.
  const brushSignals = PAGE === "distributions" ? ["b"] : FIELDS.map(f => `${f}_px`);
  let prev = brushSignals.map(s => JSON.stringify(view.signal(s)));
  let lastChangeStart = -Infinity;
  lagView = view;
  requestAnimationFrame(updateLag);
  const evaluate = view.evaluate;
  view.evaluate = function (...args) {
    const cur = brushSignals.map(s => JSON.stringify(view.signal(s)));
    const changed = cur.some((c, i) => c !== prev[i]);
    prev = cur;
    const s = performance.now();
    const p = evaluate.apply(this, args);
    if (changed) {
      shownUpTo(lastChangeStart); // the previous brush position is drawn by now
      if (openStart !== null) record(s - openStart);
      lastChangeStart = openStart = s;
    }
    return p;
  };
  // Largest frame gap while the pointer is down on the dashboard.
  $("view").addEventListener("pointerdown", e => { dragging = true; dragMax = 0; startLagWatch(); noteInput(e.timeStamp); }, { capture: true });
  window.addEventListener("pointermove", e => { if (dragging && e.buttons) noteInput(e.timeStamp); }, { capture: true });
  window.addEventListener("pointerup", () => { if (dragging) { dragging = false; $("gapMs").textContent = fmt(dragMax); } });

  $("replay").disabled = false;
  $("replay").onclick = async () => { const res = await replay(view); storeRun(res); };
  $("status").textContent = `${rows.toLocaleString()} rows · drag a brush on ${PAGE === "distributions" ? "the departure-time histogram" : "any histogram"}`;
  $("envNote").innerHTML = `Vega ${vega.version} · ${navigator.hardwareConcurrency || "?"} logical cores · ` +
    (crossOriginIsolated ? "cross-origin isolated" : `not isolated (${window.pwIsolation || "no headers"})`) +
    (active ? ` · ParaVega active on ${workersText}` : "") +
    (handle && engine === "gpu" ? (handle.gpu ? " · WebGPU active" : " · no WebGPU") : "") +
    (active && threads > cores ? `<br><span class="warn">More workers than cores (${cores}): the extra workers share cores.</span>` : "") +
    "<br>Numbers depend on the machine; the paper's were measured on a 16-core laptop.";
  window.pwView = view; // for the console
  envInfo = { cores: navigator.hardwareConcurrency || null, vega: vega.version, isolated: crossOriginIsolated, gpu: !!(handle && handle.gpu) };
  benchStep(view);
}

let replayLat = null; // latencies of the brush positions of the running replay
function record(ms) {
  if (replayLat) replayLat.push(ms);
  lat.push(ms); if (lat.length > 20) lat.shift();
  $("lastMs").textContent = fmt(ms);
  const s = [...lat].sort((a, b) => a - b);
  $("medMs").textContent = fmt(s[s.length >> 1]);
}

// A one-second drag at 60 Hz, as in the paper's benchmark: the brush is set every 16 ms
// without waiting for results, then we wait until the last update is drawn. The brush
// position is a function of the time since the start of the drag, from a fixed start to a
// fixed end, so that every configuration selects the same rows at the end (and passes the
// same positions in between), however many updates it manages.
// The pixel signal of a Vega-Lite brush lives in the scope of its view, not at the top level.
function findSignal(ctx, name) {
  if (ctx.signals && ctx.signals[name]) return ctx.signals[name];
  for (const sub of ctx.subcontext || []) { const s = findSignal(sub, name); if (s) return s; }
  return null;
}
let brushX = null;
function setBrush(view, u) { // u from 0 (start) to 1 (end)
  if (PAGE === "distributions") { const a = 60 + 480 * u; view.update(brushX, [a, a + 160]); }
  else { const a = 10 + 180 * u; view.signal("time_px", [a, a + 60]); }
}
async function idle(view) { // until no evaluation runs for two frames
  for (let quiet = 0; quiet < 2;) { await nextFrame(); quiet = view._running ? 0 : quiet + 1; if (view._running) await view._running; }
}
async function replay(view) {
  if (PAGE === "distributions" && !brushX) brushX = findSignal(view._runtime, "b_x");
  $("replay").disabled = true;
  $("status").textContent = "replaying a one-second drag…";
  // The same start for every run: the other brushes cleared, this one at its start position.
  if (PAGE === "crossfilter") { view.signal("distance_px", null); view.signal("delay_px", null); }
  setBrush(view, 0);
  await view.runAsync();
  await idle(view);
  dragging = true; dragMax = 0; startLagWatch(); replayLat = [];
  const t0 = performance.now();
  let k = 0;
  await new Promise(resolve => {
    const id = setInterval(() => {
      const u = Math.min(1, (performance.now() - t0) / 1000);
      noteInput(performance.now());
      setBrush(view, u);
      k++;
      view.runAsync();
      if (u >= 1) { clearInterval(id); resolve(); }
    }, 16);
  });
  const tEnd = performance.now();
  await view.runAsync();
  await idle(view);
  const settleMs = performance.now() - tEnd;
  dragging = false;
  // The largest lag is final once the lag meter is back to zero.
  for (let w = 0; lagWatch && w < 600; w++) await nextFrame();
  const sorted = [...replayLat].sort((a, b) => a - b);
  replayLat = null;
  const res = {
    positions: k, updates: sorted.length,
    medianMs: sorted.length ? sorted[sorted.length >> 1] : null,
    maxLagMs: lagMax, maxGapMs: dragMax, settleMs,
  };
  $("gapMs").textContent = fmt(dragMax);
  $("settleMs").textContent = fmt(res.settleMs);
  $("status").textContent = `${rows.toLocaleString()} rows · ${k} brush positions in one second`;
  $("replay").disabled = false;
  return res;
}

// ---- runs: every replay is stored in this browser (localStorage), to compare configurations
const RUNS_KEY = "paravega-showcase-runs", BENCH_KEY = "paravega-showcase-bench";
const load = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const save = (k, v) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const pageName = { crossfilter: "Crossfilter", distributions: "Distributions" };
const engineLabel = () => ENGINES[engine] + (engine === "gpu" && PAGE === "distributions" ? (gpuMode === "approx" ? " (approx.)" : " (exact)") : "");
const workersLabel = () => engine === "stock" ? "–" : mainThread ? "none" : String(threads);
let firstViewMs = null, envInfo = {};
function storeRun(res, batch) {
  const runs = load(RUNS_KEY, []);
  runs.push({
    when: new Date().toISOString(), batch: batch || null, page: PAGE, engine: engineLabel(), workers: workersLabel(),
    rows, firstViewMs, ...res, ...envInfo,
  });
  save(RUNS_KEY, runs.slice(-500));
  renderRuns();
}
const cell = v => v === null || v === undefined ? "–" : typeof v === "number" ? fmt(v) : String(v);
function renderRuns() {
  const runs = load(RUNS_KEY, []);
  const body = $("runsBody");
  if (!body) return;
  body.innerHTML = runs.length ? "" : `<tr><td colspan="11" class="note">No runs yet: press "Replay a one-second drag", or benchmark all configurations.</td></tr>`;
  for (const r of [...runs].reverse()) {
    const tr = document.createElement("tr");
    const cur = r.page === PAGE && r.engine === engineLabel() && r.workers === workersLabel() && r.rows === rows;
    if (cur) tr.className = "cur";
    const vals = [new Date(r.when).toLocaleTimeString(), pageName[r.page] || r.page, r.engine, r.workers, Number(r.rows).toLocaleString(),
      r.error ? r.error : r.positions, cell(r.medianMs), cell(r.maxLagMs), cell(r.maxGapMs), cell(r.settleMs), cell(r.firstViewMs)];
    vals.forEach((v, i) => { const td = document.createElement("td"); td.textContent = v; if (i >= 4) td.className = "num"; tr.appendChild(td); });
    body.appendChild(tr);
  }
}
function downloadRuns() {
  const runs = load(RUNS_KEY, []);
  const cols = ["when", "batch", "page", "engine", "workers", "rows", "positions", "updates", "medianMs", "maxLagMs", "maxGapMs", "settleMs", "firstViewMs", "error", "cores", "vega", "isolated", "gpu"];
  const csv = [cols.join(",")].concat(runs.map(r => cols.map(c => r[c] === undefined || r[c] === null ? "" : JSON.stringify(r[c])).join(","))).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = "paravega-showcase-runs.csv";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---- benchmark: the replay for every configuration, one fresh page per configuration
const SIZES = [...$("rows").options].map(o => Number(o.value));
const STOCK_MAX_ROWS = 1000000; // stock Vega above 1M rows takes minutes to load (paper, Section 6.1)
function benchConfigs(sizes) {
  const out = [];
  for (const n of sizes) {
    if (n <= STOCK_MAX_ROWS) out.push({ engine: "stock", rows: n });
    for (const t of ["0", "1", "2", "4", "8", "16"]) out.push({ engine: "paravega", threads: t, rows: n });
    if (PAGE === "crossfilter") { out.push({ engine: "index", threads: "16", rows: n }); out.push({ engine: "gpu", threads: "16", rows: n }); }
    else { out.push({ engine: "gpu", threads: "16", gpumode: "exact", rows: n }); out.push({ engine: "gpu", threads: "16", gpumode: "approx", rows: n }); }
  }
  return out;
}
function gotoConfig(c) {
  const u = new URLSearchParams();
  u.set("engine", c.engine); u.set("rows", String(c.rows));
  if (c.threads) u.set("threads", c.threads);
  if (c.gpumode) u.set("gpumode", c.gpumode);
  location.search = u.toString();
}
function startBench() {
  const sizes = $("benchSizes").value === "all" ? SIZES : [rows];
  const configs = benchConfigs(sizes);
  const batch = new Date().toISOString().slice(0, 19);
  save(BENCH_KEY, { page: PAGE, batch, configs, i: 0 });
  gotoConfig(configs[0]);
}
function stopBench() { save(BENCH_KEY, null); $("benchStatus").textContent = "benchmark stopped"; $("benchStop").disabled = true; $("benchRun").disabled = false; }
async function benchStep(view) {
  const plan = load(BENCH_KEY, null);
  if (!plan || plan.page !== PAGE) return;
  $("benchStatus").textContent = `benchmark ${plan.batch}: configuration ${plan.i + 1} of ${plan.configs.length} (warm-up, then measured)`;
  $("benchStop").disabled = false; $("benchRun").disabled = true;
  try {
    await replay(view);                 // warm-up (index builds, compiled kernels)
    const res = await replay(view);
    if (!load(BENCH_KEY, null)) return; // stopped meanwhile
    storeRun(res, plan.batch);
  } catch (e) { storeRun({ error: String(e && e.message || e) }, plan.batch); }
  advanceBench(plan);
}
function advanceBench(plan) {
  plan.i++;
  if (plan.i >= plan.configs.length) {
    save(BENCH_KEY, null);
    $("benchStatus").textContent = `benchmark ${plan.batch} done: ${plan.configs.length} configurations`;
    $("benchStop").disabled = true; $("benchRun").disabled = false;
    return;
  }
  save(BENCH_KEY, plan);
  gotoConfig(plan.configs[plan.i]);
}
function setupRuns() {
  const css = document.createElement("style");
  css.textContent = `#runs { padding: 0 20px 24px; } #runs table { border-collapse: collapse; width: 100%; font-size: 13px; }
#runs th, #runs td { padding: 4px 8px; border-bottom: 1px solid var(--line); text-align: left; white-space: nowrap; }
#runs th { color: var(--muted); font-weight: 600; } #runs td.num, #runs th.num { text-align: right; font-variant-numeric: tabular-nums; }
#runs tr.cur td { background: var(--panel); } #runs .tools { display: flex; flex-wrap: wrap; gap: 8px 14px; align-items: center; margin: 8px 0 10px; }
#runs .scroll { overflow-x: auto; max-height: 420px; overflow-y: auto; }`;
  document.head.appendChild(css);
  const sec = document.createElement("section");
  sec.id = "runs";
  sec.innerHTML = `<div class="card"><h2>Your runs (stored in this browser)</h2>
<div class="tools">
  <label>Benchmark <select id="benchSizes"><option value="this">this size</option><option value="all">all sizes</option></select></label>
  <button class="action" id="benchRun">Run all configurations</button>
  <button id="benchStop" disabled>Stop</button>
  <span id="benchStatus" class="note" style="margin:0"></span>
  <span style="flex:1"></span>
  <button id="runsCsv">Download CSV</button> <button id="runsClear">Clear runs</button>
</div>
<div class="note" style="margin:0 0 8px">Every replay is stored here. The benchmark loads every configuration in a fresh page (stock Vega, ParaVega with no workers and 1 to 16 workers, ${PAGE === "crossfilter" ? "the index, WebGPU" : "WebGPU exact and approximate"}), replays the drag once to warm up and once to measure. Stock Vega is skipped above 1M rows.</div>
<div class="scroll"><table><thead><tr><th>Time</th><th>Page</th><th>Engine</th><th>Workers</th><th class="num">Rows</th><th class="num">Positions</th><th class="num">Median update</th><th class="num">Largest lag</th><th class="num">Largest frame gap</th><th class="num">After the drag</th><th class="num">First view</th></tr></thead><tbody id="runsBody"></tbody></table></div></div>`;
  document.body.appendChild(sec);
  $("benchRun").onclick = startBench;
  $("benchStop").onclick = stopBench;
  $("runsCsv").onclick = downloadRuns;
  $("runsClear").onclick = () => { if (confirm("Clear all stored runs?")) { save(RUNS_KEY, []); renderRuns(); } };
  const plan = load(BENCH_KEY, null);
  if (plan && plan.page === PAGE) {
    $("benchStop").disabled = false; $("benchRun").disabled = true;
    $("benchStatus").textContent = `benchmark ${plan.batch}: loading configuration ${plan.i + 1} of ${plan.configs.length}`;
    // A configuration that does not finish in 5 minutes is recorded as a timeout.
    const i = plan.i;
    setTimeout(() => { const p = load(BENCH_KEY, null); if (p && p.batch === plan.batch && p.i === i) { storeRun({ error: "timeout" }, p.batch); advanceBench(p); } }, 300000);
  }
  renderRuns();
}
setupRuns();

main().catch(e => {
  $("status").innerHTML = `<span class="warn">${String(e && e.message || e)}</span>`; console.error(e);
  // In a benchmark, record the failure and go on with the next configuration.
  const plan = load(BENCH_KEY, null);
  if (plan && plan.page === PAGE) { storeRun({ error: String(e && e.message || e) }, plan.batch); advanceBench(plan); }
});
