/**
 * Mosaic + DuckDB-WASM backend for the crossfilter benchmark.
 *
 * The same dashboard (Vega spec in "external" mode) renders the results;
 * Mosaic computes them. Each histogram is a MosaicClient filtered by a
 * crossfilter Selection; brushes become interval clauses with scale
 * metadata so Mosaic's pre-aggregation (data-cube indexes) can be used.
 *
 * Bundled by build.mjs into demo/mosaic-bundle.js.
 */
import * as duckdb from "@duckdb/duckdb-wasm";
import { Coordinator, MosaicClient, Selection, clauseInterval, voidCache, wasmConnector } from "@uwdata/mosaic-core";
import { Query, avg, column, count, sql } from "@uwdata/mosaic-sql";
import { tableFromArrays, tableToIPC } from "@uwdata/flechette";

const DIST = new URL("/node_modules/@duckdb/duckdb-wasm/dist/", location.href).href;

async function initDuckDB() {
  const bundles = {
    base: { mainModule: DIST + "duckdb-base.wasm", mainWorker: DIST + "duckdb-browser-base.worker.js" },
    threads: {
      mainModule: DIST + "duckdb-threads.wasm",
      mainWorker: DIST + "duckdb-browser-threads.worker.js",
      pthreadWorker: DIST + "duckdb-browser-threads.pthread.worker.js",
    },
  };
  const bundle = await duckdb.selectBundle(bundles);
  const worker = new Worker(bundle.mainWorker);
  const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  return { db, threaded: !!bundle.pthreadWorker };
}

class Histogram extends MosaicClient {
  constructor(field, rb, selection, onData) {
    super(selection);
    this.field = field;
    this.rb = rb;
    this.onData = onData;
  }
  query(filter) {
    const { start, step, stop } = this.rb;
    const x = column(this.field);
    // Same binning as Vega's Bin transform: values outside [start, stop] go
    // to -Infinity / +Infinity bins, values inside are clamped to the last bin.
    // One template: sql`` values are AST nodes, and joining two with + would
    // turn them into a string.
    const bin0 = sql`CASE WHEN ${x} < ${start} THEN '-Infinity'::DOUBLE WHEN ${x} > ${stop} THEN 'Infinity'::DOUBLE ELSE ${start} + ${step} * FLOOR(1e-14 + (LEAST(GREATEST(${x}, ${start}), ${stop - step}) - ${start}) / ${step}) END`;
    return Query.from("flights").select({ bin0, count: count() }).groupby("bin0").where(filter);
  }
  queryResult(data) {
    const { start, step } = this.rb;
    const rows = data.toArray().map(r => {
      const v = Number(r.bin0);
      return { bin0: v, bin1: start + step * (1 + (v - start) / step), count: Number(r.count) };
    });
    this.onData(this.field, rows);
    return this;
  }
}

/** Vega's Bin transform as SQL (see Histogram.query). */
function vegaBinSQL(x, { start, step, stop }) {
  return sql`CASE WHEN ${x} < ${start} THEN '-Infinity'::DOUBLE WHEN ${x} > ${stop} THEN 'Infinity'::DOUBLE ELSE ${start} + ${step} * FLOOR(1e-14 + (LEAST(GREATEST(${x}, ${start}), ${stop - step}) - ${start}) / ${step}) END`;
}

/** Mean of y per bin of x, filtered by every brush. */
class MeanView extends MosaicClient {
  constructor(x, y, rb, selection, onData) {
    super(selection);
    Object.assign(this, { x, y, rb, onData });
  }
  query(filter) {
    return Query.from("flights").select({ bin0: vegaBinSQL(column(this.x), this.rb), mean: avg(column(this.y)) })
      .groupby("bin0").where(filter);
  }
  queryResult(data) {
    const { start, step } = this.rb;
    this.onData(data.toArray().map(r => {
      const v = Number(r.bin0);
      return { bin0: v, bin1: start + step * (1 + (v - start) / step), mean: r.mean == null ? null : Number(r.mean) };
    }));
    return this;
  }
}

