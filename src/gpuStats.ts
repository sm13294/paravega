/**
 * WebGPU forms of the statistics behind box plots and density estimates.
 *
 * Exact order statistics (quartiles), used with `gpu: true`:
 *   1. every value column gets a bucket code per row, once: the bucket of the
 *      value in 16,384 equal parts of the column's extent (monotone in the
 *      value, computed by the CPU workers, resident on the GPU);
 *   2. per call, the GPU counts the selected valid rows per (group, bucket)
 *      with ResidentGPU.groupCount, which counts exactly in u32;
 *   3. from the counts, the CPU finds the bucket and the rank within it of
 *      every order statistic it needs;
 *   4. the workers collect the values of only those buckets (one pass over
 *      the selected rows), which are sorted to read the statistics.
 * The values read are the values of the rows, so the quartiles are those of
 * the parallel sort that this replaces, value for value.
 *
 * Density sums in 32 bits, used only with `gpuApproximate: true`: the kernel
 * sums of Vega's kde (sum over the rows of a group of the Gaussian kernel at
 * every sample point) run as one compute dispatch per round, one workgroup
 * per (point, chunk of rows), reduced in f32 in workgroup memory and summed
 * in f64 on the CPU. The values and the arithmetic are 32-bit, so densities
 * differ from Vega's by about one part in a million, and the adaptive
 * sampling of the curve can choose slightly different points.
 */
import { map as pwMap } from "paraweb-js/resident";
import type { GpuBackend } from "./gpu";
import type { ColumnTable } from "./table";
import type { WorkerPool } from "./pool";

/** Buckets per value column. */
const NB = 1 << 14;
/** Largest (groups + 1) x buckets histogram read back from the GPU. */
const MAX_HIST = 1 << 23;

const bucketCols = new WeakMap<GpuBackend, Map<string, Promise<{ key: string; view: Int32Array }>>>();
let callId = 0;

async function bucketColumn(gb: GpuBackend, pool: WorkerPool, value: { key: string; view: Float64Array }) {
  let byKey = bucketCols.get(gb);
  if (!byKey) { byKey = new Map(); bucketCols.set(gb, byKey); }
  let p = byKey.get(value.key);
  if (!p) {
    p = (async () => {
      const n = value.view.length;
      const ext = (await pwMap({ key: "pv:gq:ext", src: `const V = cols[0]; let lo = Infinity, hi = -Infinity;
for (let i = start; i < end; i++) { const v = V[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
return [lo, hi];` }, { pool, n, cols: [value.key] })).flat() as [number, number][];
      let lo = Infinity, hi = -Infinity;
      for (const [a, b] of ext) { if (a < lo) lo = a; if (b > hi) hi = b; }
      const scale = hi > lo ? NB / (hi - lo) : 0;
      const view = new Int32Array(new SharedArrayBuffer(4 * Math.max(1, n)));
      await pwMap({ key: "pv:gq:bucket", src: `const V = cols[0], out = bufs[0], lo = args.lo, s = args.s, top = ${NB - 1};
for (let i = start; i < end; i++) { const v = V[i]; let b = v === v ? Math.floor((v - lo) * s) : 0; out[i] = b > top ? top : b < 0 ? 0 : b; }` },
        { pool, n, cols: [value.key], bufs: [{ buffer: view.buffer as SharedArrayBuffer, type: "i32" }], args: { lo: Number.isFinite(lo) ? lo : 0, s: scale } });
      const key = `gqb:${value.key}`;
      gb.gpu.uploadU32(key, view);
      pool.ensureColumn(key, "i32", view.buffer as SharedArrayBuffer);
      return { key, view };
    })();
    byKey.set(value.key, p);
    p.catch(() => byKey!.delete(value.key));
  }
  return p;
}

/**
 * Order statistics per group, exactly.
 * - gsel: per base row, 1 + the group of a selected row with a valid value, else 0;
 * - sel: the selected rows (shared), scanned to collect the values of a few buckets;
 * - want(g, count): the 0-based ranks needed in group g (count valid values).
 * Returns per group its count and the values at the wanted ranks, or null
 * when the histogram would be too large (then the caller sorts).
 */
