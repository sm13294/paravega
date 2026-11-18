/**
 * Falcon (falcon-vis, Moritz et al. CHI 2019 / FalconVis) backend for the
 * crossfilter benchmark.
 *
 * The same dashboard (Vega spec in "external" mode) renders the results;
 * Falcon computes them. Each histogram is a Falcon 1D view with Vega's bin
 * boundaries (binConfig) and a pixel resolution equal to the chart width.
 * When a histogram is brushed for the first time it becomes Falcon's active
 * view: Falcon builds its index for that view (activate), after which every
 * brush move is answered from the index (select).
 *
 * Two engines, both from falcon-vis:
 *   "arrow"  ArrowDB: index built in JavaScript on the main thread;
 *   "duckdb" DuckDB-WASM (Falcon's own copy, 1.32): queries run in DuckDB's worker.
 *
 * Semantics differ from Vega's Bin + Aggregate in two ways, so Falcon is
 * reported as approximate: brushes are snapped to pixels, and values
 * outside [start, stop] are not counted (Vega puts them in -Inf / +Inf bins).
 *
 * Bundled by build.mjs into demo/falcon-bundle.js with "apache-arrow" and
 * "@duckdb/duckdb-wasm" resolved to falcon-vis's own dependencies.
 */
import * as duckdb from "@duckdb/duckdb-wasm";
import { tableFromArrays, tableToIPC } from "apache-arrow";
import { ArrowDB, DuckDB, FalconVis } from "falcon-vis";

const DIST = new URL("/node_modules/falcon-vis/node_modules/@duckdb/duckdb-wasm/dist/", location.href).href;

async function initDuckDB() {
  const bundles = {
    mvp: { mainModule: DIST + "duckdb-mvp.wasm", mainWorker: DIST + "duckdb-browser-mvp.worker.js" },
    eh: { mainModule: DIST + "duckdb-eh.wasm", mainWorker: DIST + "duckdb-browser-eh.worker.js" },
    coi: {
      mainModule: DIST + "duckdb-coi.wasm",
      mainWorker: DIST + "duckdb-browser-coi.worker.js",
      pthreadWorker: DIST + "duckdb-browser-coi.pthread.worker.js",
    },
  };
  const bundle = await duckdb.selectBundle(bundles);
  const worker = new Worker(bundle.mainWorker);
  const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  return { db, threaded: !!bundle.pthreadWorker };
}

/**
 * @param opts.view    Vega view built from crossfilterSpec("external", ...)
 * @param opts.columns { field: Float64Array }
 * @param opts.bins    resolved bins per field: { start, stop, step, nb, extent }
 * @param opts.width   histogram width in pixels (Falcon resolution)
 * @param opts.engine  "arrow" | "duckdb"
 * @param opts.threads DuckDB thread count (threaded bundle only)
 */
export async function setupFalcon({ view, vega, columns, fields, bins, width, engine = "arrow", threads }) {
  const t0 = performance.now();
  const table = tableFromArrays(Object.fromEntries(fields.map(f => [f, columns[f]])));
  let db, threaded = false, threadSetting = "n/a";
  if (engine === "arrow") {
    db = new ArrowDB(table);
  } else {
    const d = await initDuckDB();
    threaded = d.threaded;
    const con = await d.db.connect();
    if (threaded && threads) {
      try { await con.query(`SET threads TO ${threads}`); } catch (e) { console.warn("SET threads failed:", e.message); }
    }
    try { threadSetting = String((await con.query("SELECT current_setting('threads') AS t")).toArray()[0].t); } catch {}
    await con.insertArrowFromIPCStream(tableToIPC(table, "stream"), { name: "flights", create: true });
    await con.close();
    db = new DuckDB(d.db, "flights");
  }
  const tLoad = performance.now() - t0;

  const falcon = new FalconVis(db);
  const stats = { activations: 0, activateMs: [], timeouts: 0 };
  let first = true;
  const views = {};
  // View1D.select() updates the passive views in a forEach(async ...) that
  // it does not await, so "select resolved" does not mean "counts arrived".
  // Each select therefore waits until every passive view has delivered.
  let waiting = null;
  const onData = (f, state) => {
    if (!state || !state.bin) return;
    if (waiting && waiting.need.delete(f) && waiting.need.size === 0) waiting.resolve();
    const counts = state.filter ?? state.total;
    const rows = state.bin.map((b, i) => ({ bin0: b.binStart, bin1: b.binEnd, count: Number(counts[i]) }));
    view.change(`h_${f}`, vega.changeset().remove(() => true).insert(rows));
    if (first) view.change(`bg_${f}`, vega.changeset().remove(() => true).insert(rows.map(r => ({ ...r }))));
  };
  for (const f of fields) {
    const { start, stop, step } = bins[f];
    views[f] = await falcon.view1D(
      { type: "continuous", name: f, resolution: width, binConfig: { start, stop, step } },
      state => onData(f, state));
  }
  await falcon.link();
  first = false;
  await view.runAsync();

  // Brush events are applied in order; a new brushed field first becomes the
  // active view (index build), as Falcon's own demos do on pointer entry.
  let active = null;
  let chain = Promise.resolve();
  const filtered = new Set();
  for (const f of fields) {
    view.addSignalListener(`${f}_range`, (_, value) => {
      chain = chain.then(async () => {
        if (active !== f) {
          if (!value && !filtered.has(f)) return; // nothing to clear
          const ta = performance.now();
          await views[f].activate();
          stats.activations++;
          stats.activateMs.push(performance.now() - ta);
          active = f;
        }
        const sel = value ? [Math.min(value[0], value[1]), Math.max(value[0], value[1])] : undefined;
        const last = views[f].lastFilter;
        const same = sel ? !!last && last[0] === sel[0] && last[1] === sel[1] : !filtered.has(f);
        if (same) return; // Falcon returns early without updating
        const done = new Promise(resolve => { waiting = { need: new Set(fields.filter(g => g !== f)), resolve }; });
        let timer;
        const timeout = new Promise(resolve => { timer = setTimeout(() => { stats.timeouts++; resolve(); }, 30000); });
        await views[f].select(sel);
        await Promise.race([done, timeout]);
        clearTimeout(timer);
        waiting = null;
        if (value) filtered.add(f); else filtered.delete(f);
      }).catch(e => console.error("falcon:", e));
    });
  }

  async function settle() {
    await view.runAsync();
    await chain;
    await view.runAsync();
  }

  return { settle, stats, loadMs: tLoad, threaded, threadSetting, engine };
}
