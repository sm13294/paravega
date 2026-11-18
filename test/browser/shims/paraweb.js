// ParaWeb's namespace (src/index.ts) in the browser: resident forms go to
// src/resident, per-call forms to the browser implementations of ParaWeb's
// original patterns in browser-demo/ (message passing and SharedArrayBuffer).
// Smart defaults as in src/index.ts: Map, Filter, MapReduce on shared memory,
// Reduce with message passing.
const resident = require("paraweb-js/resident");
const { MapBrowser } = require("paraweb-js/browser/mapBrowser.js");
const { MapSharedBrowser } = require("paraweb-js/browser/mapSharedBrowser.js");
const { FilterBrowser } = require("paraweb-js/browser/filterBrowser.js");
const { FilterSharedBrowser } = require("paraweb-js/browser/filterSharedBrowser.js");
const { ReduceBrowser } = require("paraweb-js/browser/reduceBrowser.js");
const { ReduceSharedBrowser } = require("paraweb-js/browser/reduceSharedBrowser.js");
const { MapReduceBrowser } = require("paraweb-js/browser/mapReduceBrowser.js");
const { MapReduceSharedBrowser } = require("paraweb-js/browser/mapReduceSharedBrowser.js");

// The browser classes require a plain array input.
const arr = d => (Array.isArray(d) ? d : Array.from(d));
// Position of the input: second argument, third for MapReduce (mapFn, reduceFn, input, threads).
const call = (Cls, method) => method === "mapReduce"
  ? (f, g, d, ...rest) => new Cls()[method](f, g, arr(d), ...rest)
  : (f, d, ...rest) => new Cls()[method](f, arr(d), ...rest);
const route = (Cls, method) => {
  const perCall = call(Cls, method);
  return (...args) => (resident.isResidentCall(method, args) ? resident[method](...args) : perCall(...args));
};
const variant = (M, F, R, MR) => ({ map: route(M, "map"), filter: route(F, "filter"), reduce: route(R, "reduce"), mapReduce: route(MR, "mapReduce") });

const paraweb = {
  ...variant(MapSharedBrowser, FilterSharedBrowser, ReduceBrowser, MapReduceSharedBrowser),
  mp: variant(MapBrowser, FilterBrowser, ReduceBrowser, MapReduceBrowser),
  shared: variant(MapSharedBrowser, FilterSharedBrowser, ReduceSharedBrowser, MapReduceSharedBrowser),
  resident,
};
module.exports = paraweb;