export async function gpuOrderStats(
  gb: GpuBackend, pool: WorkerPool, table: ColumnTable, value: { key: string; view: Float64Array },
  gsel: Int32Array, sel: Int32Array, G: number, want: (g: number, count: number) => number[],
): Promise<{ count: number; values: number[] }[] | null> {
  if ((G + 1) * NB > MAX_HIST) return null;
  const n = table.length;
  const buckets = await bucketColumn(gb, pool, value);
  const id = ++callId; // concurrent calls (Farm) must not share keys
  const gkey = `gqs:${table.id}:${id}`;
  gb.gpu.uploadU32(gkey, gsel);
  let hist: Uint32Array;
  try {
    hist = await gb.gpu.groupCount({ n, K: (G + 1) * NB, filters: [], dims: [{ col: gkey, stride: NB }, { col: buckets.key, stride: 1 }] });
  } finally { gb.gpu.drop([gkey]); }
  // Bucket and rank within the bucket of every wanted statistic.
  const pairs: number[] = [], pairIdx = new Map<number, number>();
  const plan: { count: number; at: [number, number][] }[] = [];
  for (let g = 0; g < G; g++) {
    const base = (g + 1) * NB;
    let count = 0;
    for (let b = 0; b < NB; b++) count += hist[base + b];
    const ranks = count ? want(g, count) : [];
    const at: [number, number][] = [];
    for (const r of ranks) {
      let acc = 0, b = 0;
      while (b < NB && acc + hist[base + b] <= r) { acc += hist[base + b]; b++; }
      const code = (g + 1) * NB + b;
      let j = pairIdx.get(code);
      if (j === undefined) { j = pairs.length; pairs.push(code); pairIdx.set(code, j); }
      at.push([j, r - acc]);
    }
    plan.push({ count, at });
  }
  if (!pairs.length) return plan.map(p => ({ count: p.count, values: [] }));
  // Values of the wanted buckets, from the workers.
  const skey = `gqsel:${table.id}:${id}`;
  pool.ensureColumn(skey, "i32", gsel.buffer as SharedArrayBuffer);
  let lists: number[][];
  try {
    const res = (await pwMap({ key: "pv:gq:gather", src: `const V = cols[0], GS = cols[1], BK = cols[2], R = bufs[0], NB = ${NB};
const M = new Map(args.pairs.map((p, j) => [p, j])), out = args.pairs.map(() => []);
for (let j = start; j < end; j++) { const i = R[j], g = GS[i]; if (!g) continue; const k = M.get(g * NB + BK[i]); if (k !== undefined) out[k].push(V[i]); }
return out;` }, {
      pool, n: sel.length, cols: [value.key, skey, buckets.key],
      bufs: [{ buffer: sel.buffer as SharedArrayBuffer, type: "i32" }], args: { pairs },
    })).flat() as number[][][];
    lists = pairs.map(() => [] as number[]);
    for (const part of res) part.forEach((l, j) => { for (const v of l) lists[j].push(v); });
    for (const l of lists) l.sort((a, b) => a - b);
  } finally { pool.dropColumns([skey]); }
  return plan.map(p => ({ count: p.count, values: p.at.map(([j, k]) => lists[j][k]) }));
}

/** Vega's R-7 quantile of `count` sorted values from the values at ranks floor(h) and floor(h) + 1. */
export function quantileRanks(count: number, p: number): number[] {
  if (count < 2) return [0];
  const h = (count - 1) * p, i0 = Math.floor(h);
  return i0 + 1 < count ? [i0, i0 + 1] : [i0];
}
export function quantileValue(count: number, p: number, v: number[]): number {
  if (count < 2) return v[0];
  const h = (count - 1) * p, i0 = Math.floor(h);
  return v.length > 1 ? v[0] + (v[1] - v[0]) * (h - i0) : v[0];
}

// ---- density sums in 32 bits

const KDE_WG = 256;
const KDE_SHADER = /* wgsl */ `
@group(0) @binding(0) var<storage, read> V: array<f32>;
@group(0) @binding(1) var<storage, read> X: array<f32>;
@group(0) @binding(2) var<storage, read> Q: array<u32>;
@group(0) @binding(3) var<storage, read> OFF: array<u32>;
@group(0) @binding(4) var<storage, read> BW: array<f32>;
@group(0) @binding(5) var<storage, read_write> OUT: array<f32>;
@group(0) @binding(6) var<storage, read> U: array<u32>;
var<workgroup> part: array<f32, ${KDE_WG}>;
@compute @workgroup_size(${KDE_WG})
fn main(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_index) li: u32) {
  let nc = U[0];
  let q = wid.x + wid.z * 65535u;
  if (q >= U[1]) { return; }
  let c = wid.y;
  let g = Q[q];
  let s = OFF[2u * g];
  let e = OFF[2u * g + 1u];
  let per = (e - s + nc - 1u) / nc;
  let a = min(e, s + c * per);
  let b = min(e, a + per);
  let x = X[q];
  let h = BW[g];
  var acc = 0.0;
  for (var i = a + li; i < b; i += ${KDE_WG}u) { let z = (x - V[i]) / h; acc += exp(-0.5 * z * z); }
  part[li] = acc;
  workgroupBarrier();
  for (var st = ${KDE_WG / 2}u; st > 0u; st >>= 1u) {
    if (li < st) { part[li] += part[li + st]; }
    workgroupBarrier();
  }
  if (li == 0u) { OUT[q * nc + c] = part[0]; }
}`;

