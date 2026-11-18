/**
 * Vega library code that kernels call, bundled from the same packages Vega
 * uses, so a kernel computes exactly what Vega computes on the main thread.
 * This part is also imported on the main thread (kernels that run there,
 * and checks of what the workers will compute); workerlib.ts adds the code
 * that only the workers need.
 */
import { timeFloor, utcFloor, timeInterval, utcInterval, timeUnits } from "vega-time";

/**
 * A scale rebuilt from a descriptor (type, domain, range, and the values of
 * its other properties) with a vega-scale constructor registry: vega-scale's
 * own in the workers, the `vega.scale` of the application on the main thread.
 */
export function rebuildScale(registry: (type: string) => any, desc: { type: string; domain: any[]; range: any[]; props: [string, any][] }): any {
  const make = registry(desc.type);
  if (!make) throw new Error("scale type " + desc.type);
  const s = make();
  for (const [k, v] of desc.props) if (typeof s[k] === "function") s[k](v);
  s.domain(desc.domain);
  s.range(desc.range);
  return s;
}

export const lib = {
  /** Floor and offset of Vega's timeunit transform. */
  timeunit(units: string[], step: number, utc: boolean) {
    const tunits = timeUnits(units);
    const floor = (utc ? utcFloor : timeFloor)(tunits, step);
    const offset = (utc ? utcInterval : timeInterval)(tunits[tunits.length - 1]).offset;
    return { floor, offset };
  },
};
