/**
 * Builds a self-contained HTML report (inline SVG, no external requests)
 * from a benchmark campaign directory (bench/run-campaign.sh), or from
 * individual result files.
 *
 *   node bench/report.cjs out.html <campaign-dir>
 *   node bench/report.cjs out.html run1.json [run2.json ...]
 *
 * With several files for the same suite and data set, later files override
 * earlier ones for the same (mode, rows, workers).
 */
const fs = require("fs");
const path = require("path");

const [out, ...args] = process.argv.slice(2);
if (!out || !args.length) {
  console.error("usage: report.cjs out.html <campaign-dir> | run1.json [run2.json ...]");
  process.exit(1);
}
let files = args, campaignDir = null;
if (args.length === 1 && fs.statSync(args[0]).isDirectory()) {
  campaignDir = args[0];
  files = fs.readdirSync(campaignDir).filter(f => /^(crossfilter|scatter)-.*\.json$/.test(f)).map(f => path.join(campaignDir, f));
}

// runs[suite][dataset] = Map(key -> summary group)
const runs = {};
let env = null, reps = 0;
for (const file of files) {
  const j = JSON.parse(fs.readFileSync(file, "utf8"));
  env = env || j.env;
  reps = Math.max(reps, j.reps || 0);
  const suite = (j.suite || "crossfilter") + (j.dashboard === "wide" ? "-wide" : ""), dataset = j.dataset || "synthetic";
  const m = ((runs[suite] ??= {})[dataset] ??= new Map());
  for (const g of j.summary || []) if (g.reps) m.set(`${g.mode}|${g.n}|${g.threads}`, { ...g, file: path.basename(file) });
}
const readJSON = f => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };
const envBefore = campaignDir ? readJSON(path.join(campaignDir, "env-before.json")) : null;
const envAfter = campaignDir ? readJSON(path.join(campaignDir, "env-after.json")) : null;
let machine = [];
if (campaignDir && fs.existsSync(path.join(campaignDir, "machine-state.csv"))) {
  const lines = fs.readFileSync(path.join(campaignDir, "machine-state.csv"), "utf8").trim().split("\n");
  const wide = lines[0].includes("swap_used_mb");
  machine = lines.slice(1).map(l => {
    const c = l.split(",");
    return wide ? { t: c[0], th: c[1], la: +c[2], fc: +c[3], swap: +c[4], disk: +c[5], top: c[6] || "" }
                : { t: c[0], th: c[1], la: +c[2], fc: +c[3], swap: NaN, disk: NaN, top: c[4] || "" };
  });
}

const sizeLabel = n => (n >= 1e6 ? `${n / 1e6}M` : `${n / 1e3}K`);
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
const fmt = v => (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2));
const DS = { synthetic: "synthetic data", flights: "flights-10m (real data)" };

// Fixed categorical order (reference palette, slots 1-8): one hue per
// system; variants of one system share its hue and differ by line style.
const XF_SERIES = [
  { id: "preagg", threads: 16, cls: "s1", label: "ParaVega, exact pre-aggregation (16 workers)" },
  { id: "gpu", threads: 16, cls: "s2", label: "ParaVega, WebGPU scan" },
  { id: "table", threads: 16, cls: "s3", label: "ParaVega, scan (16 workers)" },
  { id: "inline", threads: 1, cls: "s4", label: "Fused kernel on the main thread (no workers)" },
  { id: "mosaic", threads: 16, cls: "s5", label: "Mosaic, pre-aggregation (default)" },
  { id: "mosaic-noconsol", threads: 16, cls: "s5", dash: "7 4", label: "Mosaic, pre-aggregation, no frame batching" },
  { id: "mosaic-nopreagg", threads: 16, cls: "s5", dash: "2 3", label: "Mosaic, no pre-aggregation" },
  { id: "falcon-arrow", threads: 1, cls: "s6", label: "Falcon, ArrowDB (main thread)" },
  { id: "falcon-duckdb", threads: 16, cls: "s6", dash: "7 4", label: "Falcon, DuckDB-WASM" },
  { id: "crossfilter", threads: 1, cls: "s7", label: "Vega crossfilter transform" },
  { id: "stock", threads: 1, cls: "s8", label: "Stock Vega (filter, bin, aggregate)" },
];
// Scatter suite reuses slots 1, 2 and 8 so stock Vega keeps its color.
const SC_SERIES = [
  { id: "pwfilter-table", threads: 16, label: "ParaVega pwfilter, table (16 workers)", cls: "s1" },
  { id: "pwfilter-tuples", threads: 16, label: "ParaVega pwfilter, Vega tuples (16 workers)", cls: "s2" },
  { id: "stock", threads: 1, label: "Stock Vega filter", cls: "s8" },
];

