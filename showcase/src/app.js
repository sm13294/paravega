// ParaVega showcase: the three-view crossfilter dashboard of the paper (Vega
// specification from demo/crossfilterSpec.js, unchanged), on stock Vega or on
// ParaVega, with a live view of the page's responsiveness.
import { registerParaweb } from "./paraweb-vega.mjs";
import { crossfilterSpec, FIELDS } from "./crossfilterSpec.js";
import { makeDistRows, distVegaLite } from "./distSpec.js";

// Two pages share this script: the crossfilter dashboard of the paper (index.html) and the
// distribution explorer (distributions.html), which sets window.SHOWCASE_PAGE.
const PAGE = window.SHOWCASE_PAGE === "distributions" ? "distributions" : "crossfilter";

const $ = id => document.getElementById(id);
const q = new URLSearchParams(location.search);
const ENGINES = { stock: "Stock Vega", paravega: "ParaVega", index: "ParaVega + index", gpu: "ParaVega + WebGPU" };
if (PAGE === "distributions") { delete ENGINES.index; delete ENGINES.gpu; } // counts only
const engine = ENGINES[q.get("engine")] ? q.get("engine") : "stock";
const rows = Number(q.get("rows")) || 1000000;
const cores = navigator.hardwareConcurrency || 4;
// Workers: 1, 2, 4, 8, 16, or all cores (default).
const threadsParam = q.get("threads") || "auto";
const threads = threadsParam === "auto" ? cores : Math.max(1, Number(threadsParam) || cores);
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
$("threads").value = ["1", "2", "4", "8", "16"].includes(threadsParam) ? threadsParam : "auto";
$("threads").disabled = engine === "stock";
$("threads").onchange = () => go({ threads: $("threads").value });
$("engineName").textContent = ENGINES[engine];
$("engineName").className = "engine " + (engine === "stock" ? "stock" : "pv");
$("engineNote").textContent = PAGE === "distributions" ? {
  stock: "Vega filters the rows, estimates the densities and sorts the delays for the quartiles tuple by tuple on the main thread.",
  paravega: `The same operators in parallel: the densities as MapReduce in rounds and the quartiles with a parallel sort, on ${threads} worker${threads > 1 ? "s" : ""}.`,
}[engine] : {
  stock: "Vega evaluates the filters, bins and counts tuple by tuple on the main thread.",
  paravega: "The same operators, evaluated as fused kernels over shared columns on all cores.",
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
  if (engine !== "stock") handle = registerParaweb(vega, { threads, preaggregate: engine === "index", gpu: engine === "gpu" });
  if (handle && engine === "gpu") {
    await handle.ready;
    if (!handle.gpu) $("engineNote").innerHTML = '<span class="warn">WebGPU is not available in this browser, so the counts run on the workers.</span>';
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
  $("initMs").textContent = fmt(performance.now() - t0);

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
  $("replay").onclick = () => replay(view);
  $("status").textContent = `${rows.toLocaleString()} rows · drag a brush on ${PAGE === "distributions" ? "the departure-time histogram" : "any histogram"}`;
  $("envNote").innerHTML = `Vega ${vega.version} · ${navigator.hardwareConcurrency || "?"} logical cores · ` +
    (crossOriginIsolated ? "cross-origin isolated" : `not isolated (${window.pwIsolation || "no headers"})`) +
    (active ? ` · ParaVega active on ${threads} worker${threads > 1 ? "s" : ""}` : "") +
    (handle && engine === "gpu" ? (handle.gpu ? " · WebGPU active" : " · no WebGPU") : "") +
    (active && threads > cores ? `<br><span class="warn">More workers than cores (${cores}): the extra workers share cores.</span>` : "") +
    "<br>Numbers depend on the machine; the paper's were measured on a 16-core laptop.";
  window.pwView = view; // for the console
}

function record(ms) {
  lat.push(ms); if (lat.length > 20) lat.shift();
  $("lastMs").textContent = fmt(ms);
  const s = [...lat].sort((a, b) => a - b);
  $("medMs").textContent = fmt(s[s.length >> 1]);
}

// A one-second drag of the departure-time brush at 60 Hz, as in the paper's benchmark: the brush
// is set every 16 ms without waiting for results, then we wait until the last update is drawn.
// The pixel signal of a Vega-Lite brush lives in the scope of its view, not at the top level.
function findSignal(ctx, name) {
  if (ctx.signals && ctx.signals[name]) return ctx.signals[name];
  for (const sub of ctx.subcontext || []) { const s = findSignal(sub, name); if (s) return s; }
  return null;
}
let brushX = null;
async function replay(view) {
  if (PAGE === "distributions" && !brushX) brushX = findSignal(view._runtime, "b_x");
  $("replay").disabled = true;
  $("status").textContent = "replaying a one-second drag…";
  await nextFrame();
  dragging = true; dragMax = 0; startLagWatch();
  const t0 = performance.now();
  let k = 0;
  await new Promise(resolve => {
    const id = setInterval(() => {
      noteInput(performance.now());
      if (PAGE === "distributions") { const a = 60 + (k++ * 6) % 480; view.update(brushX, [a, a + 160]); }
      else { const a = 10 + (k++ * 3) % 190; view.signal("time_px", [a, a + 60]); }
      view.runAsync();
      if (performance.now() - t0 >= 1000) { clearInterval(id); resolve(); }
    }, 16);
  });
  const tEnd = performance.now();
  await view.runAsync();
  await nextFrame();
  dragging = false;
  $("gapMs").textContent = fmt(dragMax);
  $("settleMs").textContent = fmt(performance.now() - tEnd);
  $("status").textContent = `${rows.toLocaleString()} rows · ${k} brush positions in one second`;
  $("replay").disabled = false;
}

main().catch(e => { $("status").innerHTML = `<span class="warn">${String(e && e.message || e)}</span>`; console.error(e); });