const pipelines = new WeakMap<GPUDevice, GPUComputePipeline>();
const SQRT2PI = Math.sqrt(2 * Math.PI);

/** The values of the selected rows grouped on the GPU, for the rounds of one density evaluation. */
export class GpuKde {
  private device: GPUDevice;
  private vbuf: GPUBuffer;
  private offbuf: GPUBuffer;
  private maxLen: number;

  /** values: the value (0 for null) of every selected row, grouped: rows of group g at off[2g] .. off[2g+1]. */
  constructor(gb: GpuBackend, values: Float32Array, off: Uint32Array) {
    this.device = gb.gpu.device;
    this.vbuf = this.buffer(values, GPUBufferUsage.STORAGE);
    this.offbuf = this.buffer(off, GPUBufferUsage.STORAGE);
    let m = 0;
    for (let g = 0; g < off.length / 2; g++) m = Math.max(m, off[2 * g + 1] - off[2 * g]);
    this.maxLen = m;
  }

  private buffer(data: Float32Array | Uint32Array, usage: number): GPUBuffer {
    const b = this.device.createBuffer({ size: Math.max(16, Math.ceil(data.byteLength / 16) * 16), usage: usage | GPUBufferUsage.COPY_DST });
    if (data.byteLength) this.device.queue.writeBuffer(b, 0, data.buffer as ArrayBuffer, data.byteOffset, data.byteLength);
    return b;
  }

  /** Sum of densityNormal((x - v) / bw[g]) over the values of the group of every point. */
  async sums(points: Float32Array, group: Uint32Array, bw: Float32Array): Promise<Float64Array> {
    const P = points.length;
    const out64 = new Float64Array(P);
    if (!P) return out64;
    const device = this.device;
    let pipeline = pipelines.get(device);
    if (!pipeline) {
      pipeline = device.createComputePipeline({ layout: "auto", compute: { module: device.createShaderModule({ code: KDE_SHADER }), entryPoint: "main" } });
      pipelines.set(device, pipeline);
    }
    const nc = Math.max(1, Math.min(4096, Math.ceil(this.maxLen / (KDE_WG * 32))));
    const xb = this.buffer(points, GPUBufferUsage.STORAGE);
    const qb = this.buffer(group, GPUBufferUsage.STORAGE);
    const bb = this.buffer(bw, GPUBufferUsage.STORAGE);
    const ub = this.buffer(new Uint32Array([nc, P, 0, 0]), GPUBufferUsage.STORAGE);
    const bytes = Math.max(16, P * nc * 4);
    const ob = device.createBuffer({ size: bytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    const staging = device.createBuffer({ size: bytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const bind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
      { binding: 0, resource: { buffer: this.vbuf } }, { binding: 1, resource: { buffer: xb } },
      { binding: 2, resource: { buffer: qb } }, { binding: 3, resource: { buffer: this.offbuf } },
      { binding: 4, resource: { buffer: bb } }, { binding: 5, resource: { buffer: ob } },
      { binding: 6, resource: { buffer: ub } },
    ] });
    const enc = device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bind);
    pass.dispatchWorkgroups(Math.min(P, 65535), nc, Math.ceil(P / 65535));
    pass.end();
    enc.copyBufferToBuffer(ob, 0, staging, 0, bytes);
    device.queue.submit([enc.finish()]);
    await staging.mapAsync(GPUMapMode.READ);
    const r = new Float32Array(staging.getMappedRange().slice(0, P * nc * 4));
    staging.unmap();
    for (const b of [xb, qb, bb, ub, ob, staging]) b.destroy();
    for (let q = 0; q < P; q++) {
      let s = 0;
      for (let c = 0; c < nc; c++) s += r[q * nc + c];
      out64[q] = s / SQRT2PI;
    }
    return out64;
  }

  destroy() { this.vbuf.destroy(); this.offbuf.destroy(); }
}