function lineChart({ series, xs, xLabel, xFmt, yLabel, refLine, title }) {
  const W = 680, H = 380, L = 64, R = 20, T = 18, B = 52;
  const all = series.flatMap(s => s.points.map(p => p.stat.mean));
  // Axis range from the means; whiskers are clipped to the axis (with 3 runs
  // a wide CI would otherwise stretch the log axis towards zero).
  const lo = Math.min(...all), hi = Math.max(...all);
  const yMin = 10 ** Math.floor(Math.log10(Math.min(lo, refLine ?? Infinity)));
  const yMax = 10 ** Math.ceil(Math.log10(Math.max(hi * 1.3, refLine ?? 0)));
  const lx = xs.map(Math.log10);
  const xMin = Math.min(...lx), xMax = Math.max(...lx);
  const X = x => L + ((Math.log10(x) - xMin) / (xMax - xMin)) * (W - L - R);
  const Y = y => T + (1 - (Math.log10(y) - Math.log10(yMin)) / (Math.log10(yMax) - Math.log10(yMin))) * (H - T - B);
  let g = "";
  for (let e = Math.log10(yMin); e <= Math.log10(yMax) + 1e-9; e++) {
    const y = 10 ** e, py = Y(y);
    g += `<line class="grid" x1="${L}" x2="${W - R}" y1="${py}" y2="${py}"/>`;
    g += `<text class="tick" x="${L - 8}" y="${py + 4}" text-anchor="end">${y >= 1 ? y.toLocaleString("en") : y}</text>`;
  }
  for (const x of xs) {
    g += `<text class="tick" x="${X(x)}" y="${H - B + 20}" text-anchor="middle">${xFmt(x)}</text>`;
  }
  g += `<line class="axis" x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}"/>`;
  g += `<text class="axis-label" x="${(L + W - R) / 2}" y="${H - 10}" text-anchor="middle">${esc(xLabel)}</text>`;
  g += `<text class="axis-label" transform="translate(16 ${(T + H - B) / 2}) rotate(-90)" text-anchor="middle">${esc(yLabel)}</text>`;
  if (refLine) {
    const py = Y(refLine);
    g += `<line class="ref" x1="${L}" x2="${W - R}" y1="${py}" y2="${py}"/>`;
    g += `<text class="ref-label" x="${L + 6}" y="${py - 6}" text-anchor="start">one frame at 60 Hz (16.7 ms)</text>`;
  }
  for (const s of series) {
    const pts = s.points.map(p => [X(p.x), Y(p.stat.mean)]);
    if (pts.length > 1) g += `<polyline class="line ${s.cls}"${s.dash ? ` stroke-dasharray="${s.dash}"` : ""} points="${pts.map(p => p.join(",")).join(" ")}"/>`;
    for (const p of s.points) {
      const px = X(p.x), a = Y(Math.max(yMin, p.stat.mean - p.stat.ci95)), b = Y(Math.min(yMax, p.stat.mean + p.stat.ci95));
      if (p.stat.ci95 > 0) g += `<line class="ci ${s.cls}" x1="${px}" x2="${px}" y1="${a}" y2="${b}"/>`;
      g += `<g class="pt"><circle class="hit" cx="${px}" cy="${Y(p.stat.mean)}" r="11"/>` +
        `<circle class="dot ${s.cls}" cx="${px}" cy="${Y(p.stat.mean)}" r="4.5"/>` +
        `<title>${esc(s.label)}\n${esc(p.tip)}</title></g>`;
    }
  }
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">${g}</svg>`;
}

function legend(series) {
  const sample = s => `<svg class="lsample" width="26" height="12" aria-hidden="true"><line class="line ${s.cls}" x1="1" x2="25" y1="6" y2="6"${s.dash ? ` stroke-dasharray="${s.dash}"` : ""}/><circle class="dot ${s.cls}" cx="13" cy="6" r="3.5"/></svg>`;
  return `<ul class="legend">${series.map(s => `<li>${sample(s)}${esc(s.label)}</li>`).join("")}</ul>`;
}