/**
 * @param opts.view      Vega view built from crossfilterSpec("external", ...)
 * @param opts.columns   { field: Float64Array }
 * @param opts.bins      resolved bins per field: { start, stop, step, nb, extent }
 * @param opts.width     histogram width in pixels (brush pixel space)
 * @param opts.preagg    enable Mosaic pre-aggregation
 * @param opts.consolidate batch queries per animation frame (Mosaic default)
 * @param opts.threads   DuckDB thread count (threaded bundle only)
 */
export async function setupMosaic({ view, vega, columns, fields, mean = null, bins, width, preagg = true, consolidate = true, threads }) {
  const t0 = performance.now();
  const { db, threaded } = await initDuckDB();
  const connector = wasmConnector({ duckdb: db });
  const con = await connector.getConnection();
  let threadSetting = "1";
  if (threaded && threads) {
    try { await con.query(`SET threads TO ${threads}`); } catch (e) { console.warn("SET threads failed:", e.message); }
  }
  try { threadSetting = String((await con.query("SELECT current_setting('threads') AS t")).toArray()[0].t); } catch {}

  const ipc = tableToIPC(tableFromArrays(Object.fromEntries(fields.map(f => [f, columns[f]]))), { format: "stream" });
  await con.insertArrowFromIPCStream(ipc, { name: "flights", create: true });
  const tLoad = performance.now() - t0;

  // Count queries that hit pre-aggregated views (schema "mosaic").
  const stats = { queries: 0, preaggQueries: 0 };
  const rawQuery = connector.query.bind(connector);
  connector.query = q => {
    stats.queries++;
    if (/\bmosaic"?\.|"mosaic"\./.test(q.sql)) stats.preaggQueries++;
    return rawQuery(q);
  };

  const mc = new Coordinator(connector, { cache: voidCache(), consolidate, preagg: { enabled: preagg } });
  const selection = Selection.crossfilter();
  const clients = {};
  let first = true;
  const onData = (field, rows) => {
    const cs = vega.changeset().remove(() => true).insert(rows);
    view.change(`h_${field}`, cs);
    if (first) view.change(`bg_${field}`, vega.changeset().remove(() => true).insert(rows.map(r => ({ ...r }))));
  };
  for (const f of fields) {
    clients[f] = new Histogram(f, bins[f], selection, onData);
    mc.connect(clients[f]);
  }
  let meanClient = null;
  if (mean) {
    meanClient = new MeanView(mean.x, mean.y, mean.rb, selection,
      rows => view.change("m_mean", vega.changeset().remove(() => true).insert(rows)));
    mc.connect(meanClient);
  }
  const allClients = () => [...fields.map(f => clients[f]), ...(meanClient ? [meanClient] : [])];
  await Promise.all(allClients().map(c => c.pending));
  first = false;
  await view.runAsync();

  let activeField = null;
  for (const f of fields) {
    const scale = { type: "linear", domain: bins[f].extent, range: [0, width] };
    view.addSignalListener(`${f}_range`, (_, value) => {
      const clause = clauseInterval(f, value, { source: clients[f], scale, pixelSize: 1 });
      // Mosaic interactors activate on pointer entry so indexes can be
      // built before the first update; do the same when a new field is brushed.
      if (value && activeField !== f) { activeField = f; selection.activate(clause); }
      selection.update(clause);
    });
  }

  /** Resolve once every queued selection update has produced results and been rendered. */
  async function settle() {
    await view.runAsync();
    for (let i = 0; i < 100; i++) {
      await selection.pending("value");
      await Promise.all(allClients().map(c => c.pending));
      const entry = selection._callbacks && selection._callbacks.get("value");
      if (!entry || !entry.pending) break;
    }
    await view.runAsync();
  }

  return { settle, stats, loadMs: tLoad, threaded, threadSetting };
}
