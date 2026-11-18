/**
 * The Vega and Vega-Lite that tests and benchmarks run on: Vega 6 and
 * Vega-Lite 6 by default, or Vega 5.33 and Vega-Lite 5.23 (installed as
 * vega5 and vega-lite5, see scripts/link-vega5.cjs) with VEGA=5, for
 * comparisons with earlier results. Vega 6 is an ES module with top-level
 * await, so it is loaded with import().
 */
async function loadVega() {
  if (process.env.VEGA === "5") return { vega: require("vega5"), vl: require("vega-lite5"), version: "5" };
  const vega = await import("vega");
  const vl = await import("vega-lite");
  return { vega, vl, version: "6" };
}
module.exports = { loadVega };