function sizesOf(m) { return [...new Set([...m.values()].map(g => g.n))].sort((a, b) => a - b); }
function series(m, defs, metric, sizes) {
  return defs.map((s, i) => ({
    cls: s.cls || `s${i + 1}`, dash: s.dash, label: s.label,
    points: sizes.map(n => {
      const g = m.get(`${s.id}|${n}|${s.threads}`);
      const st = g && g.metrics[metric];
      return st && Number.isFinite(st.mean)
        ? { x: n, stat: st, tip: `${sizeLabel(n)} rows: ${fmt(st.mean)} ± ${fmt(st.ci95)} (95% CI, ${st.n} runs)` } : null;
    }).filter(Boolean),
  })).filter(s => s.points.length);
}
function chart(m, defs, metric, sizes, title, yLabel, caption, extra = {}) {
  const ser = series(m, defs, metric, sizes);
  if (!ser.length) return "";
  if (sizes.length < 2) return "";
  return `<figure><h3>${esc(title)}</h3>${legend(ser)}` +
    lineChart({ series: ser, xs: sizes, xLabel: "Rows", xFmt: sizeLabel, yLabel, title, ...extra }) +
    `<figcaption>${caption}</figcaption></figure>`;
}
function scalingChart(m, n) {
  const ser = [
    { id: "preagg", cls: "s1", label: "Exact pre-aggregation" },
    { id: "table", cls: "s3", label: "Scan" },
  ].map(s => ({
    cls: s.cls, label: s.label,
    points: [1, 2, 4, 8, 16].filter(t => m.get(`${s.id}|${n}|${t}`)).map(t => {
      const g = m.get(`${s.id}|${n}|${t}`); const st = g && g.metrics.sweepMs;
      return st ? { x: t, stat: st, tip: `${t} workers: ${fmt(st.mean)} ms ± ${fmt(st.ci95)} (${st.n} runs)` } : null;
    }).filter(Boolean),
  })).filter(s => s.points.length > 1);
  if (!ser.length) return "";
  return `<figure><h3>Worker scaling at ${sizeLabel(n)} rows</h3>${legend(ser)}` +
    lineChart({ series: ser, xs: [...new Set(ser.flatMap(x => x.points.map(p => p.x)))].sort((a, b) => a - b), xLabel: "Workers", xFmt: String, yLabel: "Median update latency (ms, log scale)", title: "Worker scaling" }) +
    `<figcaption>The scan scales with workers. With pre-aggregation an update merges O(log R) tree nodes per bin and scans only the rows in the two edge buckets on the main thread, so its latency no longer depends on the worker count (the workers build the index).</figcaption></figure>`;
}
const cell = v => (v && Number.isFinite(v.mean) ? `${fmt(v.mean)}<span class="pm"> ± ${fmt(v.ci95)}</span>` : "n/a");
function ttiTable(m, defs) {
  const sizes = sizesOf(m);
  const rows = defs.map((s, i) => {
    const n = [...sizes].reverse().find(n => m.get(`${s.id}|${n}|${s.threads}`));
    if (!n) return "";
    const g = m.get(`${s.id}|${n}|${s.threads}`).metrics;
    return `<tr><td><span class="swatch ${s.cls || "s" + (i + 1)}"></span>${esc(s.label)}</td><td class="num">${sizeLabel(n)}</td>` +
      `<td class="num">${cell(g.initMs)}</td><td class="num">${cell(g.firstBrushMs)}</td><td class="num">${cell(g.secondBrushMs)}</td>` +
      `<td class="num">${cell(g.sweepMs)}</td><td class="num">${cell(g.dragFps)}</td></tr>`;
  }).join("");
  return `<figure><h3>Time to interactive, largest size reached</h3><div class="table-wrap"><table>
    <thead><tr><th>Backend</th><th class="num">Rows</th><th class="num">Ready (ms)</th><th class="num">First move (ms)</th><th class="num">Second move (ms)</th><th class="num">Later moves (ms)</th><th class="num">Drag fps</th></tr></thead>
    <tbody>${rows}</tbody></table></div>
    <figcaption>Ready: from creating the view to the first render (Mosaic: includes starting DuckDB-WASM and loading the data). First and second move: the first two moves of a new brush on a fresh dashboard, where index builds happen.</figcaption></figure>`;
}
function fullTable(m, label) {
  const rows = [...m.values()].sort((a, b) => a.mode.localeCompare(b.mode) || a.n - b.n || a.threads - b.threads);
  const hasSel = rows.some(g => g.metrics.selected && Number.isFinite(g.metrics.selected.mean));
  return `<details><summary>All measurements: ${esc(label)}</summary><div class="table-wrap"><table>
    <thead><tr><th>Mode</th><th class="num">Rows</th><th class="num">Workers</th><th class="num">Runs</th><th class="num">Ready</th><th class="num">1st move</th><th class="num">2nd move</th><th class="num">Small moves</th><th class="num">Jumps</th>${hasSel ? '<th class="num">Compute</th><th class="num">Selected rows</th>' : ""}<th class="num">Drag fps</th><th class="num">Max gap</th></tr></thead>
    <tbody>${rows.map(g => `<tr><td>${esc(g.mode)}</td><td class="num">${sizeLabel(g.n)}</td><td class="num">${g.threads}</td><td class="num">${g.reps}${g.errors.length ? ` (${g.errors.length} failed)` : ""}</td>` +
      [g.metrics.initMs, g.metrics.firstBrushMs, g.metrics.secondBrushMs, g.metrics.sweepMs, g.metrics.jumpMs].map(v => `<td class="num">${cell(v)}</td>`).join("") +
      (hasSel ? `<td class="num">${cell(g.metrics.computeMs)}</td><td class="num">${g.metrics.selected && Number.isFinite(g.metrics.selected.mean) ? Math.round(g.metrics.selected.mean).toLocaleString("en") : "n/a"}</td>` : "") +
      `<td class="num">${cell(g.metrics.dragFps)}</td><td class="num">${cell(g.metrics.dragMaxGapMs)}</td></tr>`).join("")}</tbody></table></div></details>`;
}

