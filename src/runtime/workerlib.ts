/**
 * The library installed once per worker as globalThis.__pwvt (see
 * installWorkerLibrary): workerlib-core.ts, plus vega-scale (scales of
 * dense-mark encoders), vega-scenegraph's symbol mark (bounds and drawing
 * of dense marks) and vega-statistics' normal density and distribution
 * (the kernel of the density transform). Bundled by build.mjs from the packages Vega
 * itself uses.
 */
import { scale as vegaScale } from "vega-scale";
import { Marks, Bounds } from "vega-scenegraph";
import { densityNormal, cumulativeNormal } from "vega-statistics";
import { lib as core, rebuildScale } from "./workerlib-core";

export const lib = {
  ...core,
  scale: (desc: any) => rebuildScale(vegaScale, desc),
  symbol: Marks.symbol,
  Bounds,
  densityNormal,
  cumulativeNormal,
};
