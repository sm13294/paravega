/**
 * WebGPU backend for pwaggregate, on ParaWeb's ResidentGPU.
 *
 * Eligible requests (count only; range filters; bin and group-by keys) run
 * as one compute dispatch per evaluation: every row is tested against the
 * range filters with exact order-preserving keys (see residentGPU.ts) and
 * counted into its group. Group codes are u32 columns resident on the GPU:
 *   - bin dimensions: bin index per row, computed once per bin setting by the
 *     CPU workers (ParaWeb Map, kernel form) with the scan kernel's bin rules, so
 *     binning is identical to the CPU path, including the null, -Inf and
 *     +Inf bins;
 *   - group-by fields: the dictionary codes the CPU path already uses.
 * Results are therefore equal to the CPU scan, count for count. Other
 * requests (measures, set filters, pre-aggregation) use the CPU workers.
 */
import { ResidentGPU } from "paraweb-js/resident";
import { map as pwMap } from "paraweb-js/resident";
import type { Plan } from "./aggregate";
import { BIN_NEG_INF, BIN_NULL, BIN_POS_INF, EPSILON, dimCard } from "./kernel";
import { ColumnTable } from "./table";
import { WorkerPool } from "./pool";

/** Largest key space sent to the GPU (u32 counts, read back per call). */
const MAX_KEYS = 1 << 22;

export function gpuEligible(plan: Plan): boolean {
  const { spec } = plan;
  return spec.measures.length === 0 && plan.K <= MAX_KEYS && !spec.where &&
    spec.filters.every(f => f.kind === "range") &&
    spec.dims.every(d => d.kind === "bin" || d.kind === "dict");
}

/** Map kernel writing the bin index (scan kernel semantics) of every row. */
function binIndexKernel(nb: number) {
  return {
    key: `gpu-bin:${nb}`,
    src: `const c = cols[0], out = bufs[0], bs = args.bs, bp = args.bp, bl = args.bl, bt = args.bt;
let x, b;
for (let i = start; i < end; i++) {
  x = c[i];
  if (x !== x) out[i] = ${nb + BIN_NULL};
  else if (x < bs) out[i] = ${nb + BIN_NEG_INF};
  else if (x > bp) out[i] = ${nb + BIN_POS_INF};
  else { x = Math.max(bs, Math.min(x, bl)); b = Math.floor(${EPSILON} + (x - bs) / bt); if (b > ${nb - 1}) b = ${nb - 1}; out[i] = b; }
}`,
  };
}

export interface GpuStats { uploadMs: number; dispatchMs: number }

export class GpuBackend {
  readonly gpu: ResidentGPU;
  /** Pending or finished uploads by GPU buffer key. */
  private uploads = new Map<string, Promise<void>>();
  last: GpuStats = { uploadMs: 0, dispatchMs: 0 };

  constructor(gpu: ResidentGPU) { this.gpu = gpu; }

  static async create(): Promise<GpuBackend> {
    return new GpuBackend(await ResidentGPU.create());
  }

  private once(key: string, make: () => Promise<void>): Promise<void> {
    let p = this.uploads.get(key);
    if (!p) { p = make(); this.uploads.set(key, p); p.catch(() => this.uploads.delete(key)); }
    return p;
  }

  /** Counts per key of the plan, as the scan's `final` array (A = 1). */
  async aggregate(pool: WorkerPool, table: ColumnTable, plan: Plan): Promise<Float64Array> {
    const t0 = performance.now();
    const { spec, cols, fp } = plan;
    const n = table.length;
    const filters: { col: string; lo: number; hi: number }[] = [];
    const dims: { col: string; stride: number }[] = [];
    const jobs: Promise<void>[] = [];
    let p = 0;
    for (const f of spec.filters) {
      const key = cols[f.col];
      const gk = `k:${key}`;
      jobs.push(this.once(gk, async () => this.gpu.uploadKeys(gk, table.viewByKey(key) as Float64Array)));
      filters.push({ col: gk, lo: fp[p], hi: fp[p + 1] });
      p += 2;
    }
    let stride = 1;
    for (const d of spec.dims) {
      const key = cols[d.col];
      if (d.kind === "bin") {
        const bs = fp[p], bp = fp[p + 1], bl = fp[p + 2], bt = fp[p + 3];
        p += 4;
        const gk = `b:${key}:${bs}:${bp}:${bl}:${bt}:${d.nb}`;
        jobs.push(this.once(gk, async () => {
          const out = new Uint32Array(new SharedArrayBuffer(4 * Math.max(1, n)));
          await pwMap(binIndexKernel(d.nb), {
            pool, n, cols: [key], bufs: [{ buffer: out.buffer as SharedArrayBuffer, type: "u32" }], args: { bs, bp, bl, bt },
          });
          this.gpu.uploadU32(gk, out);
        }));
        dims.push({ col: gk, stride });
      } else if (d.kind === "dict") {
        const gk = `d:${key}`;
        jobs.push(this.once(gk, async () => this.gpu.uploadU32(gk, table.viewByKey(key) as Int32Array)));
        dims.push({ col: gk, stride });
      } else {
        throw new Error("pwaggregate gpu: unsupported dimension");
      }
      stride *= dimCard(d);
    }
    await Promise.all(jobs);
    const t1 = performance.now();
    const counts = await this.gpu.groupCount({ n, K: plan.K, filters, dims });
    this.last = { uploadMs: t1 - t0, dispatchMs: performance.now() - t1 };
    const final = new Float64Array(plan.K * plan.A);
    for (let k = 0; k < plan.K; k++) final[k * plan.A] = counts[k];
    return final;
  }

  destroy() { this.gpu.destroy(); this.uploads.clear(); }
}