function crossfilterSection(dataset) {
  const m = runs.crossfilter && runs.crossfilter[dataset];
  if (!m) return "";
  const sizes = sizesOf(m);
  const big = sizes[sizes.length - 1];
  return `<section class="suite"><h2>Crossfilter histograms, ${esc(DS[dataset] || dataset)}</h2>
  <p>Three linked histograms (distance, delay, time; 40 bins), each filtered by the brushes on the other two.${dataset === "flights" ? " Bin extents as in Vega's crossfilter-flights example; the first n rows of the shuffled data set." : ""}</p>
  ${chart(m, XF_SERIES, "sweepMs", sizes, "Brush-update latency, small moves", "Median update latency (ms, log scale)", "20 consecutive small brush moves; each value is the median of the 20. Stock Vega stops at 1M rows (5M did not finish within 30 minutes); Vega's crossfilter and tuple-based modes stop at 5M (tab memory). Mosaic's default per-frame query batching sets a floor near 16.7 ms.")}
  ${chart(m, XF_SERIES, "jumpMs", sizes, "Brush-update latency, random jumps", "Median update latency (ms, log scale)", "20 random brush positions. Vega's crossfilter is incremental, so large changes cost it more; the other backends recompute.")}
  ${chart(m, XF_SERIES, "dragMaxGapMs", sizes, "Responsiveness during a drag", "Largest gap between frames (ms, log scale)", "Brush updates at 60 Hz for one second without waiting for results. Points on the dashed line mean no dropped frames.", { refLine: 16.7 })}
  ${scalingChart(m, big)}
  ${ttiTable(m, XF_SERIES)}
  ${fullTable(m, `crossfilter, ${DS[dataset] || dataset}`)}
  </section>`;
}
function wideSection(dataset) {
  const m = runs["crossfilter-wide"] && runs["crossfilter-wide"][dataset];
  if (!m) return "";
  const sizes = sizesOf(m);
  const big = sizes[sizes.length - 1];
  return `<section class="suite"><h2>Six-view dashboard, ${esc(DS[dataset] || dataset)}</h2>
  <p>Six linked histograms (arrival delay, departure delay, distance, air time, departure time, arrival time; 40 bins) and the mean arrival delay per departure hour, which is filtered by all six brushes. The brush moves on distance, so seven views update per move. Falcon cannot compute the mean view (it supports counts only) and is measured without it.</p>
  ${chart(m, XF_SERIES, "sweepMs", sizes, "Brush-update latency, small moves", "Median update latency (ms, log scale)", "20 consecutive small brush moves; median of the 20. Stock Vega stops at 1M rows, Vega's crossfilter and tuple-based modes at 5M.")}
  ${chart(m, XF_SERIES, "dragMaxGapMs", sizes, "Responsiveness during a drag", "Largest gap between frames (ms, log scale)", "Brush updates at 60 Hz for one second. Points on the dashed line mean no dropped frames.", { refLine: 16.7 })}
  ${scalingChart(m, big)}
  ${ttiTable(m, XF_SERIES)}
  ${fullTable(m, `six-view dashboard, ${DS[dataset] || dataset}`)}
  </section>`;
}

