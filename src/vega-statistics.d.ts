declare module "vega-statistics" {
  export function bin(opts: any): { start: number; stop: number; step: number };
  export function densityNormal(value: number, mean?: number, stdev?: number): number;
  export function cumulativeNormal(value: number, mean?: number, stdev?: number): number;
}
