// test/vega-env.cjs in the browser: Vega and Vega-Lite are loaded by runner.html (?vega=5 for 5.33).
module.exports = {
  loadVega: async () => ({ vega: globalThis.vega, vl: globalThis.vegaLite, version: String(globalThis.vega.version)[0] }),
};