function accuracySection() {
  const f = campaignDir && path.join(campaignDir, "accuracy.txt");
  if (!f || !fs.existsSync(f)) return "";
  const lines = fs.readFileSync(f, "utf8").split("\n").filter(l => /bins differ/.test(l));
  if (!lines.length) return "";
  const rows = lines.map(l => {
    const m = l.match(/^\[(\w+)\]\s+(\S+)\s+(\S+)\s+(\d+)\/(\d+) bins differ(?: \(max ([\d.]+)%\))?\s+(.*)$/);
    if (!m) return "";
    const [, dash, ds, mode, d, t, max, verdict] = m;
    return `<tr><td>${esc(dash === "wide" ? "six-view" : "three-view")}</td><td>${esc(DS[ds] || ds)}</td><td>${esc(mode)}</td><td class="num">${d} / ${t}</td><td class="num">${max ? max + "%" : "0"}</td><td>${esc(verdict.trim())}</td></tr>`;
  }).join("");
  return `<section><h2>Do the backends show the same dashboard?</h2>
  <figure><div class="table-wrap"><table><thead><tr><th>Dashboard</th><th>Data</th><th>Backend</th><th class="num">Bins differing</th><th class="num">Largest relative difference</th><th>Verdict</th></tr></thead><tbody>${rows}</tbody></table></div>
  <figcaption>Every backend renders the same dashboard for four fixed brush combinations (1M rows); each bin count, and each mean in the six-view dashboard, is compared with ParaVega's scan. Exact backends must match every bin. Mosaic's pre-aggregation snaps brushes to pixels; Falcon snaps brushes to pixels and handles values outside the bin range differently from Vega (ArrowDB clamps them into the edge bins, its DuckDB engine drops some), so both differ by design.</figcaption></figure></section>`;
}

function scatterSection(dataset) {
  const m = runs.scatter && runs.scatter[dataset];
  if (!m) return "";
  const sizes = sizesOf(m);
  const ok = sizes.every(n => {
    const vals = [...m.values()].filter(g => g.n === n && g.metrics.selected).map(g => Math.round(g.metrics.selected.mean));
    return vals.every(v => v === vals[0]);
  });
  return `<section class="suite"><h2>Linked scatterplot (pwfilter), ${esc(DS[dataset] || dataset)}</h2>
  <p>A 3-pixel brush on a departure-time histogram selects about 1% of the rows, which are drawn in a linked scatterplot. All modes selected ${ok ? "the same rows at every size (checked by count)" : "<strong>different row counts at some size; see the table</strong>"}.</p>
  ${chart(m, SC_SERIES, "sweepMs", sizes, "Update latency including drawing the selected points", "Median update latency (ms, log scale)", "End to end: from moving the brush to the rendered scatterplot. Drawing the selected points is the same work for every mode and dominates for the parallel ones.")}
  ${chart(m, SC_SERIES.slice(0, 2), "computeMs", sizes, "pwfilter compute time", "Median pwfilter time (ms, log scale)", "Time spent in the pwfilter transform itself (predicate evaluation in workers plus building the add/remove lists); stock Vega has no separate measurement.")}
  ${chart(m, SC_SERIES, "dragMaxGapMs", sizes, "Responsiveness during a drag", "Largest gap between frames (ms, log scale)", "Brush updates at 60 Hz for one second.", { refLine: 16.7 })}
  ${fullTable(m, `scatterplot, ${DS[dataset] || dataset}`)}
  </section>`;
}

function conditions() {
  const e = envBefore || {};
  const warn = machine.filter(r => r.th !== "ok").length;
  const fcs = machine.map(r => r.fc).filter(Number.isFinite);
  const p95 = fcs.length ? [...fcs].sort((a, b) => a - b)[Math.floor(0.95 * (fcs.length - 1))] : NaN;
  const offenders = {};
  for (const r of machine) for (const m of r.top.matchAll(/(\S[^%]*?) (\d+)%/g)) { const k = m[1].trim(); if (/Google_Chrome_fo|Chrome_for_Testing/.test(k)) continue; offenders[k] = Math.max(offenders[k] || 0, +m[2]); }
  const topList = Object.entries(offenders).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${esc(k)} (peak ${v}%)`).join(", ");
  return `<section><h2>Run conditions</h2><ul class="notes">
    <li>${esc(e.cpu_model || "CPU")}: ${esc(e.cpu_perf_cores || "?")} performance + ${esc(e.cpu_eff_cores || "?")} efficiency cores, ${esc(e.cpu_logical || env.cores)} logical. ${esc(e.os || "")} ${esc(e.distro || "")}. ${esc(env.userAgent)}, headless.</li>
    <li>${reps} runs per configuration, each in a fresh page; repetitions are the outer loop. Values are means of per-run medians with 95% confidence intervals (Student's t).</li>
    ${machine.length ? `<li>Machine state sampled ${machine.length} times (every 30 s): thermal warnings in ${warn} samples; foreign CPU (processes other than the benchmark; an upper bound, since ps sometimes lists the benchmark's own Chrome helpers under a truncated name) median ${fcs.length ? [...fcs].sort((a, b) => a - b)[fcs.length >> 1] : "n/a"}%, 95th percentile ${p95}%. Largest foreign processes: ${topList || "none above 5%"}.</li>` : ""}
    ${machine.some(r => Number.isFinite(r.swap)) ? `<li>Swap in use: ${Math.min(...machine.map(r => r.swap)).toFixed(0)} to ${Math.max(...machine.map(r => r.swap)).toFixed(0)} MB; free disk ${Math.min(...machine.map(r => r.disk))} to ${Math.max(...machine.map(r => r.disk))} GB. A fresh browser process is started for every configuration.</li>` : ""}
    ${envBefore && envAfter ? `<li>Environment captured before (${esc(envBefore.captured_at)}) and after (${esc(envAfter.captured_at)}) the campaign.</li>` : ""}
  </ul></section>`;
}

const PAL = {
  light: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"],
  dark: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"],
};
const tokens = p => p.map((c, i) => `--s${i + 1}: ${c};`).join(" ");
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>ParaVega Benchmark Results</title>
<style>
/* Layout: one reading column; charts full column width; tables scroll inside their own box. */
:root {
  --bg: #fcfcfb; --surface: #ffffff; --fg: #0b0b0b; --fg2: #52514e; --muted: #8a8984; --line: #e4e3df; --grid: #eeede9;
  --font-body: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --font-mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  ${tokens(PAL.light)}
  color-scheme: light;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --bg: #141413; --surface: #1a1a19; --fg: #f0efec; --fg2: #c3c2b7; --muted: #8f8e88; --line: #34332f; --grid: #2a2a27;
  ${tokens(PAL.dark)} color-scheme: dark; } }
:root[data-theme="dark"] {
  --bg: #141413; --surface: #1a1a19; --fg: #f0efec; --fg2: #c3c2b7; --muted: #8f8e88; --line: #34332f; --grid: #2a2a27;
  ${tokens(PAL.dark)} color-scheme: dark; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.55 var(--font-body);
  padding-block: 32px 64px; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); }
main { max-width: 1040px; margin: 0 auto; display: grid; gap: 40px; }
h1 { font-size: 28px; line-height: 1.2; margin: 0 0 8px; text-wrap: balance; letter-spacing: -0.01em; }
h2 { font-size: 19px; margin: 0 0 6px; text-wrap: balance; }
p { margin: 0; max-width: 68ch; color: var(--fg2); }
.meta { font: 12.5px/1.5 var(--font-mono); color: var(--muted); }
.lead { display: grid; gap: 10px; }
.findings { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; }
.finding { border: 1px solid var(--line); border-radius: 8px; padding: 14px 16px; background: var(--surface); min-width: 0; }
.finding .v { font: 600 26px/1.1 var(--font-body); font-variant-numeric: tabular-nums; }
.finding .k { font-size: 13px; color: var(--fg2); margin-top: 4px; }
figure { margin: 0; display: grid; gap: 10px; min-width: 0; }
figcaption { font-size: 13px; color: var(--fg2); max-width: 75ch; }
svg { width: 100%; height: auto; display: block; background: var(--surface); border: 1px solid var(--line); border-radius: 8px; }
.grid { stroke: var(--grid); stroke-width: 1; }
.axis { stroke: var(--fg2); stroke-width: 1; }
.tick { fill: var(--fg2); font: 11.5px var(--font-body); font-variant-numeric: tabular-nums; }
.axis-label { fill: var(--fg2); font: 12px var(--font-body); }
.ref { stroke: var(--muted); stroke-dasharray: 4 4; stroke-width: 1; }
.ref-label { fill: var(--muted); font: 11px var(--font-body); }
.line { fill: none; stroke-width: 2; stroke-linejoin: round; }
.ci { stroke-width: 1.25; }
.dot { stroke: var(--surface); stroke-width: 2; }
.hit { fill: transparent; }
.pt:hover .dot { r: 6; }
${PAL.light.map((_, i) => `.line.s${i + 1}, .ci.s${i + 1} { stroke: var(--s${i + 1}); } .dot.s${i + 1}, .swatch.s${i + 1} { fill: var(--s${i + 1}); background: var(--s${i + 1}); }`).join("\n")}
.legend { list-style: none; padding: 0; margin: 0; display: flex; flex-wrap: wrap; gap: 6px 18px; font-size: 13px; color: var(--fg2); }
.legend li { display: flex; align-items: center; gap: 7px; }
.swatch { display: inline-block; width: 12px; height: 12px; border-radius: 3px; flex: none; vertical-align: -1px; margin-right: 6px; }
.legend .swatch { margin-right: 0; }
.legend svg.lsample { flex: none; overflow: visible; width: 26px; height: 12px; border: 0; border-radius: 0; background: none; padding: 0; margin: 0; display: inline-block; }
.lsample .line { stroke-width: 2; fill: none; }
.two { display: grid; gap: 40px; }
.table-wrap { overflow-x: auto; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); }
table { border-collapse: collapse; width: 100%; font-size: 13px; }
th, td { padding: 7px 10px; border-bottom: 1px solid var(--line); text-align: left; white-space: nowrap; }
th { color: var(--fg2); font-weight: 600; font-size: 12px; letter-spacing: 0.02em; }
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
.pm { color: var(--muted); }
td.src { font: 11px var(--font-mono); color: var(--muted); }
details summary { cursor: pointer; font-weight: 600; margin-bottom: 10px; }
ul.notes { margin: 0; padding-left: 20px; color: var(--fg2); max-width: 75ch; display: grid; gap: 6px; }
</style>
<style>h3 { font-size: 16px; margin: 0 0 6px; } section.suite { display: grid; gap: 28px; } section.suite > p { margin-top: -18px; }</style>
</head>
<body><main>
<header class="lead">
  <h1>ParaVega benchmark results</h1>
  <p>Vega dashboards backed by ParaWeb's parallel patterns, compared with stock Vega, Vega's crossfilter transform, the same kernel on the main thread, and Mosaic with DuckDB-WASM. Latency is measured from setting a brush until the dashboard has re-rendered.</p>
  <p class="meta">${esc(campaignDir ? path.basename(campaignDir) : files.map(f => path.basename(f)).join(", "))}</p>
</header>
${conditions()}
${crossfilterSection("synthetic")}
${crossfilterSection("flights")}
${wideSection("flights")}
${accuracySection()}
${scatterSection("synthetic")}
${scatterSection("flights")}
<section><h2>What to keep in mind</h2><ul class="notes">
  <li>Mosaic with pre-aggregation snaps brush edges to whole pixels, so its counts are approximate; in our cross-backend check the largest per-bin error was 64% (synthetic) and 133% (flights) for a 2-pixel brush. ParaVega, stock Vega, Vega crossfilter and Mosaic without pre-aggregation agree bin for bin.</li>
  <li>Most of ParaVega's advantage over stock Vega comes from the fused columnar kernel (the main-thread kernel and one worker take the same time); workers add parallel speedup and keep the page responsive.</li>
  <li>One machine and one browser; two data sets and two dashboards.</li>
  <li>Pre-aggregation applies to count aggregates; other ops use the scan.</li>
</ul></section>
</main></body></html>
`;
fs.writeFileSync(out, html);
console.log(`wrote ${out}`);
