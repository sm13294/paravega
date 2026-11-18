var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var __commonJS = (cb, mod) => function __require2() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key2 of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key2) && key2 !== except)
        __defProp(to, key2, { get: () => from[key2], enumerable: !(desc = __getOwnPropDesc(from, key2)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/paraweb-js/dist/resident/residentWorker.js
var require_residentWorker = __commonJS({
  "node_modules/paraweb-js/dist/resident/residentWorker.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.RESIDENT_WORKER_SOURCE = void 0;
    exports.residentWorkerMain = residentWorkerMain;
    function residentWorkerMain(self) {
      const columns = /* @__PURE__ */ new Map();
      const kernels = /* @__PURE__ */ new Map();
      const ctor = {
        f64: Float64Array,
        f32: Float32Array,
        i32: Int32Array,
        u32: Uint32Array,
        u8: Uint8Array
      };
      const column = (key2) => {
        const c = columns.get(key2);
        if (!c)
          throw new Error(`column not loaded in worker: ${key2}`);
        return c;
      };
      const views = (bufs) => (bufs || []).map((b) => b && b.buffer ? new ctor[b.type || "f64"](b.buffer) : b);
      const compile = (key2, make) => {
        let k = kernels.get(key2);
        if (!k) {
          k = make();
          kernels.set(key2, k);
        }
        return k;
      };
      const bucket = (x, lo, hi, scale, R) => {
        if (x !== x)
          return R;
        if (x <= lo)
          return 0;
        if (x >= hi)
          return R - 1;
        const b = Math.floor((x - lo) * scale);
        return b > R - 1 ? R - 1 : b;
      };
      const handle = (msg) => {
        switch (msg.op) {
          case "column":
            columns.set(msg.key, new ctor[msg.type](msg.buffer));
            return void 0;
          case "drop":
            for (const key2 of msg.keys)
              columns.delete(key2);
            return void 0;
          case "kernel": {
            const fn = compile(msg.key, () => new Function("cols", "bufs", "args", "start", "end", "idx", msg.src));
            const idx = msg.idx ? new Int32Array(msg.idx) : void 0;
            return fn((msg.cols || []).map(column), views(msg.bufs), msg.args, msg.start, msg.end, idx);
          }
          case "filter": {
            const fn = compile("filter:" + msg.key, () => new Function("cols", "bufs", "args", "mask", "prev", "changes", "start", "end", `${msg.prelude}
let w = start;
for (let i = start; i < end; i++) {
  const m = (${msg.cond}) ? 1 : 0;
  mask[i] = m;
  if (m !== prev[i]) changes[w++] = m ? i : -i - 1;
}
return w - start;`));
            return fn((msg.cols || []).map(column), views(msg.bufs), msg.args, new Uint8Array(msg.mask), new Uint8Array(msg.prev), new Int32Array(msg.changes), msg.start, msg.end);
          }
          case "bhist": {
            const col = column(msg.col), hist = new Int32Array(msg.hist);
            const { lo, hi, scale, R, base } = msg;
            if (msg.reset !== false)
              hist.fill(0, base, base + R + 1);
            for (let i = msg.start; i < msg.end; i++)
              hist[base + bucket(col[i], lo, hi, scale, R)]++;
            return void 0;
          }
          case "bscatter": {
            const col = column(msg.col), cursor = new Int32Array(msg.cursor), perm = new Int32Array(msg.perm);
            const { lo, hi, scale, R, base } = msg;
            const cur = cursor.slice(base, base + R + 1);
            for (let i = msg.start; i < msg.end; i++)
              perm[cur[bucket(col[i], lo, hi, scale, R)]++] = i;
            cursor.set(cur, base);
            return void 0;
          }
          case "extent": {
            const col = column(msg.col);
            let lo = Infinity, hi = -Infinity;
            for (let i = msg.start; i < msg.end; i++) {
              const x = col[i];
              if (x < lo)
                lo = x;
              if (x > hi)
                hi = x;
            }
            return [lo, hi];
          }
          default:
            throw new Error(`unknown op: ${msg.op}`);
        }
      };
      self.onmessage = (event) => {
        const msg = event.data;
        try {
          const result = handle(msg);
          if (msg.id !== void 0)
            self.postMessage({ id: msg.id, result });
        } catch (err) {
          if (msg.id !== void 0)
            self.postMessage({ id: msg.id, error: String(err && err.message || err) });
        }
      };
    }
    exports.RESIDENT_WORKER_SOURCE = `(${residentWorkerMain.toString()})(self);`;
  }
});

// node_modules/paraweb-js/dist/resident/residentPool.js
var require_residentPool = __commonJS({
  "node_modules/paraweb-js/dist/resident/residentPool.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.ResidentPool = exports.LOW_SHARE = exports.Priority = void 0;
    exports.browserWorkerFactory = browserWorkerFactory2;
    exports.nodeWorkerFactory = nodeWorkerFactory2;
    exports.inlineWorkerFactory = inlineWorkerFactory2;
    exports.defaultWorkerFactory = defaultWorkerFactory;
    exports.defaultThreads = defaultThreads2;
    var residentWorker_1 = require_residentWorker();
    function nodeRequire() {
      return typeof __require === "function" ? __require : globalThis.require;
    }
    function browserWorkerFactory2(source = residentWorker_1.RESIDENT_WORKER_SOURCE) {
      const blob = new Blob([source], { type: "application/javascript" });
      const url = URL.createObjectURL(blob);
      return () => new globalThis.Worker(url);
    }
    function nodeWorkerFactory2(source = residentWorker_1.RESIDENT_WORKER_SOURCE) {
      const { Worker } = nodeRequire()("node:worker_threads");
      const prelude = "const { parentPort } = require('node:worker_threads');const self = { postMessage: m => parentPort.postMessage(m) };parentPort.on('message', data => self.onmessage({ data }));";
      return () => {
        const w = new Worker(prelude + source, { eval: true });
        w.unref();
        const like = {
          onmessage: null,
          onerror: null,
          postMessage: (m) => w.postMessage(m),
          terminate: () => {
            w.terminate();
          }
        };
        w.on("message", (data) => like.onmessage && like.onmessage({ data }));
        w.on("error", (e) => like.onerror && like.onerror(e));
        return like;
      };
    }
    function inlineWorkerFactory2(source = residentWorker_1.RESIDENT_WORKER_SOURCE) {
      return () => {
        const like = {
          onmessage: null,
          onerror: null,
          postMessage: (m) => fake.onmessage({ data: m }),
          terminate: () => {
          }
        };
        const fake = {
          postMessage: (m) => queueMicrotask(() => like.onmessage && like.onmessage({ data: m }))
        };
        new Function("self", source)(fake);
        return like;
      };
    }
    function defaultWorkerFactory() {
      return typeof globalThis.Worker === "function" && typeof globalThis.Blob === "function" ? browserWorkerFactory2() : nodeWorkerFactory2();
    }
    function defaultThreads2() {
      const nav = globalThis.navigator;
      if (nav && nav.hardwareConcurrency)
        return nav.hardwareConcurrency;
      try {
        return nodeRequire()("node:os").cpus().length;
      } catch {
        return 4;
      }
    }
    exports.Priority = { High: 0, Low: 1, Lowest: 2 };
    exports.LOW_SHARE = 0.5;
    var ResidentPool2 = class {
      constructor(size = defaultThreads2(), factory = defaultWorkerFactory()) {
        this.workers = [];
        this.pending = /* @__PURE__ */ new Map();
        this.nextId = 1;
        this.loaded = [];
        this.queues = [];
        this.busy = [];
        this.lowCredit = [];
        this.lowTaskMs = 2;
        this.reservedLow = 0;
        this.size = Math.max(1, size | 0);
        for (let i = 0; i < this.size; i++) {
          const w = factory();
          w.onmessage = (ev) => this.onReply(ev.data);
          w.onerror = (ev) => this.failAll(ev);
          this.workers.push(w);
          this.loaded.push(/* @__PURE__ */ new Set());
          this.queues.push([[], [], []]);
          this.busy.push(false);
          this.lowCredit.push(0);
        }
      }
      dispatch(w) {
        if (this.busy[w] || !this.workers[w])
          return;
        const [high, low, lowest] = this.queues[w];
        let q = null;
        if (low.length && high.length && this.lowCredit[w] > 0)
          q = low;
        else if (high.length)
          q = high;
        else if (low.length)
          q = low;
        else if (lowest.length)
          q = lowest;
        if (!q)
          return;
        this.busy[w] = true;
        const msg = q.shift();
        const p = this.pending.get(msg.id);
        if (p)
          p.started = performance.now();
        this.workers[w].postMessage(msg);
      }
      lowPendingMs() {
        let n = 0;
        for (const q of this.queues)
          n += q[exports.Priority.Low].length;
        for (const p of this.pending.values())
          if (p.priority === exports.Priority.Low && p.started)
            n++;
        return (n + this.reservedLow) / this.size * this.lowTaskMs;
      }
      reserveLow(n) {
        this.reservedLow += n;
      }
      releaseLow(n) {
        this.reservedLow = Math.max(0, this.reservedLow - n);
      }
      onReply(data) {
        const p = this.pending.get(data.id);
        if (!p)
          return;
        this.pending.delete(data.id);
        const ms = performance.now() - p.started;
        if (p.priority === exports.Priority.High) {
          this.lowCredit[p.worker] = this.queues[p.worker][exports.Priority.Low].length ? Math.min(this.lowCredit[p.worker] + exports.LOW_SHARE * ms, 1e3) : 0;
        } else if (p.priority === exports.Priority.Low) {
          this.lowCredit[p.worker] = Math.max(0, this.lowCredit[p.worker] - ms);
          this.lowTaskMs = 0.8 * this.lowTaskMs + 0.2 * ms;
        }
        this.busy[p.worker] = false;
        this.dispatch(p.worker);
        if (data.error !== void 0)
          p.reject(new Error(data.error));
        else
          p.resolve(data.result);
      }
      failAll(ev) {
        const err = new Error("paraweb resident worker error: " + (ev && ev.message || ev));
        for (const p of this.pending.values())
          p.reject(err);
        this.pending.clear();
        for (const q of this.queues)
          for (const level of q)
            level.length = 0;
        this.busy = this.busy.map(() => false);
      }
      ensureColumn(key2, type, buffer) {
        for (let i = 0; i < this.size; i++) {
          if (this.loaded[i].has(key2))
            continue;
          this.workers[i].postMessage({ op: "column", key: key2, type, buffer });
          this.loaded[i].add(key2);
        }
      }
      hasColumn(key2) {
        return this.loaded.length > 0 && this.loaded[0].has(key2);
      }
      dropColumns(keys) {
        for (let i = 0; i < this.size; i++) {
          this.run(i, { op: "drop", keys }, exports.Priority.Lowest).catch(() => {
          });
          for (const k of keys)
            this.loaded[i].delete(k);
        }
      }
      run(worker, msg, priority = exports.Priority.High) {
        const id2 = this.nextId++;
        return new Promise((resolve, reject) => {
          this.pending.set(id2, { resolve, reject, worker, priority, started: 0 });
          this.queues[worker][priority].push({ ...msg, id: id2 });
          this.dispatch(worker);
        });
      }
      terminate() {
        for (const w of this.workers)
          w.terminate();
        this.workers = [];
        this.failAll("terminated");
      }
    };
    exports.ResidentPool = ResidentPool2;
  }
});

// node_modules/paraweb-js/dist/resident/residentPatterns.js
var require_residentPatterns = __commonJS({
  "node_modules/paraweb-js/dist/resident/residentPatterns.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.FilterState = void 0;
    exports.splitRanges = splitRanges2;
    exports.chunkRange = chunkRange;
    exports.compileKernelHere = compileKernelHere;
    exports.residentMap = residentMap;
    exports.residentMapReduce = residentMapReduce;
    exports.residentExtent = residentExtent;
    exports.residentCountingSort = residentCountingSort2;
    exports.residentFilter = residentFilter;
    var residentPool_1 = require_residentPool();
    function splitRanges2(n, T) {
      const out = [];
      if (n <= 0)
        return out;
      T = Math.max(1, Math.min(T, n));
      const chunk = Math.ceil(n / T);
      for (let t = 0; t < T; t++) {
        const s = t * chunk, e = Math.min(n, s + chunk);
        if (s < e)
          out.push([s, e]);
      }
      return out;
    }
    function chunkRange(s, e, size) {
      if (!size || e - s <= size)
        return [[s, e]];
      const out = [];
      for (let a = s; a < e; a += size)
        out.push([a, Math.min(e, a + size)]);
      return out;
    }
    var mainThreadKernels = /* @__PURE__ */ new Map();
    function compileKernelHere(k) {
      let fn = mainThreadKernels.get(k.key);
      if (!fn) {
        fn = new Function("cols", "bufs", "args", "start", "end", "idx", k.src);
        mainThreadKernels.set(k.key, fn);
      }
      return fn;
    }
    async function residentMap(pool, kernel, call) {
      const ranges = splitRanges2(call.n, Math.min(pool.size, call.threads ?? pool.size));
      const priority = call.priority ?? residentPool_1.Priority.High;
      const jobs = ranges.map(([start, end], t) => chunkRange(start, end, call.chunkRows ?? 0).map(([s, e], chunk) => pool.run(t, {
        op: "kernel",
        key: kernel.key,
        src: kernel.src,
        cols: call.cols,
        bufs: call.bufs,
        args: { ...call.args, t, chunk },
        start: s,
        end: e,
        idx: call.idx
      }, priority)));
      return Promise.all(jobs.map((j) => Promise.all(j)));
    }
    function grow(buf, bytes) {
      if (buf && buf.byteLength >= bytes)
        return buf;
      return new SharedArrayBuffer(Math.max(8, bytes));
    }
    async function residentMapReduce(pool, call) {
      const priority = call.priority ?? residentPool_1.Priority.High;
      const region = call.keys * call.slots;
      const maxBytes = call.maxPartialBytes ?? 512 * 1024 * 1024;
      if (region * 8 > maxBytes)
        throw new Error(`resident MapReduce: ${call.keys} groups exceed the partial-buffer limit`);
      let T = Math.min(pool.size, call.threads ?? pool.size, Math.max(1, call.n));
      while (T > 1 && T * region * 8 > maxBytes)
        T--;
      const ranges = splitRanges2(call.n, T);
      if (ranges.length === 0)
        return { final: new Float64Array(region), threads: 0, combine: "single" };
      T = ranges.length;
      const scratch = call.scratch ?? {};
      scratch.parts = grow(scratch.parts, T * region * 8);
      const parts = new Float64Array(scratch.parts, 0, T * region);
      const partsBuf = { buffer: scratch.parts, type: "f64" };
      const jobs = [];
      ranges.forEach(([start, end], t) => {
        chunkRange(start, end, call.chunkRows ?? 0).forEach(([s, e], c) => {
          jobs.push(pool.run(t, {
            op: "kernel",
            key: call.map.key,
            src: call.map.src,
            cols: call.cols,
            bufs: [partsBuf],
            args: { ...call.args, t, base: t * region, first: c === 0 },
            start: s,
            end: e
          }, priority));
        });
      });
      await Promise.all(jobs);
      if (T === 1)
        return { final: parts.subarray(0, region), threads: 1, combine: "single" };
      const cargs = { ...call.args, T, region };
      if (T * region < (call.parallelCombineMin ?? 1 << 16)) {
        const final2 = new Float64Array(region);
        compileKernelHere(call.combine)([], [parts, final2], cargs, 0, call.keys);
        return { final: final2, threads: T, combine: "main" };
      }
      scratch.dst = grow(scratch.dst, region * 8);
      const final = new Float64Array(scratch.dst, 0, region);
      const dstBuf = { buffer: scratch.dst, type: "f64" };
      await Promise.all(splitRanges2(call.keys, pool.size).map(([kStart, kEnd], w) => pool.run(w, {
        op: "kernel",
        key: call.combine.key,
        src: call.combine.src,
        bufs: [partsBuf, dstBuf],
        args: cargs,
        start: kStart,
        end: kEnd
      }, priority)));
      return { final, threads: T, combine: "parallel" };
    }
    async function residentExtent(pool, col, n, opts = {}) {
      const parts = await Promise.all(splitRanges2(n, pool.size).map(([start, end], t) => pool.run(t, { op: "extent", col, start, end }, opts.priority ?? residentPool_1.Priority.High)));
      let lo = Infinity, hi = -Infinity;
      for (const [a, b] of parts) {
        if (a < lo)
          lo = a;
        if (b > hi)
          hi = b;
      }
      return [lo, hi];
    }
    async function residentCountingSort2(pool, col, n, b, opts = {}) {
      const priority = opts.priority ?? residentPool_1.Priority.High;
      const { lo, hi, scale, R } = b;
      const ranges = splitRanges2(n, pool.size);
      const B = R + 1;
      const pieces = ranges.map(([s, e]) => chunkRange(s, e, opts.chunkRows ?? 0));
      const scatterChunks = pieces.reduce((a, p) => a + p.length, 0);
      const hist = new Int32Array(new SharedArrayBuffer(4 * Math.max(1, ranges.length * B)));
      pool.reserveLow(scatterChunks);
      try {
        await Promise.all(pieces.flatMap((p, t) => p.map(([s, e], c) => pool.run(t, {
          op: "bhist",
          col,
          lo,
          hi,
          scale,
          R,
          start: s,
          end: e,
          hist: hist.buffer,
          base: t * B,
          reset: c === 0
        }, priority))));
      } catch (e) {
        pool.releaseLow(scatterChunks);
        throw e;
      }
      const cursor = new Int32Array(new SharedArrayBuffer(4 * Math.max(1, ranges.length * B)));
      const offsets = new Int32Array(B + 1);
      let run = 0;
      for (let k = 0; k < B; k++) {
        offsets[k] = run;
        for (let t = 0; t < ranges.length; t++) {
          cursor[t * B + k] = run;
          run += hist[t * B + k];
        }
      }
      offsets[B] = run;
      const perm = new Int32Array(new SharedArrayBuffer(4 * Math.max(1, n)));
      pool.releaseLow(scatterChunks);
      await Promise.all(pieces.flatMap((p, t) => p.map(([s, e]) => pool.run(t, {
        op: "bscatter",
        col,
        lo,
        hi,
        scale,
        R,
        start: s,
        end: e,
        cursor: cursor.buffer,
        base: t * B,
        perm: perm.buffer
      }, priority))));
      return { perm, offsets };
    }
    var FilterState2 = class {
      constructor(n) {
        this.cur = 0;
        this.selected = 0;
        this.n = n;
        const m = () => new Uint8Array(new SharedArrayBuffer(Math.max(1, n)));
        this.masks = [m(), m()];
        this.changes = new Int32Array(new SharedArrayBuffer(4 * Math.max(1, n)));
      }
      get mask() {
        return this.masks[this.cur];
      }
      get next() {
        return this.masks[1 - this.cur];
      }
      swap() {
        this.cur = 1 - this.cur;
      }
    };
    exports.FilterState = FilterState2;
    async function residentFilter(pool, pred, state, call = {}) {
      const rs = splitRanges2(state.n, pool.size);
      const mask = state.next, prev = state.mask;
      const counts = await Promise.all(rs.map(([start, end], t) => pool.run(t, {
        op: "filter",
        key: pred.key,
        prelude: pred.prelude,
        cond: pred.cond,
        cols: call.cols,
        bufs: call.bufs,
        args: call.args,
        mask: mask.buffer,
        prev: prev.buffer,
        changes: state.changes.buffer,
        start,
        end
      }, call.priority ?? residentPool_1.Priority.High)));
      let nAdd = 0, nRem = 0;
      rs.forEach(([start], t) => {
        for (let j = start, e = start + counts[t]; j < e; j++)
          state.changes[j] >= 0 ? nAdd++ : nRem++;
      });
      const add = new Int32Array(nAdd), rem = new Int32Array(nRem);
      let a = 0, r = 0;
      rs.forEach(([start], t) => {
        for (let j = start, e = start + counts[t]; j < e; j++) {
          const v = state.changes[j];
          if (v >= 0)
            add[a++] = v;
          else
            rem[r++] = -v - 1;
        }
      });
      state.swap();
      state.selected += nAdd - nRem;
      return { add, rem, threads: rs.length };
    }
  }
});

// node_modules/paraweb-js/dist/core/gpuKernelCache.js
var require_gpuKernelCache = __commonJS({
  "node_modules/paraweb-js/dist/core/gpuKernelCache.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.getOrCreatePipeline = getOrCreatePipeline;
    exports.clearPipelineCache = clearPipelineCache;
    var pipelineCache = /* @__PURE__ */ new WeakMap();
    function getOrCreatePipeline(device, shaderSource, entryPoint = "main", bindGroupLayout) {
      const key2 = shaderSource + "::" + entryPoint;
      let perDevice = pipelineCache.get(device);
      if (!perDevice) {
        perDevice = /* @__PURE__ */ new Map();
        pipelineCache.set(device, perDevice);
      }
      const cached2 = perDevice.get(key2);
      if (cached2)
        return cached2;
      const shaderModule = device.createShaderModule({ code: shaderSource });
      const pipelineDesc = {
        layout: bindGroupLayout ? device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }) : "auto",
        compute: {
          module: shaderModule,
          entryPoint
        }
      };
      const pipeline = device.createComputePipeline(pipelineDesc);
      perDevice.set(key2, pipeline);
      return pipeline;
    }
    function clearPipelineCache() {
      pipelineCache = /* @__PURE__ */ new WeakMap();
    }
  }
});

// node_modules/paraweb-js/dist/core/gpuContext.js
var require_gpuContext = __commonJS({
  "node_modules/paraweb-js/dist/core/gpuContext.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.isGPUAvailable = isGPUAvailable;
    exports.getGPUDevice = getGPUDevice;
    exports.releaseGPUDevice = releaseGPUDevice;
    var gpuKernelCache_1 = require_gpuKernelCache();
    var cachedGPU = void 0;
    var cachedDevice = null;
    async function isGPUAvailable() {
      try {
        const gpu = getGPU();
        if (!gpu)
          return false;
        const adapter = await gpu.requestAdapter();
        return adapter !== null;
      } catch {
        return false;
      }
    }
    function getGPU() {
      if (cachedGPU !== void 0)
        return cachedGPU;
      if (typeof navigator !== "undefined" && navigator.gpu) {
        cachedGPU = navigator.gpu;
        return cachedGPU;
      }
      try {
        const webgpu = __require("webgpu");
        if (webgpu.globals) {
          for (const [key2, value] of Object.entries(webgpu.globals)) {
            if (!(key2 in globalThis)) {
              globalThis[key2] = value;
            }
          }
        }
        if (webgpu.create) {
          cachedGPU = webgpu.create([]);
          return cachedGPU;
        }
        cachedGPU = webgpu.gpu || null;
        return cachedGPU;
      } catch {
        cachedGPU = null;
        return null;
      }
    }
    async function getGPUDevice() {
      if (cachedDevice)
        return cachedDevice;
      const gpu = getGPU();
      if (!gpu) {
        throw new Error("WebGPU is not available. Install the 'webgpu' npm package for Node.js, or use a WebGPU-capable browser.");
      }
      const adapter = await gpu.requestAdapter();
      if (!adapter) {
        throw new Error("Failed to get GPU adapter. No compatible GPU found.");
      }
      cachedDevice = await adapter.requestDevice({
        requiredLimits: {
          maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
          maxBufferSize: adapter.limits.maxBufferSize,
          maxComputeWorkgroupSizeX: adapter.limits.maxComputeWorkgroupSizeX,
          maxComputeInvocationsPerWorkgroup: adapter.limits.maxComputeInvocationsPerWorkgroup
        }
      });
      cachedDevice.lost.then(() => {
        cachedDevice = null;
        (0, gpuKernelCache_1.clearPipelineCache)();
      });
      return cachedDevice;
    }
    function releaseGPUDevice() {
      if (cachedDevice) {
        cachedDevice.destroy();
        cachedDevice = null;
      }
    }
  }
});

// node_modules/paraweb-js/dist/resident/residentGPU.js
var require_residentGPU = __commonJS({
  "node_modules/paraweb-js/dist/resident/residentGPU.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.ResidentGPU = void 0;
    exports.orderedKey = orderedKey;
    exports.orderedKeys = orderedKeys;
    var gpuContext_1 = require_gpuContext();
    var gpuKernelCache_1 = require_gpuKernelCache();
    var f64 = new Float64Array(1);
    var u32 = new Uint32Array(f64.buffer);
    var HI = 1;
    var LO = 0;
    function orderedKey(x) {
      if (x !== x)
        return [4294967295, 4294967295];
      f64[0] = x === 0 ? 0 : x;
      const h = u32[HI], l = u32[LO];
      return h & 2147483648 ? [~h >>> 0, ~l >>> 0] : [(h | 2147483648) >>> 0, l];
    }
    function orderedKeys(col, out = new Uint32Array(2 * col.length)) {
      const n = col.length;
      const f = col instanceof Float64Array && col.byteOffset % 4 === 0 ? col : Float64Array.from(col);
      const w = new Uint32Array(f.buffer, f.byteOffset, 2 * n);
      for (let i = 0; i < n; i++) {
        let l = w[2 * i], h = w[2 * i + 1];
        if ((h & 2146435072) === 2146435072 && (h & 1048575 | l) !== 0) {
          h = 4294967295;
          l = 4294967295;
        } else if (h === 2147483648 && l === 0) {
          h = 2147483648;
        } else if (h & 2147483648) {
          h = ~h >>> 0;
          l = ~l >>> 0;
        } else
          h = (h | 2147483648) >>> 0;
        out[2 * i] = h;
        out[2 * i + 1] = l;
      }
      return out;
    }
    var WG = 256;
    var LOCAL_MAX = 4096;
    function groupCountShader(nf, nd, strides, K) {
      const local = K <= LOCAL_MAX;
      const binds = [
        "@group(0) @binding(0) var<storage, read> P: array<u32>;",
        "@group(0) @binding(1) var<storage, read_write> outc: array<atomic<u32>>;"
      ];
      for (let j = 0; j < nf; j++)
        binds.push(`@group(0) @binding(${2 + j}) var<storage, read> f${j}: array<u32>;`);
      for (let d = 0; d < nd; d++)
        binds.push(`@group(0) @binding(${2 + nf + d}) var<storage, read> d${d}: array<u32>;`);
      const tests = [];
      for (let j = 0; j < nf; j++) {
        const p = 1 + 4 * j;
        tests.push(`let h${j} = f${j}[2u * i]; let l${j} = f${j}[2u * i + 1u]; if (!(ge(h${j}, l${j}, P[${p}], P[${p + 1}]) && ge(P[${p + 2}], P[${p + 3}], h${j}, l${j}))) { continue; }`);
      }
      const key2 = nd ? strides.map((s, d) => `d${d}[i] * ${s}u`).join(" + ") : "0u";
      return `${binds.join("\n")}
${local ? `var<workgroup> hist: array<atomic<u32>, ${K}>;` : ""}
fn ge(ah: u32, al: u32, bh: u32, bl: u32) -> bool { return ah > bh || (ah == bh && al >= bl); }
@compute @workgroup_size(${WG})
fn main(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(local_invocation_index) li: u32,
        @builtin(num_workgroups) nwg: vec3<u32>) {
  ${local ? `for (var k = li; k < ${K}u; k += ${WG}u) { atomicStore(&hist[k], 0u); }
  workgroupBarrier();` : ""}
  let n = P[0];
  let step = nwg.x * ${WG}u;
  for (var i = gid.x; i < n; i += step) {
    ${tests.join("\n    ")}
    let k = ${key2};
    ${local ? "atomicAdd(&hist[k], 1u);" : "atomicAdd(&outc[k], 1u);"}
  }
  ${local ? `workgroupBarrier();
  for (var k = li; k < ${K}u; k += ${WG}u) {
    let v = atomicLoad(&hist[k]);
    if (v != 0u) { atomicAdd(&outc[k], v); }
  }` : ""}
}`;
    }
    var ResidentGPU2 = class _ResidentGPU {
      constructor(device) {
        this.bufs = /* @__PURE__ */ new Map();
        this.workgroups = 1024;
        this.lost = false;
        this.device = device;
        device.lost.then(() => {
          this.lost = true;
          this.bufs.clear();
        });
      }
      static async create() {
        return new _ResidentGPU(await (0, gpuContext_1.getGPUDevice)());
      }
      has(key2) {
        return this.bufs.has(key2);
      }
      upload(key2, data) {
        const old = this.bufs.get(key2);
        if (old)
          old.buffer.destroy();
        const buffer = this.device.createBuffer({
          size: Math.max(16, Math.ceil(data.byteLength / 16) * 16),
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
        });
        const SLICE = 1 << 24;
        for (let o = 0; o < data.length; o += SLICE) {
          let part = data.subarray(o, Math.min(data.length, o + SLICE));
          if (typeof SharedArrayBuffer !== "undefined" && part.buffer instanceof SharedArrayBuffer)
            part = part.slice();
          this.device.queue.writeBuffer(buffer, o * 4, part.buffer, part.byteOffset, part.byteLength);
        }
        this.bufs.set(key2, { buffer, length: data.length });
      }
      uploadKeys(key2, col) {
        this.upload(key2, orderedKeys(col));
      }
      uploadU32(key2, col) {
        this.upload(key2, col instanceof Uint32Array ? col : new Uint32Array(col.buffer, col.byteOffset, col.length));
      }
      drop(keys) {
        for (const k of keys) {
          const r = this.bufs.get(k);
          if (r) {
            r.buffer.destroy();
            this.bufs.delete(k);
          }
        }
      }
      get(key2) {
        const r = this.bufs.get(key2);
        if (!r)
          throw new Error(`GPU column not uploaded: ${key2}`);
        return r.buffer;
      }
      async groupCount(call) {
        const { n, filters, dims, K } = call;
        if (filters.some((f) => f.lo !== f.lo || f.hi !== f.hi) || n === 0)
          return new Uint32Array(K);
        const device = this.device;
        const code = groupCountShader(filters.length, dims.length, dims.map((d) => d.stride), K);
        const pipeline = (0, gpuKernelCache_1.getOrCreatePipeline)(device, code, "main");
        const P = new Uint32Array(1 + 4 * filters.length);
        P[0] = n;
        filters.forEach((f, j) => {
          const [lh, ll] = orderedKey(f.lo), [hh, hl] = orderedKey(f.hi);
          P.set([lh, ll, hh, hl], 1 + 4 * j);
        });
        const pBuf = device.createBuffer({ size: Math.max(16, P.byteLength), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
        device.queue.writeBuffer(pBuf, 0, P);
        const bytes = Math.max(16, K * 4);
        const out = device.createBuffer({ size: bytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
        const staging = device.createBuffer({ size: bytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
        const entries = [
          { binding: 0, resource: { buffer: pBuf } },
          { binding: 1, resource: { buffer: out } },
          ...filters.map((f, j) => ({ binding: 2 + j, resource: { buffer: this.get(f.col) } })),
          ...dims.map((d, j) => ({ binding: 2 + filters.length + j, resource: { buffer: this.get(d.col) } }))
        ];
        const bindGroup = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries });
        const enc = device.createCommandEncoder();
        enc.clearBuffer(out);
        const pass = enc.beginComputePass();
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup);
        pass.dispatchWorkgroups(Math.min(this.workgroups, Math.ceil(n / WG)));
        pass.end();
        enc.copyBufferToBuffer(out, 0, staging, 0, bytes);
        device.queue.submit([enc.finish()]);
        await staging.mapAsync(GPUMapMode.READ);
        const result = new Uint32Array(staging.getMappedRange().slice(0, K * 4));
        staging.unmap();
        staging.destroy();
        out.destroy();
        pBuf.destroy();
        return result;
      }
      destroy() {
        this.drop([...this.bufs.keys()]);
      }
    };
    exports.ResidentGPU = ResidentGPU2;
  }
});

// node_modules/paraweb-js/dist/core/parallelUtils.js
var require_parallelUtils = __commonJS({
  "node_modules/paraweb-js/dist/core/parallelUtils.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.initSharedInt32FromArray = exports.initSharedFloat64FromArray = exports.initSharedUint8 = exports.initSharedInt32 = exports.initSharedFloat64 = exports.detectIdentityElement = exports.chunkArray = exports.buildRanges = void 0;
    var buildRanges = (length, numThreads) => {
      const chunkSize = Math.ceil(length / numThreads);
      return Array.from({ length: numThreads }, (_, i) => {
        const start = i * chunkSize;
        const end = Math.min(start + chunkSize, length);
        return { start, end };
      });
    };
    exports.buildRanges = buildRanges;
    var chunkArray = (input, numThreads) => {
      const chunkSize = Math.ceil(input.length / numThreads);
      return Array.from({ length: numThreads }, (_, i) => input.slice(i * chunkSize, (i + 1) * chunkSize));
    };
    exports.chunkArray = chunkArray;
    var detectIdentityElement = (fn, initialValue) => {
      try {
        const testValue = 5;
        const resultWith0 = fn(0, testValue);
        if (resultWith0 === testValue && typeof resultWith0 === "number") {
          return 0;
        }
        const resultWith1 = fn(1, testValue);
        if (resultWith1 === testValue && typeof resultWith1 === "number") {
          return 1;
        }
      } catch (e) {
      }
      if (initialValue === 1) {
        return 1;
      }
      return 0;
    };
    exports.detectIdentityElement = detectIdentityElement;
    var initSharedFloat64 = (length, fill) => {
      const buffer = new SharedArrayBuffer(Float64Array.BYTES_PER_ELEMENT * length);
      const view = new Float64Array(buffer);
      if (fill !== void 0) {
        view.fill(fill);
      }
      return { buffer, view };
    };
    exports.initSharedFloat64 = initSharedFloat64;
    var initSharedInt32 = (length, fill) => {
      const buffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * length);
      const view = new Int32Array(buffer);
      if (fill !== void 0) {
        view.fill(fill);
      }
      return { buffer, view };
    };
    exports.initSharedInt32 = initSharedInt32;
    var initSharedUint8 = (length, fill) => {
      const buffer = new SharedArrayBuffer(Uint8Array.BYTES_PER_ELEMENT * length);
      const view = new Uint8Array(buffer);
      if (fill !== void 0) {
        view.fill(fill);
      }
      return { buffer, view };
    };
    exports.initSharedUint8 = initSharedUint8;
    var initSharedFloat64FromArray = (input) => {
      const { buffer, view } = initSharedFloat64(input.length);
      for (let i = 0; i < input.length; i++) {
        view[i] = input[i];
      }
      return { buffer, view };
    };
    exports.initSharedFloat64FromArray = initSharedFloat64FromArray;
    var initSharedInt32FromArray = (input) => {
      const { buffer, view } = initSharedInt32(input.length);
      for (let i = 0; i < input.length; i++) {
        view[i] = input[i];
      }
      return { buffer, view };
    };
    exports.initSharedInt32FromArray = initSharedInt32FromArray;
  }
});

// node_modules/paraweb-js/dist/resident/residentApi.js
var require_residentApi = __commonJS({
  "node_modules/paraweb-js/dist/resident/residentApi.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.isPredicate = exports.isMapReduceKernels = exports.isKernel = exports.isResidentOptions = void 0;
    exports.mapResident = mapResident;
    exports.mapKernel = mapKernel2;
    exports.filterResident = filterResident;
    exports.filterKernel = filterKernel;
    exports.reduceResident = reduceResident;
    exports.reduceKernel = reduceKernel;
    exports.mapReduceResident = mapReduceResident;
    exports.mapReduceKernel = mapReduceKernel;
    exports.map = map;
    exports.filter = filter;
    exports.reduce = reduce;
    exports.mapReduce = mapReduce2;
    exports.isResidentCall = isResidentCall;
    var residentPatterns_1 = require_residentPatterns();
    var parallelUtils_1 = require_parallelUtils();
    var isResidentOptions = (o) => !!o && typeof o === "object" && !!o.pool && typeof o.pool.ensureColumn === "function" && typeof o.pool.run === "function";
    exports.isResidentOptions = isResidentOptions;
    var isKernel = (k) => !!k && typeof k === "object" && typeof k.key === "string" && typeof k.src === "string";
    exports.isKernel = isKernel;
    var isMapReduceKernels = (k) => !!k && typeof k === "object" && (0, exports.isKernel)(k.map) && (0, exports.isKernel)(k.combine);
    exports.isMapReduceKernels = isMapReduceKernels;
    var isPredicate = (p) => !!p && typeof p === "object" && typeof p.key === "string" && typeof p.cond === "string";
    exports.isPredicate = isPredicate;
    var named = /* @__PURE__ */ new WeakMap();
    var inPlace = /* @__PURE__ */ new WeakMap();
    var nextColumn = 1;
    var typeOf = (a) => a instanceof Float64Array ? "f64" : a instanceof Float32Array ? "f32" : a instanceof Int32Array ? "i32" : a instanceof Uint32Array ? "u32" : a instanceof Uint8Array ? "u8" : null;
    function sharedInPlace(a) {
      const type = typeOf(a);
      if (!type || typeof SharedArrayBuffer === "undefined" || !(a.buffer instanceof SharedArrayBuffer))
        return null;
      if (a.byteOffset !== 0 || a.byteLength !== a.buffer.byteLength)
        return null;
      return { buffer: a.buffer, type };
    }
    function upload(pool, input) {
      const key2 = `pw:col:${nextColumn++}`;
      const view = new Float64Array(new SharedArrayBuffer(Math.max(8, 8 * input.length)));
      view.set(input);
      pool.ensureColumn(key2, "f64", view.buffer);
      return key2;
    }
    function residentColumn(input, o) {
      const pool = o.pool;
      const names = named.get(pool) ?? named.set(pool, /* @__PURE__ */ new Map()).get(pool);
      if (typeof input === "string") {
        const c = names.get(input);
        if (c)
          return { key: c.col, n: c.n, temp: false };
        throw new Error(`paraweb: no resident input named "${input}"`);
      }
      const n = input.length;
      if (o.key !== void 0) {
        const c = names.get(o.key);
        if (c && c.n === n && !o.refresh)
          return { key: c.col, n, temp: false };
        if (c)
          pool.dropColumns([c.col]);
        const shared2 = sharedInPlace(input);
        let col;
        if (shared2) {
          col = `pw:col:${nextColumn++}`;
          pool.ensureColumn(col, shared2.type, shared2.buffer);
        } else
          col = upload(pool, input);
        names.set(o.key, { col, n });
        return { key: col, n, temp: false };
      }
      const shared = sharedInPlace(input);
      if (shared) {
        const byBuf = inPlace.get(pool) ?? inPlace.set(pool, /* @__PURE__ */ new WeakMap()).get(pool);
        let col = byBuf.get(shared.buffer);
        if (!col) {
          col = `pw:col:${nextColumn++}`;
          pool.ensureColumn(col, shared.type, shared.buffer);
          byBuf.set(shared.buffer, col);
        }
        return { key: col, n, temp: false };
      }
      return { key: upload(pool, input), n, temp: true };
    }
    async function withColumn(input, o, f) {
      const c = residentColumn(input, o);
      try {
        return await f(c);
      } finally {
        if (c.temp)
          o.pool.dropColumns([c.key]);
      }
    }
    var run = (o) => ({ priority: o.priority, chunkRows: o.chunkRows, threads: o.threads });
    var fnSource = (f) => typeof f === "string" ? f : f.toString();
    async function mapResident(fn, input, o) {
      return withColumn(input, o, async (c) => {
        const out = new Float64Array(new SharedArrayBuffer(Math.max(8, 8 * c.n)));
        if (c.n === 0)
          return out.subarray(0, 0);
        const src = fnSource(fn);
        await (0, residentPatterns_1.residentMap)(o.pool, {
          key: "pw:map:" + src,
          src: `const f = (${src});
const x = cols[0], out = bufs[0];
for (let i = start; i < end; i++) out[i] = f(x[i], i);`
        }, { ...run(o), n: c.n, cols: [c.key], bufs: [{ buffer: out.buffer, type: "f64" }] });
        return out;
      });
    }
    function mapKernel2(kernel, call) {
      return (0, residentPatterns_1.residentMap)(call.pool, kernel, call);
    }
    async function filterResident(fn, input, o) {
      return withColumn(input, o, async (c) => {
        if (c.n === 0)
          return new Float64Array(0);
        const seg = new Float64Array(new SharedArrayBuffer(8 * c.n));
        const src = fnSource(fn);
        const res = await (0, residentPatterns_1.residentMap)(o.pool, {
          key: "pw:filter:" + src,
          src: `const f = (${src});
const x = cols[0], out = bufs[0];
let w = start;
for (let i = start; i < end; i++) { const v = x[i]; if (f(v, i)) out[w++] = v; }
return [start, w - start];`
        }, { ...run(o), n: c.n, cols: [c.key], bufs: [{ buffer: seg.buffer, type: "f64" }] });
        const parts = res.flat();
        const out = new Float64Array(parts.reduce((s, [, k]) => s + k, 0));
        let w = 0;
        for (const [s, k] of parts) {
          out.set(seg.subarray(s, s + k), w);
          w += k;
        }
        return out;
      });
    }
    function filterKernel(pred, state, call) {
      return (0, residentPatterns_1.residentFilter)(call.pool, pred, state, call);
    }
    async function partials(op, mapFn, c, o) {
      const opSrc = fnSource(op), mapSrc = mapFn ? fnSource(mapFn) : null;
      const res = await (0, residentPatterns_1.residentMap)(o.pool, {
        key: "pw:reduce:" + opSrc + "\0" + (mapSrc ?? ""),
        src: `const op = (${opSrc});
${mapSrc ? `const f = (${mapSrc});
` : ""}const x = cols[0];
if (start >= end) return { has: false };
let acc = ${mapSrc ? "f(x[start])" : "x[start]"};
for (let i = start + 1; i < end; i++) acc = op(acc, ${mapSrc ? "f(x[i])" : "x[i]"});
return { has: true, acc };`
      }, { ...run(o), n: c.n, cols: [c.key] });
      return res.flat().filter((p) => p.has).map((p) => p.acc);
    }
    async function reduceResident(op, input, identity2, o, mapFn) {
      return withColumn(input, o, async (c) => {
        const ps = await partials(op, mapFn, c, o);
        if (ps.length === 0)
          return identity2;
        let acc = ps[0];
        for (let i = 1; i < ps.length; i++)
          acc = op(acc, ps[i]);
        return identity2 === void 0 ? acc : op(identity2, acc);
      });
    }
    async function reduceKernel(kernel, call) {
      const ps = (await (0, residentPatterns_1.residentMap)(call.pool, kernel, call)).flat();
      if (ps.length === 0)
        return call.identity;
      let acc = ps[0];
      for (let i = 1; i < ps.length; i++)
        acc = call.combine(acc, ps[i]);
      return call.identity === void 0 ? acc : call.combine(call.identity, acc);
    }
    async function mapReduceResident(mapFn, reduceOp, input, o) {
      return withColumn(input, o, async (c) => {
        const ps = await partials(reduceOp, mapFn, c, o);
        if (ps.length === 0)
          return (0, parallelUtils_1.detectIdentityElement)(reduceOp, 0);
        let acc = ps[0];
        for (let i = 1; i < ps.length; i++)
          acc = reduceOp(acc, ps[i]);
        return acc;
      });
    }
    function mapReduceKernel(k, call) {
      const { pool, ...rest } = call;
      return (0, residentPatterns_1.residentMapReduce)(pool, { ...rest, map: k.map, combine: k.combine });
    }
    function map(a, b, c) {
      if ((0, exports.isKernel)(a))
        return mapKernel2(a, b);
      if ((0, exports.isResidentOptions)(c))
        return mapResident(a, b, c);
      throw new TypeError("paraweb.map: expected (kernel, { pool, ... }) or (fn, input, { pool, key })");
    }
    function filter(a, b, c) {
      if ((0, exports.isPredicate)(a))
        return filterKernel(a, b, c);
      if ((0, exports.isResidentOptions)(c))
        return filterResident(a, b, c);
      throw new TypeError("paraweb.filter: expected (predicate, state, { pool }) or (fn, input, { pool, key })");
    }
    function reduce(a, b, c, d, e) {
      if ((0, exports.isKernel)(a))
        return reduceKernel(a, b);
      if ((0, exports.isResidentOptions)(d))
        return reduceResident(a, b, c, d, e);
      throw new TypeError("paraweb.reduce: expected (kernel, { pool, combine }) or (op, input, identity, { pool, key })");
    }
    function mapReduce2(a, b, c, d) {
      if ((0, exports.isMapReduceKernels)(a))
        return mapReduceKernel(a, b);
      if ((0, exports.isResidentOptions)(d))
        return mapReduceResident(a, b, c, d);
      throw new TypeError("paraweb.mapReduce: expected ({ map, combine }, { pool, ... }) or (mapFn, reduceOp, input, { pool, key })");
    }
    function isResidentCall(pattern, args) {
      switch (pattern) {
        case "map":
          return (0, exports.isKernel)(args[0]) || (0, exports.isResidentOptions)(args[2]);
        case "filter":
          return (0, exports.isPredicate)(args[0]) || (0, exports.isResidentOptions)(args[2]);
        case "reduce":
          return (0, exports.isKernel)(args[0]) || (0, exports.isResidentOptions)(args[3]);
        case "mapReduce":
          return (0, exports.isMapReduceKernels)(args[0]) || (0, exports.isResidentOptions)(args[3]);
      }
    }
  }
});

// node_modules/paraweb-js/dist/resident/index.js
var require_resident = __commonJS({
  "node_modules/paraweb-js/dist/resident/index.js"(exports) {
    "use strict";
    var __createBinding = exports && exports.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __exportStar = exports && exports.__exportStar || function(m, exports2) {
      for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports2, p)) __createBinding(exports2, m, p);
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.isPredicate = exports.isMapReduceKernels = exports.isKernel = exports.isResidentOptions = exports.isResidentCall = exports.mapReduce = exports.reduce = exports.filter = exports.map = exports.orderedKeys = exports.orderedKey = exports.ResidentGPU = exports.residentWorkerMain = exports.RESIDENT_WORKER_SOURCE = void 0;
    __exportStar(require_residentPool(), exports);
    __exportStar(require_residentPatterns(), exports);
    var residentWorker_1 = require_residentWorker();
    Object.defineProperty(exports, "RESIDENT_WORKER_SOURCE", { enumerable: true, get: function() {
      return residentWorker_1.RESIDENT_WORKER_SOURCE;
    } });
    Object.defineProperty(exports, "residentWorkerMain", { enumerable: true, get: function() {
      return residentWorker_1.residentWorkerMain;
    } });
    var residentGPU_1 = require_residentGPU();
    Object.defineProperty(exports, "ResidentGPU", { enumerable: true, get: function() {
      return residentGPU_1.ResidentGPU;
    } });
    Object.defineProperty(exports, "orderedKey", { enumerable: true, get: function() {
      return residentGPU_1.orderedKey;
    } });
    Object.defineProperty(exports, "orderedKeys", { enumerable: true, get: function() {
      return residentGPU_1.orderedKeys;
    } });
    var residentApi_1 = require_residentApi();
    Object.defineProperty(exports, "map", { enumerable: true, get: function() {
      return residentApi_1.map;
    } });
    Object.defineProperty(exports, "filter", { enumerable: true, get: function() {
      return residentApi_1.filter;
    } });
    Object.defineProperty(exports, "reduce", { enumerable: true, get: function() {
      return residentApi_1.reduce;
    } });
    Object.defineProperty(exports, "mapReduce", { enumerable: true, get: function() {
      return residentApi_1.mapReduce;
    } });
    Object.defineProperty(exports, "isResidentCall", { enumerable: true, get: function() {
      return residentApi_1.isResidentCall;
    } });
    Object.defineProperty(exports, "isResidentOptions", { enumerable: true, get: function() {
      return residentApi_1.isResidentOptions;
    } });
    Object.defineProperty(exports, "isKernel", { enumerable: true, get: function() {
      return residentApi_1.isKernel;
    } });
    Object.defineProperty(exports, "isMapReduceKernels", { enumerable: true, get: function() {
      return residentApi_1.isMapReduceKernels;
    } });
    Object.defineProperty(exports, "isPredicate", { enumerable: true, get: function() {
      return residentApi_1.isPredicate;
    } });
  }
});

// node_modules/d3-array/dist/d3-array.mjs
function ascending(a, b) {
  return a == null || b == null ? NaN : a < b ? -1 : a > b ? 1 : a >= b ? 0 : NaN;
}
function descending(a, b) {
  return a == null || b == null ? NaN : b < a ? -1 : b > a ? 1 : b >= a ? 0 : NaN;
}
function bisector(f) {
  let compare1, compare2, delta;
  if (f.length !== 2) {
    compare1 = ascending;
    compare2 = (d, x) => ascending(f(d), x);
    delta = (d, x) => f(d) - x;
  } else {
    compare1 = f === ascending || f === descending ? f : zero;
    compare2 = f;
    delta = f;
  }
  function left(a, x, lo = 0, hi = a.length) {
    if (lo < hi) {
      if (compare1(x, x) !== 0) return hi;
      do {
        const mid = lo + hi >>> 1;
        if (compare2(a[mid], x) < 0) lo = mid + 1;
        else hi = mid;
      } while (lo < hi);
    }
    return lo;
  }
  function right(a, x, lo = 0, hi = a.length) {
    if (lo < hi) {
      if (compare1(x, x) !== 0) return hi;
      do {
        const mid = lo + hi >>> 1;
        if (compare2(a[mid], x) <= 0) lo = mid + 1;
        else hi = mid;
      } while (lo < hi);
    }
    return lo;
  }
  function center(a, x, lo = 0, hi = a.length) {
    const i = left(a, x, lo, hi - 1);
    return i > lo && delta(a[i - 1], x) > -delta(a[i], x) ? i - 1 : i;
  }
  return { left, center, right };
}
function zero() {
  return 0;
}
function number(x) {
  return x === null ? NaN : +x;
}
var ascendingBisect = bisector(ascending);
var bisectRight = ascendingBisect.right;
var bisectLeft = ascendingBisect.left;
var bisectCenter = bisector(number).center;
var blur2 = Blur2(blurf);
var blurImage = Blur2(blurfImage);
function Blur2(blur) {
  return function(data, rx, ry = rx) {
    if (!((rx = +rx) >= 0)) throw new RangeError("invalid rx");
    if (!((ry = +ry) >= 0)) throw new RangeError("invalid ry");
    let { data: values, width, height } = data;
    if (!((width = Math.floor(width)) >= 0)) throw new RangeError("invalid width");
    if (!((height = Math.floor(height !== void 0 ? height : values.length / width)) >= 0)) throw new RangeError("invalid height");
    if (!width || !height || !rx && !ry) return data;
    const blurx = rx && blur(rx);
    const blury = ry && blur(ry);
    const temp = values.slice();
    if (blurx && blury) {
      blurh(blurx, temp, values, width, height);
      blurh(blurx, values, temp, width, height);
      blurh(blurx, temp, values, width, height);
      blurv(blury, values, temp, width, height);
      blurv(blury, temp, values, width, height);
      blurv(blury, values, temp, width, height);
    } else if (blurx) {
      blurh(blurx, values, temp, width, height);
      blurh(blurx, temp, values, width, height);
      blurh(blurx, values, temp, width, height);
    } else if (blury) {
      blurv(blury, values, temp, width, height);
      blurv(blury, temp, values, width, height);
      blurv(blury, values, temp, width, height);
    }
    return data;
  };
}
function blurh(blur, T, S, w, h) {
  for (let y = 0, n = w * h; y < n; ) {
    blur(T, S, y, y += w, 1);
  }
}
function blurv(blur, T, S, w, h) {
  for (let x = 0, n = w * h; x < w; ++x) {
    blur(T, S, x, x + n, w);
  }
}
function blurfImage(radius) {
  const blur = blurf(radius);
  return (T, S, start, stop, step) => {
    start <<= 2, stop <<= 2, step <<= 2;
    blur(T, S, start + 0, stop + 0, step);
    blur(T, S, start + 1, stop + 1, step);
    blur(T, S, start + 2, stop + 2, step);
    blur(T, S, start + 3, stop + 3, step);
  };
}
function blurf(radius) {
  const radius0 = Math.floor(radius);
  if (radius0 === radius) return bluri(radius);
  const t = radius - radius0;
  const w = 2 * radius + 1;
  return (T, S, start, stop, step) => {
    if (!((stop -= step) >= start)) return;
    let sum = radius0 * S[start];
    const s0 = step * radius0;
    const s1 = s0 + step;
    for (let i = start, j = start + s0; i < j; i += step) {
      sum += S[Math.min(stop, i)];
    }
    for (let i = start, j = stop; i <= j; i += step) {
      sum += S[Math.min(stop, i + s0)];
      T[i] = (sum + t * (S[Math.max(start, i - s1)] + S[Math.min(stop, i + s1)])) / w;
      sum -= S[Math.max(start, i - s0)];
    }
  };
}
function bluri(radius) {
  const w = 2 * radius + 1;
  return (T, S, start, stop, step) => {
    if (!((stop -= step) >= start)) return;
    let sum = radius * S[start];
    const s = step * radius;
    for (let i = start, j = start + s; i < j; i += step) {
      sum += S[Math.min(stop, i)];
    }
    for (let i = start, j = stop; i <= j; i += step) {
      sum += S[Math.min(stop, i + s)];
      T[i] = sum / w;
      sum -= S[Math.max(start, i - s)];
    }
  };
}
var array = Array.prototype;
var slice = array.slice;
var e10 = Math.sqrt(50);
var e5 = Math.sqrt(10);
var e2 = Math.sqrt(2);
function tickSpec(start, stop, count) {
  const step = (stop - start) / Math.max(0, count), power = Math.floor(Math.log10(step)), error2 = step / Math.pow(10, power), factor = error2 >= e10 ? 10 : error2 >= e5 ? 5 : error2 >= e2 ? 2 : 1;
  let i1, i2, inc;
  if (power < 0) {
    inc = Math.pow(10, -power) / factor;
    i1 = Math.round(start * inc);
    i2 = Math.round(stop * inc);
    if (i1 / inc < start) ++i1;
    if (i2 / inc > stop) --i2;
    inc = -inc;
  } else {
    inc = Math.pow(10, power) * factor;
    i1 = Math.round(start / inc);
    i2 = Math.round(stop / inc);
    if (i1 * inc < start) ++i1;
    if (i2 * inc > stop) --i2;
  }
  if (i2 < i1 && 0.5 <= count && count < 2) return tickSpec(start, stop, count * 2);
  return [i1, i2, inc];
}
function tickIncrement(start, stop, count) {
  stop = +stop, start = +start, count = +count;
  return tickSpec(start, stop, count)[2];
}
function tickStep(start, stop, count) {
  stop = +stop, start = +start, count = +count;
  const reverse = stop < start, inc = reverse ? tickIncrement(stop, start, count) : tickIncrement(start, stop, count);
  return (reverse ? -1 : 1) * (inc < 0 ? 1 / -inc : inc);
}
var shuffle = shuffler(Math.random);
function shuffler(random) {
  return function shuffle2(array2, i0 = 0, i1 = array2.length) {
    let m = i1 - (i0 = +i0);
    while (m) {
      const i = random() * m-- | 0, t = array2[m + i0];
      array2[m + i0] = array2[i + i0];
      array2[i + i0] = t;
    }
    return array2;
  };
}

// node_modules/vega-statistics/build/vega-statistics.module.js
function bin(_) {
  const maxb = _.maxbins || 20, base = _.base || 10, logb = Math.log(base), div = _.divide || [5, 2];
  let min = _.extent[0], max = _.extent[1], step, level, minstep, v, i, n;
  const span = _.span || max - min || Math.abs(min) || 1;
  if (_.step) {
    step = _.step;
  } else if (_.steps) {
    v = span / maxb;
    for (i = 0, n = _.steps.length; i < n && _.steps[i] < v; ++i) ;
    step = _.steps[Math.max(0, i - 1)];
  } else {
    level = Math.ceil(Math.log(maxb) / logb);
    minstep = _.minstep || 0;
    step = Math.max(minstep, Math.pow(base, Math.round(Math.log(span) / logb) - level));
    while (Math.ceil(span / step) > maxb) {
      step *= base;
    }
    for (i = 0, n = div.length; i < n; ++i) {
      v = step / div[i];
      if (v >= minstep && span / v <= maxb) step = v;
    }
  }
  v = Math.log(step);
  const precision = v >= 0 ? 0 : ~~(-v / logb) + 1, eps = Math.pow(base, -precision - 1);
  if (_.nice || _.nice === void 0) {
    v = Math.floor(min / step + eps) * step;
    min = min < v ? v - step : v;
    max = Math.ceil(max / step) * step;
  }
  return {
    start: min,
    stop: max === min ? min + step : max,
    step
  };
}
var SQRT2PI = Math.sqrt(2 * Math.PI);
var MIN_RADIANS = 0.5 * Math.PI / 180;

// src/kernel.ts
var EPSILON = 1e-14;
var FIELD_SLOTS = 6;
var S_VALID = 0;
var S_SUM = 1;
var S_MIN = 2;
var S_MAX = 3;
var S_MEAN = 4;
var S_M2 = 5;
var BIN_NULL = 0;
var BIN_NEG_INF = 1;
var BIN_POS_INF = 2;
var BIN_SPECIALS = 3;
function dimCard(d) {
  if (d.kind === "bin") return d.nb + BIN_SPECIALS;
  if (d.kind === "bucket") return d.R + 1;
  return d.card;
}
function bucketOf(x, lo, hi, scale, R) {
  if (x !== x) return R;
  if (x <= lo) return 0;
  if (x >= hi) return R - 1;
  const b = Math.floor((x - lo) * scale);
  return b > R - 1 ? R - 1 : b;
}
function keyCount(spec) {
  let k = 1;
  for (const d of spec.dims) k *= dimCard(d);
  return k;
}
function slotCount(spec) {
  return 1 + spec.measures.length * FIELD_SLOTS;
}
function kernelSignature(spec, indexed = false) {
  return (indexed ? "idx:" : "") + JSON.stringify(spec);
}
function generateKernelSource(spec, indexed = false) {
  const A = slotCount(spec);
  const lines = [];
  const used = /* @__PURE__ */ new Set();
  spec.filters.forEach((f) => used.add(f.col));
  spec.dims.forEach((d) => used.add(d.col));
  spec.measures.forEach((c) => used.add(c));
  for (const c of used) lines.push(`const c${c} = cols[${c}];`);
  let p = 0;
  let setIdx = 0;
  const filterCode = [];
  if (spec.where) {
    lines.push(spec.where.prelude);
    filterCode.push(`if (!(${spec.where.cond})) continue;`);
  }
  spec.filters.forEach((f, j) => {
    if (f.kind === "range") {
      lines.push(`const lo${j} = fp[${p}], hi${j} = fp[${p + 1}];`);
      p += 2;
      filterCode.push(`x = c${f.col}[i]; if (!(x >= lo${j} && x <= hi${j})) continue;`);
    } else {
      lines.push(`const m${j} = sets[${setIdx++}];`);
      filterCode.push(`if (m${j}[c${f.col}[i]] === 0) continue;`);
    }
  });
  let stride = 1;
  const keyCode = [];
  spec.dims.forEach((d, j) => {
    if (d.kind === "bin") {
      lines.push(
        `const bs${j} = fp[${p}], bp${j} = fp[${p + 1}], bl${j} = fp[${p + 2}], bt${j} = fp[${p + 3}];`
      );
      p += 4;
      const nb = d.nb;
      keyCode.push(
        `x = c${d.col}[i]; if (x !== x) k += ${(nb + BIN_NULL) * stride}; else if (bs${j} !== bs${j}) k += ${(nb + BIN_POS_INF) * stride}; else if (x < bs${j}) k += ${(nb + BIN_NEG_INF) * stride}; else if (x > bp${j}) k += ${(nb + BIN_POS_INF) * stride}; else { x = Math.max(bs${j}, Math.min(x, bl${j})); b = Math.floor(${EPSILON} + (x - bs${j}) / bt${j}); if (b > ${nb - 1}) b = ${nb - 1}; k += b * ${stride}; }`
      );
    } else if (d.kind === "bucket") {
      lines.push(`const ul${j} = fp[${p}], uh${j} = fp[${p + 1}], us${j} = fp[${p + 2}];`);
      p += 3;
      const R = d.R;
      keyCode.push(
        `x = c${d.col}[i]; if (x !== x) b = ${R}; else if (x <= ul${j}) b = 0; else if (x >= uh${j}) b = ${R - 1}; else { b = Math.floor((x - ul${j}) * us${j}); if (b > ${R - 1}) b = ${R - 1}; } k += b * ${stride};`
      );
    } else {
      keyCode.push(`k += c${d.col}[i] * ${stride};`);
    }
    stride *= dimCard(d);
  });
  const measureCode = [];
  spec.measures.forEach((c, j) => {
    const off = 1 + j * FIELD_SLOTS;
    let m = `x = c${c}[i]; if (x === x) { q = o + ${off}; n = ++out[q + ${S_VALID}]; out[q + ${S_SUM}] += x; if (x < out[q + ${S_MIN}]) out[q + ${S_MIN}] = x; if (x > out[q + ${S_MAX}]) out[q + ${S_MAX}] = x;`;
    if (spec.variance) {
      m += ` d = x - out[q + ${S_MEAN}]; out[q + ${S_MEAN}] += d / n; out[q + ${S_M2}] += d * (x - out[q + ${S_MEAN}]);`;
    }
    m += " }";
    measureCode.push(m);
  });
  lines.push("let x, k, b, o, q, n, d;");
  if (indexed) {
    lines.push("for (let j = start; j < end; j++) {");
    lines.push("  const i = idx[j];");
  } else {
    lines.push("for (let i = start; i < end; i++) {");
  }
  lines.push(...filterCode.map((s) => "  " + s));
  lines.push("  k = 0;");
  lines.push(...keyCode.map((s) => "  " + s));
  lines.push(`  o = base + k * ${A};`);
  lines.push("  out[o] += 1;");
  lines.push(...measureCode.map((s) => "  " + s));
  lines.push("}");
  return lines.join("\n");
}
function compileKernel(spec, indexed = false) {
  return new Function(
    "cols",
    "sets",
    "fp",
    "out",
    "base",
    "start",
    "end",
    "idx",
    generateKernelSource(spec, indexed)
  );
}
function initRegion(out, base, K, nm) {
  const A = 1 + nm * FIELD_SLOTS;
  const end = base + K * A;
  out.fill(0, base, end);
  if (nm === 0) return;
  for (let o = base; o < end; o += A) {
    for (let j = 0; j < nm; j++) {
      const q = o + 1 + j * FIELD_SLOTS;
      out[q + S_MIN] = Infinity;
      out[q + S_MAX] = -Infinity;
    }
  }
}
function mapKernel(spec) {
  const nm = spec.measures.length;
  const A = slotCount(spec);
  const init = `if (args.first) {
  const e0 = base + args.K * ${A};
  out.fill(0, base, e0);
` + (nm ? `  for (let o = base; o < e0; o += ${A}) {
` + Array.from({ length: nm }, (_, j) => `    out[o + ${1 + j * FIELD_SLOTS + S_MIN}] = Infinity; out[o + ${1 + j * FIELD_SLOTS + S_MAX}] = -Infinity;
`).join("") + `  }
` : "") + `}
`;
  return {
    key: "agg:" + kernelSignature(spec),
    src: "const sets = args.sets, fp = args.fp, out = bufs[0], base = args.base;\n" + init + generateKernelSource(spec)
  };
}
function combineKernel(nm, variance) {
  const A = 1 + nm * FIELD_SLOTS;
  const fields = Array.from({ length: nm }, (_, j) => {
    const q = 1 + j * FIELD_SLOTS;
    return `
      { const q = o + ${q}, r = src + ${q}; const nb = parts[r + ${S_VALID}];
        if (nb !== 0) {
          const na = dst[q + ${S_VALID}], n = na + nb;
          dst[q + ${S_VALID}] = n; dst[q + ${S_SUM}] += parts[r + ${S_SUM}];
          if (parts[r + ${S_MIN}] < dst[q + ${S_MIN}]) dst[q + ${S_MIN}] = parts[r + ${S_MIN}];
          if (parts[r + ${S_MAX}] > dst[q + ${S_MAX}]) dst[q + ${S_MAX}] = parts[r + ${S_MAX}];` + (variance ? `
          const delta = parts[r + ${S_MEAN}] - dst[q + ${S_MEAN}];
          dst[q + ${S_MEAN}] += (delta * nb) / n;
          dst[q + ${S_M2}] += parts[r + ${S_M2}] + (delta * delta * na * nb) / n;` : "") + `
        } }`;
  }).join("");
  return {
    key: `combine:${nm}:${variance}`,
    src: `const parts = bufs[0], dst = bufs[1], T = args.T, region = args.region;
for (let k = start; k < end; k++) {
  const o = k * ${A};
  for (let s = 0; s < ${A}; s++) dst[o + s] = parts[o + s];
  for (let t = 1; t < T; t++) {
    const src = t * region + o;
    const cnt = parts[src];
    if (cnt === 0) continue;
    dst[o] += cnt;${fields}
  }
}`
  };
}
function treeKernel(nm, variance) {
  const A = 1 + nm * FIELD_SLOTS;
  const fields = Array.from({ length: nm }, (_, j) => {
    const q = 1 + j * FIELD_SLOTS;
    return `
      { const q = d + ${q}, r = s + ${q}; const nb = t[r + ${S_VALID}];
        if (nb !== 0) {
          const na = t[q + ${S_VALID}], n = na + nb;
          t[q + ${S_VALID}] = n; t[q + ${S_SUM}] += t[r + ${S_SUM}];
          if (t[r + ${S_MIN}] < t[q + ${S_MIN}]) t[q + ${S_MIN}] = t[r + ${S_MIN}];
          if (t[r + ${S_MAX}] > t[q + ${S_MAX}]) t[q + ${S_MAX}] = t[r + ${S_MAX}];` + (variance ? `
          const delta = t[r + ${S_MEAN}] - t[q + ${S_MEAN}];
          t[q + ${S_MEAN}] += (delta * nb) / n;
          t[q + ${S_M2}] += t[r + ${S_M2}] + (delta * delta * na * nb) / n;` : "") + `
        } }`;
  }).join("");
  const initMeasures = Array.from({ length: nm }, (_, j) => `t[o + ${1 + j * FIELD_SLOTS + S_MIN}] = Infinity; t[o + ${1 + j * FIELD_SLOTS + S_MAX}] = -Infinity;`).join(" ");
  return {
    key: `tree:${nm}:${variance}`,
    src: `const fin = bufs[0], t = bufs[1], miss = bufs[2], R = args.R, B = R + 1;
for (let kv = start; kv < end; kv++) {
  const base = kv * 2 * R;
  for (let i = 1; i < R; i++) { const o = (base + i) * ${A}; for (let x = 0; x < ${A}; x++) t[o + x] = 0; ${initMeasures} }
  t.set(fin.subarray(kv * B * ${A}, (kv * B + R) * ${A}), (base + R) * ${A});
  miss.set(fin.subarray((kv * B + R) * ${A}, (kv * B + R + 1) * ${A}), kv * ${A});
  for (let i = R - 1; i >= 1; i--) {
    const d = (base + i) * ${A};
    { const s = (base + 2 * i) * ${A}; const cnt = t[s]; if (cnt !== 0) { t[d] += cnt;${fields} } }
    { const s = (base + 2 * i + 1) * ${A}; const cnt = t[s]; if (cnt !== 0) { t[d] += cnt;${fields} } }
  }
}
return 0;`
  };
}
function filterPredicate(filters) {
  const lines = ["const fp = args.fp, sets = args.sets;", "let x;"];
  const used = new Set(filters.map((f) => f.col));
  for (const c of used) lines.push(`const c${c} = cols[${c}];`);
  let p = 0, setIdx = 0;
  const conds = [];
  filters.forEach((f, j) => {
    if (f.kind === "range") {
      lines.push(`const lo${j} = fp[${p}], hi${j} = fp[${p + 1}];`);
      p += 2;
      conds.push(`(x = c${f.col}[i], x >= lo${j} && x <= hi${j})`);
    } else {
      lines.push(`const m${j} = sets[${setIdx++}];`);
      conds.push(`m${j}[c${f.col}[i]] === 1`);
    }
  });
  return { key: "f:" + JSON.stringify(filters), prelude: lines.join("\n"), cond: conds.length ? conds.join(" && ") : "true" };
}
function mergeRecord(dst, d, src, s, nm, variance) {
  const cnt = src[s];
  if (cnt === 0) return;
  dst[d] += cnt;
  for (let j = 0; j < nm; j++) {
    const q = d + 1 + j * FIELD_SLOTS, r = s + 1 + j * FIELD_SLOTS;
    const nb = src[r + S_VALID];
    if (nb === 0) continue;
    const na = dst[q + S_VALID], n = na + nb;
    dst[q + S_VALID] = n;
    dst[q + S_SUM] += src[r + S_SUM];
    if (src[r + S_MIN] < dst[q + S_MIN]) dst[q + S_MIN] = src[r + S_MIN];
    if (src[r + S_MAX] > dst[q + S_MAX]) dst[q + S_MAX] = src[r + S_MAX];
    if (variance) {
      const delta = src[r + S_MEAN] - dst[q + S_MEAN];
      dst[q + S_MEAN] += delta * nb / n;
      dst[q + S_M2] += src[r + S_M2] + delta * delta * na * nb / n;
    }
  }
}
function groupKeySource(spec) {
  const lines = [];
  const used = /* @__PURE__ */ new Set();
  spec.dims.forEach((d) => used.add(d.col));
  for (const c of used) lines.push(`const g${c} = cols[${c}];`);
  let p = 0;
  for (const f of spec.filters) if (f.kind === "range") p += 2;
  let stride = 1;
  const body = [];
  spec.dims.forEach((d, j) => {
    if (d.kind === "bin") {
      lines.push(`const gbs${j} = fp[${p}], gbp${j} = fp[${p + 1}], gbl${j} = fp[${p + 2}], gbt${j} = fp[${p + 3}];`);
      p += 4;
      const nb = d.nb;
      body.push(
        `x = g${d.col}[i]; if (x !== x) k += ${(nb + BIN_NULL) * stride}; else if (gbs${j} !== gbs${j}) k += ${(nb + BIN_POS_INF) * stride}; else if (x < gbs${j}) k += ${(nb + BIN_NEG_INF) * stride}; else if (x > gbp${j}) k += ${(nb + BIN_POS_INF) * stride}; else { x = Math.max(gbs${j}, Math.min(x, gbl${j})); b = Math.floor(${EPSILON} + (x - gbs${j}) / gbt${j}); if (b > ${nb - 1}) b = ${nb - 1}; k += b * ${stride}; }`
      );
    } else if (d.kind === "dict") {
      body.push(`k += g${d.col}[i] * ${stride};`);
    } else {
      throw new Error("groupKeySource: bucket dimensions are not supported");
    }
    stride *= dimCard(d);
  });
  return `${lines.join("\n")}
function groupKey(i) { let x, b, k = 0; ${body.join(" ")} return k; }`;
}

// src/pool.ts
var import_resident = __toESM(require_resident());

// src/aggregate.ts
var import_resident4 = __toESM(require_resident());

// src/gpu.ts
var import_resident2 = __toESM(require_resident());
var import_resident3 = __toESM(require_resident());
var MAX_KEYS = 1 << 22;
function gpuEligible(plan) {
  const { spec } = plan;
  return spec.measures.length === 0 && plan.K <= MAX_KEYS && !spec.where && spec.filters.every((f) => f.kind === "range") && spec.dims.every((d) => d.kind === "bin" || d.kind === "dict");
}
function binIndexKernel(nb) {
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
}`
  };
}
var GpuBackend = class _GpuBackend {
  constructor(gpu) {
    /** Pending or finished uploads by GPU buffer key. */
    this.uploads = /* @__PURE__ */ new Map();
    this.last = { uploadMs: 0, dispatchMs: 0 };
    this.gpu = gpu;
  }
  static async create() {
    return new _GpuBackend(await import_resident2.ResidentGPU.create());
  }
  once(key2, make) {
    let p = this.uploads.get(key2);
    if (!p) {
      p = make();
      this.uploads.set(key2, p);
      p.catch(() => this.uploads.delete(key2));
    }
    return p;
  }
  /** Counts per key of the plan, as the scan's `final` array (A = 1). */
  async aggregate(pool, table, plan) {
    const t03 = performance.now();
    const { spec, cols, fp } = plan;
    const n = table.length;
    const filters = [];
    const dims = [];
    const jobs = [];
    let p = 0;
    for (const f of spec.filters) {
      const key2 = cols[f.col];
      const gk = `k:${key2}`;
      jobs.push(this.once(gk, async () => this.gpu.uploadKeys(gk, table.viewByKey(key2))));
      filters.push({ col: gk, lo: fp[p], hi: fp[p + 1] });
      p += 2;
    }
    let stride = 1;
    for (const d of spec.dims) {
      const key2 = cols[d.col];
      if (d.kind === "bin") {
        const bs = fp[p], bp = fp[p + 1], bl = fp[p + 2], bt = fp[p + 3];
        p += 4;
        const gk = `b:${key2}:${bs}:${bp}:${bl}:${bt}:${d.nb}`;
        jobs.push(this.once(gk, async () => {
          const out = new Uint32Array(new SharedArrayBuffer(4 * Math.max(1, n)));
          await (0, import_resident3.map)(binIndexKernel(d.nb), {
            pool,
            n,
            cols: [key2],
            bufs: [{ buffer: out.buffer, type: "u32" }],
            args: { bs, bp, bl, bt }
          });
          this.gpu.uploadU32(gk, out);
        }));
        dims.push({ col: gk, stride });
      } else if (d.kind === "dict") {
        const gk = `d:${key2}`;
        jobs.push(this.once(gk, async () => this.gpu.uploadU32(gk, table.viewByKey(key2))));
        dims.push({ col: gk, stride });
      } else {
        throw new Error("pwaggregate gpu: unsupported dimension");
      }
      stride *= dimCard(d);
    }
    await Promise.all(jobs);
    const t12 = performance.now();
    const counts = await this.gpu.groupCount({ n, K: plan.K, filters, dims });
    this.last = { uploadMs: t12 - t03, dispatchMs: performance.now() - t12 };
    const final = new Float64Array(plan.K * plan.A);
    for (let k = 0; k < plan.K; k++) final[k * plan.A] = counts[k];
    return final;
  }
  destroy() {
    this.gpu.destroy();
    this.uploads.clear();
  }
};

// src/aggregate.ts
var SUPPORTED_OPS = /* @__PURE__ */ new Set([
  "count",
  "valid",
  "missing",
  "sum",
  "mean",
  "average",
  "variance",
  "variancep",
  "stdev",
  "stdevp",
  "stderr",
  "min",
  "max"
]);
var VARIANCE_OPS = /* @__PURE__ */ new Set(["variance", "variancep", "stdev", "stdevp", "stderr"]);
var MAX_PARTIAL_BYTES = 512 * 1024 * 1024;
var PARALLEL_MERGE_SLOTS = 1 << 16;
function resolveBin(p, extent2) {
  const opts = { extent: extent2 };
  for (const k of ["maxbins", "step", "steps", "minstep", "nice", "base", "divide", "span"]) {
    if (p[k] != null) opts[k] = p[k];
  }
  const b = bin(opts);
  const step = b.step;
  let start = b.start;
  const nb = Math.ceil((b.stop - start) / step);
  let stop = start + nb * step;
  if (p.anchor != null) {
    const d = p.anchor - (start + step * Math.floor((p.anchor - start) / step));
    start += d;
    stop += d;
  }
  return { start, stop, step, nb, as: p.as ?? ["bin0", "bin1"] };
}
function measureName(op, field2, as) {
  return as || op + (!field2 ? "" : "_" + field2);
}
async function planAggregate(pool, table, params2, bucket) {
  const cols = [];
  const colIndex = /* @__PURE__ */ new Map();
  const slot = (key2, type, buffer) => {
    let s = colIndex.get(key2);
    if (s === void 0) {
      s = cols.length;
      cols.push(key2);
      colIndex.set(key2, s);
      pool.ensureColumn(key2, type, buffer);
    }
    return s;
  };
  const f64Slot = (field2) => {
    const c = params2.measureCols?.[field2] ?? table.numeric(field2);
    return slot(c.key, "f64", c.view.buffer);
  };
  const filters = [];
  const fp = [];
  const sets = [];
  for (const p of params2.filter ?? []) {
    if (p == null || !p.field) continue;
    if (p.range != null && p.range.length >= 2) {
      const a = +p.range[0], b = +p.range[1];
      filters.push({ kind: "range", col: f64Slot(p.field) });
      fp.push(Math.min(a, b), Math.max(a, b));
    } else if (p.oneOf != null) {
      const d = table.dictionary(p.field);
      const mask = new Uint8Array(d.card);
      for (const v of p.oneOf) {
        if (v == null) {
          mask[d.card - 1] = 1;
          continue;
        }
        const c = d.codes.get(v instanceof Date ? +v : v);
        if (c !== void 0) mask[c] = 1;
      }
      filters.push({ kind: "set", col: slot(d.key, "i32", d.view.buffer) });
      sets.push(mask);
    }
  }
  const dims = [];
  const decoders = [];
  if (bucket) {
    dims.push({ kind: "bucket", col: f64Slot(bucket.field), R: bucket.R });
    fp.push(bucket.lo, bucket.hi, bucket.scale);
    decoders.push(() => {
    });
  }
  for (const bp of params2.bins ?? []) {
    let rb;
    if (bp.resolved) {
      const { start, stop, step } = bp.resolved;
      const nb = Math.round((stop - start) / step);
      rb = { start, stop, step, nb: Number.isFinite(nb) && nb > 0 ? nb : 0, as: bp.as ?? ["bin0", "bin1"] };
    } else {
      const extent2 = bp.extent && bp.extent.length >= 2 ? [+bp.extent[0], +bp.extent[1]] : await table.extent(bp.field, pool);
      if (!(extent2[0] <= extent2[1])) {
        throw new Error(`pwaggregate: field ${bp.field} has no numeric values to bin`);
      }
      rb = resolveBin(bp, extent2);
    }
    const bcol = bp.column ? slot(bp.column.key, "f64", bp.column.view.buffer) : f64Slot(bp.field);
    dims.push({ kind: "bin", col: bcol, nb: rb.nb });
    fp.push(rb.start, rb.stop, rb.stop - rb.step, rb.step);
    const [a0, a1] = rb.as;
    decoders.push((idx, row) => {
      if (idx < rb.nb) {
        const v = rb.start + rb.step * idx;
        row[a0] = v;
        if (a1) row[a1] = rb.start + rb.step * (1 + (v - rb.start) / rb.step);
      } else if (idx === rb.nb + BIN_NULL) {
        row[a0] = null;
        if (a1) row[a1] = null;
      } else if (idx === rb.nb + BIN_NEG_INF) {
        row[a0] = -Infinity;
        if (a1) row[a1] = -Infinity;
      } else if (idx === rb.nb + BIN_POS_INF) {
        const v = rb.start === rb.start ? Infinity : NaN;
        row[a0] = v;
        if (a1) row[a1] = v;
      }
    });
  }
  for (const g of params2.groupby ?? []) {
    const d = params2.groupCols?.[g] ?? table.dictionary(g);
    dims.push({ kind: "dict", col: slot(d.key, "i32", d.view.buffer), card: d.card });
    decoders.push((idx, row) => {
      row[g] = d.values[idx];
    });
  }
  const ops = params2.ops && params2.ops.length ? params2.ops : ["count"];
  const fields = params2.fields ?? [];
  const asNames = params2.as ?? [];
  const measureFields = [];
  const measureOf = /* @__PURE__ */ new Map();
  let variance = false;
  const outputs = ops.map((op, i) => {
    if (!SUPPORTED_OPS.has(op)) throw new Error(`pwaggregate: unsupported op "${op}"`);
    const field2 = fields[i] && fields[i] !== "*" ? fields[i] : null;
    if (op !== "count" && !field2) throw new Error(`pwaggregate: op "${op}" requires a field`);
    let m = -1;
    if (field2 && op !== "count") {
      m = measureOf.get(field2) ?? -1;
      if (m < 0) {
        m = measureFields.length;
        measureFields.push(field2);
        measureOf.set(field2, m);
      }
    }
    if (VARIANCE_OPS.has(op)) variance = true;
    return { op, m, name: measureName(op, field2, asNames[i]) };
  });
  const measures = measureFields.map(f64Slot);
  const spec = { filters, dims, measures, variance };
  let P;
  if (params2.where) {
    const w = params2.where(slot);
    spec.where = { prelude: w.prelude, cond: w.cond };
    P = w.P;
  }
  return {
    spec,
    cols,
    fp: Float64Array.from(fp),
    sets,
    K: keyCount(spec),
    A: slotCount(spec),
    dims,
    decoders,
    outputs,
    P
  };
}
async function executePlan(pool, table, plan, scratch = {}, opts = {}) {
  const { spec, cols, sets, K, A } = plan;
  const r = await (0, import_resident4.mapReduce)({ map: mapKernel(spec), combine: combineKernel(spec.measures.length, spec.variance) }, {
    pool,
    n: table.length,
    keys: K,
    slots: A,
    cols,
    args: { sets, fp: plan.fp, K, P: plan.P },
    scratch,
    priority: opts.priority ?? import_resident.Priority.High,
    chunkRows: opts.chunkRows ?? 0,
    parallelCombineMin: PARALLEL_MERGE_SLOTS,
    maxPartialBytes: MAX_PARTIAL_BYTES
  });
  return { final: r.final, threads: r.threads, mergeMode: r.combine };
}
function emitRows(plan, final, keys) {
  const { dims, decoders, outputs, K, A } = plan;
  const variance = plan.spec.variance;
  const cards = dims.map(dimCard);
  const rows = [];
  for (let k = 0; k < K; k++) {
    const o = k * A;
    const count = final[o];
    if (count === 0) continue;
    const row = {};
    let rem = k;
    for (let d = 0; d < dims.length; d++) {
      const idx = rem % cards[d];
      rem = (rem - idx) / cards[d];
      decoders[d](idx, row);
    }
    for (const out of outputs) {
      if (out.op === "count") {
        row[out.name] = count;
        continue;
      }
      const q = o + 1 + out.m * FIELD_SLOTS;
      const valid = final[q + S_VALID];
      switch (out.op) {
        case "valid":
          row[out.name] = valid;
          break;
        case "missing":
          row[out.name] = count - valid;
          break;
        case "sum":
          row[out.name] = valid ? final[q + S_SUM] : void 0;
          break;
        case "mean":
        case "average":
          row[out.name] = valid ? variance ? final[q + S_MEAN] : final[q + S_SUM] / valid : void 0;
          break;
        case "min":
          row[out.name] = valid ? final[q + S_MIN] : void 0;
          break;
        case "max":
          row[out.name] = valid ? final[q + S_MAX] : void 0;
          break;
        case "variance":
          row[out.name] = valid > 1 ? final[q + S_M2] / (valid - 1) : void 0;
          break;
        case "variancep":
          row[out.name] = valid > 1 ? final[q + S_M2] / valid : void 0;
          break;
        case "stdev":
          row[out.name] = valid > 1 ? Math.sqrt(final[q + S_M2] / (valid - 1)) : void 0;
          break;
        case "stdevp":
          row[out.name] = valid > 1 ? Math.sqrt(final[q + S_M2] / valid) : void 0;
          break;
        case "stderr":
          row[out.name] = valid > 1 ? Math.sqrt(final[q + S_M2] / (valid * (valid - 1))) : void 0;
          break;
      }
    }
    rows.push(row);
    if (keys) keys.push(k);
  }
  return rows;
}
async function runAggregate(pool, table, params2, scratch = {}, stats, gpu) {
  const plan = await planAggregate(pool, table, params2);
  if (gpu && gpuEligible(plan)) {
    const final = await gpu.aggregate(pool, table, plan);
    const rows2 = emitRows(plan, final);
    if (stats) {
      Object.assign(stats, {
        rows: table.length,
        threads: 0,
        groups: rows2.length,
        keys: plan.K,
        mergeMode: "single",
        path: "gpu",
        gpuUploadMs: gpu.last.uploadMs,
        gpuDispatchMs: gpu.last.dispatchMs
      });
    }
    return rows2;
  }
  const ex = await executePlan(pool, table, plan, scratch);
  const rows = emitRows(plan, ex.final);
  if (stats) {
    Object.assign(stats, {
      rows: table.length,
      threads: ex.threads,
      groups: rows.length,
      keys: plan.K,
      mergeMode: ex.mergeMode,
      path: "scan"
    });
  }
  return rows;
}

// src/preagg.ts
var import_resident5 = __toESM(require_resident());
var buildConfig = { chunkRows: 1 << 18 };
function preaggEligible(params2) {
  if (params2.where || params2.groupCols || params2.measureCols) return false;
  if ((params2.bins ?? []).some((b) => b.column)) return false;
  const ops = params2.ops && params2.ops.length ? params2.ops : ["count"];
  return ops.every((op) => SUPPORTED_OPS.has(op));
}
function predKey(p) {
  if (!p) return "none";
  if (p.range != null && p.range.length >= 2) {
    const a = +p.range[0], b = +p.range[1];
    return `r:${Math.min(a, b)}:${Math.max(a, b)}`;
  }
  if (p.oneOf != null) return "s:" + JSON.stringify(p.oneOf);
  return "none";
}
function filterSnapshot(params2) {
  const m = /* @__PURE__ */ new Map();
  for (const p of params2.filter ?? []) if (p && p.field) m.set(p.field, predKey(p));
  return m;
}
function activeField(prev, cur, params2) {
  if (!prev) return null;
  const changed = [];
  for (const k of /* @__PURE__ */ new Set([...prev.keys(), ...cur.keys()])) {
    if (prev.get(k) !== cur.get(k)) changed.push(k);
  }
  if (changed.length !== 1) return null;
  const f = changed[0];
  const a = prev.get(f) ?? "none", b = cur.get(f) ?? "none";
  if (a.startsWith("s:") || b.startsWith("s:")) return null;
  const p = (params2.filter ?? []).find((q) => q && q.field === f);
  return p ? f : null;
}
function otherSignature(params2, field2) {
  return JSON.stringify({
    groupby: params2.groupby,
    bins: params2.bins,
    ops: params2.ops,
    filter: (params2.filter ?? []).filter((p) => p && p.field !== field2)
  });
}
function withoutPredicate(params2, field2) {
  return { ...params2, filter: (params2.filter ?? []).filter((p) => p && p.field !== field2) };
}
function defaultResolution(Kv, A = 1) {
  let R = 4096;
  while (R > 256 && R * Kv * A > 4 * 1024 * 1024) R >>= 1;
  return R;
}
async function buildPreagg(pool, table, params2, field2, scratch, resolution) {
  const t03 = performance.now();
  const n = table.length, T = Math.min(pool.size, Math.max(1, n));
  const perWorker = Math.ceil(n / T);
  const cubeChunks = buildConfig.chunkRows ? T * Math.ceil(perWorker / buildConfig.chunkRows) : T;
  pool.reserveLow(cubeChunks);
  let released = false;
  const release = () => {
    if (!released) {
      released = true;
      pool.releaseLow(cubeChunks);
    }
  };
  try {
    const base = withoutPredicate(params2, field2);
    const viewPlan = await planAggregate(pool, table, base);
    const R = resolution ?? defaultResolution(viewPlan.K, viewPlan.A);
    const bidx = await table.bucketIndex(field2, R, pool, import_resident.Priority.Low, buildConfig.chunkRows);
    const plan = await planAggregate(pool, table, base, {
      field: field2,
      R,
      lo: bidx.lo,
      hi: bidx.hi,
      scale: bidx.scale
    });
    void scratch;
    const running = executePlan(pool, table, plan, {}, { priority: import_resident.Priority.Low, chunkRows: buildConfig.chunkRows });
    release();
    const ex = await running;
    return await finishPreagg(pool, params2, field2, R, plan, ex.final, bidx, t03);
  } finally {
    release();
  }
}
var TREE_MAIN_VALUES = 1 << 14;
var TREE_CHUNK_VALUES = 1 << 18;
async function finishPreagg(pool, params2, field2, R, plan, final, bidx, t03) {
  const B = R + 1;
  const Kv = plan.K / B;
  const A = plan.A;
  const nm = plan.spec.measures.length, variance = plan.spec.variance;
  const size = Kv * 2 * R * A;
  if (size < TREE_MAIN_VALUES || pool.size < 2) {
    const tree2 = new Float64Array(size);
    initRegion(tree2, 0, Kv * 2 * R, nm);
    const missing2 = new Float64Array(Kv * A);
    for (let kv = 0; kv < Kv; kv++) {
      const base = kv * 2 * R;
      for (let b = 0; b < R; b++) tree2.set(final.subarray((kv * B + b) * A, (kv * B + b + 1) * A), (base + R + b) * A);
      missing2.set(final.subarray((kv * B + R) * A, (kv * B + R + 1) * A), kv * A);
      for (let i = R - 1; i >= 1; i--) {
        const o = (base + i) * A;
        mergeRecord(tree2, o, tree2, (base + 2 * i) * A, nm, variance);
        mergeRecord(tree2, o, tree2, (base + 2 * i + 1) * A, nm, variance);
      }
    }
    return { field: field2, sig: otherSignature(params2, field2), R, Kv, A, nm, variance, tree: tree2, missing: missing2, bidx, buildMs: performance.now() - t03, kernels: /* @__PURE__ */ new Map() };
  }
  const shared = (len) => new Float64Array(new SharedArrayBuffer(8 * Math.max(1, len)));
  let fin = final;
  if (!(final.buffer instanceof SharedArrayBuffer) || final.byteOffset !== 0) {
    fin = shared(final.length);
    fin.set(final);
  }
  const tree = shared(size), missing = shared(Kv * A);
  const keysPerChunk = Math.max(1, Math.floor(TREE_CHUNK_VALUES / (2 * R * A)));
  await (0, import_resident5.map)(treeKernel(nm, variance), {
    pool,
    n: Kv,
    args: { R },
    bufs: [
      { buffer: fin.buffer, type: "f64" },
      { buffer: tree.buffer, type: "f64" },
      { buffer: missing.buffer, type: "f64" }
    ],
    priority: import_resident.Priority.Low,
    chunkRows: keysPerChunk
  });
  return { field: field2, sig: otherSignature(params2, field2), R, Kv, A, nm, variance, tree, missing, bidx, buildMs: performance.now() - t03, kernels: /* @__PURE__ */ new Map() };
}
function rangeInto(state, kv, l, r, out, o) {
  const { R, A, nm, variance, tree } = state;
  const base = kv * 2 * R;
  for (l += R, r += R + 1; l < r; l >>= 1, r >>= 1) {
    if (l & 1) mergeRecord(out, o, tree, (base + l++) * A, nm, variance);
    if (r & 1) mergeRecord(out, o, tree, (base + --r) * A, nm, variance);
  }
}
async function answerPreagg(state, pool, table, params2) {
  const plan = await planAggregate(pool, table, params2);
  const { R, Kv, bidx } = state;
  if (plan.K !== Kv) throw new Error("pre-aggregate does not match the view's key space");
  const A = plan.A, nm = plan.spec.measures.length, variance = plan.spec.variance;
  if (A !== state.A) throw new Error("pre-aggregate does not match the view's measures");
  const out = new Float64Array(Kv * A);
  initRegion(out, 0, Kv, nm);
  const pred = (params2.filter ?? []).find((p) => p && p.field === state.field);
  const active = pred && pred.range != null && pred.range.length >= 2;
  if (!active) {
    for (let kv = 0; kv < Kv; kv++) {
      rangeInto(state, kv, 0, R - 1, out, kv * A);
      mergeRecord(out, kv * A, state.missing, kv * A, nm, variance);
    }
    return { rows: emitRows(plan, out), boundaryRows: 0 };
  }
  const a = +pred.range[0], b = +pred.range[1];
  const lo = Math.min(a, b), hi = Math.max(a, b);
  const bl = bucketOf(lo, bidx.lo, bidx.hi, bidx.scale, R);
  const bh = bucketOf(hi, bidx.lo, bidx.hi, bidx.scale, R);
  if (bh > bl + 1) for (let kv = 0; kv < Kv; kv++) rangeInto(state, kv, bl + 1, bh - 1, out, kv * A);
  const sig = kernelSignature(plan.spec, true);
  let kernel = state.kernels.get(sig);
  if (!kernel) {
    kernel = compileKernel(plan.spec, true);
    state.kernels.set(sig, kernel);
  }
  const cols = plan.cols.map((k) => table.viewByKey(k));
  const edge = new Float64Array(Kv * A);
  initRegion(edge, 0, Kv, nm);
  const { perm, offsets } = bidx;
  kernel(cols, plan.sets, plan.fp, edge, 0, offsets[bl], offsets[bl + 1], perm);
  let boundaryRows = offsets[bl + 1] - offsets[bl];
  if (bh !== bl) {
    kernel(cols, plan.sets, plan.fp, edge, 0, offsets[bh], offsets[bh + 1], perm);
    boundaryRows += offsets[bh + 1] - offsets[bh];
  }
  for (let kv = 0; kv < Kv; kv++) mergeRecord(out, kv * A, edge, kv * A, nm, variance);
  return { rows: emitRows(plan, out), boundaryRows };
}

// src/table.ts
var import_resident6 = __toESM(require_resident());
var import_resident7 = __toESM(require_resident());
var EXTENT_KERNEL = { key: "pv:extent", src: "const c = cols[0]; let lo = Infinity, hi = -Infinity;\nfor (let i = start; i < end; i++) { const v = c[i]; if (v < lo) lo = v; if (v > hi) hi = v; }\nreturn [lo, hi];" };
var extentOf = (a, b) => [Math.min(a[0], b[0]), Math.max(a[1], b[1])];
var MAX_EXPR_DICT = 1 << 16;
var tableCounter = 0;
function sharedF64(n) {
  return new Float64Array(new SharedArrayBuffer(Float64Array.BYTES_PER_ELEMENT * n));
}
function sharedI32(n) {
  return new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * n));
}
var ColumnTable = class _ColumnTable {
  constructor(length, getter2, raw) {
    this.f64 = /* @__PURE__ */ new Map();
    this.dict = /* @__PURE__ */ new Map();
    this.exprCols = /* @__PURE__ */ new Map();
    this.extentPending = /* @__PURE__ */ new Map();
    this.bucketIndexes = /* @__PURE__ */ new Map();
    /**
     * Keeps the current values of a field of the tuples (tuple tables only).
     * Vega's formula and other transforms write their output fields into the
     * input tuples in place; when a derived field overwrites an input field,
     * every read of the input field (columns, kernels, main thread) must still
     * see the value it had before, as Vega's own operators do when they run in
     * order. Called before the first write of such a field.
     */
    this.preserveField = () => {
    };
    /** True when the original values of `field` are kept (it was overwritten in the tuples). */
    this.isPreserved = () => false;
    this.id = "t" + ++tableCounter;
    this.length = length;
    this.getter = getter2;
    this.raw = raw;
  }
  /** Row-oriented input, as found in a Vega pulse. */
  static fromTuples(tuples) {
    const preserved = /* @__PURE__ */ new Map();
    const t = new _ColumnTable(tuples.length, (field2) => {
      const p = preserved.get(field2);
      return p ? (i) => p[i] : (i) => tuples[i][field2];
    }, null);
    const checked = /* @__PURE__ */ new Set();
    t.preserveField = (field2) => {
      if (checked.has(field2)) return;
      checked.add(field2);
      let present = false;
      for (let i = 0; i < tuples.length && !present; i++) present = tuples[i][field2] !== void 0;
      if (present) preserved.set(field2, tuples.map((r) => r[field2]));
    };
    t.isPreserved = (field2) => preserved.has(field2);
    return t;
  }
  /** Column-oriented input; Float64Arrays over a SharedArrayBuffer are used without copying. */
  static fromColumns(columns) {
    const names = Object.keys(columns);
    const length = names.length ? columns[names[0]].length : 0;
    for (const n of names) {
      if (columns[n].length !== length) {
        throw new Error(`column ${n} has length ${columns[n].length}, expected ${length}`);
      }
    }
    return new _ColumnTable(length, (field2) => {
      const c = columns[field2];
      if (!c) throw new Error(`unknown column: ${field2}`);
      return (i) => c[i];
    }, columns);
  }
  numeric(field2) {
    let col = this.f64.get(field2);
    if (col) return col;
    const raw = this.raw && this.raw[field2];
    let view;
    if (raw instanceof Float64Array && raw.buffer instanceof SharedArrayBuffer) {
      view = raw;
    } else if (raw && ArrayBuffer.isView(raw)) {
      view = sharedF64(this.length);
      view.set(raw);
    } else {
      view = sharedF64(this.length);
      const get = this.getter(field2);
      for (let i = 0; i < this.length; i++) {
        const v = get(i);
        view[i] = v == null || v === "" ? NaN : +v;
      }
    }
    col = { key: `${this.id}:f64:${field2}`, view };
    this.f64.set(field2, col);
    return col;
  }
  /**
   * The field as a compiled expression reads it (see ExprColumn), or null
   * when its values cannot be represented exactly (objects, or more than
   * MAX_EXPR_DICT distinct non-numeric values).
   */
  exprColumn(field2) {
    if (this.exprCols.has(field2)) return this.exprCols.get(field2);
    const col = this.buildExprColumn(field2);
    this.exprCols.set(field2, col);
    return col;
  }
  buildExprColumn(field2) {
    const raw = this.raw && this.raw[field2];
    const nanIn = (v) => {
      for (let i = 0; i < v.length; i++) if (v[i] !== v[i]) return true;
      return false;
    };
    if (raw && ArrayBuffer.isView(raw) && !(raw instanceof BigInt64Array) && !(raw instanceof BigUint64Array)) {
      const c = this.numeric(field2);
      if (nanIn(c.view)) {
        const tag = new Uint8Array(new SharedArrayBuffer(Math.max(1, c.view.length)));
        for (let i = 0; i < c.view.length; i++) if (c.view[i] !== c.view[i]) tag[i] = 1;
        return { kind: "num", key: c.key, view: c.view, tag, tagKey: c.key + ":tag", hasNaN: false };
      }
      return { kind: "num", key: c.key, view: c.view, hasNaN: false };
    }
    const get = this.getter(field2);
    const n = this.length;
    let numeric = true, missing = false;
    for (let i = 0; i < n; i++) {
      const v = get(i);
      if (typeof v === "number") continue;
      if (v == null) {
        missing = true;
        continue;
      }
      numeric = false;
      break;
    }
    if (numeric && !missing) {
      const c = this.numeric(field2);
      return { kind: "num", key: c.key, view: c.view, hasNaN: nanIn(c.view) };
    }
    if (numeric) {
      const view2 = sharedF64(n);
      const tag = new Uint8Array(new SharedArrayBuffer(Math.max(1, n)));
      let hasNaN = false;
      for (let i = 0; i < n; i++) {
        const v = get(i);
        if (typeof v === "number") {
          view2[i] = v;
          if (v !== v) hasNaN = true;
        } else {
          view2[i] = NaN;
          tag[i] = v === null ? 1 : 2;
        }
      }
      const key2 = `${this.id}:xnum:${field2}`;
      return { kind: "num", key: key2, view: view2, tag, tagKey: key2 + ":tag", hasNaN };
    }
    let dates0 = true;
    for (let i = 0; i < n; i++) {
      const v = get(i);
      if (v != null && !(v instanceof Date)) {
        dates0 = false;
        break;
      }
    }
    if (dates0) {
      const view2 = sharedF64(n);
      const tag = new Uint8Array(new SharedArrayBuffer(Math.max(1, n)));
      for (let i = 0; i < n; i++) {
        const v = get(i);
        if (v instanceof Date) view2[i] = +v;
        else {
          view2[i] = NaN;
          tag[i] = v === null ? 1 : 2;
        }
      }
      const key2 = `${this.id}:xdate:${field2}`;
      return { kind: "date", key: key2, view: view2, tag, tagKey: key2 + ":tag" };
    }
    const codes = /* @__PURE__ */ new Map();
    const values = [];
    const dates = /* @__PURE__ */ new Map();
    const view = sharedI32(n);
    for (let i = 0; i < n; i++) {
      const v = get(i);
      let c;
      if (v instanceof Date) {
        const t = +v;
        c = dates.get(t);
        if (c === void 0) {
          c = values.length;
          dates.set(t, c);
          values.push(new Date(t));
        }
      } else {
        if (v !== null && typeof v === "object") return null;
        if (typeof v === "function" || typeof v === "symbol" || typeof v === "bigint") return null;
        c = codes.get(v);
        if (c === void 0) {
          c = values.length;
          codes.set(v, c);
          values.push(v);
        }
      }
      if (values.length > MAX_EXPR_DICT) return null;
      view[i] = c;
    }
    return { kind: "dict", key: `${this.id}:xdict:${field2}`, view, values };
  }
  dictionary(field2) {
    let col = this.dict.get(field2);
    if (col) return col;
    const get = this.getter(field2);
    const codes = /* @__PURE__ */ new Map();
    const values = [];
    const view = sharedI32(this.length);
    let sawNull = false;
    const NULL = -1;
    for (let i = 0; i < this.length; i++) {
      const v = get(i);
      if (v === null) {
        view[i] = NULL;
        sawNull = true;
        continue;
      }
      const k = v instanceof Date ? +v : v;
      let c = codes.get(k);
      if (c === void 0) {
        c = values.length;
        codes.set(k, c);
        values.push(v);
      }
      view[i] = c;
    }
    const nullCode = values.length;
    if (sawNull) {
      for (let i = 0; i < this.length; i++) if (view[i] === NULL) view[i] = nullCode;
    }
    values.push(null);
    col = { key: `${this.id}:i32:${field2}`, view, values, codes, card: values.length };
    this.dict.set(field2, col);
    return col;
  }
  /** Min/max of a numeric field, computed in parallel and cached. */
  extent(field2, pool) {
    const col = this.numeric(field2);
    if (col.extent) return Promise.resolve(col.extent);
    let p = this.extentPending.get(field2);
    if (p) return p;
    pool.ensureColumn(col.key, "f64", col.view.buffer);
    p = (0, import_resident7.reduce)(EXTENT_KERNEL, { pool, n: this.length, cols: [col.key], combine: extentOf, identity: [Infinity, -Infinity] }).then(([lo, hi]) => {
      col.extent = [lo, hi];
      this.extentPending.delete(field2);
      return col.extent;
    });
    this.extentPending.set(field2, p);
    return p;
  }
  /** Column names of a table registered from columns (empty for tuple tables). */
  fieldNames() {
    return this.raw ? Object.keys(this.raw) : [];
  }
  /** Raw value of `field` in row i (as given at registration, not coerced). */
  value(field2, i) {
    return this.getter(field2)(i);
  }
  /** Main-thread view of a column by its key (for boundary scans). */
  viewByKey(key2) {
    for (const c of this.f64.values()) if (c.key === key2) return c.view;
    for (const c of this.dict.values()) if (c.key === key2) return c.view;
    for (const c of this.exprCols.values()) {
      if (!c) continue;
      if (c.key === key2) return c.view;
      if (c.kind !== "dict" && c.tagKey === key2) return c.tag;
    }
    throw new Error(`unknown column key: ${key2}`);
  }
  /**
   * Parallel counting sort of row ids by bucket of `field`:
   * per-worker bucket histograms (Map), exclusive prefix sums over
   * (bucket, worker) on the main thread (Scan), then each worker writes its
   * row ids at its offsets (Scatter).
   */
  bucketIndex(field2, R, pool, priority = import_resident.Priority.High, chunkRows = 0) {
    const cacheKey = `${field2}:${R}`;
    let p = this.bucketIndexes.get(cacheKey);
    if (p) return p;
    p = (async () => {
      const t03 = performance.now();
      const col = this.numeric(field2);
      const [lo, ext1] = await this.extent(field2, pool);
      const hi = ext1 > lo ? ext1 : lo + 1;
      const scale = R / (hi - lo);
      const n = this.length;
      pool.ensureColumn(col.key, "f64", col.view.buffer);
      const { perm, offsets } = await (0, import_resident6.residentCountingSort)(pool, col.key, n, { lo, hi, scale, R }, { priority, chunkRows });
      return { field: field2, R, lo, hi, scale, perm, offsets, buildMs: performance.now() - t03 };
    })();
    this.bucketIndexes.set(cacheKey, p);
    return p;
  }
  columnKeys() {
    const keys = [...this.f64.values(), ...this.dict.values()].map((c) => c.key);
    for (const c of this.exprCols.values()) {
      if (!c) continue;
      keys.push(c.key);
      if (c.kind !== "dict" && c.tagKey) keys.push(c.tagKey);
    }
    return [...new Set(keys)];
  }
  /** Release worker-side references; call when the table is replaced. */
  dispose(pool) {
    if (pool) pool.dropColumns(this.columnKeys());
    this.f64.clear();
    this.dict.clear();
    this.exprCols.clear();
    this.bucketIndexes.clear();
  }
};

// src/filter.ts
var import_resident8 = __toESM(require_resident());
var import_resident9 = __toESM(require_resident());
async function runFilter(pool, table, filter, state) {
  if (state.n !== table.length) throw new Error("pwfilter: state does not match table length");
  const plan = await planAggregate(pool, table, { filter });
  return (0, import_resident8.filter)(filterPredicate(plan.spec.filters), state, {
    pool,
    cols: plan.cols,
    args: { fp: plan.fp, sets: plan.sets }
  });
}

// src/transforms.ts
var BIN_PARAMS = [
  { name: "field", type: "string", required: true },
  { name: "extent", type: "number", array: true, length: 2 },
  { name: "maxbins", type: "number" },
  { name: "step", type: "number" },
  { name: "steps", type: "number", array: true },
  { name: "minstep", type: "number" },
  { name: "nice", type: "boolean" },
  { name: "anchor", type: "number" },
  { name: "base", type: "number" },
  { name: "divide", type: "number", array: true },
  { name: "span", type: "number" },
  { name: "as", type: "string", array: true, length: 2 }
];
var FILTER_PARAMS = [
  { name: "field", type: "string", required: true },
  { name: "range", type: "number", array: true, length: 2 },
  { name: "oneOf", type: "string", array: true }
];
function plain(obj, keys) {
  if (obj == null) return obj;
  const out = {};
  for (const k of keys) if (obj[k] !== void 0) out[k] = obj[k];
  return out;
}
var AggregateEngine = class {
  constructor(rt) {
    this.rt = rt;
    this.scratch = {};
    this.prevFilter = null;
    this.pre = null;
    this.preBuild = null;
    this.preScratch = {};
    this.preTable = null;
    /** Moving average of this view's scan time (ms). */
    this.scanMs = 0;
  }
  reset() {
    this.pre = null;
    this.preBuild = null;
    this.prevFilter = null;
  }
  run(table, params2, opts, stats) {
    const rt = this.rt;
    const pool = rt.pool();
    const name = opts.name;
    const t03 = performance.now();
    const usePre = (opts.preagg ?? rt.preagg) && preaggEligible(params2);
    const snap = filterSnapshot(params2);
    const field2 = usePre ? activeField(this.prevFilter, snap, params2) : null;
    this.prevFilter = snap;
    if (table !== this.preTable) {
      this.pre = null;
      this.preBuild = null;
      this.preTable = table;
    }
    const gpu = rt.gpu ? rt.gpu() : null;
    const index = (state) => answerPreagg(state, pool, table, params2).then((ans) => {
      Object.assign(stats, {
        rows: table.length,
        threads: 0,
        groups: ans.rows.length,
        keys: state.Kv,
        mergeMode: "single",
        path: "index",
        boundaryRows: ans.boundaryRows
      });
      return ans.rows;
    });
    const scan = () => runAggregate(pool, table, params2, this.scratch, stats, gpu);
    let compute;
    if (field2) {
      const sig = otherSignature(params2, field2);
      const ready = this.pre && this.pre.field === field2 && this.pre.sig === sig ? this.pre : null;
      const building = this.preBuild && this.preBuild.field === field2 && this.preBuild.sig === sig ? this.preBuild.promise : null;
      if (ready) {
        compute = index(ready);
      } else if (building && this.scanMs > 0 && pool.lowPendingMs() <= this.scanMs) {
        compute = building.then((state) => state ? index(state) : scan());
      } else if (building) {
        compute = scan();
      } else {
        compute = scan();
        const promise = buildPreagg(pool, table, params2, field2, this.preScratch, opts.resolution).then((st) => {
          this.pre = st;
          if (rt.onBuild) rt.onBuild({ name, field: field2, R: st.R, buildMs: st.buildMs, bucketIndexMs: st.bidx.buildMs });
          return st;
        }).catch((err) => {
          console.warn("paraweb-vega: pre-aggregation failed:", err);
          return null;
        });
        this.preBuild = { field: field2, sig, promise };
      }
    } else {
      compute = scan();
    }
    return compute.then((rows) => {
      if (stats.path === "scan" || stats.path === "gpu") {
        const ms = performance.now() - t03;
        this.scanMs = this.scanMs ? 0.7 * this.scanMs + 0.3 * ms : ms;
      }
      if (rt.onStats) rt.onStats({ ...stats, ms: performance.now() - t03, name });
      return rows;
    });
  }
};
function definePwAggregate(vega, rt) {
  function PwAggregate(params2) {
    vega.Transform.call(this, null, params2);
    this._table = null;
    this._tableSource = null;
    this._out = [];
    this._engine = new AggregateEngine(rt);
  }
  PwAggregate.Definition = {
    type: "PwAggregate",
    metadata: { generates: true, changes: true },
    params: [
      { name: "table", type: "string" },
      { name: "name", type: "string" },
      { name: "groupby", type: "string", array: true },
      { name: "bins", type: "param", array: true, params: [{ key: {}, params: BIN_PARAMS }] },
      { name: "ops", type: "enum", array: true, values: [...SUPPORTED_OPS] },
      { name: "fields", type: "string", array: true },
      { name: "as", type: "string", array: true },
      { name: "filter", type: "param", array: true, params: [{ key: {}, params: FILTER_PARAMS }] },
      { name: "preagg", type: "boolean" },
      { name: "preaggResolution", type: "number" }
    ]
  };
  vega.inherits(PwAggregate, vega.Transform, {
    transform(_, pulse) {
      const pool = rt.pool();
      let table;
      if (_.table) {
        const t = rt.table(_.table);
        if (!t) throw new Error(`pwaggregate: no table registered as "${_.table}"`);
        table = t;
      } else {
        if (!this._table || pulse.changed()) {
          const p = pulse.materialize(pulse.SOURCE);
          let src = p.source;
          if (!src) {
            src = [];
            pulse.visit(pulse.SOURCE, (t) => {
              src.push(t);
            });
          }
          if (src !== this._tableSource || pulse.changed()) {
            if (this._table) this._table.dispose(pool);
            this._table = ColumnTable.fromTuples(src);
            this._tableSource = src;
            this._engine.reset();
          }
        }
        table = this._table;
      }
      const params2 = {
        groupby: _.groupby,
        bins: (_.bins ?? []).map((b) => plain(b, BIN_PARAMS.map((p) => p.name))),
        ops: _.ops,
        fields: _.fields,
        as: _.as,
        filter: (_.filter ?? []).map((f) => plain(f, FILTER_PARAMS.map((p) => p.name)))
      };
      const name = _.name;
      const out = pulse.fork(pulse.NO_SOURCE | pulse.NO_FIELDS);
      const stats = {};
      const compute = this._engine.run(table, params2, { name, preagg: _.preagg, resolution: _.preaggResolution }, stats);
      return compute.then((rows) => {
        out.rem = this._out;
        this._out = out.add = rows.map((r) => vega.ingest(r));
        if (rows.length) out.modifies(Object.keys(rows[0]));
        return out;
      });
    }
  });
  return PwAggregate;
}
function definePwFilter(vega, rt) {
  function PwFilter(params2) {
    vega.Transform.call(this, null, params2);
    this._table = null;
    this._src = null;
    this._state = null;
    this._rows = /* @__PURE__ */ new Map();
  }
  PwFilter.Definition = {
    type: "PwFilter",
    metadata: { changes: true, generates: true },
    params: [
      { name: "table", type: "string" },
      { name: "name", type: "string" },
      { name: "filter", type: "param", array: true, params: [{ key: {}, params: FILTER_PARAMS }] },
      { name: "fields", type: "string", array: true }
    ]
  };
  vega.inherits(PwFilter, vega.Transform, {
    transform(_, pulse) {
      const pool = rt.pool();
      const out = pulse.fork(pulse.NO_FIELDS);
      let table;
      let tuples = null;
      if (_.table) {
        const t = rt.table(_.table);
        if (!t) throw new Error(`pwfilter: no table registered as "${_.table}"`);
        if (t !== this._table) {
          for (const tup of this._rows.values()) out.rem.push(tup);
          this._rows.clear();
          this._table = t;
          this._state = new import_resident9.FilterState(t.length);
        }
        table = t;
      } else {
        if (!this._table || pulse.changed()) {
          if (this._src && this._state) {
            const m = this._state.mask;
            for (let i = 0; i < this._src.length; i++) if (m[i]) out.rem.push(this._src[i]);
          }
          const p = pulse.materialize(pulse.SOURCE);
          let src = p.source;
          if (!src) {
            src = [];
            pulse.visit(pulse.SOURCE, (t) => {
              src.push(t);
            });
          }
          if (this._table) this._table.dispose(pool);
          this._table = ColumnTable.fromTuples(src);
          this._src = src;
          this._state = new import_resident9.FilterState(src.length);
        }
        table = this._table;
        tuples = this._src;
      }
      const filter = (_.filter ?? []).map((f) => plain(f, FILTER_PARAMS.map((p) => p.name)));
      const fields = _.fields && _.fields.length ? _.fields : table.fieldNames();
      const name = _.name;
      const state = this._state;
      const t03 = performance.now();
      return runFilter(pool, table, filter, state).then((delta) => {
        if (tuples) {
          for (const i of delta.add) out.add.push(tuples[i]);
          for (const i of delta.rem) out.rem.push(tuples[i]);
        } else {
          for (const i of delta.rem) {
            const tup = this._rows.get(i);
            if (tup) {
              out.rem.push(tup);
              this._rows.delete(i);
            }
          }
          for (const i of delta.add) {
            const row = {};
            for (const f of fields) row[f] = table.value(f, i);
            const tup = vega.ingest(row);
            this._rows.set(i, tup);
            out.add.push(tup);
          }
        }
        if (rt.onStats) {
          rt.onStats({
            rows: table.length,
            threads: delta.threads,
            groups: state.selected,
            keys: 0,
            mergeMode: "single",
            path: "scan",
            ms: performance.now() - t03,
            name,
            added: delta.add.length,
            removed: delta.rem.length
          });
        }
        return out;
      });
    }
  });
  return PwFilter;
}

// src/runtime/expr.ts
var PUNCT3 = ["===", "!==", ">>>", "..."];
var PUNCT2 = ["==", "!=", "<=", ">=", "&&", "||", "<<", ">>", "**", "?."];
function tokenize(src) {
  const out = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (/\s/.test(c)) {
      let j = i + 1;
      while (j < n && /\s/.test(src[j])) j++;
      out.push({ t: "ws", v: src.slice(i, j) });
      i = j;
    } else if (/[A-Za-z_$]/.test(c)) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_$]/.test(src[j])) j++;
      out.push({ t: "id", v: src.slice(i, j) });
      i = j;
    } else if (/[0-9]/.test(c) || c === "." && /[0-9]/.test(src[i + 1] ?? "")) {
      let j = i + 1;
      while (j < n && /[0-9a-fA-FxXoObBeE.]/.test(src[j])) {
        if ((src[j] === "e" || src[j] === "E") && (src[j + 1] === "+" || src[j + 1] === "-")) j++;
        j++;
      }
      out.push({ t: "num", v: src.slice(i, j) });
      i = j;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c) j += src[j] === "\\" ? 2 : 1;
      if (j >= n) return null;
      out.push({ t: "str", v: src.slice(i, j + 1) });
      i = j + 1;
    } else if (c === "`" || c === "/") {
      if (c === "/") {
        out.push({ t: "punct", v: c });
        i++;
        continue;
      }
      return null;
    } else {
      const three = src.slice(i, i + 3), two = src.slice(i, i + 2);
      const p = PUNCT3.includes(three) ? three : PUNCT2.includes(two) ? two : c;
      out.push({ t: "punct", v: p });
      i += p.length;
    }
  }
  return out;
}
var LIBRARY = {
  isValid: "(_) => _ != null && _ === _",
  isDefined: "(_) => _ !== undefined",
  isNumber: "(_) => typeof _ === 'number'",
  isString: "(_) => typeof _ === 'string'",
  isBoolean: "(_) => typeof _ === 'boolean'",
  isDate: "(_) => Object.prototype.toString.call(_) === '[object Date]'",
  isArray: "Array.isArray",
  toNumber: "(_) => _ == null || _ === '' ? null : +_",
  toString: "(_) => _ == null || _ === '' ? null : _ + ''",
  toBoolean: "(_) => _ == null || _ === '' ? null : !_ || _ === 'false' || _ === '0' ? false : !!_",
  toDate: "(_) => _ == null || _ === '' ? null : (typeof _ === 'number' ? _ : Object.prototype.toString.call(_) === '[object Date]' ? _ : Date.parse(_))",
  inrange: `(value, range, left, right) => {
    let r0 = range[0], r1 = range[range.length - 1], t;
    if (r0 > r1) { t = r0; r0 = r1; r1 = t; }
    left = left === undefined || left; right = right === undefined || right;
    return (left ? r0 <= value : r0 < value) && (right ? value <= r1 : value < r1); }`,
  indexof: "(seq, ...a) => (Array.isArray(seq) || typeof seq === 'string' ? seq : []).indexOf(...a)",
  lastindexof: "(seq, ...a) => (Array.isArray(seq) || typeof seq === 'string' ? seq : []).lastIndexOf(...a)",
  lerp: "(array, frac) => { const lo = array[0], hi = array[array.length - 1]; return lo + frac * (hi - lo); }",
  span: "(array) => array && array.length ? array[array.length - 1] - array[0] : 0",
  // Helpers of specialized Vega-Lite selection tests (see selection.ts).
  vlDnum: "(x) => Object.prototype.toString.call(x) === '[object Date]' ? +x : x",
  vlIncl: "(arr, x) => arr.includes(x)"
};
var GLOBALS = /* @__PURE__ */ new Set([
  "Math",
  "Number",
  "String",
  "Boolean",
  "Date",
  "NaN",
  "Infinity",
  "undefined",
  "null",
  "true",
  "false",
  "new",
  "typeof",
  "in",
  "void",
  "isNaN",
  "isFinite",
  "parseInt",
  "parseFloat"
]);
function strValue(tok) {
  return JSON.parse(tok.v[0] === "'" ? '"' + tok.v.slice(1, -1).replace(/"/g, '\\"') + '"' : tok.v);
}
function analyze(code) {
  const info = { code, fields: [], params: [], fns: [], unsupported: null, tokens: [] };
  const toks = tokenize(code);
  if (!toks) {
    info.unsupported = "literal";
    return info;
  }
  info.tokens = toks;
  const sig = toks.filter((t) => t.t !== "ws");
  const add = (a, v) => {
    if (!a.includes(v)) a.push(v);
  };
  for (let k = 0; k < sig.length; k++) {
    const tk = sig[k];
    if (tk.t !== "id") continue;
    const prev = sig[k - 1];
    if (prev && prev.t === "punct" && (prev.v === "." || prev.v === "?.")) continue;
    const next = sig[k + 1], next2 = sig[k + 2], next3 = sig[k + 3];
    if (tk.v === "datum") {
      if (next && next.v === "." && next2 && next2.t === "id") add(info.fields, next2.v);
      else if (next && next.v === "[" && next2 && next2.t === "str" && next3 && next3.v === "]") add(info.fields, strValue(next2));
      else {
        info.unsupported = "datum";
        return info;
      }
    } else if (tk.v === "_") {
      if (next && next.v === "[" && next2 && next2.t === "str" && next3 && next3.v === "]") add(info.params, strValue(next2));
      else {
        info.unsupported = "params";
        return info;
      }
    } else if (tk.v === "this") {
      if (next && next.v === "." && next2 && next2.t === "id" && LIBRARY[next2.v]) add(info.fns, next2.v);
      else {
        info.unsupported = "function " + (next2 ? next2.v : "this");
        return info;
      }
    } else if (!GLOBALS.has(tk.v)) {
      info.unsupported = "identifier " + tk.v;
      return info;
    }
  }
  return info;
}
function emit(info, field2) {
  const toks = info.tokens;
  const out = [];
  const sigIdx = [];
  toks.forEach((t, i) => {
    if (t.t !== "ws") sigIdx.push(i);
  });
  const at = (s2) => s2 < sigIdx.length ? toks[sigIdx[s2]] : void 0;
  let s = 0;
  while (s < sigIdx.length) {
    const tk = at(s);
    const prev = at(s - 1);
    const isProp = prev && prev.t === "punct" && (prev.v === "." || prev.v === "?.");
    if (tk.t === "id" && !isProp && tk.v === "datum") {
      const nx = at(s + 1);
      if (nx.v === ".") {
        out.push("(" + field2(at(s + 2).v) + ")");
        s += 3;
        continue;
      }
      out.push("(" + field2(strValue(at(s + 2))) + ")");
      s += 4;
      continue;
    }
    if (tk.t === "id" && !isProp && tk.v === "_") {
      out.push("P[" + at(s + 2).v + "]");
      s += 4;
      continue;
    }
    if (tk.t === "id" && !isProp && tk.v === "this") {
      out.push("F." + at(s + 2).v);
      s += 3;
      continue;
    }
    out.push(tk.t === "id" || tk.t === "num" ? " " + tk.v + " " : tk.v);
    s++;
  }
  return out.join("");
}
function libraryPrelude(fns) {
  const parts = [];
  for (const f of fns) parts.push(`${f}: ${LIBRARY[f]}`);
  return `const F = {${parts.join(",\n")}};`;
}
function conjuncts(code) {
  const strip = (s) => {
    s = s.trim();
    while (s.startsWith("(") && s.endsWith(")") && matching(s) === s.length - 1) s = s.slice(1, -1).trim();
    return s;
  };
  const matching = (s) => {
    let d = 0, q = null;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (q) {
        if (c === "\\") i++;
        else if (c === q) q = null;
        continue;
      }
      if (c === '"' || c === "'") q = c;
      else if (c === "(") d++;
      else if (c === ")") {
        d--;
        if (d === 0) return i;
      }
    }
    return -1;
  };
  const split = (s) => {
    const parts = [];
    let d = 0, q = null, last = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (q) {
        if (c === "\\") i++;
        else if (c === q) q = null;
        continue;
      }
      if (c === '"' || c === "'") q = c;
      else if (c === "(" || c === "[" || c === "{") d++;
      else if (c === ")" || c === "]" || c === "}") d--;
      else if (d === 0 && c === "&" && s[i + 1] === "&") {
        parts.push(s.slice(last, i));
        last = i + 2;
        i++;
      } else if (d === 0 && (c === "|" && s[i + 1] === "|" || c === "?")) return [s];
    }
    parts.push(s.slice(last));
    return parts;
  };
  const out = [];
  const walk = (s) => {
    const t = strip(s);
    const p = split(t);
    if (p.length === 1) out.push(t);
    else p.forEach(walk);
  };
  walk(code);
  return out;
}
var FIELD = String.raw`datum(?:\.([A-Za-z_$][\w$]*)|\["([^"\\]+)"\])`;
var PARAM = String.raw`_\["([^"\\]+)"\]`;
var RANGE_RE = new RegExp(
  String.raw`^\(?\s*!\s*${PARAM}\s*\)?\s*\|\|\s*\(\s*\(\s*${FIELD}\s*>=\s*${PARAM}\s*\[\s*0\s*\]\s*\)\s*&&\s*\(\s*${FIELD}\s*<=\s*${PARAM}\s*\[\s*1\s*\]\s*\)\s*\)$`
);
function matchRange(conj) {
  const m = RANGE_RE.exec(conj.replace(/\s+/g, " ").trim());
  if (!m) return null;
  const p0 = m[1], f1 = m[2] ?? m[3], p1 = m[4], f2 = m[5] ?? m[6], p2 = m[7];
  if (p0 !== p1 || p1 !== p2 || f1 !== f2) return null;
  return { field: f1, param: p0 };
}

// src/runtime/relation.ts
var import_resident10 = __toESM(require_resident());

// node_modules/vega-util/build/accessor.js
function accessor(fn, fields, name) {
  return Object.assign(fn, {
    fields: fields || [],
    fname: name
  });
}

// node_modules/vega-util/build/getter.js
function getter(path) {
  return path.length === 1 ? get1(path[0]) : getN(path);
}
var get1 = (field2) => function(obj) {
  return obj[field2];
};
var getN = (path) => {
  const len = path.length;
  return function(obj) {
    for (let i = 0; i < len; ++i) {
      obj = obj[path[i]];
    }
    return obj;
  };
};

// node_modules/vega-util/build/error.js
function error(message) {
  throw Error(message);
}

// node_modules/vega-util/build/splitAccessPath.js
function splitAccessPath(p) {
  const path = [], n = p.length;
  let q = null, b = 0, s = "";
  let i;
  let j;
  let c;
  p = p + "";
  function push() {
    path.push(s + p.substring(i, j));
    s = "";
    i = j + 1;
  }
  for (i = j = 0; j < n; ++j) {
    c = p[j];
    if (c === "\\") {
      s += p.substring(i, j++);
      i = j;
    } else if (c === q) {
      push();
      q = null;
      b = -1;
    } else if (q) {
      continue;
    } else if (i === b && c === '"') {
      i = j + 1;
      q = c;
    } else if (i === b && c === "'") {
      i = j + 1;
      q = c;
    } else if (c === "." && !b) {
      if (j > i) {
        push();
      } else {
        i = j + 1;
      }
    } else if (c === "[") {
      if (j > i)
        push();
      b = i = j + 1;
    } else if (c === "]") {
      if (!b)
        error("Access path missing open bracket: " + p);
      if (b > 0)
        push();
      b = 0;
      i = j + 1;
    }
  }
  if (b)
    error("Access path missing closing bracket: " + p);
  if (q)
    error("Access path missing closing quote: " + p);
  if (j > i) {
    j++;
    push();
  }
  return path;
}

// node_modules/vega-util/build/field.js
function field(field2, name, opt) {
  const path = splitAccessPath(field2);
  const fieldName = path.length === 1 ? path[0] : field2;
  return accessor((opt && opt.get || getter)(path), [fieldName], name || fieldName);
}

// node_modules/vega-util/build/accessors.js
var id = field("id");
var identity = accessor((_) => _, [], "identity");
var zero2 = accessor(() => 0, [], "zero");
var one = accessor(() => 1, [], "one");
var truthy = accessor(() => true, [], "true");
var falsy = accessor(() => false, [], "false");

// node_modules/vega-util/build/interpreter.js
var DisallowedObjectProperties = /* @__PURE__ */ new Set([
  ...Object.getOwnPropertyNames(Object.prototype).filter((name) => typeof Object.prototype[name] === "function"),
  "__proto__",
  "then"
]);

// node_modules/vega-util/build/isArray.js
var isArray = Array.isArray;

// node_modules/vega-util/build/peek.js
function peek(array2) {
  return array2[array2.length - 1];
}

// node_modules/vega-util/build/array.js
function array_default(_) {
  return _ != null ? isArray(_) ? _ : [_] : [];
}

// node_modules/vega-util/build/isFunction.js
function isFunction(value) {
  return typeof value === "function";
}

// node_modules/vega-util/build/constant.js
function constant_default(_) {
  return isFunction(_) ? _ : () => _;
}

// node_modules/vega-util/build/hasOwnProperty.js
function hasOwnProperty(object, property) {
  return Object.hasOwn(object, property);
}

// node_modules/vega-util/build/toSet.js
function toSet(_) {
  const s = {}, n = _.length;
  for (let i = 0; i < n; ++i)
    s[_[i] + ""] = true;
  return s;
}

// node_modules/d3-time/dist/d3-time.mjs
var t0 = /* @__PURE__ */ new Date();
var t1 = /* @__PURE__ */ new Date();
function timeInterval(floori, offseti, count, field2) {
  function interval(date) {
    return floori(date = arguments.length === 0 ? /* @__PURE__ */ new Date() : /* @__PURE__ */ new Date(+date)), date;
  }
  interval.floor = (date) => {
    return floori(date = /* @__PURE__ */ new Date(+date)), date;
  };
  interval.ceil = (date) => {
    return floori(date = new Date(date - 1)), offseti(date, 1), floori(date), date;
  };
  interval.round = (date) => {
    const d0 = interval(date), d1 = interval.ceil(date);
    return date - d0 < d1 - date ? d0 : d1;
  };
  interval.offset = (date, step) => {
    return offseti(date = /* @__PURE__ */ new Date(+date), step == null ? 1 : Math.floor(step)), date;
  };
  interval.range = (start, stop, step) => {
    const range = [];
    start = interval.ceil(start);
    step = step == null ? 1 : Math.floor(step);
    if (!(start < stop) || !(step > 0)) return range;
    let previous;
    do
      range.push(previous = /* @__PURE__ */ new Date(+start)), offseti(start, step), floori(start);
    while (previous < start && start < stop);
    return range;
  };
  interval.filter = (test) => {
    return timeInterval((date) => {
      if (date >= date) while (floori(date), !test(date)) date.setTime(date - 1);
    }, (date, step) => {
      if (date >= date) {
        if (step < 0) while (++step <= 0) {
          while (offseti(date, -1), !test(date)) {
          }
        }
        else while (--step >= 0) {
          while (offseti(date, 1), !test(date)) {
          }
        }
      }
    });
  };
  if (count) {
    interval.count = (start, end) => {
      t0.setTime(+start), t1.setTime(+end);
      floori(t0), floori(t1);
      return Math.floor(count(t0, t1));
    };
    interval.every = (step) => {
      step = Math.floor(step);
      return !isFinite(step) || !(step > 0) ? null : !(step > 1) ? interval : interval.filter(field2 ? (d) => field2(d) % step === 0 : (d) => interval.count(0, d) % step === 0);
    };
  }
  return interval;
}
var millisecond = timeInterval(() => {
}, (date, step) => {
  date.setTime(+date + step);
}, (start, end) => {
  return end - start;
});
millisecond.every = (k) => {
  k = Math.floor(k);
  if (!isFinite(k) || !(k > 0)) return null;
  if (!(k > 1)) return millisecond;
  return timeInterval((date) => {
    date.setTime(Math.floor(date / k) * k);
  }, (date, step) => {
    date.setTime(+date + step * k);
  }, (start, end) => {
    return (end - start) / k;
  });
};
var milliseconds = millisecond.range;
var durationSecond = 1e3;
var durationMinute = durationSecond * 60;
var durationHour = durationMinute * 60;
var durationDay = durationHour * 24;
var durationWeek = durationDay * 7;
var durationMonth = durationDay * 30;
var durationYear = durationDay * 365;
var second = timeInterval((date) => {
  date.setTime(date - date.getMilliseconds());
}, (date, step) => {
  date.setTime(+date + step * durationSecond);
}, (start, end) => {
  return (end - start) / durationSecond;
}, (date) => {
  return date.getUTCSeconds();
});
var seconds = second.range;
var timeMinute = timeInterval((date) => {
  date.setTime(date - date.getMilliseconds() - date.getSeconds() * durationSecond);
}, (date, step) => {
  date.setTime(+date + step * durationMinute);
}, (start, end) => {
  return (end - start) / durationMinute;
}, (date) => {
  return date.getMinutes();
});
var timeMinutes = timeMinute.range;
var utcMinute = timeInterval((date) => {
  date.setUTCSeconds(0, 0);
}, (date, step) => {
  date.setTime(+date + step * durationMinute);
}, (start, end) => {
  return (end - start) / durationMinute;
}, (date) => {
  return date.getUTCMinutes();
});
var utcMinutes = utcMinute.range;
var timeHour = timeInterval((date) => {
  date.setTime(date - date.getMilliseconds() - date.getSeconds() * durationSecond - date.getMinutes() * durationMinute);
}, (date, step) => {
  date.setTime(+date + step * durationHour);
}, (start, end) => {
  return (end - start) / durationHour;
}, (date) => {
  return date.getHours();
});
var timeHours = timeHour.range;
var utcHour = timeInterval((date) => {
  date.setUTCMinutes(0, 0, 0);
}, (date, step) => {
  date.setTime(+date + step * durationHour);
}, (start, end) => {
  return (end - start) / durationHour;
}, (date) => {
  return date.getUTCHours();
});
var utcHours = utcHour.range;
var timeDay = timeInterval(
  (date) => date.setHours(0, 0, 0, 0),
  (date, step) => date.setDate(date.getDate() + step),
  (start, end) => (end - start - (end.getTimezoneOffset() - start.getTimezoneOffset()) * durationMinute) / durationDay,
  (date) => date.getDate() - 1
);
var timeDays = timeDay.range;
var utcDay = timeInterval((date) => {
  date.setUTCHours(0, 0, 0, 0);
}, (date, step) => {
  date.setUTCDate(date.getUTCDate() + step);
}, (start, end) => {
  return (end - start) / durationDay;
}, (date) => {
  return date.getUTCDate() - 1;
});
var utcDays = utcDay.range;
var unixDay = timeInterval((date) => {
  date.setUTCHours(0, 0, 0, 0);
}, (date, step) => {
  date.setUTCDate(date.getUTCDate() + step);
}, (start, end) => {
  return (end - start) / durationDay;
}, (date) => {
  return Math.floor(date / durationDay);
});
var unixDays = unixDay.range;
function timeWeekday(i) {
  return timeInterval((date) => {
    date.setDate(date.getDate() - (date.getDay() + 7 - i) % 7);
    date.setHours(0, 0, 0, 0);
  }, (date, step) => {
    date.setDate(date.getDate() + step * 7);
  }, (start, end) => {
    return (end - start - (end.getTimezoneOffset() - start.getTimezoneOffset()) * durationMinute) / durationWeek;
  });
}
var timeSunday = timeWeekday(0);
var timeMonday = timeWeekday(1);
var timeTuesday = timeWeekday(2);
var timeWednesday = timeWeekday(3);
var timeThursday = timeWeekday(4);
var timeFriday = timeWeekday(5);
var timeSaturday = timeWeekday(6);
var timeSundays = timeSunday.range;
var timeMondays = timeMonday.range;
var timeTuesdays = timeTuesday.range;
var timeWednesdays = timeWednesday.range;
var timeThursdays = timeThursday.range;
var timeFridays = timeFriday.range;
var timeSaturdays = timeSaturday.range;
function utcWeekday(i) {
  return timeInterval((date) => {
    date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 7 - i) % 7);
    date.setUTCHours(0, 0, 0, 0);
  }, (date, step) => {
    date.setUTCDate(date.getUTCDate() + step * 7);
  }, (start, end) => {
    return (end - start) / durationWeek;
  });
}
var utcSunday = utcWeekday(0);
var utcMonday = utcWeekday(1);
var utcTuesday = utcWeekday(2);
var utcWednesday = utcWeekday(3);
var utcThursday = utcWeekday(4);
var utcFriday = utcWeekday(5);
var utcSaturday = utcWeekday(6);
var utcSundays = utcSunday.range;
var utcMondays = utcMonday.range;
var utcTuesdays = utcTuesday.range;
var utcWednesdays = utcWednesday.range;
var utcThursdays = utcThursday.range;
var utcFridays = utcFriday.range;
var utcSaturdays = utcSaturday.range;
var timeMonth = timeInterval((date) => {
  date.setDate(1);
  date.setHours(0, 0, 0, 0);
}, (date, step) => {
  date.setMonth(date.getMonth() + step);
}, (start, end) => {
  return end.getMonth() - start.getMonth() + (end.getFullYear() - start.getFullYear()) * 12;
}, (date) => {
  return date.getMonth();
});
var timeMonths = timeMonth.range;
var utcMonth = timeInterval((date) => {
  date.setUTCDate(1);
  date.setUTCHours(0, 0, 0, 0);
}, (date, step) => {
  date.setUTCMonth(date.getUTCMonth() + step);
}, (start, end) => {
  return end.getUTCMonth() - start.getUTCMonth() + (end.getUTCFullYear() - start.getUTCFullYear()) * 12;
}, (date) => {
  return date.getUTCMonth();
});
var utcMonths = utcMonth.range;
var timeYear = timeInterval((date) => {
  date.setMonth(0, 1);
  date.setHours(0, 0, 0, 0);
}, (date, step) => {
  date.setFullYear(date.getFullYear() + step);
}, (start, end) => {
  return end.getFullYear() - start.getFullYear();
}, (date) => {
  return date.getFullYear();
});
timeYear.every = (k) => {
  return !isFinite(k = Math.floor(k)) || !(k > 0) ? null : timeInterval((date) => {
    date.setFullYear(Math.floor(date.getFullYear() / k) * k);
    date.setMonth(0, 1);
    date.setHours(0, 0, 0, 0);
  }, (date, step) => {
    date.setFullYear(date.getFullYear() + step * k);
  });
};
var timeYears = timeYear.range;
var utcYear = timeInterval((date) => {
  date.setUTCMonth(0, 1);
  date.setUTCHours(0, 0, 0, 0);
}, (date, step) => {
  date.setUTCFullYear(date.getUTCFullYear() + step);
}, (start, end) => {
  return end.getUTCFullYear() - start.getUTCFullYear();
}, (date) => {
  return date.getUTCFullYear();
});
utcYear.every = (k) => {
  return !isFinite(k = Math.floor(k)) || !(k > 0) ? null : timeInterval((date) => {
    date.setUTCFullYear(Math.floor(date.getUTCFullYear() / k) * k);
    date.setUTCMonth(0, 1);
    date.setUTCHours(0, 0, 0, 0);
  }, (date, step) => {
    date.setUTCFullYear(date.getUTCFullYear() + step * k);
  });
};
var utcYears = utcYear.range;
function ticker(year, month, week, day, hour, minute) {
  const tickIntervals = [
    [second, 1, durationSecond],
    [second, 5, 5 * durationSecond],
    [second, 15, 15 * durationSecond],
    [second, 30, 30 * durationSecond],
    [minute, 1, durationMinute],
    [minute, 5, 5 * durationMinute],
    [minute, 15, 15 * durationMinute],
    [minute, 30, 30 * durationMinute],
    [hour, 1, durationHour],
    [hour, 3, 3 * durationHour],
    [hour, 6, 6 * durationHour],
    [hour, 12, 12 * durationHour],
    [day, 1, durationDay],
    [day, 2, 2 * durationDay],
    [week, 1, durationWeek],
    [month, 1, durationMonth],
    [month, 3, 3 * durationMonth],
    [year, 1, durationYear]
  ];
  function ticks(start, stop, count) {
    const reverse = stop < start;
    if (reverse) [start, stop] = [stop, start];
    const interval = count && typeof count.range === "function" ? count : tickInterval(start, stop, count);
    const ticks2 = interval ? interval.range(start, +stop + 1) : [];
    return reverse ? ticks2.reverse() : ticks2;
  }
  function tickInterval(start, stop, count) {
    const target = Math.abs(stop - start) / count;
    const i = bisector(([, , step2]) => step2).right(tickIntervals, target);
    if (i === tickIntervals.length) return year.every(tickStep(start / durationYear, stop / durationYear, count));
    if (i === 0) return millisecond.every(Math.max(tickStep(start, stop, count), 1));
    const [t, step] = tickIntervals[target / tickIntervals[i - 1][2] < tickIntervals[i][2] / target ? i - 1 : i];
    return t.every(step);
  }
  return [ticks, tickInterval];
}
var [utcTicks, utcTickInterval] = ticker(utcYear, utcMonth, utcSunday, unixDay, utcHour, utcMinute);
var [timeTicks, timeTickInterval] = ticker(timeYear, timeMonth, timeSunday, timeDay, timeHour, timeMinute);

// node_modules/vega-time/build/vega-time.js
var YEAR = "year";
var QUARTER = "quarter";
var MONTH = "month";
var WEEK = "week";
var ISOWEEK = "isoweek";
var DATE = "date";
var DAY = "day";
var DAYOFYEAR = "dayofyear";
var HOURS = "hours";
var MINUTES = "minutes";
var SECONDS = "seconds";
var MILLISECONDS = "milliseconds";
var TIME_UNITS = [YEAR, QUARTER, MONTH, WEEK, ISOWEEK, DATE, DAY, DAYOFYEAR, HOURS, MINUTES, SECONDS, MILLISECONDS];
var UNITS = TIME_UNITS.reduce((o, u, i) => (o[u] = 1 + i, o), {});
function timeUnits(units) {
  const u = array_default(units).slice(), m = {};
  if (!u.length) error("Missing time unit.");
  u.forEach((unit) => {
    if (hasOwnProperty(UNITS, unit)) {
      m[unit] = 1;
    } else {
      error(`Invalid time unit: ${unit}.`);
    }
  });
  const numTypes = (m[WEEK] || m[ISOWEEK] || m[DAY] ? 1 : 0) + (m[QUARTER] || m[MONTH] || m[DATE] ? 1 : 0) + (m[DAYOFYEAR] ? 1 : 0);
  if (numTypes > 1 || m[WEEK] && m[ISOWEEK]) {
    error(`Incompatible time units: ${units}`);
  }
  u.sort((a, b) => UNITS[a] - UNITS[b]);
  return u;
}
var defaultSpecifiers = {
  [YEAR]: "%Y ",
  [QUARTER]: "Q%q ",
  [MONTH]: "%b ",
  [DATE]: "%d ",
  [WEEK]: "W%U ",
  [ISOWEEK]: "W%V ",
  [DAY]: "%a ",
  [DAYOFYEAR]: "%j ",
  [HOURS]: "%H:00",
  [MINUTES]: "00:%M",
  [SECONDS]: ":%S",
  [MILLISECONDS]: ".%L",
  [`${YEAR}-${ISOWEEK}`]: "%G W%V ",
  [`${YEAR}-${MONTH}`]: "%Y-%m ",
  [`${YEAR}-${MONTH}-${DATE}`]: "%Y-%m-%d ",
  [`${HOURS}-${MINUTES}`]: "%H:%M"
};
var t02 = /* @__PURE__ */ new Date();
function localYear(y) {
  t02.setFullYear(y);
  t02.setMonth(0);
  t02.setDate(1);
  t02.setHours(0, 0, 0, 0);
  return t02;
}
function localDayOfYear(d) {
  return timeDay.count(localYear(d.getFullYear()) - 1, d);
}
function localWeekNum(d) {
  return timeSunday.count(localYear(d.getFullYear()) - 1, d);
}
function localISOWeekYear(d) {
  return timeDay.offset(timeMonday.floor(d), 3).getFullYear();
}
function localISOWeekNum(d) {
  return 1 + timeMonday.count(localISOWeekOne(localISOWeekYear(d)), d);
}
function localISOWeekOne(y) {
  return timeMonday.floor(timeDay.offset(localYear(y), 3));
}
function localISOWeekOneDate(y) {
  const d = localISOWeekOne(y);
  return d.getMonth() ? d.getDate() - 31 : d.getDate();
}
function localFirst(y) {
  return localYear(y).getDay();
}
function localDate(y, m, d, H, M, S, L) {
  if (0 <= y && y < 100) {
    const date = new Date(-1, m, d, H, M, S, L);
    date.setFullYear(y);
    return date;
  }
  return new Date(y, m, d, H, M, S, L);
}
function utcDayOfYear(d) {
  const y = Date.UTC(d.getUTCFullYear(), 0, 1);
  return utcDay.count(y - 1, d);
}
function utcWeekNum(d) {
  const y = Date.UTC(d.getUTCFullYear(), 0, 1);
  return utcSunday.count(y - 1, d);
}
function utcISOWeekYear(d) {
  return utcDay.offset(utcMonday.floor(d), 3).getUTCFullYear();
}
function utcISOWeekNum(d) {
  return 1 + utcMonday.count(utcISOWeekOne(utcISOWeekYear(d)), d);
}
function utcISOWeekOne(y) {
  return utcMonday.floor(utcDay.offset(Date.UTC(y, 0, 1), 3));
}
function utcISOWeekOneDate(y) {
  const d = utcISOWeekOne(y);
  return d.getUTCMonth() ? d.getUTCDate() - 31 : d.getUTCDate();
}
function utcFirst(y) {
  t02.setTime(Date.UTC(y, 0, 1));
  return t02.getUTCDay();
}
function utcDate(y, m, d, H, M, S, L) {
  if (0 <= y && y < 100) {
    const date = new Date(Date.UTC(-1, m, d, H, M, S, L));
    date.setUTCFullYear(d.y);
    return date;
  }
  return new Date(Date.UTC(y, m, d, H, M, S, L));
}
var REFERENCE_YEAR = 2012;
var ISOWEEK_REFERENCE_YEAR = 2015;
function floor(units, step, get, inv, newDate) {
  const s = step || 1, b = peek(units), _ = (unit, p, key2) => {
    key2 = key2 || unit;
    return getUnit(get[key2], inv[key2], unit === b && s, p);
  };
  const t = /* @__PURE__ */ new Date(), u = toSet(units), y = u[YEAR] ? _(YEAR, null, u[ISOWEEK] ? YEAR + ISOWEEK : YEAR) : constant_default(u[ISOWEEK] ? ISOWEEK_REFERENCE_YEAR : REFERENCE_YEAR), m = u[MONTH] ? _(MONTH) : u[QUARTER] ? _(QUARTER) : zero2, d = u[WEEK] && u[DAY] ? _(DAY, 1, WEEK + DAY) : u[ISOWEEK] && u[DAY] ? _(DAY, 1, ISOWEEK + DAY) : u[WEEK] ? _(WEEK, 1) : u[ISOWEEK] ? _(ISOWEEK, 1) : u[DAY] ? _(DAY, 1) : u[DATE] ? _(DATE, 1) : u[DAYOFYEAR] ? _(DAYOFYEAR, 1) : one, H = u[HOURS] ? _(HOURS) : zero2, M = u[MINUTES] ? _(MINUTES) : zero2, S = u[SECONDS] ? _(SECONDS) : zero2, L = u[MILLISECONDS] ? _(MILLISECONDS) : zero2;
  return function(v) {
    t.setTime(+v);
    const year = y(t);
    return newDate(year, m(t), d(t, year), H(t), M(t), S(t), L(t));
  };
}
function getUnit(f, inv, step, phase) {
  const u = step <= 1 ? f : phase ? (d, y) => phase + step * Math.floor((f(d, y) - phase) / step) : (d, y) => step * Math.floor(f(d, y) / step);
  return inv ? (d, y) => inv(u(d, y), y) : u;
}
function weekday(week, day, firstDay) {
  return day + week * 7 - (firstDay + 6) % 7;
}
function isoDay(day) {
  return (day + 6) % 7;
}
function isoWeekday(weekOneDate, week, day) {
  return weekOneDate + (week - 1) * 7 + day;
}
var localGet = {
  [YEAR]: (d) => d.getFullYear(),
  [QUARTER]: (d) => Math.floor(d.getMonth() / 3),
  [MONTH]: (d) => d.getMonth(),
  [DATE]: (d) => d.getDate(),
  [HOURS]: (d) => d.getHours(),
  [MINUTES]: (d) => d.getMinutes(),
  [SECONDS]: (d) => d.getSeconds(),
  [MILLISECONDS]: (d) => d.getMilliseconds(),
  [DAYOFYEAR]: (d) => localDayOfYear(d),
  [WEEK]: (d) => localWeekNum(d),
  [WEEK + DAY]: (d, y) => weekday(localWeekNum(d), d.getDay(), localFirst(y)),
  [DAY]: (d, y) => weekday(1, d.getDay(), localFirst(y)),
  [ISOWEEK]: (d) => localISOWeekNum(d),
  [YEAR + ISOWEEK]: (d) => localISOWeekYear(d),
  [ISOWEEK + DAY]: (d, y) => isoWeekday(localISOWeekOneDate(y), localISOWeekNum(d), isoDay(d.getDay()))
};
var localInv = {
  [QUARTER]: (q) => 3 * q,
  [WEEK]: (w, y) => weekday(w, 0, localFirst(y)),
  [ISOWEEK]: (w, y) => isoWeekday(localISOWeekOneDate(y), w, 0)
};
function timeFloor(units, step) {
  return floor(units, step || 1, localGet, localInv, localDate);
}
var utcGet = {
  [YEAR]: (d) => d.getUTCFullYear(),
  [QUARTER]: (d) => Math.floor(d.getUTCMonth() / 3),
  [MONTH]: (d) => d.getUTCMonth(),
  [DATE]: (d) => d.getUTCDate(),
  [HOURS]: (d) => d.getUTCHours(),
  [MINUTES]: (d) => d.getUTCMinutes(),
  [SECONDS]: (d) => d.getUTCSeconds(),
  [MILLISECONDS]: (d) => d.getUTCMilliseconds(),
  [DAYOFYEAR]: (d) => utcDayOfYear(d),
  [WEEK]: (d) => utcWeekNum(d),
  [DAY]: (d, y) => weekday(1, d.getUTCDay(), utcFirst(y)),
  [WEEK + DAY]: (d, y) => weekday(utcWeekNum(d), d.getUTCDay(), utcFirst(y)),
  [ISOWEEK]: (d) => utcISOWeekNum(d),
  [YEAR + ISOWEEK]: (d) => utcISOWeekYear(d),
  [ISOWEEK + DAY]: (d, y) => isoWeekday(utcISOWeekOneDate(y), utcISOWeekNum(d), isoDay(d.getUTCDay()))
};
var utcInv = {
  [QUARTER]: (q) => 3 * q,
  [WEEK]: (w, y) => weekday(w, 0, utcFirst(y)),
  [ISOWEEK]: (w, y) => isoWeekday(utcISOWeekOneDate(y), w, 0)
};
function utcFloor(units, step) {
  return floor(units, step || 1, utcGet, utcInv, utcDate);
}
var timeIntervals = {
  [YEAR]: timeYear,
  [QUARTER]: timeMonth.every(3),
  [MONTH]: timeMonth,
  [WEEK]: timeSunday,
  [ISOWEEK]: timeMonday,
  [DATE]: timeDay,
  [DAY]: timeDay,
  [DAYOFYEAR]: timeDay,
  [HOURS]: timeHour,
  [MINUTES]: timeMinute,
  [SECONDS]: second,
  [MILLISECONDS]: millisecond
};
var utcIntervals = {
  [YEAR]: utcYear,
  [QUARTER]: utcMonth.every(3),
  [MONTH]: utcMonth,
  [WEEK]: utcSunday,
  [ISOWEEK]: utcMonday,
  [DATE]: utcDay,
  [DAY]: utcDay,
  [DAYOFYEAR]: utcDay,
  [HOURS]: utcHour,
  [MINUTES]: utcMinute,
  [SECONDS]: second,
  [MILLISECONDS]: millisecond
};
function timeInterval2(unit) {
  return timeIntervals[unit];
}
function utcInterval(unit) {
  return utcIntervals[unit];
}
var durationSecond2 = 1e3;
var durationMinute2 = durationSecond2 * 60;
var durationHour2 = durationMinute2 * 60;
var durationDay2 = durationHour2 * 24;
var durationWeek2 = durationDay2 * 7;
var durationMonth2 = durationDay2 * 30;
var durationYear2 = durationDay2 * 365;
var Milli = [YEAR, MONTH, DATE, HOURS, MINUTES, SECONDS, MILLISECONDS];
var Seconds = Milli.slice(0, -1);
var Minutes = Seconds.slice(0, -1);
var Hours = Minutes.slice(0, -1);
var Day = Hours.slice(0, -1);
var Week = [YEAR, WEEK];
var Month = [YEAR, MONTH];
var Year = [YEAR];
var intervals = [[Seconds, 1, durationSecond2], [Seconds, 5, 5 * durationSecond2], [Seconds, 15, 15 * durationSecond2], [Seconds, 30, 30 * durationSecond2], [Minutes, 1, durationMinute2], [Minutes, 5, 5 * durationMinute2], [Minutes, 15, 15 * durationMinute2], [Minutes, 30, 30 * durationMinute2], [Hours, 1, durationHour2], [Hours, 3, 3 * durationHour2], [Hours, 6, 6 * durationHour2], [Hours, 12, 12 * durationHour2], [Day, 1, durationDay2], [Week, 1, durationWeek2], [Month, 1, durationMonth2], [Month, 3, 3 * durationMonth2], [Year, 1, durationYear2]];
var localGetters = {
  [YEAR]: (d) => d.getFullYear(),
  [MONTH]: (d) => d.getMonth(),
  [DATE]: (d) => d.getDate(),
  [DAY]: (d) => d.getDay(),
  [HOURS]: (d) => d.getHours(),
  [MINUTES]: (d) => d.getMinutes(),
  [SECONDS]: (d) => d.getSeconds(),
  [MILLISECONDS]: (d) => d.getMilliseconds()
};
var utcGetters = {
  [YEAR]: (d) => d.getUTCFullYear(),
  [MONTH]: (d) => d.getUTCMonth(),
  [DATE]: (d) => d.getUTCDate(),
  [DAY]: (d) => d.getUTCDay(),
  [HOURS]: (d) => d.getUTCHours(),
  [MINUTES]: (d) => d.getUTCMinutes(),
  [SECONDS]: (d) => d.getUTCSeconds(),
  [MILLISECONDS]: (d) => d.getUTCMilliseconds()
};

// src/runtime/workerlib-core.ts
function rebuildScale(registry, desc) {
  const make = registry(desc.type);
  if (!make) throw new Error("scale type " + desc.type);
  const s = make();
  for (const [k, v] of desc.props) if (typeof s[k] === "function") s[k](v);
  s.domain(desc.domain);
  s.range(desc.range);
  return s;
}
var lib = {
  /** Floor and offset of Vega's timeunit transform. */
  timeunit(units, step, utc) {
    const tunits = timeUnits(units);
    const floor2 = (utc ? utcFloor : timeFloor)(tunits, step);
    const offset = (utc ? utcInterval : timeInterval2)(tunits[tunits.length - 1]).offset;
    return { floor: floor2, offset };
  }
};

// src/runtime/relation.ts
var Unsupported = class extends Error {
};
function evalDerived(d, t, i) {
  if (d.kind === "col") {
    const g = d.col.tag[i];
    return g === 0 ? d.col.view[i] : g === 1 ? null : void 0;
  }
  if (d.kind === "map") return d.table[d.dict.view[i]];
  if (d.kind === "expr") return d.fn(t, d.P);
  if (d.kind === "bin") {
    const v2 = d.fn(t);
    return d.part === 0 ? v2 : v2 == null ? null : d.start + d.step * (1 + (v2 - d.start) / d.step);
  }
  const v = t[d.field];
  if (v == null) return null;
  const a = d.floor(v);
  return d.part === 0 ? a : d.offset(a, d.step);
}
function evalDerivedRow(table, d, i) {
  if (d.kind === "col" || d.kind === "map") return evalDerived(d, null, i);
  const read = (f) => {
    const e = d.env.get(f);
    return e ? evalDerivedRow(table, e, i) : table.value(f, i);
  };
  const datum = new Proxy({}, { get: (_t, f) => typeof f === "string" ? read(f) : void 0 });
  return evalDerived(d, datum, i);
}
function mainEvaluator(rel) {
  for (const name of rel.derived.keys()) {
    if (rel.base.table.isPreserved(name)) return (d, _t, i) => evalDerivedRow(rel.base.table, d, i);
  }
  return evalDerived;
}
function preserveBase(rel, name) {
  if (!rel.derived.has(name)) rel.base.table.preserveField(name);
}
var baseCounter = 0;
function makeBase(tuples, source = tuples) {
  return { tuples, table: ColumnTable.fromTuples(tuples), id: ++baseCounter, source };
}
function baseRelation(base) {
  return { base, preds: [], derived: /* @__PURE__ */ new Map(), derive: false, sig: "b" + base.id };
}
function hash(s) {
  let h1 = 2166136261, h2 = 74565;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619);
    h2 = Math.imul(h2 ^ c, 2246822519) + 2654435769;
  }
  return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36) + s.length.toString(36);
}
function predSig(p) {
  return p.info.code + "|" + JSON.stringify(p.P);
}
function derivedSig(d) {
  if (d.kind === "expr") return `${d.name}=${d.info.code}|${JSON.stringify(d.P)}`;
  if (d.kind === "bin") return `${d.name}=bin(${d.field},${d.part},${d.start},${d.stop},${d.step})`;
  if (d.kind === "col") return `${d.name}=col(${d.col.key}#${d.col.version})`;
  if (d.kind === "map") return `${d.name}=map(${d.field},${d.dict.key}#${d.version})`;
  return `${d.name}=time(${d.field},${d.part},${d.units.join(",")},${d.step},${d.utc})`;
}
function relationSig(r) {
  return hash(["b" + r.base.id, r.derive ? "d" : "", ...r.preds.map(predSig), ...[...r.derived.values()].map(derivedSig)].join("\n"));
}
function literal(v) {
  if (v === void 0) return "undefined";
  if (v instanceof Date) return `new Date(${+v})`;
  if (typeof v === "number") return Object.is(v, -0) ? "-0" : String(v);
  return JSON.stringify(v);
}
function cloneable(v, depth = 0) {
  if (v == null || typeof v === "number" || typeof v === "string" || typeof v === "boolean") return true;
  if (v instanceof Date) return true;
  if (typeof v !== "object" || depth > 4) return false;
  if (Array.isArray(v)) return v.every((x) => cloneable(x, depth + 1));
  if (Object.getPrototypeOf(v) !== Object.prototype) return false;
  return Object.values(v).every((x) => cloneable(x, depth + 1));
}
var RowCode = class {
  constructor(rel, pool, slotFn) {
    this.rel = rel;
    this.pool = pool;
    this.slotFn = slotFn;
    this.cols = [];
    this.colIdx = /* @__PURE__ */ new Map();
    this.lines = [];
    this.fns = /* @__PURE__ */ new Set();
    this.P = {};
    this.bins = /* @__PURE__ */ new Map();
    this.times = /* @__PURE__ */ new Map();
    /** Buffer and type of every column slot, for running the same code on the main thread. */
    this.buffers = [];
    this.declared = /* @__PURE__ */ new Set();
  }
  slot(key2, type, buffer) {
    if (this.slotFn) return this.slotFn(key2, type, buffer);
    let s = this.colIdx.get(key2);
    if (s === void 0) {
      s = this.cols.length;
      this.cols.push(key2);
      this.buffers.push({ buffer, type });
      this.colIdx.set(key2, s);
      this.pool.ensureColumn(key2, type, buffer);
    }
    return s;
  }
  /** Main-thread views of the column slots. */
  views() {
    return this.buffers.map((b) => b.type === "f64" ? new Float64Array(b.buffer) : b.type === "i32" ? new Int32Array(b.buffer) : new Uint8Array(b.buffer));
  }
  declare(name, src) {
    if (this.declared.has(name)) return;
    this.declared.add(name);
    this.lines.push(`const ${name} = ${src};`);
  }
  baseField(name) {
    const c = this.rel.base.table.exprColumn(name);
    if (!c) throw new Unsupported(`field ${name}`);
    const s = this.slot(c.key, c.kind === "dict" ? "i32" : "f64", c.view.buffer);
    this.declare(`w${s}`, `cols[${s}]`);
    if (c.kind === "date") {
      const t = this.slot(c.tagKey, "u8", c.tag.buffer);
      this.declare(`w${t}`, `cols[${t}]`);
      return `(w${t}[i] === 0 ? new Date(w${s}[i]) : w${t}[i] === 1 ? null : undefined)`;
    }
    if (c.kind === "num") {
      if (!c.tag) return `w${s}[i]`;
      const t = this.slot(c.tagKey, "u8", c.tag.buffer);
      this.declare(`w${t}`, `cols[${t}]`);
      return `(w${t}[i] === 0 ? w${s}[i] : w${t}[i] === 1 ? null : undefined)`;
    }
    this.declare(`W${s}`, `[${c.values.map(literal).join(",")}]`);
    return `W${s}[w${s}[i]]`;
  }
  /** Source that reads `name` at row i, as seen by an expression with derived fields `env`. */
  field(name, env = this.rel.derived) {
    const d = env.get(name);
    if (!d) return this.baseField(name);
    if (d.kind === "expr") return "(" + this.expr(d.info, d.P, d.env) + ")";
    if (d.kind === "col") {
      const s = this.slot(d.col.key, "f64", d.col.view.buffer);
      const t = this.slot(d.col.tagKey, "u8", d.col.tag.buffer);
      this.declare(`w${s}`, `cols[${s}]`);
      this.declare(`w${t}`, `cols[${t}]`);
      return `(w${t}[i] === 0 ? w${s}[i] : w${t}[i] === 1 ? null : undefined)`;
    }
    if (d.kind === "map") {
      const s = this.slot(d.dict.key, "i32", d.dict.view.buffer);
      this.declare(`w${s}`, `cols[${s}]`);
      const t = `MT${d.version}`;
      this.declare(t, `[${d.table.map(literal).join(",")}]`);
      return `${t}[w${s}[i]]`;
    }
    if (d.kind === "time") {
      const tk = JSON.stringify([d.units, d.step, d.utc]);
      let k = this.times.get(tk);
      if (k === void 0) {
        k = this.times.size;
        this.times.set(tk, k);
        const key2 = `#tu${k}`;
        this.P[key2] = { units: d.units, step: d.step, utc: d.utc };
        this.lines.push(
          `const tu${k} = globalThis.__pwvt.timeunit(P[${JSON.stringify(key2)}].units, P[${JSON.stringify(key2)}].step, P[${JSON.stringify(key2)}].utc);`,
          `function tu0_${k}(v) { return v == null ? null : tu${k}.floor(v); }`,
          `function tu1_${k}(v) { return v == null ? null : tu${k}.offset(tu${k}.floor(v), ${d.step}); }`
        );
      }
      return `tu${d.part}_${k}(${this.field(d.field, d.env)})`;
    }
    let b = this.bins.get(d);
    if (b === void 0) {
      b = this.bins.size;
      this.bins.set(d, b);
      const key2 = `#bin${b}`;
      this.P[key2] = { start: d.start, stop: d.stop, step: d.step };
      this.lines.push(
        `const bk${b} = P[${JSON.stringify(key2)}];`,
        `function bin0_${b}(x) { let v = x == null || x === '' ? null : +x; const s = bk${b}.start, e = bk${b}.stop, t = bk${b}.step; return v == null ? null : v < s ? -Infinity : v > e ? Infinity : (v = Math.max(s, Math.min(v, e - t)), s + t * Math.floor(${EPSILON} + (v - s) / t)); }`,
        `function bin1_${b}(x) { const v = bin0_${b}(x); const s = bk${b}.start, t = bk${b}.step; return v == null ? null : s + t * (1 + (v - s) / t); }`
      );
    }
    return `bin${d.part}_${b}(${this.field(d.field, d.env)})`;
  }
  expr(info, P, env = this.rel.derived) {
    if (info.unsupported) throw new Unsupported(info.unsupported);
    for (const k of info.params) {
      if (k in this.P && JSON.stringify(this.P[k]) !== JSON.stringify(P[k])) throw new Unsupported("parameter " + k);
      this.P[k] = P[k];
    }
    info.fns.forEach((f) => this.fns.add(f));
    return emit(info, (f) => this.field(f, env));
  }
  /** Declarations to put before the row loop; reads parameters from args.P. */
  prelude() {
    return ["const P = args.P;", libraryPrelude(this.fns), ...this.lines].join("\n");
  }
};
function predicateCode(rc, preds) {
  return preds.length ? preds.map((p) => `(${rc.expr(p.info, p.P)})`).join(" && ") : "true";
}
function kernelKey(prefix, ...parts) {
  return prefix + hash(parts.join("\0"));
}
var MAIN_THREAD_ROWS = 1 << 15;
var T_NUM = 0;
var T_NULL = 1;
var T_UNDEF = 2;
var T_TRUE = 3;
var T_FALSE = 4;
var T_OTHER = 5;
var Materializer = class {
  constructor(vega) {
    this.vega = vega;
    this.base = null;
    this.derive = false;
    this.state = null;
    this.lut = null;
    this.written = "";
  }
  tuple(i) {
    const b = this.base;
    if (!this.lut) return b.tuples[i];
    let d = this.lut[i];
    if (!d) {
      const t = b.tuples[i];
      d = this.vega.ingest({});
      for (const k in t) d[k] = t[k];
      this.lut[i] = d;
    }
    return d;
  }
  selectedRows() {
    const m = this.state.mask;
    const out = new Int32Array(this.state.selected);
    let w = 0;
    for (let i = 0; i < this.state.n; i++) if (m[i]) out[w++] = i;
    return out;
  }
  /** Row ids of the current output, in a shared array (for kernels). */
  selectedShared() {
    const m = this.state.mask;
    const out = new Int32Array(new SharedArrayBuffer(4 * Math.max(1, this.state.selected)));
    let w = 0;
    for (let i = 0; i < this.state.n; i++) if (m[i]) out[w++] = i;
    return out.subarray(0, w);
  }
  /** Forget the previous output (for instance when the operator falls back to Vega). */
  reset() {
    this.base = null;
    this.state = null;
    this.lut = null;
    this.written = "";
  }
  async update(rel, pool) {
    const add = [], rem = [], mod = [];
    if (this.base !== rel.base || this.derive !== rel.derive) {
      if (this.base && this.state) for (const i of this.selectedRows()) rem.push(this.tuple(i));
      this.base = rel.base;
      this.derive = rel.derive;
      this.lut = rel.derive ? new Array(rel.base.tuples.length) : null;
      this.state = new import_resident9.FilterState(rel.base.tuples.length);
      this.written = "";
    }
    const state = this.state;
    const n = state.n;
    const rc = new RowCode(rel, pool);
    const cond = predicateCode(rc, rel.preds);
    const prelude = rc.prelude();
    const delta = n === 0 ? { add: new Int32Array(0), rem: new Int32Array(0) } : await (0, import_resident10.filter)(
      { key: kernelKey("pv:sel:", prelude, cond), prelude, cond },
      state,
      { pool, cols: rc.cols, args: { P: rc.P } }
    );
    for (const i of delta.rem) rem.push(this.tuple(i));
    const derived = [...rel.derived.values()];
    const dsig = derived.map(derivedSig).join("\n");
    let rows;
    const rewrite = dsig !== this.written && derived.length > 0;
    if (rewrite) rows = this.selectedRows();
    else rows = delta.add;
    if (derived.length && rows.length) await this.writeDerived(rel, pool, derived, rows);
    this.written = dsig;
    for (const i of delta.add) add.push(this.tuple(i));
    if (rewrite) {
      const added = new Set(delta.add);
      for (const i of rows) if (!added.has(i)) mod.push(this.tuple(i));
    }
    if (rem.length && add.length) {
      const removed = new Set(rem);
      const both = new Set(add.filter((t) => removed.has(t)));
      if (both.size) {
        const inMod = new Set(mod);
        for (const t of both) if (!inMod.has(t)) mod.push(t);
        let w = 0;
        for (const t of add) if (!both.has(t)) add[w++] = t;
        add.length = w;
        w = 0;
        for (const t of rem) if (!both.has(t)) rem[w++] = t;
        rem.length = w;
      }
    }
    let src = null;
    return {
      add,
      rem,
      mod,
      fields: derived.map((d) => d.name),
      source: () => src || (src = Array.from(this.selectedRows(), (i) => this.tuple(i)))
    };
  }
  async writeDerived(rel, pool, derived, rows) {
    const evalMain = mainEvaluator(rel);
    if (rows.length < MAIN_THREAD_ROWS) {
      for (const i of rows) {
        const t = this.tuple(i);
        for (const d of derived) t[d.name] = evalMain(d, t, i);
      }
      return;
    }
    const m = rows.length;
    const idx = new Int32Array(new SharedArrayBuffer(4 * m));
    idx.set(rows);
    const outs = derived.map(() => ({
      v: new Float64Array(new SharedArrayBuffer(8 * m)),
      t: new Uint8Array(new SharedArrayBuffer(Math.max(1, m)))
    }));
    let rc = new RowCode(rel, pool);
    let body = [];
    try {
      derived.forEach((d, j) => {
        const src2 = rc.field(d.name, new Map([...d.env, [d.name, d]]));
        body.push(`{ const r = ${src2}; const o = bufs[${2 * j}], g = bufs[${2 * j + 1}]; if (typeof r === 'number') { o[j] = r; g[j] = ${T_NUM}; } else if (r === null) g[j] = ${T_NULL}; else if (r === undefined) g[j] = ${T_UNDEF}; else if (r === true) g[j] = ${T_TRUE}; else if (r === false) g[j] = ${T_FALSE}; else g[j] = ${T_OTHER}; }`);
      });
    } catch (e) {
      if (!(e instanceof Unsupported)) throw e;
      rc = null;
    }
    if (!rc) {
      for (const i of rows) {
        const t = this.tuple(i);
        for (const d of derived) t[d.name] = evalMain(d, t, i);
      }
      return;
    }
    const prelude = rc.prelude();
    const src = `${prelude}
const rowIds = bufs[${2 * derived.length}];
for (let j = start; j < end; j++) { const i = rowIds[j];
${body.join("\n")}
}`;
    const bufs = outs.flatMap((o) => [
      { buffer: o.v.buffer, type: "f64" },
      { buffer: o.t.buffer, type: "u8" }
    ]);
    bufs.push({ buffer: idx.buffer, type: "i32" });
    await (0, import_resident10.map)({ key: kernelKey("pv:der:", src), src }, { pool, n: m, cols: rc.cols, bufs, args: { P: rc.P } });
    for (let j = 0; j < m; j++) {
      const t = this.tuple(rows[j]);
      for (let k = 0; k < derived.length; k++) {
        const g = outs[k].t[j];
        const d = derived[k];
        t[d.name] = g === T_NUM ? outs[k].v[j] : g === T_NULL ? null : g === T_UNDEF ? void 0 : g === T_TRUE ? true : g === T_FALSE ? false : evalMain(d, t, rows[j]);
      }
    }
  }
};
function materializeSync(rel, pool, vega) {
  if (!globalThis.__pwvt) globalThis.__pwvt = lib;
  const rc = new RowCode(rel, pool);
  const cond = predicateCode(rc, rel.preds);
  const prelude = rc.prelude();
  const fn = new Function("cols", "args", "n", `${prelude}
const out = [];
for (let i = 0; i < n; i++) if (${cond}) out.push(i);
return out;`);
  const cols = rc.views();
  const rows = fn(cols, { P: rc.P }, rel.base.tuples.length);
  const derived = [...rel.derived.values()];
  const evalMain = mainEvaluator(rel);
  const out = rows.map((i) => {
    let t = rel.base.tuples[i];
    if (rel.derive) {
      const d = vega.ingest({});
      for (const k in t) d[k] = t[k];
      t = d;
    }
    for (const d of derived) t[d.name] = evalMain(d, t, i);
    return t;
  });
  if (rel.orderCmp) {
    const pos = /* @__PURE__ */ new Map();
    out.forEach((t, j) => pos.set(t, j));
    out.sort((a, b) => rel.orderCmp(a, b) || pos.get(a) - pos.get(b));
  }
  return out;
}
async function selectRows(rel, pool) {
  const n = rel.base.tuples.length;
  if (!rel.preds.length) {
    const all = new Int32Array(new SharedArrayBuffer(4 * Math.max(1, n)));
    for (let i = 0; i < n; i++) all[i] = i;
    return all.subarray(0, n);
  }
  const state = new import_resident9.FilterState(n);
  const rc = new RowCode(rel, pool);
  const cond = predicateCode(rc, rel.preds);
  const prelude = rc.prelude();
  const d = await (0, import_resident10.filter)({ key: kernelKey("pv:sel:", prelude, cond), prelude, cond }, state, { pool, cols: rc.cols, args: { P: rc.P } });
  const out = new Int32Array(new SharedArrayBuffer(4 * Math.max(1, d.add.length)));
  out.set(d.add);
  return out.subarray(0, d.add.length);
}

// src/runtime/selection.ts
var TEST_RE = /this\.vlSelectionTest\("([^"\\]+)",datum(?:,"(union|intersect)")?\)/g;
var DATA_RE = /this\.data\("([^"\\]+)"\)/g;
var BRUSH_RE = /^\(?\(!this\.data\("([^"\\]+)"\)\.length\)\|\|this\.vlSelectionTest\("([^"\\]+)",datum(?:,"(union|intersect)")?\)\)?$/;
var isDate2 = (x) => Object.prototype.toString.call(x) === "[object Date]";
var dnum = (x) => isDate2(x) ? +x : x;
function entriesOf(_, store) {
  const tuples = _[":" + store];
  if (!Array.isArray(tuples)) return null;
  const out = [];
  for (const t of tuples) {
    if (!t || !Array.isArray(t.fields) || !Array.isArray(t.values)) return null;
    const fields = t.fields.map((f) => ({ field: f.field, type: f.type ?? "E" }));
    if (fields.some((f) => typeof f.field !== "string" || /[.[\]\\]/.test(f.field))) return null;
    const values = t.values.map((v) => Array.isArray(v) ? v.map(dnum) : dnum(v));
    out.push({ unit: t.unit, fields, values });
  }
  return out;
}
function fieldTest(type, d, V, isArray2) {
  switch (type) {
    case "E":
      return isArray2 ? `this.vlIncl(${V},${d})` : `(${d} === ${V})`;
    case "R":
      return `this.inrange(${d},${V})`;
    case "R-RE":
      return `this.inrange(${d},${V},true,false)`;
    case "R-E":
      return `this.inrange(${d},${V},false,false)`;
    case "R-LE":
      return `this.inrange(${d},${V},false,true)`;
    case "E-LT":
      return `(!(${d} >= ${V}))`;
    case "E-LTE":
      return `(!(${d} > ${V}))`;
    case "E-GT":
      return `(!(${d} <= ${V}))`;
    case "E-GTE":
      return `(!(${d} < ${V}))`;
    case "E-VALID":
      return `(!(${d} === null || isNaN(${d})))`;
    case "E-ONE":
      return `(${V}.indexOf(${d}) !== -1)`;
    default:
      return null;
  }
}
function specializeSelections(code, _) {
  const extra = {};
  let failed = false;
  const store = (name) => {
    const k = "#sel:" + name;
    if (!(k in extra)) {
      const e = entriesOf(_, name);
      if (!e) {
        failed = true;
        return null;
      }
      extra[k] = e.map((x) => x.values);
      extra["#data:" + name] = e.map((x) => ({ unit: x.unit, fields: x.fields, values: x.values }));
    }
    return extra["#data:" + name];
  };
  let out = code.replace(TEST_RE, (_m, name, op) => {
    const entries = store(name);
    if (!entries) return "false";
    if (!entries.length) return "0";
    const V = (e, i) => `_[${JSON.stringify("#sel:" + name)}][${e}][${i}]`;
    const tests = entries.map((en, e) => {
      const parts = en.fields.map((f, i) => fieldTest(f.type, `this.vlDnum(datum[${JSON.stringify(f.field)}])`, V(e, i), Array.isArray(en.values[i])));
      if (parts.some((p) => p === null)) {
        failed = true;
        return "false";
      }
      return parts.length ? "(" + parts.join("&&") + ")" : "true";
    });
    if (op !== "intersect") return "(" + tests.join("||") + ")";
    const units = /* @__PURE__ */ new Map();
    entries.forEach((en, e) => {
      const u = units.get(en.unit) || [];
      u.push(tests[e]);
      units.set(en.unit, u);
    });
    return "(" + [...units.values()].map((t) => "(" + t.join("||") + ")").join("&&") + ")";
  });
  out = out.replace(DATA_RE, (_m, name) => {
    store(name);
    return `_[${JSON.stringify("#data:" + name)}]`;
  });
  return failed ? null : { code: out, extra };
}
function readsSelection(code) {
  return code.includes("this.vlSelectionTest(") || code.includes("this.data(");
}
function brushRanges(conj, _) {
  const m = BRUSH_RE.exec(conj);
  if (!m || m[1] !== m[2]) return null;
  const entries = entriesOf(_, m[1]);
  if (!entries) return null;
  if (entries.length === 0) return [];
  if (entries.length !== 1) return null;
  const e = entries[0];
  const out = [];
  for (let i = 0; i < e.fields.length; i++) {
    const v = e.values[i];
    if (e.fields[i].type !== "R" || !Array.isArray(v) || v.length < 1) return null;
    let lo = v[0], hi = v[v.length - 1];
    if (typeof lo !== "number" || typeof hi !== "number") return null;
    if (lo > hi) {
      const t = lo;
      lo = hi;
      hi = t;
    }
    out.push({ field: e.fields[i].field, value: [lo, hi] });
  }
  return out;
}

// src/runtime/sort.ts
var import_resident11 = __toESM(require_resident());
var import_resident12 = __toESM(require_resident());
function cmpSource(nk, orders) {
  const parts = [];
  for (let k = 0; k < nk; k++) {
    const o = orders[k];
    parts.push(`x = K${k}[a]; y = K${k}[b]; if (x < y) return ${-o}; if (x > y) return ${o};`);
  }
  return `function cmp(a, b) { let x, y; ${parts.join(" ")} return a - b; }`;
}
var MAIN_THREAD_SORT = 1 << 16;
async function sortRows(pool, rows, keys) {
  const m = rows.length;
  const out = new Int32Array(new SharedArrayBuffer(4 * Math.max(1, m)));
  const orders = keys.map((k) => k.order);
  const cmpSrc = cmpSource(keys.length, orders);
  const decl = keys.map((_k, i) => `const K${i} = cols[${i}];`).join("\n");
  const cols = keys.map((k) => k.key);
  keys.forEach((k) => pool.ensureColumn(k.key, "f64", k.view.buffer));
  const T = Math.min(pool.size, Math.max(1, Math.floor(m / 4096)));
  if (m < MAIN_THREAD_SORT || T < 2) {
    const cmp = new Function(...keys.map((_k, i) => `K${i}`), `${cmpSrc}; return cmp;`)(...keys.map((k) => k.view));
    out.set(rows);
    out.subarray(0, m).sort(cmp);
    return out.subarray(0, m);
  }
  const cmpMain = new Function(...keys.map((_k, i) => `K${i}`), `${cmpSrc}; return cmp;`)(...keys.map((k) => k.view));
  const S = Math.min(m, 256 * T);
  const sample = new Int32Array(S);
  for (let s = 0; s < S; s++) sample[s] = rows[Math.floor((s + 0.5) * m / S)];
  sample.sort(cmpMain);
  const splitters = new Int32Array(T - 1);
  for (let b = 1; b < T; b++) splitters[b - 1] = sample[Math.floor(b * S / T)];
  const rowsShared = rows.buffer instanceof SharedArrayBuffer && rows.byteOffset === 0 && rows.length * 4 === rows.buffer.byteLength ? rows : (() => {
    const r = new Int32Array(new SharedArrayBuffer(4 * m));
    r.set(rows);
    return r;
  })();
  const bucket = new Int32Array(new SharedArrayBuffer(4 * m));
  const sb2 = (a) => ({ buffer: a.buffer, type: "i32" });
  const countSrc = `${decl}
${cmpSrc}
const R = bufs[0], B = bufs[1], sp = args.sp, T = sp.length + 1;
const counts = new Array(T).fill(0);
for (let j = start; j < end; j++) {
  const r = R[j]; let lo = 0, hi = sp.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (cmp(sp[mid], r) <= 0) lo = mid + 1; else hi = mid; }
  B[j] = lo; counts[lo]++;
}
return counts;`;
  const res = await (0, import_resident11.map)({ key: "pv:sort:count:" + keys.length + ":" + orders.join(","), src: countSrc }, {
    pool,
    n: m,
    threads: T,
    cols,
    bufs: [sb2(rowsShared), sb2(bucket)],
    args: { sp: Array.from(splitters) }
  });
  const counts = res.map((c) => c[0]);
  const W = counts.length;
  const offsets = counts.map(() => new Array(T).fill(0));
  const bounds = [];
  let acc = 0;
  for (let b = 0; b < T; b++) {
    const s0 = acc;
    for (let w = 0; w < W; w++) {
      offsets[w][b] = acc;
      acc += counts[w][b];
    }
    bounds.push([s0, acc]);
  }
  const scatterSrc = `const R = bufs[0], B = bufs[1], O = bufs[2], off = args.offsets[args.t].slice();
for (let j = start; j < end; j++) O[off[B[j]]++] = R[j];
return 0;`;
  await (0, import_resident11.map)({ key: "pv:sort:scatter", src: scatterSrc }, {
    pool,
    n: m,
    threads: T,
    bufs: [sb2(rowsShared), sb2(bucket), sb2(out)],
    args: { offsets }
  });
  const sortSrc = `${decl}
${cmpSrc}
const O = bufs[0];
for (let b = start; b < end; b++) { const [s, e] = args.bounds[b]; O.subarray(s, e).sort(cmp); }
return 0;`;
  await (0, import_resident11.map)({ key: "pv:sort:bucket:" + keys.length + ":" + orders.join(","), src: sortSrc }, {
    pool,
    n: T,
    threads: T,
    cols,
    bufs: [sb2(out)],
    args: { bounds }
  });
  void import_resident12.splitRanges;
  return out.subarray(0, m);
}

// src/runtime/window.ts
var import_resident13 = __toESM(require_resident());
var WINDOW_RANK_OPS = /* @__PURE__ */ new Set(["row_number", "rank", "dense_rank", "percent_rank", "cume_dist"]);
var WINDOW_AGG_OPS = /* @__PURE__ */ new Set(["count", "valid", "missing", "sum", "mean", "average", "min", "max"]);
var WINDOW_VALUE_OPS = /* @__PURE__ */ new Set(["lag", "lead", "first_value", "last_value", "nth_value"]);
var MAX_SCAN_FRAME = 4096;
var sb = (a, type) => ({ buffer: a.buffer, type });
async function computeWindow(pool, n, rows, groupKeys, sortKeys, ops, ignorePeers, orderOnly = false, frame = [null, 0]) {
  const m = rows.length;
  const outs = ops.map(() => ({
    view: new Float64Array(new SharedArrayBuffer(8 * Math.max(1, n))),
    tag: new Uint8Array(new SharedArrayBuffer(Math.max(1, n)))
  }));
  for (const o of outs) o.tag.fill(2);
  if (m === 0) return outs;
  const S = await sortRows(pool, rows, [...groupKeys, ...sortKeys]);
  const G = groupKeys.length, K = sortKeys.length;
  const hasSort = K > 0 && !orderOnly;
  const range = hasSort && !ignorePeers;
  const framed = !(frame[0] == null && frame[1] === 0);
  const views = [...groupKeys, ...sortKeys].map((k) => k.view);
  const same = (a, b, upto) => {
    for (let k = 0; k < upto; k++) if (views[k][a] !== views[k][b]) return false;
    return true;
  };
  const T = Math.min(pool.size, Math.max(1, Math.floor(m / 4096)));
  const cuts = [0];
  for (let t = 1; t < T; t++) {
    let p = Math.max(cuts[cuts.length - 1] + 1, Math.floor(t * m / T));
    while (p < m && hasSort && same(S[p - 1], S[p], G + K)) p++;
    if (p < m && p > cuts[cuts.length - 1]) cuts.push(p);
  }
  cuts.push(m);
  const bounds = [];
  for (let c = 0; c + 1 < cuts.length; c++) bounds.push([cuts[c], cuts[c + 1]]);
  const C = bounds.length;
  const cont = bounds.map(([s]) => s > 0 && same(S[s - 1], S[s], G) ? 1 : 0);
  const mkeys = [];
  const mIndex = ops.map((o) => {
    if (!o.measure) return -1;
    let j = mkeys.indexOf(o.measure.key);
    if (j < 0) {
      j = mkeys.length;
      mkeys.push(o.measure.key);
      pool.ensureColumn(o.measure.key, "f64", o.measure.view.buffer);
    }
    return j;
  });
  const NM = mkeys.length;
  const loc = Array.from({ length: 5 }, () => new Float64Array(new SharedArrayBuffer(8 * m)));
  const acc = Array.from({ length: 1 + 4 * NM }, () => new Float64Array(new SharedArrayBuffer(8 * m)));
  const pre = Array.from({ length: framed ? 2 * NM : 0 }, () => new Float64Array(new SharedArrayBuffer(8 * m)));
  const keyCols = [...groupKeys, ...sortKeys].map((k) => k.key);
  [...groupKeys, ...sortKeys].forEach((k) => pool.ensureColumn(k.key, "f64", k.view.buffer));
  const cols = [...keyCols, ...mkeys];
  const decl = cols.map((_c, i) => `const C${i} = cols[${i}];`).join("\n");
  const sameG = G ? Array.from({ length: G }, (_x, k) => `C${k}[a] === C${k}[b]`).join(" && ") : "true";
  const sameP = G + K ? Array.from({ length: G + K }, (_x, k) => `C${k}[a] === C${k}[b]`).join(" && ") : "true";
  const mcols = Array.from({ length: NM }, (_x, j) => `C${G + K + j}`);
  const phase1 = `${decl}
const S = bufs[0], L0 = bufs[1], L1 = bufs[2], L2 = bufs[3], L3 = bufs[4], L4 = bufs[5], A0 = bufs[6];
const A = [${Array.from({ length: NM }, (_x, j) => `[bufs[${7 + 4 * j}], bufs[${8 + 4 * j}], bufs[${9 + 4 * j}], bufs[${10 + 4 * j}]]`).join(", ")}];
const M = [${mcols.join(", ")}];
const PRE = [${Array.from({ length: framed ? NM : 0 }, (_x, j) => `[bufs[${7 + 4 * NM + 2 * j}], bufs[${8 + 4 * NM + 2 * j}]]`).join(", ")}];
const sameG = (a, b) => ${sameG};
const samePeer = (a, b) => ${hasSort ? sameP : "false"};
const out = [];
for (let c = start; c < end; c++) {
  const [s, e] = args.bounds[c];
  const starts = [];
  let pstart = s, idx = 0, dense = 0, cnt = 0;
  const va = new Float64Array(${NM}), su = new Float64Array(${NM}), mn = new Float64Array(${NM}).fill(NaN), mx = new Float64Array(${NM}).fill(NaN);
  let first = null;
  const finish = (p0, p1) => { for (let q = p0; q < p1; q++) L4[q] = p1 - p0; };
  const pv = new Float64Array(${NM}), ps = new Float64Array(${NM});
  for (let q = s; q < e && PRE.length; q++) {
    const r = S[q];
    for (let k = 0; k < PRE.length; k++) { PRE[k][0][q] = pv[k]; PRE[k][1][q] = ps[k]; const v = M[k][r]; if (v === v) { pv[k]++; ps[k] += v; } }
  }
  let j = s;
  while (j < e) {
    if (j > s && !sameG(S[j - 1], S[j])) {
      starts.push(j);
      if (first === null) first = { len: idx, dense, cnt, va: Array.from(va), su: Array.from(su), mn: Array.from(mn), mx: Array.from(mx), end: j };
      finish(pstart, j);
      pstart = j; idx = 0; dense = 0; cnt = 0; va.fill(0); su.fill(0); mn.fill(NaN); mx.fill(NaN);
    }
    let g = j + 1;
    while (g < e && samePeer(S[g - 1], S[g])) g++;
    dense++;
    const rank0 = idx;
    for (let q = j; q < g; q++) {
      const r = S[q];
      cnt++;
      for (let k = 0; k < ${NM}; k++) { const v = M[k][r]; if (v === v) { va[k]++; su[k] += v; if (!(v >= mn[k])) mn[k] = v; if (!(v <= mx[k])) mx[k] = v; } }
      L0[q] = idx++; L1[q] = rank0; L2[q] = dense; L3[q] = g - 1 - pstart;
      if (!${range}) { A0[q] = cnt; for (let k = 0; k < ${NM}; k++) { A[k][0][q] = va[k]; A[k][1][q] = su[k]; A[k][2][q] = mn[k]; A[k][3][q] = mx[k]; } }
    }
    if (${range}) for (let q = j; q < g; q++) { A0[q] = cnt; for (let k = 0; k < ${NM}; k++) { A[k][0][q] = va[k]; A[k][1][q] = su[k]; A[k][2][q] = mn[k]; A[k][3][q] = mx[k]; } }
    j = g;
  }
  finish(pstart, e);
  const last = { len: idx, dense, cnt, va: Array.from(va), su: Array.from(su), mn: Array.from(mn), mx: Array.from(mx), start: pstart };
  out.push({ first: first || { ...last, end: e }, last, single: first === null, pv: Array.from(pv), ps: Array.from(ps), starts });
}
return out;`;
  const bufs = [sb(S, "i32"), ...loc.map((a) => sb(a, "f64")), ...acc.map((a) => sb(a, "f64")), ...pre.map((a) => sb(a, "f64"))];
  const res = await (0, import_resident13.map)({ key: `pv:win1:${G}:${K}:${NM}:${range}:${hasSort}:${framed}`, src: phase1 }, {
    pool,
    n: C,
    threads: C,
    cols,
    bufs,
    args: { bounds }
  });
  const sums = res.flat().flat();
  const empty = () => ({ len: 0, dense: 0, cnt: 0, va: new Array(NM).fill(0), su: new Array(NM).fill(0), mn: new Array(NM).fill(NaN), mx: new Array(NM).fill(NaN) });
  const add = (a, b) => ({
    len: a.len + b.len,
    dense: a.dense + b.dense,
    cnt: a.cnt + b.cnt,
    va: a.va.map((x, k) => x + b.va[k]),
    su: a.su.map((x, k) => x + b.su[k]),
    mn: a.mn.map((x, k) => !(b.mn[k] >= x) ? b.mn[k] : x).map((x, k) => x !== x ? a.mn[k] : x),
    mx: a.mx.map((x, k) => !(b.mx[k] <= x) ? b.mx[k] : x).map((x, k) => x !== x ? a.mx[k] : x)
  });
  const carry = new Array(C);
  for (let c = 0; c < C; c++) {
    if (!cont[c]) {
      carry[c] = empty();
      continue;
    }
    const prev = sums[c - 1];
    carry[c] = add(prev.single && cont[c - 1] ? carry[c - 1] : empty(), prev.last);
  }
  const firstTotal = new Array(C).fill(-1), lastTotal = new Array(C).fill(-1);
  for (let c = 0; c + 1 < C; c++) {
    if (!cont[c + 1] || sums[c].single && cont[c]) continue;
    let total = sums[c].last.len, c1 = c + 1;
    for (; ; ) {
      total += sums[c1].first.len;
      if (sums[c1].single && c1 + 1 < C && cont[c1 + 1]) {
        c1++;
        continue;
      }
      break;
    }
    lastTotal[c] = total;
    for (let q = c + 1; q <= c1; q++) firstTotal[q] = total;
  }
  const baseV = [], baseS = [];
  {
    const v = new Array(NM).fill(0), su = new Array(NM).fill(0);
    for (let c = 0; c < C; c++) {
      baseV.push(v.slice());
      baseS.push(su.slice());
      if (framed) for (let k = 0; k < NM; k++) {
        v[k] += sums[c].pv[k];
        su[k] += sums[c].ps[k];
      }
    }
    baseV.push(v.slice());
    baseS.push(su.slice());
  }
  const vkeys = [];
  const vIndex = ops.map((o) => {
    if (!o.value) return -1;
    const j = vkeys.length;
    vkeys.push(o.value.key);
    pool.ensureColumn(o.value.key, "f64", o.value.view.buffer);
    vkeys.push(o.value.tagKey || "");
    if (o.value.tagKey) pool.ensureColumn(o.value.tagKey, "u8", o.value.tag.buffer);
    return j;
  });
  const vcols = vkeys.filter((k) => k);
  const opCodes = ops.map((o) => o.op);
  const p3cols = [...mkeys, ...vcols];
  let vslot = 0;
  const vdecl = vIndex.map((j, o) => {
    if (j < 0) return "null";
    const val = `cols[${NM + vslot++}]`;
    const tg = ops[o].value.tagKey ? `cols[${NM + vslot++}]` : "null";
    return `[${val}, ${tg}]`;
  });
  const phase3 = `const S = bufs[0], L0 = bufs[1], L1 = bufs[2], L2 = bufs[3], L3 = bufs[4], L4 = bufs[5], A0 = bufs[6];
const A = [${Array.from({ length: NM }, (_x, j) => `[bufs[${7 + 4 * j}], bufs[${8 + 4 * j}], bufs[${9 + 4 * j}], bufs[${10 + 4 * j}]]`).join(", ")}];
const PRE = [${Array.from({ length: framed ? NM : 0 }, (_x, j) => `[bufs[${7 + 4 * NM + 2 * j}], bufs[${8 + 4 * NM + 2 * j}]]`).join(", ")}];
const OB = ${7 + 4 * NM + (framed ? 2 * NM : 0)};
const M = [${Array.from({ length: NM }, (_x, j) => `cols[${j}]`).join(", ")}];
const VF = [${vdecl.join(", ")}];
const ops = args.ops, mi = args.mi, prm = args.prm, f0 = args.frame[0], f1 = args.frame[1], framed = ${framed}, range = ${range};
const starts = args.starts, m = args.m;
// Prefix (valid, sum) of measure k before sorted position x.
const chunkOf = x => { let c = 0; while (c + 1 < starts.length && starts[c + 1] <= x) c++; return c; };
const preV = (k, x) => { if (x >= m) return args.baseV[starts.length][k]; const c = chunkOf(x); return args.baseV[c][k] + PRE[k][0][x]; };
const preS = (k, x) => { if (x >= m) return args.baseS[starts.length][k]; const c = chunkOf(x); return args.baseS[c][k] + PRE[k][1][x]; };
const firstPeer = x => x - (L0[x] - L1[x]), lastPeer = x => x + (L3[x] - L0[x]);
const val = (o, x) => { const F = VF[o]; if (F[1] && F[1][S[x]] !== 0) return F[1][S[x]] === 1 ? null : undefined; return F[0][S[x]]; };
for (let c = start; c < end; c++) {
  const [s, e] = args.bounds[c], cr = args.carry[c], ft = args.firstTotal[c], lt = args.lastTotal[c];
  const segEnd = args.cont[c] ? args.firstEnd[c] : s, lastStart = args.lastStart[c];
  for (let q = s; q < e; q++) {
    const inFirst = q < segEnd, r = S[q];
    const base = inFirst ? cr : null;
    let size = L4[q];
    if (inFirst && ft >= 0) size = ft; else if (q >= lastStart && lt >= 0) size = lt;
    const off = base ? base.len : 0;
    // Vega's frame of the row: [i0, i1) in its partition, which starts at sorted position ps.
    const li = off + L0[q], ps = q - li;
    let i0 = f0 == null ? 0 : Math.max(0, li - Math.abs(f0));
    let i1 = f1 == null ? size : Math.min(size, li + Math.abs(f1) + 1);
    if (range && i1 > i0) { i0 = firstPeer(ps + i0) - ps; i1 = lastPeer(ps + i1 - 1) + 1 - ps; }
    for (let o = 0; o < ops.length; o++) {
      const V = bufs[OB + 2 * o], G = bufs[OB + 2 * o + 1];
      let v, k = mi[o];
      if (VF[o]) {
        let x = -1;
        switch (ops[o]) {
          case "lag": x = li - prm[o] >= 0 ? q - prm[o] : -1; break;
          case "lead": x = li + prm[o] < size ? q + prm[o] : -1; break;
          case "first_value": x = ps + i0; break;
          case "last_value": x = ps + i1 - 1; break;
          case "nth_value": x = i0 + prm[o] - 1 < i1 ? ps + i0 + prm[o] - 1 : -1; break;
        }
        v = x < 0 ? null : val(o, x);
        if (v === undefined) G[r] = 2; else if (v === null) G[r] = 1; else { V[r] = v; G[r] = 0; }
        continue;
      }
      if (framed && ops[o] !== "row_number" && ops[o] !== "rank" && ops[o] !== "dense_rank" && ops[o] !== "percent_rank" && ops[o] !== "cume_dist") {
        const cnt = i1 - i0;
        if (ops[o] === "count") v = cnt;
        else {
          const va = preV(k, ps + i1) - preV(k, ps + i0);
          if (ops[o] === "valid") v = va;
          else if (ops[o] === "missing") v = cnt - va;
          else if (!va) v = undefined;
          else if (ops[o] === "sum") v = preS(k, ps + i1) - preS(k, ps + i0);
          else if (ops[o] === "mean" || ops[o] === "average") v = (preS(k, ps + i1) - preS(k, ps + i0)) / va;
          else {
            let b = NaN;
            const mx = ops[o] === "max", Mk = M[k];
            for (let x = ps + i0; x < ps + i1; x++) { const y = Mk[S[x]]; if (y === y && (b !== b || (mx ? y > b : y < b))) b = y; }
            v = b;
          }
        }
        if (v === undefined) G[r] = 2; else { V[r] = v; G[r] = 0; }
        continue;
      }
      switch (ops[o]) {
        case "row_number": v = off + L0[q] + 1; break;
        case "rank": v = off + L1[q] + 1; break;
        case "dense_rank": v = (base ? base.dense : 0) + L2[q]; break;
        case "percent_rank": v = (off + L1[q]) / (size - 1); break;
        // As WindowOps.cume_dist: the first row of a partition is 1 / size, even with peers.
        case "cume_dist": v = (off + L0[q] === 0 ? 1 : off + L3[q] + 1) / size; break;
        case "count": v = (base ? base.cnt : 0) + A0[q]; break;
        default: {
          const va = (base ? base.va[k] : 0) + A[k][0][q];
          if (ops[o] === "valid") { v = va; break; }
          if (ops[o] === "missing") { v = (base ? base.cnt : 0) + A0[q] - va; break; }
          if (!va) { v = undefined; break; }
          const su = (base ? base.su[k] : 0) + A[k][1][q];
          if (ops[o] === "sum") v = su;
          else if (ops[o] === "mean" || ops[o] === "average") v = su / va;
          else if (ops[o] === "min") { const a = base ? base.mn[k] : NaN, b = A[k][2][q]; v = a !== a ? b : b !== b ? a : Math.min(a, b); }
          else { const a = base ? base.mx[k] : NaN, b = A[k][3][q]; v = a !== a ? b : b !== b ? a : Math.max(a, b); }
        }
      }
      if (v === undefined) G[r] = 2; else { V[r] = v; G[r] = 0; }
    }
  }
}
return 0;`;
  const firstEnd = sums.map((x) => x.single ? x.first.end : x.first.end);
  const lastStart = sums.map((x) => x.last.start);
  await (0, import_resident13.map)({ key: `pv:win3:${NM}:${framed}:${range}:${vdecl.join("|")}`, src: phase3 }, {
    pool,
    n: C,
    threads: C,
    cols: p3cols,
    bufs: [...bufs, ...outs.flatMap((o) => [sb(o.view, "f64"), sb(o.tag, "u8")])],
    args: {
      bounds,
      carry,
      cont,
      firstTotal,
      lastTotal,
      firstEnd,
      lastStart,
      ops: opCodes,
      mi: mIndex,
      prm: ops.map((o) => o.param ?? 0),
      frame,
      starts: bounds.map((b) => b[0]),
      m,
      baseV,
      baseS
    }
  });
  const seqOps = ops.map((o, i) => o.op === "sum" || o.op === "mean" || o.op === "average" ? i : -1).filter((i) => i >= 0);
  if (seqOps.length) {
    const pstarts = [];
    sums.forEach((x, c) => {
      if (!cont[c]) pstarts.push(bounds[c][0]);
      for (const q of x.starts) pstarts.push(q);
    });
    const parts = pstarts.map((p0, i) => [p0, i + 1 < pstarts.length ? pstarts[i + 1] : m]);
    const W = Math.min(pool.size, parts.length);
    const groups = [];
    let gi = 0;
    for (let w = 0; w < W && gi < parts.length; w++) {
      const target = (w + 1) * m / W;
      let gj = gi + 1;
      while (gj < parts.length && parts[gj][0] < target) gj++;
      if (w === W - 1) gj = parts.length;
      groups.push([gi, gj]);
      gi = gj;
    }
    const seqKeys = [...new Set(seqOps.map((i) => mIndex[i]))];
    const OB0 = 7 + 4 * NM + (framed ? 2 * NM : 0);
    const phase4 = `const S = bufs[0], L0 = bufs[1], L1 = bufs[2], L3 = bufs[4];
const M = [${Array.from({ length: NM }, (_x, j) => `cols[${j}]`).join(", ")}];
const f0 = args.frame[0], f1 = args.frame[1], range = ${range}, parts = args.parts, seq = args.seq, mi = args.mi, kinds = args.kinds, keys = args.keys;
const OUT = seq.map(o => [bufs[${OB0} + 2 * o], bufs[${OB0} + 2 * o + 1]]);
const firstPeer = x => x - (L0[x] - L1[x]), lastPeer = x => x + (L3[x] - L0[x]);
const valid = new Float64Array(keys.length), sum = new Float64Array(keys.length), mean = new Float64Array(keys.length);
const slot = mi.map(k => keys.indexOf(k));
const add = (x) => { const r = S[x]; for (let a = 0; a < keys.length; a++) { const v = M[keys[a]][r]; if (v !== v) continue; ++valid[a]; sum[a] += +v; const d = v - mean[a]; mean[a] += d / valid[a]; } };
const rem = (x) => { const r = S[x]; for (let a = 0; a < keys.length; a++) { const v = M[keys[a]][r]; if (v !== v) continue; --valid[a]; sum[a] -= v; const d = v - mean[a]; mean[a] -= valid[a] ? d / valid[a] : mean[a]; } };
for (let g = start; g < end; g++) for (let p = args.groups[g][0]; p < args.groups[g][1]; p++) {
  const ps = parts[p][0], n = parts[p][1] - ps;
  valid.fill(0); sum.fill(0); mean.fill(0);
  let i0 = 0, i1 = 0;
  for (let i = 0; i < n; i++) {
    const p0 = i0, p1 = i1;
    i0 = f0 == null ? 0 : Math.max(0, i - Math.abs(f0));
    i1 = f1 == null ? n : Math.min(n, i + Math.abs(f1) + 1);
    if (range) {
      if (i0 > 0) i0 = firstPeer(ps + i0) - ps;
      if (i1 - 1 < n - 1) i1 = lastPeer(ps + i1 - 1) + 1 - ps;
    }
    for (let j = p0; j < i0; j++) rem(ps + j);
    for (let j = p1; j < i1; j++) add(ps + j);
    const r = S[ps + i];
    for (let q = 0; q < seq.length; q++) {
      const a = slot[q], V = OUT[q][0], G = OUT[q][1];
      if (!valid[a]) { G[r] = 2; continue; }
      V[r] = kinds[q] === "sum" ? sum[a] : mean[a];
      G[r] = 0;
    }
  }
}
return 0;`;
    await (0, import_resident13.map)({ key: `pv:win4:${NM}:${range}`, src: phase4 }, {
      pool,
      n: groups.length,
      threads: groups.length,
      cols: mkeys,
      bufs: [...bufs, ...outs.flatMap((o) => [sb(o.view, "f64"), sb(o.tag, "u8")])],
      args: { frame, parts, groups, seq: seqOps, mi: seqOps.map((i) => mIndex[i]), kinds: seqOps.map((i) => ops[i].op), keys: seqKeys }
    });
  }
  return outs;
}

// src/runtime/operators.ts
var import_resident16 = __toESM(require_resident());

// src/runtime/derived.ts
var import_resident14 = __toESM(require_resident());

// src/runtime/workerlib.generated.ts
var WORKER_LIBRARY = '"use strict";var __pwlib=(()=>{var la=Object.defineProperty;var i0=Object.getOwnPropertyDescriptor;var a0=Object.getOwnPropertyNames;var o0=Object.prototype.hasOwnProperty;var Cf=(e,t)=>{for(var n in t)la(e,n,{get:t[n],enumerable:!0})},f0=(e,t,n,r)=>{if(t&&typeof t=="object"||typeof t=="function")for(let i of a0(t))!o0.call(e,i)&&i!==n&&la(e,i,{get:()=>t[i],enumerable:!(r=i0(t,i))||r.enumerable});return e};var s0=e=>f0(la({},"__esModule",{value:!0}),e);var tm={};Cf(tm,{lib:()=>em});function De(e,t,n){return Object.assign(e,{fields:t||[],fname:n})}function $r(e){return e.length===1?c0(e[0]):u0(e)}var c0=e=>function(t){return t[e]},u0=e=>{let t=e.length;return function(n){for(let r=0;r<t;++r)n=n[e[r]];return n}};function B(e){throw Error(e)}function qn(e){let t=[],n=e.length,r=null,i=0,a="",o,f,s;e=e+"";function c(){t.push(a+e.substring(o,f)),a="",o=f+1}for(o=f=0;f<n;++f)if(s=e[f],s==="\\\\")a+=e.substring(o,f++),o=f;else if(s===r)c(),r=null,i=-1;else{if(r)continue;o===i&&s===\'"\'||o===i&&s==="\'"?(o=f+1,r=s):s==="."&&!i?f>o?c():o=f+1:s==="["?(f>o&&c(),i=o=f+1):s==="]"&&(i||B("Access path missing open bracket: "+e),i>0&&c(),i=0,o=f+1)}return i&&B("Access path missing closing bracket: "+e),r&&B("Access path missing closing quote: "+e),f>o&&(f++,c()),t}function $t(e,t,n){let r=qn(e),i=r.length===1?r[0]:e;return De((n&&n.get||$r)(r),[i],t||i)}var l0=$t("id"),ha=De(e=>e,[],"identity"),Pt=De(()=>0,[],"zero"),da=De(()=>1,[],"one"),Pr=De(()=>!0,[],"true"),h0=De(()=>!1,[],"false");var d0=new Set([...Object.getOwnPropertyNames(Object.prototype).filter(e=>typeof Object.prototype[e]=="function"),"__proto__","then"]);var Z=Array.isArray;function Fe(e){return e===Object(e)}function ie(e){return e[e.length-1]}function fn(e){return e==null||e===""?null:+e}function We(e){return e!=null?Z(e)?e:[e]:[]}function ke(e){return typeof e=="function"}function Or(e){return ke(e)?e:()=>e}function $e(e,...t){for(let n of t)for(let r in n)e[r]=n[r];return e}function ae(e,t){return Object.hasOwn(e,t)}function pa(e,t,n){let r=e.prototype=Object.create(t.prototype);return Object.defineProperty(r,"constructor",{value:e,writable:!0,enumerable:!0,configurable:!0}),$e(r,n)}function Ir(e){return e!=null&&ke(e[Symbol.iterator])}function tt(e){return typeof e=="string"}var b0=1e4;function ba(e){e=+e||b0;let t,n,r,i=()=>{t={},n={},r=0},a=(o,f)=>(++r>e&&(n=t,t={},r=1),t[o]=f);return i(),{clear:i,has:o=>ae(t,o)||ae(n,o),get:o=>ae(t,o)?t[o]:ae(n,o)?a(o,n[o]):void 0,set:(o,f)=>ae(t,o)?t[o]=f:a(o,f)}}function sn(e){return Z(e)?`[${e.map(t=>t===null?"null":sn(t))}]`:Fe(e)||tt(e)?JSON.stringify(e).replaceAll("\\u2028","\\\\u2028").replaceAll("\\u2029","\\\\u2029"):e}function dt(e){let t={},n=e.length;for(let r=0;r<n;++r)t[e[r]+""]=!0;return t}function ln(e,t){return e==null||t==null?NaN:e<t?-1:e>t?1:e>=t?0:NaN}function w0(e,t){return e==null||t==null?NaN:t<e?-1:t>e?1:t>=e?0:NaN}function Fr(e){let t,n,r;e.length!==2?(t=ln,n=(f,s)=>ln(e(f),s),r=(f,s)=>e(f)-s):(t=e===ln||e===w0?e:M0,n=e,r=e);function i(f,s,c=0,l=f.length){if(c<l){if(t(s,s)!==0)return l;do{let u=c+l>>>1;n(f[u],s)<0?c=u+1:l=u}while(c<l)}return c}function a(f,s,c=0,l=f.length){if(c<l){if(t(s,s)!==0)return l;do{let u=c+l>>>1;n(f[u],s)<=0?c=u+1:l=u}while(c<l)}return c}function o(f,s,c=0,l=f.length){let u=i(f,s,c,l-1);return u>c&&r(f[u-1],s)>-r(f[u],s)?u-1:u}return{left:i,center:o,right:a}}function M0(){return 0}function Nf(e){return e===null?NaN:+e}var Rf=Fr(ln),Ge=Rf.right,c8=Rf.left,u8=Fr(Nf).center;var l8=Ef(Df),h8=Ef(k0);function Ef(e){return function(t,n,r=n){if(!((n=+n)>=0))throw new RangeError("invalid rx");if(!((r=+r)>=0))throw new RangeError("invalid ry");let{data:i,width:a,height:o}=t;if(!((a=Math.floor(a))>=0))throw new RangeError("invalid width");if(!((o=Math.floor(o!==void 0?o:i.length/a))>=0))throw new RangeError("invalid height");if(!a||!o||!n&&!r)return t;let f=n&&e(n),s=r&&e(r),c=i.slice();return f&&s?(cn(f,c,i,a,o),cn(f,i,c,a,o),cn(f,c,i,a,o),un(s,i,c,a,o),un(s,c,i,a,o),un(s,i,c,a,o)):f?(cn(f,i,c,a,o),cn(f,c,i,a,o),cn(f,i,c,a,o)):s&&(un(s,i,c,a,o),un(s,c,i,a,o),un(s,i,c,a,o)),t}}function cn(e,t,n,r,i){for(let a=0,o=r*i;a<o;)e(t,n,a,a+=r,1)}function un(e,t,n,r,i){for(let a=0,o=r*i;a<r;++a)e(t,n,a,a+o,r)}function k0(e){let t=Df(e);return(n,r,i,a,o)=>{i<<=2,a<<=2,o<<=2,t(n,r,i+0,a+0,o),t(n,r,i+1,a+1,o),t(n,r,i+2,a+2,o),t(n,r,i+3,a+3,o)}}function Df(e){let t=Math.floor(e);if(t===e)return T0(e);let n=e-t,r=2*e+1;return(i,a,o,f,s)=>{if(!((f-=s)>=o))return;let c=t*a[o],l=s*t,u=l+s;for(let h=o,d=o+l;h<d;h+=s)c+=a[Math.min(f,h)];for(let h=o,d=f;h<=d;h+=s)c+=a[Math.min(f,h+l)],i[h]=(c+n*(a[Math.max(o,h-u)]+a[Math.min(f,h+u)]))/r,c-=a[Math.max(o,h-l)]}}function T0(e){let t=2*e+1;return(n,r,i,a,o)=>{if(!((a-=o)>=i))return;let f=e*r[i],s=o*e;for(let c=i,l=i+s;c<l;c+=o)f+=r[Math.min(a,c)];for(let c=i,l=a;c<=l;c+=o)f+=r[Math.min(a,c+s)],n[c]=f/t,f-=r[Math.max(i,c-s)]}}var zn=class extends Map{constructor(t,n=A0){if(super(),Object.defineProperties(this,{_intern:{value:new Map},_key:{value:n}}),t!=null)for(let[r,i]of t)this.set(r,i)}get(t){return super.get(Af(this,t))}has(t){return super.has(Af(this,t))}set(t,n){return super.set(S0(this,t),n)}delete(t){return super.delete(C0(this,t))}};function Af({_intern:e,_key:t},n){let r=t(n);return e.has(r)?e.get(r):n}function S0({_intern:e,_key:t},n){let r=t(n);return e.has(r)?e.get(r):(e.set(r,n),n)}function C0({_intern:e,_key:t},n){let r=t(n);return e.has(r)&&(n=e.get(r),e.delete(r)),n}function A0(e){return e!==null&&typeof e=="object"?e.valueOf():e}var N0=Array.prototype,d8=N0.slice;var R0=Math.sqrt(50),E0=Math.sqrt(10),D0=Math.sqrt(2);function Lr(e,t,n){let r=(t-e)/Math.max(0,n),i=Math.floor(Math.log10(r)),a=r/Math.pow(10,i),o=a>=R0?10:a>=E0?5:a>=D0?2:1,f,s,c;return i<0?(c=Math.pow(10,-i)/o,f=Math.round(e*c),s=Math.round(t*c),f/c<e&&++f,s/c>t&&--s,c=-c):(c=Math.pow(10,i)*o,f=Math.round(e/c),s=Math.round(t/c),f*c<e&&++f,s*c>t&&--s),s<f&&.5<=n&&n<2?Lr(e,t,n*2):[f,s,c]}function qr(e,t,n){if(t=+t,e=+e,n=+n,!(n>0))return[];if(e===t)return[e];let r=t<e,[i,a,o]=r?Lr(t,e,n):Lr(e,t,n);if(!(a>=i))return[];let f=a-i+1,s=new Array(f);if(r)if(o<0)for(let c=0;c<f;++c)s[c]=(a-c)/-o;else for(let c=0;c<f;++c)s[c]=(a-c)*o;else if(o<0)for(let c=0;c<f;++c)s[c]=(i+c)/-o;else for(let c=0;c<f;++c)s[c]=(i+c)*o;return s}function Ur(e,t,n){return t=+t,e=+e,n=+n,Lr(e,t,n)[2]}function pt(e,t,n){t=+t,e=+e,n=+n;let r=t<e,i=r?Ur(t,e,n):Ur(e,t,n);return(r?-1:1)*(i<0?1/-i:i)}function $f(e,t,n=Nf){if(!(!(r=e.length)||isNaN(t=+t))){if(t<=0||r<2)return+n(e[0],0,e);if(t>=1)return+n(e[r-1],r-1,e);var r,i=(r-1)*t,a=Math.floor(i),o=+n(e[a],a,e),f=+n(e[a+1],a+1,e);return o+(f-o)*(i-a)}}function ma(e,t,n){e=+e,t=+t,n=(i=arguments.length)<2?(t=e,e=0,1):i<3?1:+n;for(var r=-1,i=Math.max(0,Math.ceil((t-e)/n))|0,a=new Array(i);++r<i;)a[r]=e+r*n;return a}var p8=$0(Math.random);function $0(e){return function(n,r=0,i=n.length){let a=i-(r=+r);for(;a;){let o=e()*a--|0,f=n[a+r];n[a+r]=n[o+r],n[o+r]=f}return n}}var Da={};Cf(Da,{interpolate:()=>gt,interpolateArray:()=>Q0,interpolateBasis:()=>as,interpolateBasisClosed:()=>os,interpolateCubehelix:()=>ph,interpolateCubehelixLong:()=>Gn,interpolateDate:()=>ls,interpolateDiscrete:()=>K0,interpolateHcl:()=>hh,interpolateHclLong:()=>dh,interpolateHsl:()=>ch,interpolateHslLong:()=>uh,interpolateHue:()=>eh,interpolateLab:()=>lh,interpolateNumber:()=>Oe,interpolateNumberArray:()=>Ea,interpolateObject:()=>hs,interpolateRgb:()=>Ca,interpolateRgbBasis:()=>Ra,interpolateRgbBasisClosed:()=>V0,interpolateRound:()=>Wn,interpolateString:()=>ds,interpolateTransformCss:()=>rh,interpolateTransformSvg:()=>ih,interpolateZoom:()=>sh,piecewise:()=>jn,quantize:()=>bh});function bn(e,t,n){e.prototype=t.prototype=n,n.constructor=e}function Hn(e,t){var n=Object.create(e.prototype);for(var r in t)n[r]=t[r];return n}function bt(){}var Ut=.7,pn=1/Ut,hn="\\\\s*([+-]?\\\\d+)\\\\s*",Yn="\\\\s*([+-]?(?:\\\\d*\\\\.)?\\\\d+(?:[eE][+-]?\\\\d+)?)\\\\s*",je="\\\\s*([+-]?(?:\\\\d*\\\\.)?\\\\d+(?:[eE][+-]?\\\\d+)?)%\\\\s*",P0=/^#([0-9a-f]{3,8})$/,O0=new RegExp(`^rgb\\\\(${hn},${hn},${hn}\\\\)$`),I0=new RegExp(`^rgb\\\\(${je},${je},${je}\\\\)$`),L0=new RegExp(`^rgba\\\\(${hn},${hn},${hn},${Yn}\\\\)$`),U0=new RegExp(`^rgba\\\\(${je},${je},${je},${Yn}\\\\)$`),F0=new RegExp(`^hsl\\\\(${Yn},${je},${je}\\\\)$`),q0=new RegExp(`^hsla\\\\(${Yn},${je},${je},${Yn}\\\\)$`),Pf={aliceblue:15792383,antiquewhite:16444375,aqua:65535,aquamarine:8388564,azure:15794175,beige:16119260,bisque:16770244,black:0,blanchedalmond:16772045,blue:255,blueviolet:9055202,brown:10824234,burlywood:14596231,cadetblue:6266528,chartreuse:8388352,chocolate:13789470,coral:16744272,cornflowerblue:6591981,cornsilk:16775388,crimson:14423100,cyan:65535,darkblue:139,darkcyan:35723,darkgoldenrod:12092939,darkgray:11119017,darkgreen:25600,darkgrey:11119017,darkkhaki:12433259,darkmagenta:9109643,darkolivegreen:5597999,darkorange:16747520,darkorchid:10040012,darkred:9109504,darksalmon:15308410,darkseagreen:9419919,darkslateblue:4734347,darkslategray:3100495,darkslategrey:3100495,darkturquoise:52945,darkviolet:9699539,deeppink:16716947,deepskyblue:49151,dimgray:6908265,dimgrey:6908265,dodgerblue:2003199,firebrick:11674146,floralwhite:16775920,forestgreen:2263842,fuchsia:16711935,gainsboro:14474460,ghostwhite:16316671,gold:16766720,goldenrod:14329120,gray:8421504,green:32768,greenyellow:11403055,grey:8421504,honeydew:15794160,hotpink:16738740,indianred:13458524,indigo:4915330,ivory:16777200,khaki:15787660,lavender:15132410,lavenderblush:16773365,lawngreen:8190976,lemonchiffon:16775885,lightblue:11393254,lightcoral:15761536,lightcyan:14745599,lightgoldenrodyellow:16448210,lightgray:13882323,lightgreen:9498256,lightgrey:13882323,lightpink:16758465,lightsalmon:16752762,lightseagreen:2142890,lightskyblue:8900346,lightslategray:7833753,lightslategrey:7833753,lightsteelblue:11584734,lightyellow:16777184,lime:65280,limegreen:3329330,linen:16445670,magenta:16711935,maroon:8388608,mediumaquamarine:6737322,mediumblue:205,mediumorchid:12211667,mediumpurple:9662683,mediumseagreen:3978097,mediumslateblue:8087790,mediumspringgreen:64154,mediumturquoise:4772300,mediumvioletred:13047173,midnightblue:1644912,mintcream:16121850,mistyrose:16770273,moccasin:16770229,navajowhite:16768685,navy:128,oldlace:16643558,olive:8421376,olivedrab:7048739,orange:16753920,orangered:16729344,orchid:14315734,palegoldenrod:15657130,palegreen:10025880,paleturquoise:11529966,palevioletred:14381203,papayawhip:16773077,peachpuff:16767673,peru:13468991,pink:16761035,plum:14524637,powderblue:11591910,purple:8388736,rebeccapurple:6697881,red:16711680,rosybrown:12357519,royalblue:4286945,saddlebrown:9127187,salmon:16416882,sandybrown:16032864,seagreen:3050327,seashell:16774638,sienna:10506797,silver:12632256,skyblue:8900331,slateblue:6970061,slategray:7372944,slategrey:7372944,snow:16775930,springgreen:65407,steelblue:4620980,tan:13808780,teal:32896,thistle:14204888,tomato:16737095,turquoise:4251856,violet:15631086,wheat:16113331,white:16777215,whitesmoke:16119285,yellow:16776960,yellowgreen:10145074};bn(bt,gn,{copy(e){return Object.assign(new this.constructor,this,e)},displayable(){return this.rgb().displayable()},hex:Of,formatHex:Of,formatHex8:z0,formatHsl:Y0,formatRgb:If,toString:If});function Of(){return this.rgb().formatHex()}function z0(){return this.rgb().formatHex8()}function Y0(){return Wf(this).formatHsl()}function If(){return this.rgb().formatRgb()}function gn(e){var t,n;return e=(e+"").trim().toLowerCase(),(t=P0.exec(e))?(n=t[1].length,t=parseInt(t[1],16),n===6?Lf(t):n===3?new J(t>>8&15|t>>4&240,t>>4&15|t&240,(t&15)<<4|t&15,1):n===8?zr(t>>24&255,t>>16&255,t>>8&255,(t&255)/255):n===4?zr(t>>12&15|t>>8&240,t>>8&15|t>>4&240,t>>4&15|t&240,((t&15)<<4|t&15)/255):null):(t=O0.exec(e))?new J(t[1],t[2],t[3],1):(t=I0.exec(e))?new J(t[1]*255/100,t[2]*255/100,t[3]*255/100,1):(t=L0.exec(e))?zr(t[1],t[2],t[3],t[4]):(t=U0.exec(e))?zr(t[1]*255/100,t[2]*255/100,t[3]*255/100,t[4]):(t=F0.exec(e))?qf(t[1],t[2]/100,t[3]/100,1):(t=q0.exec(e))?qf(t[1],t[2]/100,t[3]/100,t[4]):Pf.hasOwnProperty(e)?Lf(Pf[e]):e==="transparent"?new J(NaN,NaN,NaN,0):null}function Lf(e){return new J(e>>16&255,e>>8&255,e&255,1)}function zr(e,t,n,r){return r<=0&&(e=t=n=NaN),new J(e,t,n,r)}function Ma(e){return e instanceof bt||(e=gn(e)),e?(e=e.rgb(),new J(e.r,e.g,e.b,e.opacity)):new J}function Ft(e,t,n,r){return arguments.length===1?Ma(e):new J(e,t,n,r??1)}function J(e,t,n,r){this.r=+e,this.g=+t,this.b=+n,this.opacity=+r}bn(J,Ft,Hn(bt,{brighter(e){return e=e==null?pn:Math.pow(pn,e),new J(this.r*e,this.g*e,this.b*e,this.opacity)},darker(e){return e=e==null?Ut:Math.pow(Ut,e),new J(this.r*e,this.g*e,this.b*e,this.opacity)},rgb(){return this},clamp(){return new J(It(this.r),It(this.g),It(this.b),Br(this.opacity))},displayable(){return-.5<=this.r&&this.r<255.5&&-.5<=this.g&&this.g<255.5&&-.5<=this.b&&this.b<255.5&&0<=this.opacity&&this.opacity<=1},hex:Uf,formatHex:Uf,formatHex8:B0,formatRgb:Ff,toString:Ff}));function Uf(){return`#${Ot(this.r)}${Ot(this.g)}${Ot(this.b)}`}function B0(){return`#${Ot(this.r)}${Ot(this.g)}${Ot(this.b)}${Ot((isNaN(this.opacity)?1:this.opacity)*255)}`}function Ff(){let e=Br(this.opacity);return`${e===1?"rgb(":"rgba("}${It(this.r)}, ${It(this.g)}, ${It(this.b)}${e===1?")":`, ${e})`}`}function Br(e){return isNaN(e)?1:Math.max(0,Math.min(1,e))}function It(e){return Math.max(0,Math.min(255,Math.round(e)||0))}function Ot(e){return e=It(e),(e<16?"0":"")+e.toString(16)}function qf(e,t,n,r){return r<=0?e=t=n=NaN:n<=0||n>=1?e=t=NaN:t<=0&&(e=NaN),new qe(e,t,n,r)}function Wf(e){if(e instanceof qe)return new qe(e.h,e.s,e.l,e.opacity);if(e instanceof bt||(e=gn(e)),!e)return new qe;if(e instanceof qe)return e;e=e.rgb();var t=e.r/255,n=e.g/255,r=e.b/255,i=Math.min(t,n,r),a=Math.max(t,n,r),o=NaN,f=a-i,s=(a+i)/2;return f?(t===a?o=(n-r)/f+(n<r)*6:n===a?o=(r-t)/f+2:o=(t-n)/f+4,f/=s<.5?a+i:2-a-i,o*=60):f=s>0&&s<1?0:o,new qe(o,f,s,e.opacity)}function Wr(e,t,n,r){return arguments.length===1?Wf(e):new qe(e,t,n,r??1)}function qe(e,t,n,r){this.h=+e,this.s=+t,this.l=+n,this.opacity=+r}bn(qe,Wr,Hn(bt,{brighter(e){return e=e==null?pn:Math.pow(pn,e),new qe(this.h,this.s,this.l*e,this.opacity)},darker(e){return e=e==null?Ut:Math.pow(Ut,e),new qe(this.h,this.s,this.l*e,this.opacity)},rgb(){var e=this.h%360+(this.h<0)*360,t=isNaN(e)||isNaN(this.s)?0:this.s,n=this.l,r=n+(n<.5?n:1-n)*t,i=2*n-r;return new J(ya(e>=240?e-240:e+120,i,r),ya(e,i,r),ya(e<120?e+240:e-120,i,r),this.opacity)},clamp(){return new qe(zf(this.h),Yr(this.s),Yr(this.l),Br(this.opacity))},displayable(){return(0<=this.s&&this.s<=1||isNaN(this.s))&&0<=this.l&&this.l<=1&&0<=this.opacity&&this.opacity<=1},formatHsl(){let e=Br(this.opacity);return`${e===1?"hsl(":"hsla("}${zf(this.h)}, ${Yr(this.s)*100}%, ${Yr(this.l)*100}%${e===1?")":`, ${e})`}`}}));function zf(e){return e=(e||0)%360,e<0?e+360:e}function Yr(e){return Math.max(0,Math.min(1,e||0))}function ya(e,t,n){return(e<60?t+(n-t)*e/60:e<180?n:e<240?t+(n-t)*(240-e)/60:t)*255}var Gf=Math.PI/180,jf=180/Math.PI,Hr=18,Xf=.96422,Vf=1,Qf=.82521,Zf=4/29,dn=6/29,Jf=3*dn*dn,H0=dn*dn*dn;function Kf(e){if(e instanceof Xe)return new Xe(e.l,e.a,e.b,e.opacity);if(e instanceof nt)return es(e);e instanceof J||(e=Ma(e));var t=wa(e.r),n=wa(e.g),r=wa(e.b),i=_a((.2225045*t+.7168786*n+.0606169*r)/Vf),a,o;return t===n&&n===r?a=o=i:(a=_a((.4360747*t+.3850649*n+.1430804*r)/Xf),o=_a((.0139322*t+.0971045*n+.7141733*r)/Qf)),new Xe(116*i-16,500*(a-i),200*(i-o),e.opacity)}function Gr(e,t,n,r){return arguments.length===1?Kf(e):new Xe(e,t,n,r??1)}function Xe(e,t,n,r){this.l=+e,this.a=+t,this.b=+n,this.opacity=+r}bn(Xe,Gr,Hn(bt,{brighter(e){return new Xe(this.l+Hr*(e??1),this.a,this.b,this.opacity)},darker(e){return new Xe(this.l-Hr*(e??1),this.a,this.b,this.opacity)},rgb(){var e=(this.l+16)/116,t=isNaN(this.a)?e:e+this.a/500,n=isNaN(this.b)?e:e-this.b/200;return t=Xf*va(t),e=Vf*va(e),n=Qf*va(n),new J(xa(3.1338561*t-1.6168667*e-.4906146*n),xa(-.9787684*t+1.9161415*e+.033454*n),xa(.0719453*t-.2289914*e+1.4052427*n),this.opacity)}}));function _a(e){return e>H0?Math.pow(e,1/3):e/Jf+Zf}function va(e){return e>dn?e*e*e:Jf*(e-Zf)}function xa(e){return 255*(e<=.0031308?12.92*e:1.055*Math.pow(e,1/2.4)-.055)}function wa(e){return(e/=255)<=.04045?e/12.92:Math.pow((e+.055)/1.055,2.4)}function W0(e){if(e instanceof nt)return new nt(e.h,e.c,e.l,e.opacity);if(e instanceof Xe||(e=Kf(e)),e.a===0&&e.b===0)return new nt(NaN,0<e.l&&e.l<100?0:NaN,e.l,e.opacity);var t=Math.atan2(e.b,e.a)*jf;return new nt(t<0?t+360:t,Math.sqrt(e.a*e.a+e.b*e.b),e.l,e.opacity)}function jr(e,t,n,r){return arguments.length===1?W0(e):new nt(e,t,n,r??1)}function nt(e,t,n,r){this.h=+e,this.c=+t,this.l=+n,this.opacity=+r}function es(e){if(isNaN(e.h))return new Xe(e.l,0,0,e.opacity);var t=e.h*Gf;return new Xe(e.l,Math.cos(t)*e.c,Math.sin(t)*e.c,e.opacity)}bn(nt,jr,Hn(bt,{brighter(e){return new nt(this.h,this.c,this.l+Hr*(e??1),this.opacity)},darker(e){return new nt(this.h,this.c,this.l-Hr*(e??1),this.opacity)},rgb(){return es(this).rgb()}}));var ts=-.14861,ka=1.78277,Ta=-.29227,Xr=-.90649,Bn=1.97294,Yf=Bn*Xr,Bf=Bn*ka,Hf=ka*Ta-Xr*ts;function G0(e){if(e instanceof Lt)return new Lt(e.h,e.s,e.l,e.opacity);e instanceof J||(e=Ma(e));var t=e.r/255,n=e.g/255,r=e.b/255,i=(Hf*r+Yf*t-Bf*n)/(Hf+Yf-Bf),a=r-i,o=(Bn*(n-i)-Ta*a)/Xr,f=Math.sqrt(o*o+a*a)/(Bn*i*(1-i)),s=f?Math.atan2(o,a)*jf-120:NaN;return new Lt(s<0?s+360:s,f,i,e.opacity)}function Pe(e,t,n,r){return arguments.length===1?G0(e):new Lt(e,t,n,r??1)}function Lt(e,t,n,r){this.h=+e,this.s=+t,this.l=+n,this.opacity=+r}bn(Lt,Pe,Hn(bt,{brighter(e){return e=e==null?pn:Math.pow(pn,e),new Lt(this.h,this.s,this.l*e,this.opacity)},darker(e){return e=e==null?Ut:Math.pow(Ut,e),new Lt(this.h,this.s,this.l*e,this.opacity)},rgb(){var e=isNaN(this.h)?0:(this.h+120)*Gf,t=+this.l,n=isNaN(this.s)?0:this.s*t*(1-t),r=Math.cos(e),i=Math.sin(e);return new J(255*(t+n*(ts*r+ka*i)),255*(t+n*(Ta*r+Xr*i)),255*(t+n*(Bn*r)),this.opacity)}}));function is(e,t,n,r,i){var a=e*e,o=a*e;return((1-3*e+3*a-o)*t+(4-6*a+3*o)*n+(1+3*e+3*a-3*o)*r+o*i)/6}function as(e){var t=e.length-1;return function(n){var r=n<=0?n=0:n>=1?(n=1,t-1):Math.floor(n*t),i=e[r],a=e[r+1],o=r>0?e[r-1]:2*i-a,f=r<t-1?e[r+2]:2*a-i;return is((n-r/t)*t,o,i,a,f)}}function os(e){var t=e.length;return function(n){var r=Math.floor(((n%=1)<0?++n:n)*t),i=e[(r+t-1)%t],a=e[r%t],o=e[(r+1)%t],f=e[(r+2)%t];return is((n-r/t)*t,i,a,o,f)}}var Qr=e=>()=>e;function fs(e,t){return function(n){return e+n*t}}function j0(e,t,n){return e=Math.pow(e,n),t=Math.pow(t,n)-e,n=1/n,function(r){return Math.pow(e+r*t,n)}}function Zr(e,t){var n=t-e;return n?fs(e,n>180||n<-180?n-360*Math.round(n/360):n):Qr(isNaN(e)?t:e)}function X0(e){return(e=+e)==1?K:function(t,n){return n-t?j0(t,n,e):Qr(isNaN(t)?n:t)}}function K(e,t){var n=t-e;return n?fs(e,n):Qr(isNaN(e)?t:e)}var Ca=(function e(t){var n=X0(t);function r(i,a){var o=n((i=Ft(i)).r,(a=Ft(a)).r),f=n(i.g,a.g),s=n(i.b,a.b),c=K(i.opacity,a.opacity);return function(l){return i.r=o(l),i.g=f(l),i.b=s(l),i.opacity=c(l),i+""}}return r.gamma=e,r})(1);function ss(e){return function(t){var n=t.length,r=new Array(n),i=new Array(n),a=new Array(n),o,f;for(o=0;o<n;++o)f=Ft(t[o]),r[o]=f.r||0,i[o]=f.g||0,a[o]=f.b||0;return r=e(r),i=e(i),a=e(a),f.opacity=1,function(s){return f.r=r(s),f.g=i(s),f.b=a(s),f+""}}}var Ra=ss(as),V0=ss(os);function Ea(e,t){t||(t=[]);var n=e?Math.min(t.length,e.length):0,r=t.slice(),i;return function(a){for(i=0;i<n;++i)r[i]=e[i]*(1-a)+t[i]*a;return r}}function cs(e){return ArrayBuffer.isView(e)&&!(e instanceof DataView)}function Q0(e,t){return(cs(t)?Ea:us)(e,t)}function us(e,t){var n=t?t.length:0,r=e?Math.min(n,e.length):0,i=new Array(r),a=new Array(n),o;for(o=0;o<r;++o)i[o]=gt(e[o],t[o]);for(;o<n;++o)a[o]=t[o];return function(f){for(o=0;o<r;++o)a[o]=i[o](f);return a}}function ls(e,t){var n=new Date;return e=+e,t=+t,function(r){return n.setTime(e*(1-r)+t*r),n}}function Oe(e,t){return e=+e,t=+t,function(n){return e*(1-n)+t*n}}function hs(e,t){var n={},r={},i;(e===null||typeof e!="object")&&(e={}),(t===null||typeof t!="object")&&(t={});for(i in t)i in e?n[i]=gt(e[i],t[i]):r[i]=t[i];return function(a){for(i in n)r[i]=n[i](a);return r}}var Aa=/[-+]?(?:\\d+\\.?\\d*|\\.?\\d+)(?:[eE][-+]?\\d+)?/g,Sa=new RegExp(Aa.source,"g");function Z0(e){return function(){return e}}function J0(e){return function(t){return e(t)+""}}function ds(e,t){var n=Aa.lastIndex=Sa.lastIndex=0,r,i,a,o=-1,f=[],s=[];for(e=e+"",t=t+"";(r=Aa.exec(e))&&(i=Sa.exec(t));)(a=i.index)>n&&(a=t.slice(n,a),f[o]?f[o]+=a:f[++o]=a),(r=r[0])===(i=i[0])?f[o]?f[o]+=i:f[++o]=i:(f[++o]=null,s.push({i:o,x:Oe(r,i)})),n=Sa.lastIndex;return n<t.length&&(a=t.slice(n),f[o]?f[o]+=a:f[++o]=a),f.length<2?s[0]?J0(s[0].x):Z0(t):(t=s.length,function(c){for(var l=0,u;l<t;++l)f[(u=s[l]).i]=u.x(c);return f.join("")})}function gt(e,t){var n=typeof t,r;return t==null||n==="boolean"?Qr(t):(n==="number"?Oe:n==="string"?(r=gn(t))?(t=r,Ca):ds:t instanceof gn?Ca:t instanceof Date?ls:cs(t)?Ea:Array.isArray(t)?us:typeof t.valueOf!="function"&&typeof t.toString!="function"||isNaN(t)?hs:Oe)(e,t)}function K0(e){var t=e.length;return function(n){return e[Math.max(0,Math.min(t-1,Math.floor(n*t)))]}}function eh(e,t){var n=Zr(+e,+t);return function(r){var i=n(r);return i-360*Math.floor(i/360)}}function Wn(e,t){return e=+e,t=+t,function(n){return Math.round(e*(1-n)+t*n)}}var ns=180/Math.PI,Na={translateX:0,translateY:0,rotate:0,skewX:0,scaleX:1,scaleY:1};function ps(e,t,n,r,i,a){var o,f,s;return(o=Math.sqrt(e*e+t*t))&&(e/=o,t/=o),(s=e*n+t*r)&&(n-=e*s,r-=t*s),(f=Math.sqrt(n*n+r*r))&&(n/=f,r/=f,s/=f),e*r<t*n&&(e=-e,t=-t,s=-s,o=-o),{translateX:i,translateY:a,rotate:Math.atan2(t,e)*ns,skewX:Math.atan(s)*ns,scaleX:o,scaleY:f}}var Vr;function th(e){let t=new(typeof DOMMatrix=="function"?DOMMatrix:WebKitCSSMatrix)(e+"");return t.isIdentity?Na:ps(t.a,t.b,t.c,t.d,t.e,t.f)}function nh(e){return e==null||(Vr||(Vr=document.createElementNS("http://www.w3.org/2000/svg","g")),Vr.setAttribute("transform",e),!(e=Vr.transform.baseVal.consolidate()))?Na:(e=e.matrix,ps(e.a,e.b,e.c,e.d,e.e,e.f))}function bs(e,t,n,r){function i(c){return c.length?c.pop()+" ":""}function a(c,l,u,h,d,b){if(c!==u||l!==h){var p=d.push("translate(",null,t,null,n);b.push({i:p-4,x:Oe(c,u)},{i:p-2,x:Oe(l,h)})}else(u||h)&&d.push("translate("+u+t+h+n)}function o(c,l,u,h){c!==l?(c-l>180?l+=360:l-c>180&&(c+=360),h.push({i:u.push(i(u)+"rotate(",null,r)-2,x:Oe(c,l)})):l&&u.push(i(u)+"rotate("+l+r)}function f(c,l,u,h){c!==l?h.push({i:u.push(i(u)+"skewX(",null,r)-2,x:Oe(c,l)}):l&&u.push(i(u)+"skewX("+l+r)}function s(c,l,u,h,d,b){if(c!==u||l!==h){var p=d.push(i(d)+"scale(",null,",",null,")");b.push({i:p-4,x:Oe(c,u)},{i:p-2,x:Oe(l,h)})}else(u!==1||h!==1)&&d.push(i(d)+"scale("+u+","+h+")")}return function(c,l){var u=[],h=[];return c=e(c),l=e(l),a(c.translateX,c.translateY,l.translateX,l.translateY,u,h),o(c.rotate,l.rotate,u,h),f(c.skewX,l.skewX,u,h),s(c.scaleX,c.scaleY,l.scaleX,l.scaleY,u,h),c=l=null,function(d){for(var b=-1,p=h.length,g;++b<p;)u[(g=h[b]).i]=g.x(d);return u.join("")}}}var rh=bs(th,"px, ","px)","deg)"),ih=bs(nh,", ",")",")"),ah=1e-12;function rs(e){return((e=Math.exp(e))+1/e)/2}function oh(e){return((e=Math.exp(e))-1/e)/2}function fh(e){return((e=Math.exp(2*e))-1)/(e+1)}var sh=(function e(t,n,r){function i(a,o){var f=a[0],s=a[1],c=a[2],l=o[0],u=o[1],h=o[2],d=l-f,b=u-s,p=d*d+b*b,g,m;if(p<ah)m=Math.log(h/c)/t,g=function(k){return[f+k*d,s+k*b,c*Math.exp(t*k*m)]};else{var w=Math.sqrt(p),x=(h*h-c*c+r*p)/(2*c*n*w),v=(h*h-c*c-r*p)/(2*h*n*w),C=Math.log(Math.sqrt(x*x+1)-x),_=Math.log(Math.sqrt(v*v+1)-v);m=(_-C)/t,g=function(k){var E=k*m,z=rs(C),U=c/(n*w)*(z*fh(t*E+C)-oh(C));return[f+U*d,s+U*b,c*z/rs(t*E+C)]}}return g.duration=Math.abs(m)*1e3*t/Math.SQRT2,g}return i.rho=function(a){var o=Math.max(.001,+a),f=o*o,s=f*f;return e(o,f,s)},i})(Math.SQRT2,2,4);function gs(e){return function(t,n){var r=e((t=Wr(t)).h,(n=Wr(n)).h),i=K(t.s,n.s),a=K(t.l,n.l),o=K(t.opacity,n.opacity);return function(f){return t.h=r(f),t.s=i(f),t.l=a(f),t.opacity=o(f),t+""}}}var ch=gs(Zr),uh=gs(K);function lh(e,t){var n=K((e=Gr(e)).l,(t=Gr(t)).l),r=K(e.a,t.a),i=K(e.b,t.b),a=K(e.opacity,t.opacity);return function(o){return e.l=n(o),e.a=r(o),e.b=i(o),e.opacity=a(o),e+""}}function ms(e){return function(t,n){var r=e((t=jr(t)).h,(n=jr(n)).h),i=K(t.c,n.c),a=K(t.l,n.l),o=K(t.opacity,n.opacity);return function(f){return t.h=r(f),t.c=i(f),t.l=a(f),t.opacity=o(f),t+""}}}var hh=ms(Zr),dh=ms(K);function ys(e){return(function t(n){n=+n;function r(i,a){var o=e((i=Pe(i)).h,(a=Pe(a)).h),f=K(i.s,a.s),s=K(i.l,a.l),c=K(i.opacity,a.opacity);return function(l){return i.h=o(l),i.s=f(l),i.l=s(Math.pow(l,n)),i.opacity=c(l),i+""}}return r.gamma=t,r})(1)}var ph=ys(Zr),Gn=ys(K);function jn(e,t){t===void 0&&(t=e,e=gt);for(var n=0,r=t.length-1,i=t[0],a=new Array(r<0?0:r);n<r;)a[n]=e(i,i=t[++n]);return function(o){var f=Math.max(0,Math.min(r-1,Math.floor(o*=r)));return a[f](o-f)}}function bh(e,t){for(var n=new Array(t),r=0;r<t;++r)n[r]=e(r/(t-1));return n}function gh(e){return Math.abs(e=Math.round(e))>=1e21?e.toLocaleString("en").replace(/,/g,""):e.toString(10)}function Kr(e,t){if(!isFinite(e)||e===0)return null;var n=(e=t?e.toExponential(t-1):e.toExponential()).indexOf("e"),r=e.slice(0,n);return[r.length>1?r[0]+r.slice(2):r,+e.slice(n+1)]}function mn(e){return e=Kr(Math.abs(e)),e?e[1]:NaN}function mh(e,t){return function(n,r){for(var i=n.length,a=[],o=0,f=e[0],s=0;i>0&&f>0&&(s+f+1>r&&(f=Math.max(1,r-s)),a.push(n.substring(i-=f,i+f)),!((s+=f+1)>r));)f=e[o=(o+1)%e.length];return a.reverse().join(t)}}function yh(e){return function(t){return t.replace(/[0-9]/g,function(n){return e[+n]})}}var _h=/^(?:(.)?([<>=^]))?([+\\-( ])?([$#])?(0)?(\\d+)?(,)?(\\.\\d+)?(~)?([a-z%])?$/i;function rt(e){if(!(t=_h.exec(e)))throw new Error("invalid format: "+e);var t;return new $a({fill:t[1],align:t[2],sign:t[3],symbol:t[4],zero:t[5],width:t[6],comma:t[7],precision:t[8]&&t[8].slice(1),trim:t[9],type:t[10]})}rt.prototype=$a.prototype;function $a(e){this.fill=e.fill===void 0?" ":e.fill+"",this.align=e.align===void 0?">":e.align+"",this.sign=e.sign===void 0?"-":e.sign+"",this.symbol=e.symbol===void 0?"":e.symbol+"",this.zero=!!e.zero,this.width=e.width===void 0?void 0:+e.width,this.comma=!!e.comma,this.precision=e.precision===void 0?void 0:+e.precision,this.trim=!!e.trim,this.type=e.type===void 0?"":e.type+""}$a.prototype.toString=function(){return this.fill+this.align+this.sign+this.symbol+(this.zero?"0":"")+(this.width===void 0?"":Math.max(1,this.width|0))+(this.comma?",":"")+(this.precision===void 0?"":"."+Math.max(0,this.precision|0))+(this.trim?"~":"")+this.type};function vh(e){e:for(var t=e.length,n=1,r=-1,i;n<t;++n)switch(e[n]){case".":r=i=n;break;case"0":r===0&&(r=n),i=n;break;default:if(!+e[n])break e;r>0&&(r=0);break}return r>0?e.slice(0,r)+e.slice(i+1):e}var ei;function xh(e,t){var n=Kr(e,t);if(!n)return ei=void 0,e.toPrecision(t);var r=n[0],i=n[1],a=i-(ei=Math.max(-8,Math.min(8,Math.floor(i/3)))*3)+1,o=r.length;return a===o?r:a>o?r+new Array(a-o+1).join("0"):a>0?r.slice(0,a)+"."+r.slice(a):"0."+new Array(1-a).join("0")+Kr(e,Math.max(0,t+a-1))[0]}function _s(e,t){var n=Kr(e,t);if(!n)return e+"";var r=n[0],i=n[1];return i<0?"0."+new Array(-i).join("0")+r:r.length>i+1?r.slice(0,i+1)+"."+r.slice(i+1):r+new Array(i-r.length+2).join("0")}var vs={"%":(e,t)=>(e*100).toFixed(t),b:e=>Math.round(e).toString(2),c:e=>e+"",d:gh,e:(e,t)=>e.toExponential(t),f:(e,t)=>e.toFixed(t),g:(e,t)=>e.toPrecision(t),o:e=>Math.round(e).toString(8),p:(e,t)=>_s(e*100,t),r:_s,s:xh,X:e=>Math.round(e).toString(16).toUpperCase(),x:e=>Math.round(e).toString(16)};function xs(e){return e}var ws=Array.prototype.map,Ms=["y","z","a","f","p","n","\\xB5","m","","k","M","G","T","P","E","Z","Y"];function ks(e){var t=e.grouping===void 0||e.thousands===void 0?xs:mh(ws.call(e.grouping,Number),e.thousands+""),n=e.currency===void 0?"":e.currency[0]+"",r=e.currency===void 0?"":e.currency[1]+"",i=e.decimal===void 0?".":e.decimal+"",a=e.numerals===void 0?xs:yh(ws.call(e.numerals,String)),o=e.percent===void 0?"%":e.percent+"",f=e.minus===void 0?"\\u2212":e.minus+"",s=e.nan===void 0?"NaN":e.nan+"";function c(u,h){u=rt(u);var d=u.fill,b=u.align,p=u.sign,g=u.symbol,m=u.zero,w=u.width,x=u.comma,v=u.precision,C=u.trim,_=u.type;_==="n"?(x=!0,_="g"):vs[_]||(v===void 0&&(v=12),C=!0,_="g"),(m||d==="0"&&b==="=")&&(m=!0,d="0",b="=");var k=(h&&h.prefix!==void 0?h.prefix:"")+(g==="$"?n:g==="#"&&/[boxX]/.test(_)?"0"+_.toLowerCase():""),E=(g==="$"?r:/[%p]/.test(_)?o:"")+(h&&h.suffix!==void 0?h.suffix:""),z=vs[_],U=/[defgprs%]/.test(_);v=v===void 0?6:/[gprs]/.test(_)?Math.max(1,Math.min(21,v)):Math.max(0,Math.min(20,v));function W(S){var T=k,A=E,F,ve,oe;if(_==="c")A=z(S)+A,S="";else{S=+S;var j=S<0||1/S<0;if(S=isNaN(S)?s:z(Math.abs(S),v),C&&(S=vh(S)),j&&+S==0&&p!=="+"&&(j=!1),T=(j?p==="("?p:f:p==="-"||p==="("?"":p)+T,A=(_==="s"&&!isNaN(S)&&ei!==void 0?Ms[8+ei/3]:"")+A+(j&&p==="("?")":""),U){for(F=-1,ve=S.length;++F<ve;)if(oe=S.charCodeAt(F),48>oe||oe>57){A=(oe===46?i+S.slice(F+1):S.slice(F))+A,S=S.slice(0,F);break}}}x&&!m&&(S=t(S,1/0));var xe=T.length+S.length+A.length,Q=xe<w?new Array(w-xe+1).join(d):"";switch(x&&m&&(S=t(Q+S,Q.length?w-A.length:1/0),Q=""),b){case"<":S=T+S+A+Q;break;case"=":S=T+Q+S+A;break;case"^":S=Q.slice(0,xe=Q.length>>1)+T+S+A+Q.slice(xe);break;default:S=Q+T+S+A;break}return a(S)}return W.toString=function(){return u+""},W}function l(u,h){var d=Math.max(-8,Math.min(8,Math.floor(mn(h)/3)))*3,b=Math.pow(10,-d),p=c((u=rt(u),u.type="f",u),{suffix:Ms[8+d/3]});return function(g){return p(b*g)}}return{format:c,formatPrefix:l}}var Jr,yn,Xn;wh({thousands:",",grouping:[3],currency:["$",""]});function wh(e){return Jr=ks(e),yn=Jr.format,Xn=Jr.formatPrefix,Jr}function ti(e){return Math.max(0,-mn(Math.abs(e)))}function ni(e,t){return Math.max(0,Math.max(-8,Math.min(8,Math.floor(mn(t)/3)))*3-mn(Math.abs(e)))}function ri(e,t){return e=Math.abs(e),t=Math.abs(t)-e,Math.max(0,mn(t)-mn(e))+1}var Pa=new Date,Oa=new Date;function X(e,t,n,r){function i(a){return e(a=arguments.length===0?new Date:new Date(+a)),a}return i.floor=a=>(e(a=new Date(+a)),a),i.ceil=a=>(e(a=new Date(a-1)),t(a,1),e(a),a),i.round=a=>{let o=i(a),f=i.ceil(a);return a-o<f-a?o:f},i.offset=(a,o)=>(t(a=new Date(+a),o==null?1:Math.floor(o)),a),i.range=(a,o,f)=>{let s=[];if(a=i.ceil(a),f=f==null?1:Math.floor(f),!(a<o)||!(f>0))return s;let c;do s.push(c=new Date(+a)),t(a,f),e(a);while(c<a&&a<o);return s},i.filter=a=>X(o=>{if(o>=o)for(;e(o),!a(o);)o.setTime(o-1)},(o,f)=>{if(o>=o)if(f<0)for(;++f<=0;)for(;t(o,-1),!a(o););else for(;--f>=0;)for(;t(o,1),!a(o););}),n&&(i.count=(a,o)=>(Pa.setTime(+a),Oa.setTime(+o),e(Pa),e(Oa),Math.floor(n(Pa,Oa))),i.every=a=>(a=Math.floor(a),!isFinite(a)||!(a>0)?null:a>1?i.filter(r?o=>r(o)%a===0:o=>i.count(0,o)%a===0):i)),i}var mt=X(()=>{},(e,t)=>{e.setTime(+e+t)},(e,t)=>t-e);mt.every=e=>(e=Math.floor(e),!isFinite(e)||!(e>0)?null:e>1?X(t=>{t.setTime(Math.floor(t/e)*e)},(t,n)=>{t.setTime(+t+n*e)},(t,n)=>(n-t)/e):mt);var v8=mt.range,it=1e3,Ie=it*60,at=Ie*60,ot=at*24,La=ot*7,Ts=ot*30,Ia=ot*365,Te=X(e=>{e.setTime(e-e.getMilliseconds())},(e,t)=>{e.setTime(+e+t*it)},(e,t)=>(t-e)/it,e=>e.getUTCSeconds()),x8=Te.range,_n=X(e=>{e.setTime(e-e.getMilliseconds()-e.getSeconds()*it)},(e,t)=>{e.setTime(+e+t*Ie)},(e,t)=>(t-e)/Ie,e=>e.getMinutes()),w8=_n.range,vn=X(e=>{e.setUTCSeconds(0,0)},(e,t)=>{e.setTime(+e+t*Ie)},(e,t)=>(t-e)/Ie,e=>e.getUTCMinutes()),M8=vn.range,xn=X(e=>{e.setTime(e-e.getMilliseconds()-e.getSeconds()*it-e.getMinutes()*Ie)},(e,t)=>{e.setTime(+e+t*at)},(e,t)=>(t-e)/at,e=>e.getHours()),k8=xn.range,wn=X(e=>{e.setUTCMinutes(0,0,0)},(e,t)=>{e.setTime(+e+t*at)},(e,t)=>(t-e)/at,e=>e.getUTCHours()),T8=wn.range,be=X(e=>e.setHours(0,0,0,0),(e,t)=>e.setDate(e.getDate()+t),(e,t)=>(t-e-(t.getTimezoneOffset()-e.getTimezoneOffset())*Ie)/ot,e=>e.getDate()-1),S8=be.range,Se=X(e=>{e.setUTCHours(0,0,0,0)},(e,t)=>{e.setUTCDate(e.getUTCDate()+t)},(e,t)=>(t-e)/ot,e=>e.getUTCDate()-1),C8=Se.range,Ss=X(e=>{e.setUTCHours(0,0,0,0)},(e,t)=>{e.setUTCDate(e.getUTCDate()+t)},(e,t)=>(t-e)/ot,e=>Math.floor(e/ot)),A8=Ss.range;function qt(e){return X(t=>{t.setDate(t.getDate()-(t.getDay()+7-e)%7),t.setHours(0,0,0,0)},(t,n)=>{t.setDate(t.getDate()+n*7)},(t,n)=>(n-t-(n.getTimezoneOffset()-t.getTimezoneOffset())*Ie)/La)}var ft=qt(0),Ve=qt(1),Mh=qt(2),kh=qt(3),zt=qt(4),Th=qt(5),Sh=qt(6),N8=ft.range,R8=Ve.range,E8=Mh.range,D8=kh.range,$8=zt.range,P8=Th.range,O8=Sh.range;function Yt(e){return X(t=>{t.setUTCDate(t.getUTCDate()-(t.getUTCDay()+7-e)%7),t.setUTCHours(0,0,0,0)},(t,n)=>{t.setUTCDate(t.getUTCDate()+n*7)},(t,n)=>(n-t)/La)}var st=Yt(0),Qe=Yt(1),Ch=Yt(2),Ah=Yt(3),Bt=Yt(4),Nh=Yt(5),Rh=Yt(6),I8=st.range,L8=Qe.range,U8=Ch.range,F8=Ah.range,q8=Bt.range,z8=Nh.range,Y8=Rh.range,Ht=X(e=>{e.setDate(1),e.setHours(0,0,0,0)},(e,t)=>{e.setMonth(e.getMonth()+t)},(e,t)=>t.getMonth()-e.getMonth()+(t.getFullYear()-e.getFullYear())*12,e=>e.getMonth()),B8=Ht.range,Wt=X(e=>{e.setUTCDate(1),e.setUTCHours(0,0,0,0)},(e,t)=>{e.setUTCMonth(e.getUTCMonth()+t)},(e,t)=>t.getUTCMonth()-e.getUTCMonth()+(t.getUTCFullYear()-e.getUTCFullYear())*12,e=>e.getUTCMonth()),H8=Wt.range,Ce=X(e=>{e.setMonth(0,1),e.setHours(0,0,0,0)},(e,t)=>{e.setFullYear(e.getFullYear()+t)},(e,t)=>t.getFullYear()-e.getFullYear(),e=>e.getFullYear());Ce.every=e=>!isFinite(e=Math.floor(e))||!(e>0)?null:X(t=>{t.setFullYear(Math.floor(t.getFullYear()/e)*e),t.setMonth(0,1),t.setHours(0,0,0,0)},(t,n)=>{t.setFullYear(t.getFullYear()+n*e)});var W8=Ce.range,Ae=X(e=>{e.setUTCMonth(0,1),e.setUTCHours(0,0,0,0)},(e,t)=>{e.setUTCFullYear(e.getUTCFullYear()+t)},(e,t)=>t.getUTCFullYear()-e.getUTCFullYear(),e=>e.getUTCFullYear());Ae.every=e=>!isFinite(e=Math.floor(e))||!(e>0)?null:X(t=>{t.setUTCFullYear(Math.floor(t.getUTCFullYear()/e)*e),t.setUTCMonth(0,1),t.setUTCHours(0,0,0,0)},(t,n)=>{t.setUTCFullYear(t.getUTCFullYear()+n*e)});var G8=Ae.range;function Cs(e,t,n,r,i,a){let o=[[Te,1,it],[Te,5,5*it],[Te,15,15*it],[Te,30,30*it],[a,1,Ie],[a,5,5*Ie],[a,15,15*Ie],[a,30,30*Ie],[i,1,at],[i,3,3*at],[i,6,6*at],[i,12,12*at],[r,1,ot],[r,2,2*ot],[n,1,La],[t,1,Ts],[t,3,3*Ts],[e,1,Ia]];function f(c,l,u){let h=l<c;h&&([c,l]=[l,c]);let d=u&&typeof u.range=="function"?u:s(c,l,u),b=d?d.range(c,+l+1):[];return h?b.reverse():b}function s(c,l,u){let h=Math.abs(l-c)/u,d=Fr(([,,g])=>g).right(o,h);if(d===o.length)return e.every(pt(c/Ia,l/Ia,u));if(d===0)return mt.every(Math.max(pt(c,l,u),1));let[b,p]=o[h/o[d-1][2]<o[d][2]/h?d-1:d];return b.every(p)}return[f,s]}var[As,Ns]=Cs(Ae,Wt,st,Ss,wn,vn),[Rs,Es]=Cs(Ce,Ht,ft,be,xn,_n);function Ua(e){if(0<=e.y&&e.y<100){var t=new Date(-1,e.m,e.d,e.H,e.M,e.S,e.L);return t.setFullYear(e.y),t}return new Date(e.y,e.m,e.d,e.H,e.M,e.S,e.L)}function Fa(e){if(0<=e.y&&e.y<100){var t=new Date(Date.UTC(-1,e.m,e.d,e.H,e.M,e.S,e.L));return t.setUTCFullYear(e.y),t}return new Date(Date.UTC(e.y,e.m,e.d,e.H,e.M,e.S,e.L))}function Vn(e,t,n){return{y:e,m:t,d:n,H:0,M:0,S:0,L:0}}function Ys(e){var t=e.dateTime,n=e.date,r=e.time,i=e.periods,a=e.days,o=e.shortDays,f=e.months,s=e.shortMonths,c=Qn(i),l=Zn(i),u=Qn(a),h=Zn(a),d=Qn(o),b=Zn(o),p=Qn(f),g=Zn(f),m=Qn(s),w=Zn(s),x={a:oe,A:j,b:xe,B:Q,c:null,d:Ls,e:Ls,f:Kh,g:cd,G:ld,H:Qh,I:Zh,j:Jh,L:Bs,m:ed,M:td,p:an,q:on,Q:qs,s:zs,S:nd,u:rd,U:id,V:ad,w:od,W:fd,x:null,X:null,y:sd,Y:ud,Z:hd,"%":Fs},v={a:On,A:In,b:Ue,B:Ln,c:null,d:Us,e:Us,f:gd,g:Sd,G:Ad,H:dd,I:pd,j:bd,L:Ws,m:md,M:yd,p:Un,q:Fn,Q:qs,s:zs,S:_d,u:vd,U:xd,V:wd,w:Md,W:kd,x:null,X:null,y:Td,Y:Cd,Z:Nd,"%":Fs},C={a:U,A:W,b:S,B:T,c:A,d:Os,e:Os,f:Gh,g:Ps,G:$s,H:Is,I:Is,j:Yh,L:Wh,m:zh,M:Bh,p:z,q:qh,Q:Xh,s:Vh,S:Hh,u:Oh,U:Ih,V:Lh,w:Ph,W:Uh,x:F,X:ve,y:Ps,Y:$s,Z:Fh,"%":jh};x.x=_(n,x),x.X=_(r,x),x.c=_(t,x),v.x=_(n,v),v.X=_(r,v),v.c=_(t,v);function _(M,R){return function(D){var y=[],pe=-1,L=0,we=M.length,Me,Dt,Sf;for(D instanceof Date||(D=new Date(+D));++pe<we;)M.charCodeAt(pe)===37&&(y.push(M.slice(L,pe)),(Dt=Ds[Me=M.charAt(++pe)])!=null?Me=M.charAt(++pe):Dt=Me==="e"?" ":"0",(Sf=R[Me])&&(Me=Sf(D,Dt)),y.push(Me),L=pe+1);return y.push(M.slice(L,pe)),y.join("")}}function k(M,R){return function(D){var y=Vn(1900,void 0,1),pe=E(y,M,D+="",0),L,we;if(pe!=D.length)return null;if("Q"in y)return new Date(y.Q);if("s"in y)return new Date(y.s*1e3+("L"in y?y.L:0));if(R&&!("Z"in y)&&(y.Z=0),"p"in y&&(y.H=y.H%12+y.p*12),y.m===void 0&&(y.m="q"in y?y.q:0),"V"in y){if(y.V<1||y.V>53)return null;"w"in y||(y.w=1),"Z"in y?(L=Fa(Vn(y.y,0,1)),we=L.getUTCDay(),L=we>4||we===0?Qe.ceil(L):Qe(L),L=Se.offset(L,(y.V-1)*7),y.y=L.getUTCFullYear(),y.m=L.getUTCMonth(),y.d=L.getUTCDate()+(y.w+6)%7):(L=Ua(Vn(y.y,0,1)),we=L.getDay(),L=we>4||we===0?Ve.ceil(L):Ve(L),L=be.offset(L,(y.V-1)*7),y.y=L.getFullYear(),y.m=L.getMonth(),y.d=L.getDate()+(y.w+6)%7)}else("W"in y||"U"in y)&&("w"in y||(y.w="u"in y?y.u%7:"W"in y?1:0),we="Z"in y?Fa(Vn(y.y,0,1)).getUTCDay():Ua(Vn(y.y,0,1)).getDay(),y.m=0,y.d="W"in y?(y.w+6)%7+y.W*7-(we+5)%7:y.w+y.U*7-(we+6)%7);return"Z"in y?(y.H+=y.Z/100|0,y.M+=y.Z%100,Fa(y)):Ua(y)}}function E(M,R,D,y){for(var pe=0,L=R.length,we=D.length,Me,Dt;pe<L;){if(y>=we)return-1;if(Me=R.charCodeAt(pe++),Me===37){if(Me=R.charAt(pe++),Dt=C[Me in Ds?R.charAt(pe++):Me],!Dt||(y=Dt(M,D,y))<0)return-1}else if(Me!=D.charCodeAt(y++))return-1}return y}function z(M,R,D){var y=c.exec(R.slice(D));return y?(M.p=l.get(y[0].toLowerCase()),D+y[0].length):-1}function U(M,R,D){var y=d.exec(R.slice(D));return y?(M.w=b.get(y[0].toLowerCase()),D+y[0].length):-1}function W(M,R,D){var y=u.exec(R.slice(D));return y?(M.w=h.get(y[0].toLowerCase()),D+y[0].length):-1}function S(M,R,D){var y=m.exec(R.slice(D));return y?(M.m=w.get(y[0].toLowerCase()),D+y[0].length):-1}function T(M,R,D){var y=p.exec(R.slice(D));return y?(M.m=g.get(y[0].toLowerCase()),D+y[0].length):-1}function A(M,R,D){return E(M,t,R,D)}function F(M,R,D){return E(M,n,R,D)}function ve(M,R,D){return E(M,r,R,D)}function oe(M){return o[M.getDay()]}function j(M){return a[M.getDay()]}function xe(M){return s[M.getMonth()]}function Q(M){return f[M.getMonth()]}function an(M){return i[+(M.getHours()>=12)]}function on(M){return 1+~~(M.getMonth()/3)}function On(M){return o[M.getUTCDay()]}function In(M){return a[M.getUTCDay()]}function Ue(M){return s[M.getUTCMonth()]}function Ln(M){return f[M.getUTCMonth()]}function Un(M){return i[+(M.getUTCHours()>=12)]}function Fn(M){return 1+~~(M.getUTCMonth()/3)}return{format:function(M){var R=_(M+="",x);return R.toString=function(){return M},R},parse:function(M){var R=k(M+="",!1);return R.toString=function(){return M},R},utcFormat:function(M){var R=_(M+="",v);return R.toString=function(){return M},R},utcParse:function(M){var R=k(M+="",!0);return R.toString=function(){return M},R}}}var Ds={"-":"",_:" ",0:"0"},ee=/^\\s*\\d+/,Eh=/^%/,Dh=/[\\\\^$*+?|[\\]().{}]/g;function $(e,t,n){var r=e<0?"-":"",i=(r?-e:e)+"",a=i.length;return r+(a<n?new Array(n-a+1).join(t)+i:i)}function $h(e){return e.replace(Dh,"\\\\$&")}function Qn(e){return new RegExp("^(?:"+e.map($h).join("|")+")","i")}function Zn(e){return new Map(e.map((t,n)=>[t.toLowerCase(),n]))}function Ph(e,t,n){var r=ee.exec(t.slice(n,n+1));return r?(e.w=+r[0],n+r[0].length):-1}function Oh(e,t,n){var r=ee.exec(t.slice(n,n+1));return r?(e.u=+r[0],n+r[0].length):-1}function Ih(e,t,n){var r=ee.exec(t.slice(n,n+2));return r?(e.U=+r[0],n+r[0].length):-1}function Lh(e,t,n){var r=ee.exec(t.slice(n,n+2));return r?(e.V=+r[0],n+r[0].length):-1}function Uh(e,t,n){var r=ee.exec(t.slice(n,n+2));return r?(e.W=+r[0],n+r[0].length):-1}function $s(e,t,n){var r=ee.exec(t.slice(n,n+4));return r?(e.y=+r[0],n+r[0].length):-1}function Ps(e,t,n){var r=ee.exec(t.slice(n,n+2));return r?(e.y=+r[0]+(+r[0]>68?1900:2e3),n+r[0].length):-1}function Fh(e,t,n){var r=/^(Z)|([+-]\\d\\d)(?::?(\\d\\d))?/.exec(t.slice(n,n+6));return r?(e.Z=r[1]?0:-(r[2]+(r[3]||"00")),n+r[0].length):-1}function qh(e,t,n){var r=ee.exec(t.slice(n,n+1));return r?(e.q=r[0]*3-3,n+r[0].length):-1}function zh(e,t,n){var r=ee.exec(t.slice(n,n+2));return r?(e.m=r[0]-1,n+r[0].length):-1}function Os(e,t,n){var r=ee.exec(t.slice(n,n+2));return r?(e.d=+r[0],n+r[0].length):-1}function Yh(e,t,n){var r=ee.exec(t.slice(n,n+3));return r?(e.m=0,e.d=+r[0],n+r[0].length):-1}function Is(e,t,n){var r=ee.exec(t.slice(n,n+2));return r?(e.H=+r[0],n+r[0].length):-1}function Bh(e,t,n){var r=ee.exec(t.slice(n,n+2));return r?(e.M=+r[0],n+r[0].length):-1}function Hh(e,t,n){var r=ee.exec(t.slice(n,n+2));return r?(e.S=+r[0],n+r[0].length):-1}function Wh(e,t,n){var r=ee.exec(t.slice(n,n+3));return r?(e.L=+r[0],n+r[0].length):-1}function Gh(e,t,n){var r=ee.exec(t.slice(n,n+6));return r?(e.L=Math.floor(r[0]/1e3),n+r[0].length):-1}function jh(e,t,n){var r=Eh.exec(t.slice(n,n+1));return r?n+r[0].length:-1}function Xh(e,t,n){var r=ee.exec(t.slice(n));return r?(e.Q=+r[0],n+r[0].length):-1}function Vh(e,t,n){var r=ee.exec(t.slice(n));return r?(e.s=+r[0],n+r[0].length):-1}function Ls(e,t){return $(e.getDate(),t,2)}function Qh(e,t){return $(e.getHours(),t,2)}function Zh(e,t){return $(e.getHours()%12||12,t,2)}function Jh(e,t){return $(1+be.count(Ce(e),e),t,3)}function Bs(e,t){return $(e.getMilliseconds(),t,3)}function Kh(e,t){return Bs(e,t)+"000"}function ed(e,t){return $(e.getMonth()+1,t,2)}function td(e,t){return $(e.getMinutes(),t,2)}function nd(e,t){return $(e.getSeconds(),t,2)}function rd(e){var t=e.getDay();return t===0?7:t}function id(e,t){return $(ft.count(Ce(e)-1,e),t,2)}function Hs(e){var t=e.getDay();return t>=4||t===0?zt(e):zt.ceil(e)}function ad(e,t){return e=Hs(e),$(zt.count(Ce(e),e)+(Ce(e).getDay()===4),t,2)}function od(e){return e.getDay()}function fd(e,t){return $(Ve.count(Ce(e)-1,e),t,2)}function sd(e,t){return $(e.getFullYear()%100,t,2)}function cd(e,t){return e=Hs(e),$(e.getFullYear()%100,t,2)}function ud(e,t){return $(e.getFullYear()%1e4,t,4)}function ld(e,t){var n=e.getDay();return e=n>=4||n===0?zt(e):zt.ceil(e),$(e.getFullYear()%1e4,t,4)}function hd(e){var t=e.getTimezoneOffset();return(t>0?"-":(t*=-1,"+"))+$(t/60|0,"0",2)+$(t%60,"0",2)}function Us(e,t){return $(e.getUTCDate(),t,2)}function dd(e,t){return $(e.getUTCHours(),t,2)}function pd(e,t){return $(e.getUTCHours()%12||12,t,2)}function bd(e,t){return $(1+Se.count(Ae(e),e),t,3)}function Ws(e,t){return $(e.getUTCMilliseconds(),t,3)}function gd(e,t){return Ws(e,t)+"000"}function md(e,t){return $(e.getUTCMonth()+1,t,2)}function yd(e,t){return $(e.getUTCMinutes(),t,2)}function _d(e,t){return $(e.getUTCSeconds(),t,2)}function vd(e){var t=e.getUTCDay();return t===0?7:t}function xd(e,t){return $(st.count(Ae(e)-1,e),t,2)}function Gs(e){var t=e.getUTCDay();return t>=4||t===0?Bt(e):Bt.ceil(e)}function wd(e,t){return e=Gs(e),$(Bt.count(Ae(e),e)+(Ae(e).getUTCDay()===4),t,2)}function Md(e){return e.getUTCDay()}function kd(e,t){return $(Qe.count(Ae(e)-1,e),t,2)}function Td(e,t){return $(e.getUTCFullYear()%100,t,2)}function Sd(e,t){return e=Gs(e),$(e.getUTCFullYear()%100,t,2)}function Cd(e,t){return $(e.getUTCFullYear()%1e4,t,4)}function Ad(e,t){var n=e.getUTCDay();return e=n>=4||n===0?Bt(e):Bt.ceil(e),$(e.getUTCFullYear()%1e4,t,4)}function Nd(){return"+0000"}function Fs(){return"%"}function qs(e){return+e}function zs(e){return Math.floor(+e/1e3)}var Mn,Jn,qa,kn,ii;Rd({dateTime:"%x, %X",date:"%-m/%-d/%Y",time:"%-I:%M:%S %p",periods:["AM","PM"],days:["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"],shortDays:["Sun","Mon","Tue","Wed","Thu","Fri","Sat"],months:["January","February","March","April","May","June","July","August","September","October","November","December"],shortMonths:["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]});function Rd(e){return Mn=Ys(e),Jn=Mn.format,qa=Mn.parse,kn=Mn.utcFormat,ii=Mn.utcParse,Mn}var js="%Y-%m-%dT%H:%M:%S.%LZ";function Ed(e){return e.toISOString()}var V8=Date.prototype.toISOString?Ed:kn(js);function Dd(e){var t=new Date(e);return isNaN(t)?null:t}var Q8=+new Date("2000-01-01T00:00:00.000Z")?Dd:ii(js);function Ze(e,t){switch(arguments.length){case 0:break;case 1:this.range(e);break;default:this.range(t).domain(e);break}return this}function yt(e,t){switch(arguments.length){case 0:break;case 1:{typeof e=="function"?this.interpolator(e):this.range(e);break}default:{this.domain(e),typeof t=="function"?this.interpolator(t):this.range(t);break}}return this}var Xs=Symbol("implicit");function Kn(){var e=new zn,t=[],n=[],r=Xs;function i(a){let o=e.get(a);if(o===void 0){if(r!==Xs)return r;e.set(a,o=t.push(a)-1)}return n[o%n.length]}return i.domain=function(a){if(!arguments.length)return t.slice();t=[],e=new zn;for(let o of a)e.has(o)||e.set(o,t.push(o)-1);return i},i.range=function(a){return arguments.length?(n=Array.from(a),i):n.slice()},i.unknown=function(a){return arguments.length?(r=a,i):r},i.copy=function(){return Kn(t,n).unknown(r)},Ze.apply(i,arguments),i}function $d(e){return function(){return e}}function za(e){return+e}var Vs=[0,1];function ge(e){return e}function Ya(e,t){return(t-=e=+e)?function(n){return(n-e)/t}:$d(isNaN(t)?NaN:.5)}function Pd(e,t){var n;return e>t&&(n=e,e=t,t=n),function(r){return Math.max(e,Math.min(t,r))}}function Od(e,t,n){var r=e[0],i=e[1],a=t[0],o=t[1];return i<r?(r=Ya(i,r),a=n(o,a)):(r=Ya(r,i),a=n(a,o)),function(f){return a(r(f))}}function Id(e,t,n){var r=Math.min(e.length,t.length)-1,i=new Array(r),a=new Array(r),o=-1;for(e[r]<e[0]&&(e=e.slice().reverse(),t=t.slice().reverse());++o<r;)i[o]=Ya(e[o],e[o+1]),a[o]=n(t[o],t[o+1]);return function(f){var s=Ge(e,f,1,r)-1;return a[s](i[s](f))}}function er(e,t){return t.domain(e.domain()).range(e.range()).interpolate(e.interpolate()).clamp(e.clamp()).unknown(e.unknown())}function ai(){var e=Vs,t=Vs,n=gt,r,i,a,o=ge,f,s,c;function l(){var h=Math.min(e.length,t.length);return o!==ge&&(o=Pd(e[0],e[h-1])),f=h>2?Id:Od,s=c=null,u}function u(h){return h==null||isNaN(h=+h)?a:(s||(s=f(e.map(r),t,n)))(r(o(h)))}return u.invert=function(h){return o(i((c||(c=f(t,e.map(r),Oe)))(h)))},u.domain=function(h){return arguments.length?(e=Array.from(h,za),l()):e.slice()},u.range=function(h){return arguments.length?(t=Array.from(h),l()):t.slice()},u.rangeRound=function(h){return t=Array.from(h),n=Wn,l()},u.clamp=function(h){return arguments.length?(o=h?!0:ge,l()):o!==ge},u.interpolate=function(h){return arguments.length?(n=h,l()):n},u.unknown=function(h){return arguments.length?(a=h,u):a},function(h,d){return r=h,i=d,l()}}function nc(){return ai()(ge,ge)}function Ba(e,t,n,r){var i=pt(e,t,n),a;switch(r=rt(r??",f"),r.type){case"s":{var o=Math.max(Math.abs(e),Math.abs(t));return r.precision==null&&!isNaN(a=ni(i,o))&&(r.precision=a),Xn(r,o)}case"":case"e":case"g":case"p":case"r":{r.precision==null&&!isNaN(a=ri(i,Math.max(Math.abs(e),Math.abs(t))))&&(r.precision=a-(r.type==="e"));break}case"f":case"%":{r.precision==null&&!isNaN(a=ti(i))&&(r.precision=a-(r.type==="%")*2);break}}return yn(r)}function Gt(e){var t=e.domain;return e.ticks=function(n){var r=t();return qr(r[0],r[r.length-1],n??10)},e.tickFormat=function(n,r){var i=t();return Ba(i[0],i[i.length-1],n??10,r)},e.nice=function(n){n==null&&(n=10);var r=t(),i=0,a=r.length-1,o=r[i],f=r[a],s,c,l=10;for(f<o&&(c=o,o=f,f=c,c=i,i=a,a=c);l-- >0;){if(c=Ur(o,f,n),c===s)return r[i]=o,r[a]=f,t(r);if(c>0)o=Math.floor(o/c)*c,f=Math.ceil(f/c)*c;else if(c<0)o=Math.ceil(o*c)/c,f=Math.floor(f*c)/c;else break;s=c}return e},e}function Ha(){var e=nc();return e.copy=function(){return er(e,Ha())},Ze.apply(e,arguments),Gt(e)}function Wa(e){var t;function n(r){return r==null||isNaN(r=+r)?t:r}return n.invert=n,n.domain=n.range=function(r){return arguments.length?(e=Array.from(r,za),n):e.slice()},n.unknown=function(r){return arguments.length?(t=r,n):t},n.copy=function(){return Wa(e).unknown(t)},e=arguments.length?Array.from(e,za):[0,1],Gt(n)}function rc(e,t){e=e.slice();var n=0,r=e.length-1,i=e[n],a=e[r],o;return a<i&&(o=n,n=r,r=o,o=i,i=a,a=o),e[n]=t.floor(i),e[r]=t.ceil(a),e}function Qs(e){return Math.log(e)}function Zs(e){return Math.exp(e)}function Ld(e){return-Math.log(-e)}function Ud(e){return-Math.exp(-e)}function Fd(e){return isFinite(e)?+("1e"+e):e<0?0:e}function qd(e){return e===10?Fd:e===Math.E?Math.exp:t=>Math.pow(e,t)}function zd(e){return e===Math.E?Math.log:e===10&&Math.log10||e===2&&Math.log2||(e=Math.log(e),t=>Math.log(t)/e)}function Js(e){return(t,n)=>-e(-t,n)}function Ga(e){let t=e(Qs,Zs),n=t.domain,r=10,i,a;function o(){return i=zd(r),a=qd(r),n()[0]<0?(i=Js(i),a=Js(a),e(Ld,Ud)):e(Qs,Zs),t}return t.base=function(f){return arguments.length?(r=+f,o()):r},t.domain=function(f){return arguments.length?(n(f),o()):n()},t.ticks=f=>{let s=n(),c=s[0],l=s[s.length-1],u=l<c;u&&([c,l]=[l,c]);let h=i(c),d=i(l),b,p,g=f==null?10:+f,m=[];if(!(r%1)&&d-h<g){if(h=Math.floor(h),d=Math.ceil(d),c>0){for(;h<=d;++h)for(b=1;b<r;++b)if(p=h<0?b/a(-h):b*a(h),!(p<c)){if(p>l)break;m.push(p)}}else for(;h<=d;++h)for(b=r-1;b>=1;--b)if(p=h>0?b/a(-h):b*a(h),!(p<c)){if(p>l)break;m.push(p)}m.length*2<g&&(m=qr(c,l,g))}else m=qr(h,d,Math.min(d-h,g)).map(a);return u?m.reverse():m},t.tickFormat=(f,s)=>{if(f==null&&(f=10),s==null&&(s=r===10?"s":","),typeof s!="function"&&(!(r%1)&&(s=rt(s)).precision==null&&(s.trim=!0),s=yn(s)),f===1/0)return s;let c=Math.max(1,r*f/t.ticks().length);return l=>{let u=l/a(Math.round(i(l)));return u*r<r-.5&&(u*=r),u<=c?s(l):""}},t.nice=()=>n(rc(n(),{floor:f=>a(Math.floor(i(f))),ceil:f=>a(Math.ceil(i(f)))})),t}function ja(){let e=Ga(ai()).domain([1,10]);return e.copy=()=>er(e,ja()).base(e.base()),Ze.apply(e,arguments),e}function Ks(e){return function(t){return Math.sign(t)*Math.log1p(Math.abs(t/e))}}function ec(e){return function(t){return Math.sign(t)*Math.expm1(Math.abs(t))*e}}function Xa(e){var t=1,n=e(Ks(t),ec(t));return n.constant=function(r){return arguments.length?e(Ks(t=+r),ec(t)):t},Gt(n)}function Va(){var e=Xa(ai());return e.copy=function(){return er(e,Va()).constant(e.constant())},Ze.apply(e,arguments)}function tc(e){return function(t){return t<0?-Math.pow(-t,e):Math.pow(t,e)}}function Yd(e){return e<0?-Math.sqrt(-e):Math.sqrt(e)}function Bd(e){return e<0?-e*e:e*e}function Qa(e){var t=e(ge,ge),n=1;function r(){return n===1?e(ge,ge):n===.5?e(Yd,Bd):e(tc(n),tc(1/n))}return t.exponent=function(i){return arguments.length?(n=+i,r()):n},Gt(t)}function oi(){var e=Qa(ai());return e.copy=function(){return er(e,oi()).exponent(e.exponent())},Ze.apply(e,arguments),e}function ic(){return oi.apply(null,arguments).exponent(.5)}function Za(){var e=[],t=[],n=[],r;function i(){var o=0,f=Math.max(1,t.length);for(n=new Array(f-1);++o<f;)n[o-1]=$f(e,o/f);return a}function a(o){return o==null||isNaN(o=+o)?r:t[Ge(n,o)]}return a.invertExtent=function(o){var f=t.indexOf(o);return f<0?[NaN,NaN]:[f>0?n[f-1]:e[0],f<n.length?n[f]:e[e.length-1]]},a.domain=function(o){if(!arguments.length)return e.slice();e=[];for(let f of o)f!=null&&!isNaN(f=+f)&&e.push(f);return e.sort(ln),i()},a.range=function(o){return arguments.length?(t=Array.from(o),i()):t.slice()},a.unknown=function(o){return arguments.length?(r=o,a):r},a.quantiles=function(){return n.slice()},a.copy=function(){return Za().domain(e).range(t).unknown(r)},Ze.apply(a,arguments)}function Ja(){var e=0,t=1,n=1,r=[.5],i=[0,1],a;function o(s){return s!=null&&s<=s?i[Ge(r,s,0,n)]:a}function f(){var s=-1;for(r=new Array(n);++s<n;)r[s]=((s+1)*t-(s-n)*e)/(n+1);return o}return o.domain=function(s){return arguments.length?([e,t]=s,e=+e,t=+t,f()):[e,t]},o.range=function(s){return arguments.length?(n=(i=Array.from(s)).length-1,f()):i.slice()},o.invertExtent=function(s){var c=i.indexOf(s);return c<0?[NaN,NaN]:c<1?[e,r[0]]:c>=n?[r[n-1],t]:[r[c-1],r[c]]},o.unknown=function(s){return arguments.length&&(a=s),o},o.thresholds=function(){return r.slice()},o.copy=function(){return Ja().domain([e,t]).range(i).unknown(a)},Ze.apply(Gt(o),arguments)}function Ka(){var e=[.5],t=[0,1],n,r=1;function i(a){return a!=null&&a<=a?t[Ge(e,a,0,r)]:n}return i.domain=function(a){return arguments.length?(e=Array.from(a),r=Math.min(e.length,t.length-1),i):e.slice()},i.range=function(a){return arguments.length?(t=Array.from(a),r=Math.min(e.length,t.length-1),i):t.slice()},i.invertExtent=function(a){var o=t.indexOf(a);return[e[o-1],e[o]]},i.unknown=function(a){return arguments.length?(n=a,i):n},i.copy=function(){return Ka().domain(e).range(t).unknown(n)},Ze.apply(i,arguments)}function Hd(e){return new Date(e)}function Wd(e){return e instanceof Date?+e:Math.round(e)}function eo(e,t,n,r,i,a,o,f,s,c){var l=nc(),u=l.invert,h=l.domain,d=c(".%L"),b=c(":%S"),p=c("%I:%M"),g=c("%I %p"),m=c("%a %d"),w=c("%b %d"),x=c("%B"),v=c("%Y");function C(_){return(s(_)<_?d:f(_)<_?b:o(_)<_?p:a(_)<_?g:r(_)<_?i(_)<_?m:w:n(_)<_?x:v)(_)}return l.invert=function(_){return new Date(Math.round(u(_)))},l.domain=function(_){return arguments.length?h(Array.from(_,Wd)):h().map(Hd)},l.ticks=function(_){var k=h();return e(k[0],k[k.length-1],_??10)},l.tickFormat=function(_,k){return k==null?C:c(k)},l.nice=function(_){var k=h();return(!_||typeof _.range!="function")&&(_=t(k[0],k[k.length-1],_??10)),_?h(rc(k,_)):l},l.copy=function(){return er(l,eo(e,t,n,r,i,a,o,f,s,c))},l}function ac(){return Ze.apply(eo(Rs,Es,Ce,Ht,ft,be,xn,_n,Te,Jn).domain([new Date(2e3,0,1),new Date(2e3,0,2)]),arguments)}function oc(){return Ze.apply(eo(As,Ns,Ae,Wt,st,Se,wn,vn,Te,kn).domain([Date.UTC(2e3,0,1),Date.UTC(2e3,0,2)]),arguments)}function fi(){var e=0,t=1,n,r,i,a,o=ge,f=!1,s;function c(u){return u==null||isNaN(u=+u)?s:o(i===0?.5:(u=(a(u)-n)*i,f?Math.max(0,Math.min(1,u)):u))}c.domain=function(u){return arguments.length?([e,t]=u,n=a(e=+e),r=a(t=+t),i=n===r?0:1/(r-n),c):[e,t]},c.clamp=function(u){return arguments.length?(f=!!u,c):f},c.interpolator=function(u){return arguments.length?(o=u,c):o};function l(u){return function(h){var d,b;return arguments.length?([d,b]=h,o=u(d,b),c):[o(0),o(1)]}}return c.range=l(gt),c.rangeRound=l(Wn),c.unknown=function(u){return arguments.length?(s=u,c):s},function(u){return a=u,n=u(e),r=u(t),i=n===r?0:1/(r-n),c}}function _t(e,t){return t.domain(e.domain()).interpolator(e.interpolator()).clamp(e.clamp()).unknown(e.unknown())}function si(){var e=Gt(fi()(ge));return e.copy=function(){return _t(e,si())},yt.apply(e,arguments)}function to(){var e=Ga(fi()).domain([1,10]);return e.copy=function(){return _t(e,to()).base(e.base())},yt.apply(e,arguments)}function no(){var e=Xa(fi());return e.copy=function(){return _t(e,no()).constant(e.constant())},yt.apply(e,arguments)}function ci(){var e=Qa(fi());return e.copy=function(){return _t(e,ci()).exponent(e.exponent())},yt.apply(e,arguments)}function fc(){return ci.apply(null,arguments).exponent(.5)}function ui(){var e=0,t=.5,n=1,r=1,i,a,o,f,s,c=ge,l,u=!1,h;function d(p){return p==null||isNaN(p=+p)?h:(p=.5+((p=+l(p))-a)*(r*p<r*a?f:s),c(u?Math.max(0,Math.min(1,p)):p))}d.domain=function(p){return arguments.length?([e,t,n]=p,i=l(e=+e),a=l(t=+t),o=l(n=+n),f=i===a?0:.5/(a-i),s=a===o?0:.5/(o-a),r=a<i?-1:1,d):[e,t,n]},d.clamp=function(p){return arguments.length?(u=!!p,d):u},d.interpolator=function(p){return arguments.length?(c=p,d):c};function b(p){return function(g){var m,w,x;return arguments.length?([m,w,x]=g,c=jn(p,[m,w,x]),d):[c(0),c(.5),c(1)]}}return d.range=b(gt),d.rangeRound=b(Wn),d.unknown=function(p){return arguments.length?(h=p,d):h},function(p){return l=p,i=p(e),a=p(t),o=p(n),f=i===a?0:.5/(a-i),s=a===o?0:.5/(o-a),r=a<i?-1:1,d}}function ro(){var e=Gt(ui()(ge));return e.copy=function(){return _t(e,ro())},yt.apply(e,arguments)}function io(){var e=Ga(ui()).domain([.1,1,10]);return e.copy=function(){return _t(e,io()).base(e.base())},yt.apply(e,arguments)}function ao(){var e=Xa(ui());return e.copy=function(){return _t(e,ao()).constant(e.constant())},yt.apply(e,arguments)}function li(){var e=Qa(ui());return e.copy=function(){return _t(e,li()).exponent(e.exponent())},yt.apply(e,arguments)}function sc(){return li.apply(null,arguments).exponent(.5)}function N(e){for(var t=e.length/6|0,n=new Array(t),r=0;r<t;)n[r]="#"+e.slice(r*6,++r*6);return n}var cc=N("1f77b4ff7f0e2ca02cd627289467bd8c564be377c27f7f7fbcbd2217becf"),uc=N("7fc97fbeaed4fdc086ffff99386cb0f0027fbf5b17666666"),lc=N("1b9e77d95f027570b3e7298a66a61ee6ab02a6761d666666"),hc=N("4269d0efb118ff725c6cc5b03ca951ff8ab7a463f297bbf59c6b4e9498a0"),dc=N("a6cee31f78b4b2df8a33a02cfb9a99e31a1cfdbf6fff7f00cab2d66a3d9affff99b15928"),pc=N("fbb4aeb3cde3ccebc5decbe4fed9a6ffffcce5d8bdfddaecf2f2f2"),bc=N("b3e2cdfdcdaccbd5e8f4cae4e6f5c9fff2aef1e2cccccccc"),gc=N("e41a1c377eb84daf4a984ea3ff7f00ffff33a65628f781bf999999"),mc=N("66c2a5fc8d628da0cbe78ac3a6d854ffd92fe5c494b3b3b3"),yc=N("8dd3c7ffffb3bebadafb807280b1d3fdb462b3de69fccde5d9d9d9bc80bdccebc5ffed6f"),o5=N("4e79a7f28e2ce1575976b7b259a14fedc949af7aa1ff9da79c755fbab0ab"),I=e=>Ra(e[e.length-1]),jd=new Array(3).concat("d8b365f5f5f55ab4ac","a6611adfc27d80cdc1018571","a6611adfc27df5f5f580cdc1018571","8c510ad8b365f6e8c3c7eae55ab4ac01665e","8c510ad8b365f6e8c3f5f5f5c7eae55ab4ac01665e","8c510abf812ddfc27df6e8c3c7eae580cdc135978f01665e","8c510abf812ddfc27df6e8c3f5f5f5c7eae580cdc135978f01665e","5430058c510abf812ddfc27df6e8c3c7eae580cdc135978f01665e003c30","5430058c510abf812ddfc27df6e8c3f5f5f5c7eae580cdc135978f01665e003c30").map(N),f5=I(jd),Xd=new Array(3).concat("af8dc3f7f7f77fbf7b","7b3294c2a5cfa6dba0008837","7b3294c2a5cff7f7f7a6dba0008837","762a83af8dc3e7d4e8d9f0d37fbf7b1b7837","762a83af8dc3e7d4e8f7f7f7d9f0d37fbf7b1b7837","762a839970abc2a5cfe7d4e8d9f0d3a6dba05aae611b7837","762a839970abc2a5cfe7d4e8f7f7f7d9f0d3a6dba05aae611b7837","40004b762a839970abc2a5cfe7d4e8d9f0d3a6dba05aae611b783700441b","40004b762a839970abc2a5cfe7d4e8f7f7f7d9f0d3a6dba05aae611b783700441b").map(N),s5=I(Xd),Vd=new Array(3).concat("e9a3c9f7f7f7a1d76a","d01c8bf1b6dab8e1864dac26","d01c8bf1b6daf7f7f7b8e1864dac26","c51b7de9a3c9fde0efe6f5d0a1d76a4d9221","c51b7de9a3c9fde0eff7f7f7e6f5d0a1d76a4d9221","c51b7dde77aef1b6dafde0efe6f5d0b8e1867fbc414d9221","c51b7dde77aef1b6dafde0eff7f7f7e6f5d0b8e1867fbc414d9221","8e0152c51b7dde77aef1b6dafde0efe6f5d0b8e1867fbc414d9221276419","8e0152c51b7dde77aef1b6dafde0eff7f7f7e6f5d0b8e1867fbc414d9221276419").map(N),c5=I(Vd),Qd=new Array(3).concat("998ec3f7f7f7f1a340","5e3c99b2abd2fdb863e66101","5e3c99b2abd2f7f7f7fdb863e66101","542788998ec3d8daebfee0b6f1a340b35806","542788998ec3d8daebf7f7f7fee0b6f1a340b35806","5427888073acb2abd2d8daebfee0b6fdb863e08214b35806","5427888073acb2abd2d8daebf7f7f7fee0b6fdb863e08214b35806","2d004b5427888073acb2abd2d8daebfee0b6fdb863e08214b358067f3b08","2d004b5427888073acb2abd2d8daebf7f7f7fee0b6fdb863e08214b358067f3b08").map(N),u5=I(Qd),Zd=new Array(3).concat("ef8a62f7f7f767a9cf","ca0020f4a58292c5de0571b0","ca0020f4a582f7f7f792c5de0571b0","b2182bef8a62fddbc7d1e5f067a9cf2166ac","b2182bef8a62fddbc7f7f7f7d1e5f067a9cf2166ac","b2182bd6604df4a582fddbc7d1e5f092c5de4393c32166ac","b2182bd6604df4a582fddbc7f7f7f7d1e5f092c5de4393c32166ac","67001fb2182bd6604df4a582fddbc7d1e5f092c5de4393c32166ac053061","67001fb2182bd6604df4a582fddbc7f7f7f7d1e5f092c5de4393c32166ac053061").map(N),l5=I(Zd),Jd=new Array(3).concat("ef8a62ffffff999999","ca0020f4a582bababa404040","ca0020f4a582ffffffbababa404040","b2182bef8a62fddbc7e0e0e09999994d4d4d","b2182bef8a62fddbc7ffffffe0e0e09999994d4d4d","b2182bd6604df4a582fddbc7e0e0e0bababa8787874d4d4d","b2182bd6604df4a582fddbc7ffffffe0e0e0bababa8787874d4d4d","67001fb2182bd6604df4a582fddbc7e0e0e0bababa8787874d4d4d1a1a1a","67001fb2182bd6604df4a582fddbc7ffffffe0e0e0bababa8787874d4d4d1a1a1a").map(N),h5=I(Jd),Kd=new Array(3).concat("fc8d59ffffbf91bfdb","d7191cfdae61abd9e92c7bb6","d7191cfdae61ffffbfabd9e92c7bb6","d73027fc8d59fee090e0f3f891bfdb4575b4","d73027fc8d59fee090ffffbfe0f3f891bfdb4575b4","d73027f46d43fdae61fee090e0f3f8abd9e974add14575b4","d73027f46d43fdae61fee090ffffbfe0f3f8abd9e974add14575b4","a50026d73027f46d43fdae61fee090e0f3f8abd9e974add14575b4313695","a50026d73027f46d43fdae61fee090ffffbfe0f3f8abd9e974add14575b4313695").map(N),d5=I(Kd),e1=new Array(3).concat("fc8d59ffffbf91cf60","d7191cfdae61a6d96a1a9641","d7191cfdae61ffffbfa6d96a1a9641","d73027fc8d59fee08bd9ef8b91cf601a9850","d73027fc8d59fee08bffffbfd9ef8b91cf601a9850","d73027f46d43fdae61fee08bd9ef8ba6d96a66bd631a9850","d73027f46d43fdae61fee08bffffbfd9ef8ba6d96a66bd631a9850","a50026d73027f46d43fdae61fee08bd9ef8ba6d96a66bd631a9850006837","a50026d73027f46d43fdae61fee08bffffbfd9ef8ba6d96a66bd631a9850006837").map(N),p5=I(e1),t1=new Array(3).concat("fc8d59ffffbf99d594","d7191cfdae61abdda42b83ba","d7191cfdae61ffffbfabdda42b83ba","d53e4ffc8d59fee08be6f59899d5943288bd","d53e4ffc8d59fee08bffffbfe6f59899d5943288bd","d53e4ff46d43fdae61fee08be6f598abdda466c2a53288bd","d53e4ff46d43fdae61fee08bffffbfe6f598abdda466c2a53288bd","9e0142d53e4ff46d43fdae61fee08be6f598abdda466c2a53288bd5e4fa2","9e0142d53e4ff46d43fdae61fee08bffffbfe6f598abdda466c2a53288bd5e4fa2").map(N),b5=I(t1),n1=new Array(3).concat("e5f5f999d8c92ca25f","edf8fbb2e2e266c2a4238b45","edf8fbb2e2e266c2a42ca25f006d2c","edf8fbccece699d8c966c2a42ca25f006d2c","edf8fbccece699d8c966c2a441ae76238b45005824","f7fcfde5f5f9ccece699d8c966c2a441ae76238b45005824","f7fcfde5f5f9ccece699d8c966c2a441ae76238b45006d2c00441b").map(N),g5=I(n1),r1=new Array(3).concat("e0ecf49ebcda8856a7","edf8fbb3cde38c96c688419d","edf8fbb3cde38c96c68856a7810f7c","edf8fbbfd3e69ebcda8c96c68856a7810f7c","edf8fbbfd3e69ebcda8c96c68c6bb188419d6e016b","f7fcfde0ecf4bfd3e69ebcda8c96c68c6bb188419d6e016b","f7fcfde0ecf4bfd3e69ebcda8c96c68c6bb188419d810f7c4d004b").map(N),m5=I(r1),i1=new Array(3).concat("e0f3dba8ddb543a2ca","f0f9e8bae4bc7bccc42b8cbe","f0f9e8bae4bc7bccc443a2ca0868ac","f0f9e8ccebc5a8ddb57bccc443a2ca0868ac","f0f9e8ccebc5a8ddb57bccc44eb3d32b8cbe08589e","f7fcf0e0f3dbccebc5a8ddb57bccc44eb3d32b8cbe08589e","f7fcf0e0f3dbccebc5a8ddb57bccc44eb3d32b8cbe0868ac084081").map(N),y5=I(i1),a1=new Array(3).concat("fee8c8fdbb84e34a33","fef0d9fdcc8afc8d59d7301f","fef0d9fdcc8afc8d59e34a33b30000","fef0d9fdd49efdbb84fc8d59e34a33b30000","fef0d9fdd49efdbb84fc8d59ef6548d7301f990000","fff7ecfee8c8fdd49efdbb84fc8d59ef6548d7301f990000","fff7ecfee8c8fdd49efdbb84fc8d59ef6548d7301fb300007f0000").map(N),_5=I(a1),o1=new Array(3).concat("ece2f0a6bddb1c9099","f6eff7bdc9e167a9cf02818a","f6eff7bdc9e167a9cf1c9099016c59","f6eff7d0d1e6a6bddb67a9cf1c9099016c59","f6eff7d0d1e6a6bddb67a9cf3690c002818a016450","fff7fbece2f0d0d1e6a6bddb67a9cf3690c002818a016450","fff7fbece2f0d0d1e6a6bddb67a9cf3690c002818a016c59014636").map(N),v5=I(o1),f1=new Array(3).concat("ece7f2a6bddb2b8cbe","f1eef6bdc9e174a9cf0570b0","f1eef6bdc9e174a9cf2b8cbe045a8d","f1eef6d0d1e6a6bddb74a9cf2b8cbe045a8d","f1eef6d0d1e6a6bddb74a9cf3690c00570b0034e7b","fff7fbece7f2d0d1e6a6bddb74a9cf3690c00570b0034e7b","fff7fbece7f2d0d1e6a6bddb74a9cf3690c00570b0045a8d023858").map(N),x5=I(f1),s1=new Array(3).concat("e7e1efc994c7dd1c77","f1eef6d7b5d8df65b0ce1256","f1eef6d7b5d8df65b0dd1c77980043","f1eef6d4b9dac994c7df65b0dd1c77980043","f1eef6d4b9dac994c7df65b0e7298ace125691003f","f7f4f9e7e1efd4b9dac994c7df65b0e7298ace125691003f","f7f4f9e7e1efd4b9dac994c7df65b0e7298ace125698004367001f").map(N),w5=I(s1),c1=new Array(3).concat("fde0ddfa9fb5c51b8a","feebe2fbb4b9f768a1ae017e","feebe2fbb4b9f768a1c51b8a7a0177","feebe2fcc5c0fa9fb5f768a1c51b8a7a0177","feebe2fcc5c0fa9fb5f768a1dd3497ae017e7a0177","fff7f3fde0ddfcc5c0fa9fb5f768a1dd3497ae017e7a0177","fff7f3fde0ddfcc5c0fa9fb5f768a1dd3497ae017e7a017749006a").map(N),M5=I(c1),u1=new Array(3).concat("edf8b17fcdbb2c7fb8","ffffcca1dab441b6c4225ea8","ffffcca1dab441b6c42c7fb8253494","ffffccc7e9b47fcdbb41b6c42c7fb8253494","ffffccc7e9b47fcdbb41b6c41d91c0225ea80c2c84","ffffd9edf8b1c7e9b47fcdbb41b6c41d91c0225ea80c2c84","ffffd9edf8b1c7e9b47fcdbb41b6c41d91c0225ea8253494081d58").map(N),k5=I(u1),l1=new Array(3).concat("f7fcb9addd8e31a354","ffffccc2e69978c679238443","ffffccc2e69978c67931a354006837","ffffccd9f0a3addd8e78c67931a354006837","ffffccd9f0a3addd8e78c67941ab5d238443005a32","ffffe5f7fcb9d9f0a3addd8e78c67941ab5d238443005a32","ffffe5f7fcb9d9f0a3addd8e78c67941ab5d238443006837004529").map(N),T5=I(l1),h1=new Array(3).concat("fff7bcfec44fd95f0e","ffffd4fed98efe9929cc4c02","ffffd4fed98efe9929d95f0e993404","ffffd4fee391fec44ffe9929d95f0e993404","ffffd4fee391fec44ffe9929ec7014cc4c028c2d04","ffffe5fff7bcfee391fec44ffe9929ec7014cc4c028c2d04","ffffe5fff7bcfee391fec44ffe9929ec7014cc4c02993404662506").map(N),S5=I(h1),d1=new Array(3).concat("ffeda0feb24cf03b20","ffffb2fecc5cfd8d3ce31a1c","ffffb2fecc5cfd8d3cf03b20bd0026","ffffb2fed976feb24cfd8d3cf03b20bd0026","ffffb2fed976feb24cfd8d3cfc4e2ae31a1cb10026","ffffccffeda0fed976feb24cfd8d3cfc4e2ae31a1cb10026","ffffccffeda0fed976feb24cfd8d3cfc4e2ae31a1cbd0026800026").map(N),C5=I(d1),p1=new Array(3).concat("deebf79ecae13182bd","eff3ffbdd7e76baed62171b5","eff3ffbdd7e76baed63182bd08519c","eff3ffc6dbef9ecae16baed63182bd08519c","eff3ffc6dbef9ecae16baed64292c62171b5084594","f7fbffdeebf7c6dbef9ecae16baed64292c62171b5084594","f7fbffdeebf7c6dbef9ecae16baed64292c62171b508519c08306b").map(N),A5=I(p1),b1=new Array(3).concat("e5f5e0a1d99b31a354","edf8e9bae4b374c476238b45","edf8e9bae4b374c47631a354006d2c","edf8e9c7e9c0a1d99b74c47631a354006d2c","edf8e9c7e9c0a1d99b74c47641ab5d238b45005a32","f7fcf5e5f5e0c7e9c0a1d99b74c47641ab5d238b45005a32","f7fcf5e5f5e0c7e9c0a1d99b74c47641ab5d238b45006d2c00441b").map(N),N5=I(b1),g1=new Array(3).concat("f0f0f0bdbdbd636363","f7f7f7cccccc969696525252","f7f7f7cccccc969696636363252525","f7f7f7d9d9d9bdbdbd969696636363252525","f7f7f7d9d9d9bdbdbd969696737373525252252525","fffffff0f0f0d9d9d9bdbdbd969696737373525252252525","fffffff0f0f0d9d9d9bdbdbd969696737373525252252525000000").map(N),R5=I(g1),m1=new Array(3).concat("efedf5bcbddc756bb1","f2f0f7cbc9e29e9ac86a51a3","f2f0f7cbc9e29e9ac8756bb154278f","f2f0f7dadaebbcbddc9e9ac8756bb154278f","f2f0f7dadaebbcbddc9e9ac8807dba6a51a34a1486","fcfbfdefedf5dadaebbcbddc9e9ac8807dba6a51a34a1486","fcfbfdefedf5dadaebbcbddc9e9ac8807dba6a51a354278f3f007d").map(N),E5=I(m1),y1=new Array(3).concat("fee0d2fc9272de2d26","fee5d9fcae91fb6a4acb181d","fee5d9fcae91fb6a4ade2d26a50f15","fee5d9fcbba1fc9272fb6a4ade2d26a50f15","fee5d9fcbba1fc9272fb6a4aef3b2ccb181d99000d","fff5f0fee0d2fcbba1fc9272fb6a4aef3b2ccb181d99000d","fff5f0fee0d2fcbba1fc9272fb6a4aef3b2ccb181da50f1567000d").map(N),D5=I(y1),_1=new Array(3).concat("fee6cefdae6be6550d","feeddefdbe85fd8d3cd94701","feeddefdbe85fd8d3ce6550da63603","feeddefdd0a2fdae6bfd8d3ce6550da63603","feeddefdd0a2fdae6bfd8d3cf16913d948018c2d04","fff5ebfee6cefdd0a2fdae6bfd8d3cf16913d948018c2d04","fff5ebfee6cefdd0a2fdae6bfd8d3cf16913d94801a636037f2704").map(N),$5=I(_1);var P5=Gn(Pe(300,.5,0),Pe(-240,.5,1)),O5=Gn(Pe(-100,.75,.35),Pe(80,1.5,.8)),I5=Gn(Pe(260,.75,.35),Pe(80,1.5,.8)),L5=Pe();var U5=Ft(),F5=Math.PI/3,q5=Math.PI*2/3;function hi(e){var t=e.length;return function(n){return e[Math.max(0,Math.min(t-1,Math.floor(n*t)))]}}var z5=hi(N("44015444025645045745055946075a46085c460a5d460b5e470d60470e6147106347116447136548146748166848176948186a481a6c481b6d481c6e481d6f481f70482071482173482374482475482576482677482878482979472a7a472c7a472d7b472e7c472f7d46307e46327e46337f463480453581453781453882443983443a83443b84433d84433e85423f854240864241864142874144874045884046883f47883f48893e49893e4a893e4c8a3d4d8a3d4e8a3c4f8a3c508b3b518b3b528b3a538b3a548c39558c39568c38588c38598c375a8c375b8d365c8d365d8d355e8d355f8d34608d34618d33628d33638d32648e32658e31668e31678e31688e30698e306a8e2f6b8e2f6c8e2e6d8e2e6e8e2e6f8e2d708e2d718e2c718e2c728e2c738e2b748e2b758e2a768e2a778e2a788e29798e297a8e297b8e287c8e287d8e277e8e277f8e27808e26818e26828e26828e25838e25848e25858e24868e24878e23888e23898e238a8d228b8d228c8d228d8d218e8d218f8d21908d21918c20928c20928c20938c1f948c1f958b1f968b1f978b1f988b1f998a1f9a8a1e9b8a1e9c891e9d891f9e891f9f881fa0881fa1881fa1871fa28720a38620a48621a58521a68522a78522a88423a98324aa8325ab8225ac8226ad8127ad8128ae8029af7f2ab07f2cb17e2db27d2eb37c2fb47c31b57b32b67a34b67935b77937b87838b9773aba763bbb753dbc743fbc7340bd7242be7144bf7046c06f48c16e4ac16d4cc26c4ec36b50c46a52c56954c56856c66758c7655ac8645cc8635ec96260ca6063cb5f65cb5e67cc5c69cd5b6ccd5a6ece5870cf5773d05675d05477d1537ad1517cd2507fd34e81d34d84d44b86d54989d5488bd6468ed64590d74393d74195d84098d83e9bd93c9dd93ba0da39a2da37a5db36a8db34aadc32addc30b0dd2fb2dd2db5de2bb8de29bade28bddf26c0df25c2df23c5e021c8e020cae11fcde11dd0e11cd2e21bd5e21ad8e219dae319dde318dfe318e2e418e5e419e7e419eae51aece51befe51cf1e51df4e61ef6e620f8e621fbe723fde725")),Y5=hi(N("00000401000501010601010802010902020b02020d03030f03031204041405041606051806051a07061c08071e0907200a08220b09240c09260d0a290e0b2b100b2d110c2f120d31130d34140e36150e38160f3b180f3d19103f1a10421c10441d11471e114920114b21114e22115024125325125527125829115a2a115c2c115f2d11612f116331116533106734106936106b38106c390f6e3b0f703d0f713f0f72400f74420f75440f764510774710784910784a10794c117a4e117b4f127b51127c52137c54137d56147d57157e59157e5a167e5c167f5d177f5f187f601880621980641a80651a80671b80681c816a1c816b1d816d1d816e1e81701f81721f817320817521817621817822817922827b23827c23827e24828025828125818326818426818627818827818928818b29818c29818e2a81902a81912b81932b80942c80962c80982d80992d809b2e7f9c2e7f9e2f7fa02f7fa1307ea3307ea5317ea6317da8327daa337dab337cad347cae347bb0357bb2357bb3367ab5367ab73779b83779ba3878bc3978bd3977bf3a77c03a76c23b75c43c75c53c74c73d73c83e73ca3e72cc3f71cd4071cf4070d0416fd2426fd3436ed5446dd6456cd8456cd9466bdb476adc4869de4968df4a68e04c67e24d66e34e65e44f64e55064e75263e85362e95462ea5661eb5760ec5860ed5a5fee5b5eef5d5ef05f5ef1605df2625df2645cf3655cf4675cf4695cf56b5cf66c5cf66e5cf7705cf7725cf8745cf8765cf9785df9795df97b5dfa7d5efa7f5efa815ffb835ffb8560fb8761fc8961fc8a62fc8c63fc8e64fc9065fd9266fd9467fd9668fd9869fd9a6afd9b6bfe9d6cfe9f6dfea16efea36ffea571fea772fea973feaa74feac76feae77feb078feb27afeb47bfeb67cfeb77efeb97ffebb81febd82febf84fec185fec287fec488fec68afec88cfeca8dfecc8ffecd90fecf92fed194fed395fed597fed799fed89afdda9cfddc9efddea0fde0a1fde2a3fde3a5fde5a7fde7a9fde9aafdebacfcecaefceeb0fcf0b2fcf2b4fcf4b6fcf6b8fcf7b9fcf9bbfcfbbdfcfdbf")),B5=hi(N("00000401000501010601010802010a02020c02020e03021004031204031405041706041907051b08051d09061f0a07220b07240c08260d08290e092b10092d110a30120a32140b34150b37160b39180c3c190c3e1b0c411c0c431e0c451f0c48210c4a230c4c240c4f260c51280b53290b552b0b572d0b592f0a5b310a5c320a5e340a5f3609613809623909633b09643d09653e0966400a67420a68440a68450a69470b6a490b6a4a0c6b4c0c6b4d0d6c4f0d6c510e6c520e6d540f6d550f6d57106e59106e5a116e5c126e5d126e5f136e61136e62146e64156e65156e67166e69166e6a176e6c186e6d186e6f196e71196e721a6e741a6e751b6e771c6d781c6d7a1d6d7c1d6d7d1e6d7f1e6c801f6c82206c84206b85216b87216b88226a8a226a8c23698d23698f24699025689225689326679526679727669827669a28659b29649d29649f2a63a02a63a22b62a32c61a52c60a62d60a82e5fa92e5eab2f5ead305dae305cb0315bb1325ab3325ab43359b63458b73557b93556ba3655bc3754bd3853bf3952c03a51c13a50c33b4fc43c4ec63d4dc73e4cc83f4bca404acb4149cc4248ce4347cf4446d04545d24644d34743d44842d54a41d74b3fd84c3ed94d3dda4e3cdb503bdd513ade5238df5337e05536e15635e25734e35933e45a31e55c30e65d2fe75e2ee8602de9612bea632aeb6429eb6628ec6726ed6925ee6a24ef6c23ef6e21f06f20f1711ff1731df2741cf3761bf37819f47918f57b17f57d15f67e14f68013f78212f78410f8850ff8870ef8890cf98b0bf98c0af98e09fa9008fa9207fa9407fb9606fb9706fb9906fb9b06fb9d07fc9f07fca108fca309fca50afca60cfca80dfcaa0ffcac11fcae12fcb014fcb216fcb418fbb61afbb81dfbba1ffbbc21fbbe23fac026fac228fac42afac62df9c72ff9c932f9cb35f8cd37f8cf3af7d13df7d340f6d543f6d746f5d949f5db4cf4dd4ff4df53f4e156f3e35af3e55df2e661f2e865f2ea69f1ec6df1ed71f1ef75f1f179f2f27df2f482f3f586f3f68af4f88ef5f992f6fa96f8fb9af9fc9dfafda1fcffa4")),H5=hi(N("0d088710078813078916078a19068c1b068d1d068e20068f2206902406912605912805922a05932c05942e05952f059631059733059735049837049938049a3a049a3c049b3e049c3f049c41049d43039e44039e46039f48039f4903a04b03a14c02a14e02a25002a25102a35302a35502a45601a45801a45901a55b01a55c01a65e01a66001a66100a76300a76400a76600a76700a86900a86a00a86c00a86e00a86f00a87100a87201a87401a87501a87701a87801a87a02a87b02a87d03a87e03a88004a88104a78305a78405a78606a68707a68808a68a09a58b0aa58d0ba58e0ca48f0da4910ea3920fa39410a29511a19613a19814a099159f9a169f9c179e9d189d9e199da01a9ca11b9ba21d9aa31e9aa51f99a62098a72197a82296aa2395ab2494ac2694ad2793ae2892b02991b12a90b22b8fb32c8eb42e8db52f8cb6308bb7318ab83289ba3388bb3488bc3587bd3786be3885bf3984c03a83c13b82c23c81c33d80c43e7fc5407ec6417dc7427cc8437bc9447aca457acb4679cc4778cc4977cd4a76ce4b75cf4c74d04d73d14e72d24f71d35171d45270d5536fd5546ed6556dd7566cd8576bd9586ada5a6ada5b69db5c68dc5d67dd5e66de5f65de6164df6263e06363e16462e26561e26660e3685fe4695ee56a5de56b5de66c5ce76e5be76f5ae87059e97158e97257ea7457eb7556eb7655ec7754ed7953ed7a52ee7b51ef7c51ef7e50f07f4ff0804ef1814df1834cf2844bf3854bf3874af48849f48948f58b47f58c46f68d45f68f44f79044f79143f79342f89441f89540f9973ff9983ef99a3efa9b3dfa9c3cfa9e3bfb9f3afba139fba238fca338fca537fca636fca835fca934fdab33fdac33fdae32fdaf31fdb130fdb22ffdb42ffdb52efeb72dfeb82cfeba2cfebb2bfebd2afebe2afec029fdc229fdc328fdc527fdc627fdc827fdca26fdcb26fccd25fcce25fcd025fcd225fbd324fbd524fbd724fad824fada24f9dc24f9dd25f8df25f8e125f7e225f7e425f6e626f6e826f5e926f5eb27f4ed27f3ee27f3f027f2f227f1f426f1f525f0f724f0f921"));var q="year",me="quarter",te="month",G="week",H="isoweek",fe="date",Y="day",ct="dayofyear",le="hours",he="minutes",ye="seconds",Ne="milliseconds",v1=[q,me,te,G,H,fe,Y,ct,le,he,ye,Ne],oo=v1.reduce((e,t,n)=>(e[t]=1+n,e),{});function Tc(e){let t=We(e).slice(),n={};return t.length||B("Missing time unit."),t.forEach(i=>{ae(oo,i)?n[i]=1:B(`Invalid time unit: ${i}.`)}),((n[G]||n[H]||n[Y]?1:0)+(n[me]||n[te]||n[fe]?1:0)+(n[ct]?1:0)>1||n[G]&&n[H])&&B(`Incompatible time units: ${e}`),t.sort((i,a)=>oo[i]-oo[a]),t}var X5={[q]:"%Y ",[me]:"Q%q ",[te]:"%b ",[fe]:"%d ",[G]:"W%U ",[H]:"W%V ",[Y]:"%a ",[ct]:"%j ",[le]:"%H:00",[he]:"00:%M",[ye]:":%S",[Ne]:".%L",[`${q}-${H}`]:"%G W%V ",[`${q}-${te}`]:"%Y-%m ",[`${q}-${te}-${fe}`]:"%Y-%m-%d ",[`${le}-${he}`]:"%H:%M"};var jt=new Date;function di(e){return jt.setFullYear(e),jt.setMonth(0),jt.setDate(1),jt.setHours(0,0,0,0),jt}function x1(e){return be.count(di(e.getFullYear())-1,e)}function _c(e){return ft.count(di(e.getFullYear())-1,e)}function Sc(e){return be.offset(Ve.floor(e),3).getFullYear()}function vc(e){return 1+Ve.count(Cc(Sc(e)),e)}function Cc(e){return Ve.floor(be.offset(di(e),3))}function Ac(e){let t=Cc(e);return t.getMonth()?t.getDate()-31:t.getDate()}function fo(e){return di(e).getDay()}function w1(e,t,n,r,i,a,o){if(0<=e&&e<100){let f=new Date(-1,t,n,r,i,a,o);return f.setFullYear(e),f}return new Date(e,t,n,r,i,a,o)}function M1(e){let t=Date.UTC(e.getUTCFullYear(),0,1);return Se.count(t-1,e)}function xc(e){let t=Date.UTC(e.getUTCFullYear(),0,1);return st.count(t-1,e)}function Nc(e){return Se.offset(Qe.floor(e),3).getUTCFullYear()}function wc(e){return 1+Qe.count(Rc(Nc(e)),e)}function Rc(e){return Qe.floor(Se.offset(Date.UTC(e,0,1),3))}function Ec(e){let t=Rc(e);return t.getUTCMonth()?t.getUTCDate()-31:t.getUTCDate()}function so(e){return jt.setTime(Date.UTC(e,0,1)),jt.getUTCDay()}function k1(e,t,n,r,i,a,o){if(0<=e&&e<100){let f=new Date(Date.UTC(-1,t,n,r,i,a,o));return f.setUTCFullYear(n.y),f}return new Date(Date.UTC(e,t,n,r,i,a,o))}var T1=2012,S1=2015;function Dc(e,t,n,r,i){let a=t||1,o=ie(e),f=(m,w,x)=>(x=x||m,C1(n[x],r[x],m===o&&a,w)),s=new Date,c=dt(e),l=c[q]?f(q,null,c[H]?q+H:q):Or(c[H]?S1:T1),u=c[te]?f(te):c[me]?f(me):Pt,h=c[G]&&c[Y]?f(Y,1,G+Y):c[H]&&c[Y]?f(Y,1,H+Y):c[G]?f(G,1):c[H]?f(H,1):c[Y]?f(Y,1):c[fe]?f(fe,1):c[ct]?f(ct,1):da,d=c[le]?f(le):Pt,b=c[he]?f(he):Pt,p=c[ye]?f(ye):Pt,g=c[Ne]?f(Ne):Pt;return function(m){s.setTime(+m);let w=l(s);return i(w,u(s),h(s,w),d(s),b(s),p(s),g(s))}}function C1(e,t,n,r){let i=n<=1?e:r?(a,o)=>r+n*Math.floor((e(a,o)-r)/n):(a,o)=>n*Math.floor(e(a,o)/n);return t?(a,o)=>t(i(a,o),o):i}function Tn(e,t,n){return t+e*7-(n+6)%7}function $c(e){return(e+6)%7}function pi(e,t,n){return e+(t-1)*7+n}var A1={[q]:e=>e.getFullYear(),[me]:e=>Math.floor(e.getMonth()/3),[te]:e=>e.getMonth(),[fe]:e=>e.getDate(),[le]:e=>e.getHours(),[he]:e=>e.getMinutes(),[ye]:e=>e.getSeconds(),[Ne]:e=>e.getMilliseconds(),[ct]:e=>x1(e),[G]:e=>_c(e),[G+Y]:(e,t)=>Tn(_c(e),e.getDay(),fo(t)),[Y]:(e,t)=>Tn(1,e.getDay(),fo(t)),[H]:e=>vc(e),[q+H]:e=>Sc(e),[H+Y]:(e,t)=>pi(Ac(t),vc(e),$c(e.getDay()))},N1={[me]:e=>3*e,[G]:(e,t)=>Tn(e,0,fo(t)),[H]:(e,t)=>pi(Ac(t),e,0)};function Pc(e,t){return Dc(e,t||1,A1,N1,w1)}var R1={[q]:e=>e.getUTCFullYear(),[me]:e=>Math.floor(e.getUTCMonth()/3),[te]:e=>e.getUTCMonth(),[fe]:e=>e.getUTCDate(),[le]:e=>e.getUTCHours(),[he]:e=>e.getUTCMinutes(),[ye]:e=>e.getUTCSeconds(),[Ne]:e=>e.getUTCMilliseconds(),[ct]:e=>M1(e),[G]:e=>xc(e),[Y]:(e,t)=>Tn(1,e.getUTCDay(),so(t)),[G+Y]:(e,t)=>Tn(xc(e),e.getUTCDay(),so(t)),[H]:e=>wc(e),[q+H]:e=>Nc(e),[H+Y]:(e,t)=>pi(Ec(t),wc(e),$c(e.getUTCDay()))},E1={[me]:e=>3*e,[G]:(e,t)=>Tn(e,0,so(t)),[H]:(e,t)=>pi(Ec(t),e,0)};function Oc(e,t){return Dc(e,t||1,R1,E1,k1)}var D1={[q]:Ce,[me]:Ht.every(3),[te]:Ht,[G]:ft,[H]:Ve,[fe]:be,[Y]:be,[ct]:be,[le]:xn,[he]:_n,[ye]:Te,[Ne]:mt},$1={[q]:Ae,[me]:Wt.every(3),[te]:Wt,[G]:st,[H]:Qe,[fe]:Se,[Y]:Se,[ct]:Se,[le]:wn,[he]:vn,[ye]:Te,[Ne]:mt};function fr(e){return D1[e]}function sr(e){return $1[e]}var tr=1e3,nr=tr*60,rr=nr*60,bi=rr*24,P1=bi*7,Mc=bi*30,O1=bi*365,I1=[q,te,fe,le,he,ye,Ne],ir=I1.slice(0,-1),ar=ir.slice(0,-1),or=ar.slice(0,-1),L1=or.slice(0,-1),U1=[q,G],kc=[q,te],F1=[q],V5=[[ir,1,tr],[ir,5,5*tr],[ir,15,15*tr],[ir,30,30*tr],[ar,1,nr],[ar,5,5*nr],[ar,15,15*nr],[ar,30,30*nr],[or,1,rr],[or,3,3*rr],[or,6,6*rr],[or,12,12*rr],[L1,1,bi],[U1,1,P1],[kc,1,Mc],[kc,3,3*Mc],[F1,1,O1]];var Q5={[q]:e=>e.getFullYear(),[te]:e=>e.getMonth(),[fe]:e=>e.getDate(),[Y]:e=>e.getDay(),[le]:e=>e.getHours(),[he]:e=>e.getMinutes(),[ye]:e=>e.getSeconds(),[Ne]:e=>e.getMilliseconds()},Z5={[q]:e=>e.getUTCFullYear(),[te]:e=>e.getUTCMonth(),[fe]:e=>e.getUTCDate(),[Y]:e=>e.getUTCDay(),[le]:e=>e.getUTCHours(),[he]:e=>e.getUTCMinutes(),[ye]:e=>e.getUTCSeconds(),[Ne]:e=>e.getUTCMilliseconds()};function q1(e,t,n){let r=e-t+n*2;return e?r>0?r:1:0}var z1="identity",uo="linear",vt="log",lo="pow",ho="sqrt",po="symlog",cr="time",ur="utc",Sn="sequential",lr="diverging",gi="quantile",bo="quantize",Fc="threshold",Y1="ordinal",B1="point",H1="band",W1="bin-ordinal",ne="continuous",hr="discrete",dr="discretizing",ze="interpolating",go="temporal";function G1(e){return function(t){let n=t[0],r=t[1],i;return r<n&&(i=n,n=r,r=i),[e.invert(n),e.invert(r)]}}function j1(e){return function(t){let n=e.range(),r=t[0],i=t[1],a=-1,o,f,s,c;for(i<r&&(f=r,r=i,i=f),s=0,c=n.length;s<c;++s)n[s]>=r&&n[s]<=i&&(a<0&&(a=s),o=s);if(!(a<0))return r=e.invertExtent(n[a]),i=e.invertExtent(n[o]),[r[0]===void 0?r[1]:r[0],i[1]===void 0?i[0]:i[1]]}}function mo(){let e=Kn().unknown(void 0),t=e.domain,n=e.range,r=[0,1],i,a,o=!1,f=0,s=0,c=.5;delete e.unknown;function l(){let u=t().length,h=r[1]<r[0],d=r[1-h],b=q1(u,f,s),p=r[h-0];i=(d-p)/(b||1),o&&(i=Math.floor(i)),p+=(d-p-i*(u-f))*c,a=i*(1-f),o&&(p=Math.round(p),a=Math.round(a));let g=ma(u).map(m=>p+i*m);return n(h?g.reverse():g)}return e.domain=function(u){return arguments.length?(t(u),l()):t()},e.range=function(u){return arguments.length?(r=[+u[0],+u[1]],l()):r.slice()},e.rangeRound=function(u){return r=[+u[0],+u[1]],o=!0,l()},e.bandwidth=function(){return a},e.step=function(){return i},e.round=function(u){return arguments.length?(o=!!u,l()):o},e.padding=function(u){return arguments.length?(s=Math.max(0,Math.min(1,u)),f=s,l()):f},e.paddingInner=function(u){return arguments.length?(f=Math.max(0,Math.min(1,u)),l()):f},e.paddingOuter=function(u){return arguments.length?(s=Math.max(0,Math.min(1,u)),l()):s},e.align=function(u){return arguments.length?(c=Math.max(0,Math.min(1,u)),l()):c},e.invertRange=function(u){if(u[0]==null||u[1]==null)return;let h=r[1]<r[0],d=h?n().reverse():n(),b=d.length-1,p=+u[0],g=+u[1],m,w,x;if(!(p!==p||g!==g)&&(g<p&&(x=p,p=g,g=x),!(g<d[0]||p>r[1-h])))return m=Math.max(0,Ge(d,p)-1),w=p===g?m:Ge(d,g)-1,p-d[m]>a+1e-10&&++m,h&&(x=m,m=b-w,w=b-x),m>w?void 0:t().slice(m,w+1)},e.invert=function(u){let h=e.invertRange([u,u]);return h&&h[0]},e.copy=function(){return mo().domain(t()).range(r).round(o).paddingInner(f).paddingOuter(s).align(c)},l()}function qc(e){let t=e.copy;return e.padding=e.paddingOuter,delete e.paddingInner,e.copy=function(){return qc(t())},e}function X1(){return qc(mo().paddingInner(1))}var V1=Array.prototype.map;function Q1(e){return V1.call(e,fn)}var Z1=Array.prototype.slice;function zc(){let e=[],t=[];function n(r){return r==null||r!==r?void 0:t[(Ge(e,r)-1)%t.length]}return n.domain=function(r){return arguments.length?(e=Q1(r),n):e.slice()},n.range=function(r){return arguments.length?(t=Z1.call(r),n):t.slice()},n.tickFormat=function(r,i){return Ba(e[0],ie(e),r??10,i)},n.copy=function(){return zc().domain(n.domain()).range(n.range())},n}var mi=new Map,J1=Symbol("vega_scale");function K1(e){return e[J1]=!0,e}function e2(e,t,n){let r=function(){let a=t();return a.invertRange||(a.invertRange=a.invert?G1(a):a.invertExtent?j1(a):void 0),a.type=e,K1(a)};return r.metadata=dt(We(n)),r}function O(e,t,n){return arguments.length>1?(mi.set(e,e2(e,t,n)),this):t2(e)?mi.get(e):void 0}O(z1,Wa);O(uo,Ha,ne);O(vt,ja,[ne,vt]);O(lo,oi,ne);O(ho,ic,ne);O(po,Va,ne);O(cr,ac,[ne,go]);O(ur,oc,[ne,go]);O(Sn,si,[ne,ze]);O(`${Sn}-${uo}`,si,[ne,ze]);O(`${Sn}-${vt}`,to,[ne,ze,vt]);O(`${Sn}-${lo}`,ci,[ne,ze]);O(`${Sn}-${ho}`,fc,[ne,ze]);O(`${Sn}-${po}`,no,[ne,ze]);O(`${lr}-${uo}`,ro,[ne,ze]);O(`${lr}-${vt}`,io,[ne,ze,vt]);O(`${lr}-${lo}`,li,[ne,ze]);O(`${lr}-${ho}`,sc,[ne,ze]);O(`${lr}-${po}`,ao,[ne,ze]);O(gi,Za,[dr,gi]);O(bo,Ja,dr);O(Fc,Ka,dr);O(W1,zc,[hr,dr]);O(Y1,Kn,hr);O(H1,mo,hr);O(B1,X1,hr);function t2(e){return mi.has(e)}function yi(e,t){let n=mi.get(e);return n&&n.metadata[t]}function yo(e){return yi(e,hr)}function n2(e){return yi(e,dr)}function r2(e){return yi(e,vt)}function i2(e){return yi(e,go)}function a2(e,t,n){return jn(o2(t||"rgb",n),e)}function o2(e,t){let n=Da[f2(e)];return t!=null&&n&&n.gamma?n.gamma(t):n}function f2(e){return"interpolate"+e.toLowerCase().split("-").map(t=>t[0].toUpperCase()+t.slice(1)).join("")}var s2={blues:"cfe1f2bed8eca8cee58fc1de74b2d75ba3cf4592c63181bd206fb2125ca40a4a90",greens:"d3eecdc0e6baabdda594d3917bc77d60ba6c46ab5e329a512089430e7735036429",greys:"e2e2e2d4d4d4c4c4c4b1b1b19d9d9d8888887575756262624d4d4d3535351e1e1e",oranges:"fdd8b3fdc998fdb87bfda55efc9244f87f2cf06b18e4580bd14904b93d029f3303",purples:"e2e1efd4d4e8c4c5e0b4b3d6a3a0cc928ec3827cb97566ae684ea25c3696501f8c",reds:"fdc9b4fcb49afc9e80fc8767fa7051f6573fec3f2fdc2a25c81b1db21218970b13",blueGreen:"d5efedc1e8e0a7ddd18bd2be70c6a958ba9144ad77319c5d2089460e7736036429",bluePurple:"ccddecbad0e4a8c2dd9ab0d4919cc98d85be8b6db28a55a6873c99822287730f71",greenBlue:"d3eecec5e8c3b1e1bb9bd8bb82cec269c2ca51b2cd3c9fc7288abd1675b10b60a1",orangeRed:"fddcaffdcf9bfdc18afdad77fb9562f67d53ee6545e24932d32d1ebf130da70403",purpleBlue:"dbdaebc8cee4b1c3de97b7d87bacd15b9fc93a90c01e7fb70b70ab056199045281",purpleBlueGreen:"dbd8eac8cee4b0c3de93b7d872acd1549fc83892bb1c88a3097f8702736b016353",purpleRed:"dcc9e2d3b3d7ce9eccd186c0da6bb2e14da0e23189d91e6fc61159ab07498f023a",redPurple:"fccfccfcbec0faa9b8f98faff571a5ec539ddb3695c41b8aa908808d0179700174",yellowGreen:"e4f4acd1eca0b9e2949ed68880c97c62bb6e47aa5e3297502083440e723b036034",yellowOrangeBrown:"feeaa1fedd84fecc63feb746fca031f68921eb7215db5e0bc54c05ab3d038f3204",yellowOrangeRed:"fee087fed16ffebd59fea849fd903efc7335f9522bee3423de1b20ca0b22af0225",blueOrange:"134b852f78b35da2cb9dcae1d2e5eff2f0ebfce0bafbbf74e8932fc5690d994a07",brownBlueGreen:"704108a0651ac79548e3c78af3e6c6eef1eac9e9e48ed1c74da79e187a72025147",purpleGreen:"5b1667834792a67fb6c9aed3e6d6e8eff0efd9efd5aedda971bb75368e490e5e29",purpleOrange:"4114696647968f83b7b9b4d6dadbebf3eeeafce0bafbbf74e8932fc5690d994a07",redBlue:"8c0d25bf363adf745ef4ae91fbdbc9f2efeed2e5ef9dcae15da2cb2f78b3134b85",redGrey:"8c0d25bf363adf745ef4ae91fcdccbfaf4f1e2e2e2c0c0c0969696646464343434",yellowGreenBlue:"eff9bddbf1b4bde5b594d5b969c5be45b4c22c9ec02182b82163aa23479c1c3185",redYellowBlue:"a50026d4322cf16e43fcac64fedd90faf8c1dcf1ecabd6e875abd04a74b4313695",redYellowGreen:"a50026d4322cf16e43fcac63fedd8df9f7aed7ee8ea4d86e64bc6122964f006837",pinkYellowGreen:"8e0152c0267edd72adf0b3d6faddedf5f3efe1f2cab6de8780bb474f9125276419",spectral:"9e0142d13c4bf0704afcac63fedd8dfbf8b0e0f3a1a9dda269bda94288b55e4fa2",viridis:"440154470e61481a6c482575472f7d443a834144873d4e8a39568c35608d31688e2d708e2a788e27818e23888e21918d1f988b1fa08822a8842ab07f35b77943bf7154c56866cc5d7ad1518fd744a5db36bcdf27d2e21be9e51afde725",magma:"0000040404130b0924150e3720114b2c11603b0f704a107957157e651a80721f817f24828c29819a2e80a8327db6377ac43c75d1426fde4968e95462f1605df76f5cfa7f5efc8f65fe9f6dfeaf78febf84fece91fddea0fcedaffcfdbf",inferno:"0000040403130c0826170c3b240c4f330a5f420a68500d6c5d126e6b176e781c6d86216b932667a12b62ae305cbb3755c73e4cd24644dd513ae65c30ed6925f3771af8850ffb9506fca50afcb519fac62df6d645f2e661f3f484fcffa4",plasma:"0d088723069033059742039d5002a25d01a66a00a87801a88405a7900da49c179ea72198b12a90ba3488c33d80cb4779d35171da5a69e16462e76e5bed7953f2834cf68f44fa9a3dfca636fdb32ffec029fcce25f9dc24f5ea27f0f921",cividis:"00205100235800265d002961012b65042e670831690d346b11366c16396d1c3c6e213f6e26426e2c456e31476e374a6e3c4d6e42506e47536d4c566d51586e555b6e5a5e6e5e616e62646f66676f6a6a706e6d717270717573727976737c79747f7c75827f758682768985778c8877908b78938e789691789a94789e9778a19b78a59e77a9a177aea575b2a874b6ab73bbaf71c0b26fc5b66dc9b96acebd68d3c065d8c462ddc85fe2cb5ce7cf58ebd355f0d652f3da4ff7de4cfae249fce647",rainbow:"6e40aa883eb1a43db3bf3cafd83fa4ee4395fe4b83ff576eff6659ff7847ff8c38f3a130e2b72fcfcc36bee044aff05b8ff4576ff65b52f6673af27828ea8d1ddfa319d0b81cbecb23abd82f96e03d82e14c6edb5a5dd0664dbf6e40aa",sinebow:"ff4040fc582af47218e78d0bd5a703bfbf00a7d5038de70b72f41858fc2a40ff402afc5818f4720be78d03d5a700bfbf03a7d50b8de71872f42a58fc4040ff582afc7218f48d0be7a703d5bf00bfd503a7e70b8df41872fc2a58ff4040",turbo:"23171b32204a3e2a71453493493eae4b49c54a53d7485ee44569ee4074f53c7ff8378af93295f72e9ff42ba9ef28b3e926bce125c5d925cdcf27d5c629dcbc2de3b232e9a738ee9d3ff39347f68950f9805afc7765fd6e70fe667cfd5e88fc5795fb51a1f84badf545b9f140c5ec3cd0e637dae034e4d931ecd12ef4c92bfac029ffb626ffad24ffa223ff9821ff8d1fff821dff771cfd6c1af76118f05616e84b14df4111d5380fcb2f0dc0260ab61f07ac1805a313029b0f00950c00910b00",browns:"eedbbdecca96e9b97ae4a865dc9856d18954c7784cc0673fb85536ad44339f3632",tealBlues:"bce4d89dd3d181c3cb65b3c245a2b9368fae347da0306a932c5985",teals:"bbdfdfa2d4d58ac9c975bcbb61b0af4da5a43799982b8b8c1e7f7f127273006667",warmGreys:"dcd4d0cec5c1c0b8b4b3aaa7a59c9998908c8b827f7e7673726866665c5a59504e",goldGreen:"f4d166d5ca60b6c35c98bb597cb25760a6564b9c533f8f4f33834a257740146c36",goldOrange:"f4d166f8be5cf8aa4cf5983bf3852aef701be2621fd65322c54923b142239e3a26",goldRed:"f4d166f6be59f9aa51fc964ef6834bee734ae56249db5247cf4244c43141b71d3e",lightGreyRed:"efe9e6e1dad7d5cbc8c8bdb9bbaea9cd967ddc7b43e15f19df4011dc000b",lightGreyTeal:"e4eaead6dcddc8ced2b7c2c7a6b4bc64b0bf22a6c32295c11f85be1876bc",lightMulti:"e0f1f2c4e9d0b0de9fd0e181f6e072f6c053f3993ef77440ef4a3c",lightOrange:"f2e7daf7d5baf9c499fab184fa9c73f68967ef7860e8645bde515bd43d5b",lightTealBlue:"e3e9e0c0dccf9aceca7abfc859afc0389fb9328dad2f7ca0276b95255988",darkBlue:"3232322d46681a5c930074af008cbf05a7ce25c0dd38daed50f3faffffff",darkGold:"3c3c3c584b37725e348c7631ae8b2bcfa424ecc31ef9de30fff184ffffff",darkGreen:"3a3a3a215748006f4d048942489e4276b340a6c63dd2d836ffeb2cffffaa",darkMulti:"3737371f5287197d8c29a86995ce3fffe800ffffff",darkRed:"3434347036339e3c38cc4037e75d1eec8620eeab29f0ce32ffeb2c"},c2={accent:uc,category10:cc,category20:"1f77b4aec7e8ff7f0effbb782ca02c98df8ad62728ff98969467bdc5b0d58c564bc49c94e377c2f7b6d27f7f7fc7c7c7bcbd22dbdb8d17becf9edae5",category20b:"393b795254a36b6ecf9c9ede6379398ca252b5cf6bcedb9c8c6d31bd9e39e7ba52e7cb94843c39ad494ad6616be7969c7b4173a55194ce6dbdde9ed6",category20c:"3182bd6baed69ecae1c6dbefe6550dfd8d3cfdae6bfdd0a231a35474c476a1d99bc7e9c0756bb19e9ac8bcbddcdadaeb636363969696bdbdbdd9d9d9",dark2:lc,observable10:hc,paired:dc,pastel1:pc,pastel2:bc,set1:gc,set2:mc,set3:yc,tableau10:"4c78a8f58518e4575672b7b254a24beeca3bb279a2ff9da69d755dbab0ac",tableau20:"4c78a89ecae9f58518ffbf7954a24b88d27ab79a20f2cf5b43989483bcb6e45756ff9d9879706ebab0acd67195fcbfd2b279a2d6a5c99e765fd8b5a5"};function Yc(e){if(Z(e))return e;let t=e.length/6|0,n=new Array(t);for(let r=0;r<t;)n[r]="#"+e.slice(r*6,++r*6);return n}function Bc(e,t){for(let n in e)u2(n,t(e[n]))}var Ic={};Bc(c2,Yc);Bc(s2,e=>a2(Yc(e)));function u2(e,t){return e=e&&e.toLowerCase(),arguments.length>1?(Ic[e]=t,this):Ic[e]}var l2="symbol",h2="discrete";var d2=e=>Z(e)?e.map(t=>String(t)):String(e),p2=(e,t)=>e[1]-t[1],b2=(e,t)=>t[1]-e[1];function g2(e,t,n){let r=e.range(),i=r[0],a=ie(r),o=p2;if(i>a&&(r=a,a=i,i=r,o=b2),i=Math.floor(i),a=Math.ceil(a),t=t.map(f=>[f,e(f)]).filter(f=>i<=f[1]&&f[1]<=a).sort(o).map(f=>f[0]),n>0&&t.length>1){let f=[t[0],ie(t)];for(;t.length>n&&t.length>=3;)t=t.filter((s,c)=>!(c%2));t.length<3&&(t=f)}return t}function Hc(e,t){return e.bins?g2(e,e.bins,t):e.ticks?e.ticks(t):e.domain()}function m2(e,t,n,r,i,a){let o=t.type,f=d2;if(o===cr||i===cr)f=e.timeFormat(r);else if(o===ur||i===ur)f=e.utcFormat(r);else if(r2(o)){let s=e.formatFloat(r);if(a||t.bins)f=s;else{let c=Wc(t,n,!1);f=l=>c(l)?s(l):""}}else if(t.tickFormat){let s=t.domain();f=e.formatSpan(s[0],s[s.length-1],n,r)}else r&&(f=e.format(r));return f}function Wc(e,t,n){let r=Hc(e,t),i=e.base(),a=Math.log(i),o=Math.max(1,i*t/r.length),f=s=>{let c=s/Math.pow(i,Math.round(Math.log(s)/a));return c*i<i-.5&&(c*=i),c<=o};return n?r.filter(f):f}var co={[gi]:"quantiles",[bo]:"thresholds",[Fc]:"domain"},Gc={[gi]:"quantiles",[bo]:"domain"};function y2(e,t){return e.bins?x2(e.bins):e.type===vt?Wc(e,t,!0):co[e.type]?v2(e[co[e.type]]()):Hc(e,t)}function _2(e,t,n){let r=t[Gc[t.type]](),i=r.length,a=i>1?r[1]-r[0]:r[0],o;for(o=1;o<i;++o)a=Math.min(a,r[o]-r[o-1]);return e.formatSpan(0,a,30,n)}function v2(e){let t=[-1/0].concat(e);return t.max=1/0,t}function x2(e){let t=e.slice(0,-1);return t.max=ie(e),t}var w2=e=>co[e.type]||e.bins;function M2(e,t,n,r,i,a,o){let f=Gc[t.type]&&a!==cr&&a!==ur?_2(e,t,i):m2(e,t,n,i,a,o);return r===l2&&w2(t)?k2(f):r===h2?T2(f):S2(f)}var k2=e=>(t,n,r)=>{let i=Lc(r[n+1],Lc(r.max,1/0)),a=Uc(t,e),o=Uc(i,e);return a&&o?a+" \\u2013 "+o:o?"< "+o:"\\u2265 "+a},Lc=(e,t)=>e??t,T2=e=>(t,n)=>n?e(t):null,S2=e=>t=>e(t),Uc=(e,t)=>Number.isFinite(e)?t(e):null;function C2(e,t,n,r){let i=r||t.type;return tt(n)&&i2(i)&&(n=n.replace(/%a/g,"%A").replace(/%b/g,"%B")),!n&&i===cr?e.timeFormat("%A, %d %B %Y, %X"):!n&&i===ur?e.utcFormat("%A, %d %B %Y, %X UTC"):M2(e,t,5,null,n,r,!0)}function _o(e,t,n){n=n||{};let r=Math.max(3,n.maxlen||7),i=C2(e,t,n.format,n.formatType);if(n2(t.type)){let a=y2(t).slice(1).map(i),o=a.length;return`${o} boundar${o===1?"y":"ies"}: ${a.join(", ")}`}else if(yo(t.type)){let a=t.domain(),o=a.length,f=o>r?a.slice(0,r-2).map(i).join(", ")+", ending with "+a.slice(-1).map(i):a.map(i).join(", ");return`${o} value${o===1?"":"s"}: ${f}`}else{let a=t.domain();return`values from ${i(a[0])} to ${i(ie(a))}`}}var pr=Math.PI,vo=2*pr,Xt=1e-6,A2=vo-Xt;function jc(e){this._+=e[0];for(let t=1,n=e.length;t<n;++t)this._+=arguments[t]+e[t]}function N2(e){let t=Math.floor(e);if(!(t>=0))throw new Error(`invalid digits: ${e}`);if(t>15)return jc;let n=10**t;return function(r){this._+=r[0];for(let i=1,a=r.length;i<a;++i)this._+=Math.round(arguments[i]*n)/n+r[i]}}function Xc(e,t,n,r){return e===n&&t===r}function R2(e){let t=Math.floor(e);if(!(t<=15))return Xc;let n=10**t,r=function(i){return Math.round(i*n)};return function(i,a,o,f){return r(i)===r(o)&&r(a)===r(f)}}var Cn=class{constructor(t){this._x0=this._y0=this._x1=this._y1=null,this._="",this._append=t==null?jc:N2(t),this._equal=t==null?Xc:R2(t)}moveTo(t,n){this._append`M${this._x0=this._x1=+t},${this._y0=this._y1=+n}`}closePath(){this._x1!==null&&(this._x1=this._x0,this._y1=this._y0,this._append`Z`)}lineTo(t,n){this._append`L${this._x1=+t},${this._y1=+n}`}quadraticCurveTo(t,n,r,i){this._append`Q${+t},${+n},${this._x1=+r},${this._y1=+i}`}bezierCurveTo(t,n,r,i,a,o){this._append`C${+t},${+n},${+r},${+i},${this._x1=+a},${this._y1=+o}`}arcTo(t,n,r,i,a){if(t=+t,n=+n,r=+r,i=+i,a=+a,a<0)throw new Error(`negative radius: ${a}`);let o=this._x1,f=this._y1,s=r-t,c=i-n,l=o-t,u=f-n,h=l*l+u*u;if(this._x1===null)this._append`M${this._x1=t},${this._y1=n}`;else if(h>Xt)if(!(Math.abs(u*s-c*l)>Xt)||!a)this._append`L${this._x1=t},${this._y1=n}`;else{let d=r-o,b=i-f,p=s*s+c*c,g=d*d+b*b,m=Math.sqrt(p),w=Math.sqrt(h),x=a*Math.tan((pr-Math.acos((p+h-g)/(2*m*w)))/2),v=x/w,C=x/m;Math.abs(v-1)>Xt&&this._append`L${t+v*l},${n+v*u}`,this._append`A${a},${a},0,0,${+(u*d>l*b)},${this._x1=t+C*s},${this._y1=n+C*c}`}}arc(t,n,r,i,a,o){if(t=+t,n=+n,r=+r,o=!!o,r<0)throw new Error(`negative radius: ${r}`);let f=r*Math.cos(i),s=r*Math.sin(i),c=t+f,l=n+s,u=1^o,h=o?i-a:a-i;if(this._x1===null?this._append`M${c},${l}`:(Math.abs(this._x1-c)>Xt||Math.abs(this._y1-l)>Xt)&&this._append`L${c},${l}`,!!r){if(h<0&&(h=h%vo+vo),h>A2)this._append`A${r},${r},0,1,${u},${t-f},${n-s}A${r},${r},0,1,${u},${this._x1=c},${this._y1=l}`;else if(h>Xt){let d=t+r*Math.cos(a),b=n+r*Math.sin(a);if(h>=pr&&this._equal(c,l,d,b)){h/=2;let p=i+h;this._append`A${r},${r},0,${+(h>=pr)},${u},${t+r*Math.cos(p)},${n+r*Math.sin(p)}`}this._append`A${r},${r},0,${+(h>=pr)},${u},${this._x1=d},${this._y1=b}`}}}rect(t,n,r,i){this._append`M${this._x0=this._x1=+t},${this._y0=this._y1=+n}h${r=+r}v${+i}h${-r}Z`}toString(){return this._}};function _i(){return new Cn}_i.prototype=Cn.prototype;function P(e){return function(){return e}}var Vc=Math.abs,se=Math.atan2,xt=Math.cos,E2=Math.max,xo=Math.min,Re=Math.sin,Ee=Math.sqrt,ce=1e-12,wt=Math.PI,xi=wt/2,Ti=2*wt;function D2(e){return e>1?0:e<-1?wt:Math.acos(e)}function Qc(e){return e>=1?xi:e<=-1?-xi:Math.asin(e)}function Si(e){let t=3;return e.digits=function(n){if(!arguments.length)return t;if(n==null)t=null;else{let r=Math.floor(n);if(!(r>=0))throw new RangeError(`invalid digits: ${n}`);t=r}return e},()=>new Cn(t)}function $2(e){return e.innerRadius}function P2(e){return e.outerRadius}function O2(e){return e.startAngle}function I2(e){return e.endAngle}function L2(e){return e&&e.padAngle}function U2(e,t,n,r,i,a,o,f){var s=n-e,c=r-t,l=o-i,u=f-a,h=u*s-l*c;if(!(h*h<ce))return h=(l*(t-a)-u*(e-i))/h,[e+h*s,t+h*c]}function vi(e,t,n,r,i,a,o){var f=e-n,s=t-r,c=(o?a:-a)/Ee(f*f+s*s),l=c*s,u=-c*f,h=e+l,d=t+u,b=n+l,p=r+u,g=(h+b)/2,m=(d+p)/2,w=b-h,x=p-d,v=w*w+x*x,C=i-a,_=h*p-b*d,k=(x<0?-1:1)*Ee(E2(0,C*C*v-_*_)),E=(_*x-w*k)/v,z=(-_*w-x*k)/v,U=(_*x+w*k)/v,W=(-_*w+x*k)/v,S=E-g,T=z-m,A=U-g,F=W-m;return S*S+T*T>A*A+F*F&&(E=U,z=W),{cx:E,cy:z,x01:-l,y01:-u,x11:E*(i/C-1),y11:z*(i/C-1)}}function tu(){var e=$2,t=P2,n=P(0),r=null,i=O2,a=I2,o=L2,f=null,s=Si(c);function c(){var l,u,h=+e.apply(this,arguments),d=+t.apply(this,arguments),b=i.apply(this,arguments)-xi,p=a.apply(this,arguments)-xi,g=Vc(p-b),m=p>b;if(f||(f=l=s()),d<h&&(u=d,d=h,h=u),!(d>ce))f.moveTo(0,0);else if(g>Ti-ce)f.moveTo(d*xt(b),d*Re(b)),f.arc(0,0,d,b,p,!m),h>ce&&(f.moveTo(h*xt(p),h*Re(p)),f.arc(0,0,h,p,b,m));else{var w=b,x=p,v=b,C=p,_=g,k=g,E=o.apply(this,arguments)/2,z=E>ce&&(r?+r.apply(this,arguments):Ee(h*h+d*d)),U=xo(Vc(d-h)/2,+n.apply(this,arguments)),W=U,S=U,T,A;if(z>ce){var F=Qc(z/h*Re(E)),ve=Qc(z/d*Re(E));(_-=F*2)>ce?(F*=m?1:-1,v+=F,C-=F):(_=0,v=C=(b+p)/2),(k-=ve*2)>ce?(ve*=m?1:-1,w+=ve,x-=ve):(k=0,w=x=(b+p)/2)}var oe=d*xt(w),j=d*Re(w),xe=h*xt(C),Q=h*Re(C);if(U>ce){var an=d*xt(x),on=d*Re(x),On=h*xt(v),In=h*Re(v),Ue;if(g<wt)if(Ue=U2(oe,j,On,In,an,on,xe,Q)){var Ln=oe-Ue[0],Un=j-Ue[1],Fn=an-Ue[0],M=on-Ue[1],R=1/Re(D2((Ln*Fn+Un*M)/(Ee(Ln*Ln+Un*Un)*Ee(Fn*Fn+M*M)))/2),D=Ee(Ue[0]*Ue[0]+Ue[1]*Ue[1]);W=xo(U,(h-D)/(R-1)),S=xo(U,(d-D)/(R+1))}else W=S=0}k>ce?S>ce?(T=vi(On,In,oe,j,d,S,m),A=vi(an,on,xe,Q,d,S,m),f.moveTo(T.cx+T.x01,T.cy+T.y01),S<U?f.arc(T.cx,T.cy,S,se(T.y01,T.x01),se(A.y01,A.x01),!m):(f.arc(T.cx,T.cy,S,se(T.y01,T.x01),se(T.y11,T.x11),!m),f.arc(0,0,d,se(T.cy+T.y11,T.cx+T.x11),se(A.cy+A.y11,A.cx+A.x11),!m),f.arc(A.cx,A.cy,S,se(A.y11,A.x11),se(A.y01,A.x01),!m))):(f.moveTo(oe,j),f.arc(0,0,d,w,x,!m)):f.moveTo(oe,j),!(h>ce)||!(_>ce)?f.lineTo(xe,Q):W>ce?(T=vi(xe,Q,an,on,h,-W,m),A=vi(oe,j,On,In,h,-W,m),f.lineTo(T.cx+T.x01,T.cy+T.y01),W<U?f.arc(T.cx,T.cy,W,se(T.y01,T.x01),se(A.y01,A.x01),!m):(f.arc(T.cx,T.cy,W,se(T.y01,T.x01),se(T.y11,T.x11),!m),f.arc(0,0,h,se(T.cy+T.y11,T.cx+T.x11),se(A.cy+A.y11,A.cx+A.x11),m),f.arc(A.cx,A.cy,W,se(A.y11,A.x11),se(A.y01,A.x01),!m))):f.arc(0,0,h,C,v,m)}if(f.closePath(),l)return f=null,l+""||null}return c.centroid=function(){var l=(+e.apply(this,arguments)+ +t.apply(this,arguments))/2,u=(+i.apply(this,arguments)+ +a.apply(this,arguments))/2-wt/2;return[xt(u)*l,Re(u)*l]},c.innerRadius=function(l){return arguments.length?(e=typeof l=="function"?l:P(+l),c):e},c.outerRadius=function(l){return arguments.length?(t=typeof l=="function"?l:P(+l),c):t},c.cornerRadius=function(l){return arguments.length?(n=typeof l=="function"?l:P(+l),c):n},c.padRadius=function(l){return arguments.length?(r=l==null?null:typeof l=="function"?l:P(+l),c):r},c.startAngle=function(l){return arguments.length?(i=typeof l=="function"?l:P(+l),c):i},c.endAngle=function(l){return arguments.length?(a=typeof l=="function"?l:P(+l),c):a},c.padAngle=function(l){return arguments.length?(o=typeof l=="function"?l:P(+l),c):o},c.context=function(l){return arguments.length?(f=l??null,c):f},c}var f7=Array.prototype.slice;function nu(e){return typeof e=="object"&&"length"in e?e:Array.from(e)}function ru(e){this._context=e}ru.prototype={areaStart:function(){this._line=0},areaEnd:function(){this._line=NaN},lineStart:function(){this._point=0},lineEnd:function(){(this._line||this._line!==0&&this._point===1)&&this._context.closePath(),this._line=1-this._line},point:function(e,t){switch(e=+e,t=+t,this._point){case 0:this._point=1,this._line?this._context.lineTo(e,t):this._context.moveTo(e,t);break;case 1:this._point=2;default:this._context.lineTo(e,t);break}}};function br(e){return new ru(e)}function iu(e){return e[0]}function au(e){return e[1]}function Mo(e,t){var n=P(!0),r=null,i=br,a=null,o=Si(f);e=typeof e=="function"?e:e===void 0?iu:P(e),t=typeof t=="function"?t:t===void 0?au:P(t);function f(s){var c,l=(s=nu(s)).length,u,h=!1,d;for(r==null&&(a=i(d=o())),c=0;c<=l;++c)!(c<l&&n(u=s[c],c,s))===h&&((h=!h)?a.lineStart():a.lineEnd()),h&&a.point(+e(u,c,s),+t(u,c,s));if(d)return a=null,d+""||null}return f.x=function(s){return arguments.length?(e=typeof s=="function"?s:P(+s),f):e},f.y=function(s){return arguments.length?(t=typeof s=="function"?s:P(+s),f):t},f.defined=function(s){return arguments.length?(n=typeof s=="function"?s:P(!!s),f):n},f.curve=function(s){return arguments.length?(i=s,r!=null&&(a=i(r)),f):i},f.context=function(s){return arguments.length?(s==null?r=a=null:a=i(r=s),f):r},f}function ko(e,t,n){var r=null,i=P(!0),a=null,o=br,f=null,s=Si(c);e=typeof e=="function"?e:e===void 0?iu:P(+e),t=typeof t=="function"?t:P(t===void 0?0:+t),n=typeof n=="function"?n:n===void 0?au:P(+n);function c(u){var h,d,b,p=(u=nu(u)).length,g,m=!1,w,x=new Array(p),v=new Array(p);for(a==null&&(f=o(w=s())),h=0;h<=p;++h){if(!(h<p&&i(g=u[h],h,u))===m)if(m=!m)d=h,f.areaStart(),f.lineStart();else{for(f.lineEnd(),f.lineStart(),b=h-1;b>=d;--b)f.point(x[b],v[b]);f.lineEnd(),f.areaEnd()}m&&(x[h]=+e(g,h,u),v[h]=+t(g,h,u),f.point(r?+r(g,h,u):x[h],n?+n(g,h,u):v[h]))}if(w)return f=null,w+""||null}function l(){return Mo().defined(i).curve(o).context(a)}return c.x=function(u){return arguments.length?(e=typeof u=="function"?u:P(+u),r=null,c):e},c.x0=function(u){return arguments.length?(e=typeof u=="function"?u:P(+u),c):e},c.x1=function(u){return arguments.length?(r=u==null?null:typeof u=="function"?u:P(+u),c):r},c.y=function(u){return arguments.length?(t=typeof u=="function"?u:P(+u),n=null,c):t},c.y0=function(u){return arguments.length?(t=typeof u=="function"?u:P(+u),c):t},c.y1=function(u){return arguments.length?(n=u==null?null:typeof u=="function"?u:P(+u),c):n},c.lineX0=c.lineY0=function(){return l().x(e).y(t)},c.lineY1=function(){return l().x(e).y(n)},c.lineX1=function(){return l().x(r).y(t)},c.defined=function(u){return arguments.length?(i=typeof u=="function"?u:P(!!u),c):i},c.curve=function(u){return arguments.length?(o=u,a!=null&&(f=o(a)),c):o},c.context=function(u){return arguments.length?(u==null?a=f=null:f=o(a=u),c):a},c}var s7=F2(br);function ou(e){this._curve=e}ou.prototype={areaStart:function(){this._curve.areaStart()},areaEnd:function(){this._curve.areaEnd()},lineStart:function(){this._curve.lineStart()},lineEnd:function(){this._curve.lineEnd()},point:function(e,t){this._curve.point(t*Math.sin(e),t*-Math.cos(e))}};function F2(e){function t(n){return new ou(e(n))}return t._curve=e,t}var c7=Ee(3);var q2={draw(e,t){let n=Ee(t/wt);e.moveTo(n,0),e.arc(0,0,n,0,Ti)}};var z2=Ee(1/3),u7=z2*2;var fu=Re(wt/10)/Re(7*wt/10),l7=Re(Ti/10)*fu,h7=-xt(Ti/10)*fu;var d7=Ee(3);var p7=Ee(3);var b7=Ee(3)/2,Y2=1/Ee(12),g7=(Y2/2+1)*3;function su(e,t){let n=null,r=Si(i);e=typeof e=="function"?e:P(e||q2),t=typeof t=="function"?t:P(t===void 0?64:+t);function i(){let a;if(n||(n=a=r()),e.apply(this,arguments).draw(n,+t.apply(this,arguments)),a)return n=null,a+""||null}return i.type=function(a){return arguments.length?(e=typeof a=="function"?a:P(a),i):e},i.size=function(a){return arguments.length?(t=typeof a=="function"?a:P(+a),i):t},i.context=function(a){return arguments.length?(n=a??null,i):n},i}function Mt(){}function wi(e,t,n){e._context.bezierCurveTo((2*e._x0+e._x1)/3,(2*e._y0+e._y1)/3,(e._x0+2*e._x1)/3,(e._y0+2*e._y1)/3,(e._x0+4*e._x1+t)/6,(e._y0+4*e._y1+n)/6)}function Ci(e){this._context=e}Ci.prototype={areaStart:function(){this._line=0},areaEnd:function(){this._line=NaN},lineStart:function(){this._x0=this._x1=this._y0=this._y1=NaN,this._point=0},lineEnd:function(){switch(this._point){case 3:wi(this,this._x1,this._y1);case 2:this._context.lineTo(this._x1,this._y1);break}(this._line||this._line!==0&&this._point===1)&&this._context.closePath(),this._line=1-this._line},point:function(e,t){switch(e=+e,t=+t,this._point){case 0:this._point=1,this._line?this._context.lineTo(e,t):this._context.moveTo(e,t);break;case 1:this._point=2;break;case 2:this._point=3,this._context.lineTo((5*this._x0+this._x1)/6,(5*this._y0+this._y1)/6);default:wi(this,e,t);break}this._x0=this._x1,this._x1=e,this._y0=this._y1,this._y1=t}};function cu(e){return new Ci(e)}function uu(e){this._context=e}uu.prototype={areaStart:Mt,areaEnd:Mt,lineStart:function(){this._x0=this._x1=this._x2=this._x3=this._x4=this._y0=this._y1=this._y2=this._y3=this._y4=NaN,this._point=0},lineEnd:function(){switch(this._point){case 1:{this._context.moveTo(this._x2,this._y2),this._context.closePath();break}case 2:{this._context.moveTo((this._x2+2*this._x3)/3,(this._y2+2*this._y3)/3),this._context.lineTo((this._x3+2*this._x2)/3,(this._y3+2*this._y2)/3),this._context.closePath();break}case 3:{this.point(this._x2,this._y2),this.point(this._x3,this._y3),this.point(this._x4,this._y4);break}}},point:function(e,t){switch(e=+e,t=+t,this._point){case 0:this._point=1,this._x2=e,this._y2=t;break;case 1:this._point=2,this._x3=e,this._y3=t;break;case 2:this._point=3,this._x4=e,this._y4=t,this._context.moveTo((this._x0+4*this._x1+e)/6,(this._y0+4*this._y1+t)/6);break;default:wi(this,e,t);break}this._x0=this._x1,this._x1=e,this._y0=this._y1,this._y1=t}};function lu(e){return new uu(e)}function hu(e){this._context=e}hu.prototype={areaStart:function(){this._line=0},areaEnd:function(){this._line=NaN},lineStart:function(){this._x0=this._x1=this._y0=this._y1=NaN,this._point=0},lineEnd:function(){(this._line||this._line!==0&&this._point===3)&&this._context.closePath(),this._line=1-this._line},point:function(e,t){switch(e=+e,t=+t,this._point){case 0:this._point=1;break;case 1:this._point=2;break;case 2:this._point=3;var n=(this._x0+4*this._x1+e)/6,r=(this._y0+4*this._y1+t)/6;this._line?this._context.lineTo(n,r):this._context.moveTo(n,r);break;case 3:this._point=4;default:wi(this,e,t);break}this._x0=this._x1,this._x1=e,this._y0=this._y1,this._y1=t}};function du(e){return new hu(e)}function pu(e,t){this._basis=new Ci(e),this._beta=t}pu.prototype={lineStart:function(){this._x=[],this._y=[],this._basis.lineStart()},lineEnd:function(){var e=this._x,t=this._y,n=e.length-1;if(n>0)for(var r=e[0],i=t[0],a=e[n]-r,o=t[n]-i,f=-1,s;++f<=n;)s=f/n,this._basis.point(this._beta*e[f]+(1-this._beta)*(r+s*a),this._beta*t[f]+(1-this._beta)*(i+s*o));this._x=this._y=null,this._basis.lineEnd()},point:function(e,t){this._x.push(+e),this._y.push(+t)}};var bu=(function e(t){function n(r){return t===1?new Ci(r):new pu(r,t)}return n.beta=function(r){return e(+r)},n})(.85);function Mi(e,t,n){e._context.bezierCurveTo(e._x1+e._k*(e._x2-e._x0),e._y1+e._k*(e._y2-e._y0),e._x2+e._k*(e._x1-t),e._y2+e._k*(e._y1-n),e._x2,e._y2)}function To(e,t){this._context=e,this._k=(1-t)/6}To.prototype={areaStart:function(){this._line=0},areaEnd:function(){this._line=NaN},lineStart:function(){this._x0=this._x1=this._x2=this._y0=this._y1=this._y2=NaN,this._point=0},lineEnd:function(){switch(this._point){case 2:this._context.lineTo(this._x2,this._y2);break;case 3:Mi(this,this._x1,this._y1);break}(this._line||this._line!==0&&this._point===1)&&this._context.closePath(),this._line=1-this._line},point:function(e,t){switch(e=+e,t=+t,this._point){case 0:this._point=1,this._line?this._context.lineTo(e,t):this._context.moveTo(e,t);break;case 1:this._point=2,this._x1=e,this._y1=t;break;case 2:this._point=3;default:Mi(this,e,t);break}this._x0=this._x1,this._x1=this._x2,this._x2=e,this._y0=this._y1,this._y1=this._y2,this._y2=t}};var gu=(function e(t){function n(r){return new To(r,t)}return n.tension=function(r){return e(+r)},n})(0);function So(e,t){this._context=e,this._k=(1-t)/6}So.prototype={areaStart:Mt,areaEnd:Mt,lineStart:function(){this._x0=this._x1=this._x2=this._x3=this._x4=this._x5=this._y0=this._y1=this._y2=this._y3=this._y4=this._y5=NaN,this._point=0},lineEnd:function(){switch(this._point){case 1:{this._context.moveTo(this._x3,this._y3),this._context.closePath();break}case 2:{this._context.lineTo(this._x3,this._y3),this._context.closePath();break}case 3:{this.point(this._x3,this._y3),this.point(this._x4,this._y4),this.point(this._x5,this._y5);break}}},point:function(e,t){switch(e=+e,t=+t,this._point){case 0:this._point=1,this._x3=e,this._y3=t;break;case 1:this._point=2,this._context.moveTo(this._x4=e,this._y4=t);break;case 2:this._point=3,this._x5=e,this._y5=t;break;default:Mi(this,e,t);break}this._x0=this._x1,this._x1=this._x2,this._x2=e,this._y0=this._y1,this._y1=this._y2,this._y2=t}};var mu=(function e(t){function n(r){return new So(r,t)}return n.tension=function(r){return e(+r)},n})(0);function Co(e,t){this._context=e,this._k=(1-t)/6}Co.prototype={areaStart:function(){this._line=0},areaEnd:function(){this._line=NaN},lineStart:function(){this._x0=this._x1=this._x2=this._y0=this._y1=this._y2=NaN,this._point=0},lineEnd:function(){(this._line||this._line!==0&&this._point===3)&&this._context.closePath(),this._line=1-this._line},point:function(e,t){switch(e=+e,t=+t,this._point){case 0:this._point=1;break;case 1:this._point=2;break;case 2:this._point=3,this._line?this._context.lineTo(this._x2,this._y2):this._context.moveTo(this._x2,this._y2);break;case 3:this._point=4;default:Mi(this,e,t);break}this._x0=this._x1,this._x1=this._x2,this._x2=e,this._y0=this._y1,this._y1=this._y2,this._y2=t}};var yu=(function e(t){function n(r){return new Co(r,t)}return n.tension=function(r){return e(+r)},n})(0);function Ao(e,t,n){var r=e._x1,i=e._y1,a=e._x2,o=e._y2;if(e._l01_a>ce){var f=2*e._l01_2a+3*e._l01_a*e._l12_a+e._l12_2a,s=3*e._l01_a*(e._l01_a+e._l12_a);r=(r*f-e._x0*e._l12_2a+e._x2*e._l01_2a)/s,i=(i*f-e._y0*e._l12_2a+e._y2*e._l01_2a)/s}if(e._l23_a>ce){var c=2*e._l23_2a+3*e._l23_a*e._l12_a+e._l12_2a,l=3*e._l23_a*(e._l23_a+e._l12_a);a=(a*c+e._x1*e._l23_2a-t*e._l12_2a)/l,o=(o*c+e._y1*e._l23_2a-n*e._l12_2a)/l}e._context.bezierCurveTo(r,i,a,o,e._x2,e._y2)}function _u(e,t){this._context=e,this._alpha=t}_u.prototype={areaStart:function(){this._line=0},areaEnd:function(){this._line=NaN},lineStart:function(){this._x0=this._x1=this._x2=this._y0=this._y1=this._y2=NaN,this._l01_a=this._l12_a=this._l23_a=this._l01_2a=this._l12_2a=this._l23_2a=this._point=0},lineEnd:function(){switch(this._point){case 2:this._context.lineTo(this._x2,this._y2);break;case 3:this.point(this._x2,this._y2);break}(this._line||this._line!==0&&this._point===1)&&this._context.closePath(),this._line=1-this._line},point:function(e,t){if(e=+e,t=+t,this._point){var n=this._x2-e,r=this._y2-t;this._l23_a=Math.sqrt(this._l23_2a=Math.pow(n*n+r*r,this._alpha))}switch(this._point){case 0:this._point=1,this._line?this._context.lineTo(e,t):this._context.moveTo(e,t);break;case 1:this._point=2;break;case 2:this._point=3;default:Ao(this,e,t);break}this._l01_a=this._l12_a,this._l12_a=this._l23_a,this._l01_2a=this._l12_2a,this._l12_2a=this._l23_2a,this._x0=this._x1,this._x1=this._x2,this._x2=e,this._y0=this._y1,this._y1=this._y2,this._y2=t}};var vu=(function e(t){function n(r){return t?new _u(r,t):new To(r,0)}return n.alpha=function(r){return e(+r)},n})(.5);function xu(e,t){this._context=e,this._alpha=t}xu.prototype={areaStart:Mt,areaEnd:Mt,lineStart:function(){this._x0=this._x1=this._x2=this._x3=this._x4=this._x5=this._y0=this._y1=this._y2=this._y3=this._y4=this._y5=NaN,this._l01_a=this._l12_a=this._l23_a=this._l01_2a=this._l12_2a=this._l23_2a=this._point=0},lineEnd:function(){switch(this._point){case 1:{this._context.moveTo(this._x3,this._y3),this._context.closePath();break}case 2:{this._context.lineTo(this._x3,this._y3),this._context.closePath();break}case 3:{this.point(this._x3,this._y3),this.point(this._x4,this._y4),this.point(this._x5,this._y5);break}}},point:function(e,t){if(e=+e,t=+t,this._point){var n=this._x2-e,r=this._y2-t;this._l23_a=Math.sqrt(this._l23_2a=Math.pow(n*n+r*r,this._alpha))}switch(this._point){case 0:this._point=1,this._x3=e,this._y3=t;break;case 1:this._point=2,this._context.moveTo(this._x4=e,this._y4=t);break;case 2:this._point=3,this._x5=e,this._y5=t;break;default:Ao(this,e,t);break}this._l01_a=this._l12_a,this._l12_a=this._l23_a,this._l01_2a=this._l12_2a,this._l12_2a=this._l23_2a,this._x0=this._x1,this._x1=this._x2,this._x2=e,this._y0=this._y1,this._y1=this._y2,this._y2=t}};var wu=(function e(t){function n(r){return t?new xu(r,t):new So(r,0)}return n.alpha=function(r){return e(+r)},n})(.5);function Mu(e,t){this._context=e,this._alpha=t}Mu.prototype={areaStart:function(){this._line=0},areaEnd:function(){this._line=NaN},lineStart:function(){this._x0=this._x1=this._x2=this._y0=this._y1=this._y2=NaN,this._l01_a=this._l12_a=this._l23_a=this._l01_2a=this._l12_2a=this._l23_2a=this._point=0},lineEnd:function(){(this._line||this._line!==0&&this._point===3)&&this._context.closePath(),this._line=1-this._line},point:function(e,t){if(e=+e,t=+t,this._point){var n=this._x2-e,r=this._y2-t;this._l23_a=Math.sqrt(this._l23_2a=Math.pow(n*n+r*r,this._alpha))}switch(this._point){case 0:this._point=1;break;case 1:this._point=2;break;case 2:this._point=3,this._line?this._context.lineTo(this._x2,this._y2):this._context.moveTo(this._x2,this._y2);break;case 3:this._point=4;default:Ao(this,e,t);break}this._l01_a=this._l12_a,this._l12_a=this._l23_a,this._l01_2a=this._l12_2a,this._l12_2a=this._l23_2a,this._x0=this._x1,this._x1=this._x2,this._x2=e,this._y0=this._y1,this._y1=this._y2,this._y2=t}};var ku=(function e(t){function n(r){return t?new Mu(r,t):new Co(r,0)}return n.alpha=function(r){return e(+r)},n})(.5);function Tu(e){this._context=e}Tu.prototype={areaStart:Mt,areaEnd:Mt,lineStart:function(){this._point=0},lineEnd:function(){this._point&&this._context.closePath()},point:function(e,t){e=+e,t=+t,this._point?this._context.lineTo(e,t):(this._point=1,this._context.moveTo(e,t))}};function Su(e){return new Tu(e)}function Zc(e){return e<0?-1:1}function Jc(e,t,n){var r=e._x1-e._x0,i=t-e._x1,a=(e._y1-e._y0)/(r||i<0&&-0),o=(n-e._y1)/(i||r<0&&-0),f=(a*i+o*r)/(r+i);return(Zc(a)+Zc(o))*Math.min(Math.abs(a),Math.abs(o),.5*Math.abs(f))||0}function Kc(e,t){var n=e._x1-e._x0;return n?(3*(e._y1-e._y0)/n-t)/2:t}function wo(e,t,n){var r=e._x0,i=e._y0,a=e._x1,o=e._y1,f=(a-r)/3;e._context.bezierCurveTo(r+f,i+f*t,a-f,o-f*n,a,o)}function ki(e){this._context=e}ki.prototype={areaStart:function(){this._line=0},areaEnd:function(){this._line=NaN},lineStart:function(){this._x0=this._x1=this._y0=this._y1=this._t0=NaN,this._point=0},lineEnd:function(){switch(this._point){case 2:this._context.lineTo(this._x1,this._y1);break;case 3:wo(this,this._t0,Kc(this,this._t0));break}(this._line||this._line!==0&&this._point===1)&&this._context.closePath(),this._line=1-this._line},point:function(e,t){var n=NaN;if(e=+e,t=+t,!(e===this._x1&&t===this._y1)){switch(this._point){case 0:this._point=1,this._line?this._context.lineTo(e,t):this._context.moveTo(e,t);break;case 1:this._point=2;break;case 2:this._point=3,wo(this,Kc(this,n=Jc(this,e,t)),n);break;default:wo(this,this._t0,n=Jc(this,e,t));break}this._x0=this._x1,this._x1=e,this._y0=this._y1,this._y1=t,this._t0=n}}};function Cu(e){this._context=new Au(e)}(Cu.prototype=Object.create(ki.prototype)).point=function(e,t){ki.prototype.point.call(this,t,e)};function Au(e){this._context=e}Au.prototype={moveTo:function(e,t){this._context.moveTo(t,e)},closePath:function(){this._context.closePath()},lineTo:function(e,t){this._context.lineTo(t,e)},bezierCurveTo:function(e,t,n,r,i,a){this._context.bezierCurveTo(t,e,r,n,a,i)}};function Nu(e){return new ki(e)}function Ru(e){return new Cu(e)}function Eu(e){this._context=e}Eu.prototype={areaStart:function(){this._line=0},areaEnd:function(){this._line=NaN},lineStart:function(){this._x=[],this._y=[]},lineEnd:function(){var e=this._x,t=this._y,n=e.length;if(n)if(this._line?this._context.lineTo(e[0],t[0]):this._context.moveTo(e[0],t[0]),n===2)this._context.lineTo(e[1],t[1]);else for(var r=eu(e),i=eu(t),a=0,o=1;o<n;++a,++o)this._context.bezierCurveTo(r[0][a],i[0][a],r[1][a],i[1][a],e[o],t[o]);(this._line||this._line!==0&&n===1)&&this._context.closePath(),this._line=1-this._line,this._x=this._y=null},point:function(e,t){this._x.push(+e),this._y.push(+t)}};function eu(e){var t,n=e.length-1,r,i=new Array(n),a=new Array(n),o=new Array(n);for(i[0]=0,a[0]=2,o[0]=e[0]+2*e[1],t=1;t<n-1;++t)i[t]=1,a[t]=4,o[t]=4*e[t]+2*e[t+1];for(i[n-1]=2,a[n-1]=7,o[n-1]=8*e[n-1]+e[n],t=1;t<n;++t)r=i[t]/a[t-1],a[t]-=r,o[t]-=r*o[t-1];for(i[n-1]=o[n-1]/a[n-1],t=n-2;t>=0;--t)i[t]=(o[t]-i[t+1])/a[t];for(a[n-1]=(e[n]+i[n-1])/2,t=0;t<n-1;++t)a[t]=2*e[t+1]-i[t+1];return[i,a]}function Du(e){return new Eu(e)}function Ai(e,t){this._context=e,this._t=t}Ai.prototype={areaStart:function(){this._line=0},areaEnd:function(){this._line=NaN},lineStart:function(){this._x=this._y=NaN,this._point=0},lineEnd:function(){0<this._t&&this._t<1&&this._point===2&&this._context.lineTo(this._x,this._y),(this._line||this._line!==0&&this._point===1)&&this._context.closePath(),this._line>=0&&(this._t=1-this._t,this._line=1-this._line)},point:function(e,t){switch(e=+e,t=+t,this._point){case 0:this._point=1,this._line?this._context.lineTo(e,t):this._context.moveTo(e,t);break;case 1:this._point=2;default:{if(this._t<=0)this._context.lineTo(this._x,t),this._context.lineTo(e,t);else{var n=this._x*(1-this._t)+e*this._t;this._context.lineTo(n,this._y),this._context.lineTo(n,t)}break}}this._x=e,this._y=t}};function $u(e){return new Ai(e,.5)}function Pu(e){return new Ai(e,0)}function Ou(e){return new Ai(e,1)}function Ni(e,t){if(typeof document<"u"&&document.createElement){let n=document.createElement("canvas");if(n&&n.getContext)return n.width=e,n.height=t,n}return null}var Iu=()=>typeof Image<"u"?Image:null;var Lu={},No={},Ro=34,gr=10,Eo=13;function Fu(e){return new Function("d","return {"+e.map(function(t,n){return JSON.stringify(t)+": d["+n+\'] || ""\'}).join(",")+"}")}function B2(e,t){var n=Fu(e);return function(r,i){return t(n(r),i,e)}}function Uu(e){var t=Object.create(null),n=[];return e.forEach(function(r){for(var i in r)i in t||n.push(t[i]=i)}),n}function _e(e,t){var n=e+"",r=n.length;return r<t?new Array(t-r+1).join(0)+n:n}function H2(e){return e<0?"-"+_e(-e,6):e>9999?"+"+_e(e,6):_e(e,4)}function W2(e){var t=e.getUTCHours(),n=e.getUTCMinutes(),r=e.getUTCSeconds(),i=e.getUTCMilliseconds();return isNaN(e)?"Invalid Date":H2(e.getUTCFullYear())+"-"+_e(e.getUTCMonth()+1,2)+"-"+_e(e.getUTCDate(),2)+(i?"T"+_e(t,2)+":"+_e(n,2)+":"+_e(r,2)+"."+_e(i,3)+"Z":r?"T"+_e(t,2)+":"+_e(n,2)+":"+_e(r,2)+"Z":n||t?"T"+_e(t,2)+":"+_e(n,2)+"Z":"")}function Ri(e){var t=new RegExp(\'["\'+e+`\n\\r]`),n=e.charCodeAt(0);function r(u,h){var d,b,p=i(u,function(g,m){if(d)return d(g,m-1);b=g,d=h?B2(g,h):Fu(g)});return p.columns=b||[],p}function i(u,h){var d=[],b=u.length,p=0,g=0,m,w=b<=0,x=!1;u.charCodeAt(b-1)===gr&&--b,u.charCodeAt(b-1)===Eo&&--b;function v(){if(w)return No;if(x)return x=!1,Lu;var _,k=p,E;if(u.charCodeAt(k)===Ro){for(;p++<b&&u.charCodeAt(p)!==Ro||u.charCodeAt(++p)===Ro;);return(_=p)>=b?w=!0:(E=u.charCodeAt(p++))===gr?x=!0:E===Eo&&(x=!0,u.charCodeAt(p)===gr&&++p),u.slice(k+1,_-1).replace(/""/g,\'"\')}for(;p<b;){if((E=u.charCodeAt(_=p++))===gr)x=!0;else if(E===Eo)x=!0,u.charCodeAt(p)===gr&&++p;else if(E!==n)continue;return u.slice(k,_)}return w=!0,u.slice(k,b)}for(;(m=v())!==No;){for(var C=[];m!==Lu&&m!==No;)C.push(m),m=v();h&&(C=h(C,g++))==null||d.push(C)}return d}function a(u,h){return u.map(function(d){return h.map(function(b){return l(d[b])}).join(e)})}function o(u,h){return h==null&&(h=Uu(u)),[h.map(l).join(e)].concat(a(u,h)).join(`\n`)}function f(u,h){return h==null&&(h=Uu(u)),a(u,h).join(`\n`)}function s(u){return u.map(c).join(`\n`)}function c(u){return u.map(l).join(e)}function l(u){return u==null?"":u instanceof Date?W2(u):t.test(u+="")?\'"\'+u.replace(/"/g,\'""\')+\'"\':u}return{parse:r,parseRows:i,format:o,formatBody:f,formatRows:s,formatRow:c,formatValue:l}}var Vt=Ri(","),_7=Vt.parse,v7=Vt.parseRows,x7=Vt.format,w7=Vt.formatBody,M7=Vt.formatRows,k7=Vt.formatRow,T7=Vt.formatValue,Qt=Ri("	"),S7=Qt.parse,C7=Qt.parseRows,A7=Qt.format,N7=Qt.formatBody,R7=Qt.formatRows,E7=Qt.formatRow,D7=Qt.formatValue;var $7=new Date("2019-01-01T00:00").getHours()||new Date("2019-07-01T00:00").getHours();function Do(e){return e}function Ei(e){if(e==null)return Do;var t,n,r=e.scale[0],i=e.scale[1],a=e.translate[0],o=e.translate[1];return function(f,s){s||(t=n=0);var c=2,l=f.length,u=new Array(l);for(u[0]=(t+=f[0])*r+a,u[1]=(n+=f[1])*i+o;c<l;)u[c]=f[c],++c;return u}}function qu(e,t){for(var n,r=e.length,i=r-t;i<--r;)n=e[i],e[i++]=e[r],e[r]=n}function $o(e,t){return typeof t=="string"&&(t=e.objects[t]),t.type==="GeometryCollection"?{type:"FeatureCollection",features:t.geometries.map(function(n){return zu(e,n)})}:zu(e,t)}function zu(e,t){var n=t.id,r=t.bbox,i=t.properties==null?{}:t.properties,a=Di(e,t);return n==null&&r==null?{type:"Feature",properties:i,geometry:a}:r==null?{type:"Feature",id:n,properties:i,geometry:a}:{type:"Feature",id:n,bbox:r,properties:i,geometry:a}}function Di(e,t){var n=Ei(e.transform),r=e.arcs;function i(l,u){u.length&&u.pop();for(var h=r[l<0?~l:l],d=0,b=h.length;d<b;++d)u.push(n(h[d],d));l<0&&qu(u,b)}function a(l){return n(l)}function o(l){for(var u=[],h=0,d=l.length;h<d;++h)i(l[h],u);return u.length<2&&u.push(u[0]),u}function f(l){for(var u=o(l);u.length<4;)u.push(u[0]);return u}function s(l){return l.map(f)}function c(l){var u=l.type,h;switch(u){case"GeometryCollection":return{type:u,geometries:l.geometries.map(c)};case"Point":h=a(l.coordinates);break;case"MultiPoint":h=l.coordinates.map(a);break;case"LineString":h=o(l.arcs);break;case"MultiLineString":h=l.arcs.map(o);break;case"Polygon":h=s(l.arcs);break;case"MultiPolygon":h=l.arcs.map(s);break;default:return null}return{type:u,coordinates:h}}return c(t)}function Po(e,t){var n={},r={},i={},a=[],o=-1;t.forEach(function(c,l){var u=e.arcs[c<0?~c:c],h;u.length<3&&!u[1][0]&&!u[1][1]&&(h=t[++o],t[o]=c,t[l]=h)}),t.forEach(function(c){var l=f(c),u=l[0],h=l[1],d,b;if(d=i[u])if(delete i[d.end],d.push(c),d.end=h,b=r[h]){delete r[b.start];var p=b===d?d:d.concat(b);r[p.start=d.start]=i[p.end=b.end]=p}else r[d.start]=i[d.end]=d;else if(d=r[h])if(delete r[d.start],d.unshift(c),d.start=u,b=i[u]){delete i[b.end];var g=b===d?d:b.concat(d);r[g.start=b.start]=i[g.end=d.end]=g}else r[d.start]=i[d.end]=d;else d=[c],r[d.start=u]=i[d.end=h]=d});function f(c){var l=e.arcs[c<0?~c:c],u=l[0],h;return e.transform?(h=[0,0],l.forEach(function(d){h[0]+=d[0],h[1]+=d[1]})):h=l[l.length-1],c<0?[h,u]:[u,h]}function s(c,l){for(var u in c){var h=c[u];delete l[h.start],delete h.start,delete h.end,h.forEach(function(d){n[d<0?~d:d]=1}),a.push(h)}}return s(i,r),s(r,i),t.forEach(function(c){n[c<0?~c:c]||a.push([c])}),a}function Oo(e){return Di(e,Yu.apply(this,arguments))}function Yu(e,t,n){var r,i,a;if(arguments.length>1)r=G2(e,t,n);else for(i=0,r=new Array(a=e.arcs.length);i<a;++i)r[i]=i;return{type:"MultiLineString",arcs:Po(e,r)}}function G2(e,t,n){var r=[],i=[],a;function o(u){var h=u<0?~u:u;(i[h]||(i[h]=[])).push({i:u,g:a})}function f(u){u.forEach(o)}function s(u){u.forEach(f)}function c(u){u.forEach(s)}function l(u){switch(a=u,u.type){case"GeometryCollection":u.geometries.forEach(l);break;case"LineString":f(u.arcs);break;case"MultiLineString":case"Polygon":s(u.arcs);break;case"MultiPolygon":c(u.arcs);break}}return l(t),i.forEach(n==null?function(u){r.push(u[0].i)}:function(u){n(u[0].g,u[u.length-1].g)&&r.push(u[0].i)}),r}function mr(e){let t={};return n=>t[n]||(t[n]=e(n))}function V2(e,t){return n=>{let r=e(n),i=r.indexOf(t);if(i<0)return r;let a=Q2(r,i),o=a<r.length?r.slice(a):"";for(;--a>i;)if(r[a]!=="0"){++a;break}return r.slice(0,a)+o}}function Q2(e,t){let n=e.lastIndexOf("e"),r;if(n>0)return n;for(n=e.length;--n>t;)if(r=e.charCodeAt(n),r>=48&&r<=57)return n+1}function Z2(e){let t=mr(e.format),n=e.formatPrefix;return{format:t,formatPrefix:n,formatFloat(r){let i=rt(r||",");if(i.precision==null){switch(i.precision=12,i.type){case"%":i.precision-=2;break;case"e":i.precision-=1;break}return V2(t(i),t(".1f")(1)[1])}else return t(i)},formatSpan(r,i,a,o){o=rt(o??",f");let f=pt(r,i,a),s=Math.max(Math.abs(r),Math.abs(i)),c;if(o.precision==null)switch(o.type){case"s":return isNaN(c=ni(f,s))||(o.precision=c),n(o,s);case"":case"e":case"g":case"p":case"r":{isNaN(c=ri(f,s))||(o.precision=c-(o.type==="e"));break}case"f":case"%":{isNaN(c=ti(f))||(o.precision=c-(o.type==="%")*2);break}}return t(o)}}}var J2;K2();function K2(){return J2=Z2({format:yn,formatPrefix:Xn})}function Bu(e,t,n){n=n||{},Fe(n)||B(`Invalid time multi-format specifier: ${n}`);let r=t(ye),i=t(he),a=t(le),o=t(fe),f=t(G),s=t(te),c=t(me),l=t(q),u=e(n[Ne]||".%L"),h=e(n[ye]||":%S"),d=e(n[he]||"%I:%M"),b=e(n[le]||"%I %p"),p=e(n[fe]||n[Y]||"%a %d"),g=e(n[G]||"%b %d"),m=e(n[te]||"%B"),w=e(n[me]||"%B"),x=e(n[q]||"%Y");return v=>(r(v)<v?u:i(v)<v?h:a(v)<v?d:o(v)<v?b:s(v)<v?f(v)<v?p:g:l(v)<v?c(v)<v?m:w:x)(v)}function ep(e){let t=mr(e.format),n=mr(e.utcFormat);return{timeFormat:r=>tt(r)?t(r):Bu(t,fr,r),utcFormat:r=>tt(r)?n(r):Bu(n,sr,r),timeParse:mr(e.parse),utcParse:mr(e.utcParse)}}var tp;np();function np(){return tp=ep({format:Jn,parse:qa,utcFormat:kn,utcParse:ii})}var rp=/^(data:|([A-Za-z]+:)?\\/\\/)/,ip=/^(?:(?:(?:f|ht)tps?|mailto|tel|callto|cid|xmpp|file|data):|[^a-z]|[a-z+.\\-]+(?:[^a-z+.\\-:]|$))/i,ap=/[\\u0000-\\u0020\\u00A0\\u1680\\u180E\\u2000-\\u2029\\u205f\\u3000]/g,Hu="file://";function op(e){return t=>({options:t||{},sanitize:sp,load:fp,fileAccess:!1,file:cp(e),http:lp})}async function fp(e,t){let n=await this.sanitize(e,t),r=n.href;return n.localFile?this.file(r):this.http(r,t?.http)}async function sp(e,t){t=$e({},this.options,t);let n=this.fileAccess,r={href:null},i,a,o,f=ip.test(e.replace(ap,""));(e==null||typeof e!="string"||!f)&&B("Sanitize failure, invalid URI: "+sn(e));let s=rp.test(e);return(o=t.baseURL)&&!s&&(!e.startsWith("/")&&!o.endsWith("/")&&(e="/"+e),e=o+e),a=(i=e.startsWith(Hu))||t.mode==="file"||t.mode!=="http"&&!s&&n,i?e=e.slice(Hu.length):e.startsWith("//")&&(t.defaultProtocol==="file"?(e=e.slice(2),a=!0):e=(t.defaultProtocol||"http")+":"+e),Object.defineProperty(r,"localFile",{value:!!a}),r.href=e,t.target&&(r.target=t.target+""),t.rel&&(r.rel=t.rel+""),t.context==="image"&&t.crossOrigin&&(r.crossOrigin=t.crossOrigin+""),r}function cp(e){return e?t=>new Promise((n,r)=>{e.readFile(t,(i,a)=>{i?r(i):n(a)})}):up}async function up(){B("No file system access.")}async function lp(e,t){let n=$e({},this.options.http,t),r=t&&t.response,i=await fetch(e,n);return i.ok?ke(i[r])?i[r]():i.text():B(i.status+""+i.statusText)}function Wu(e){let t=function(n,r){let i={delimiter:e};return Io(n,r?$e(r,i):i)};return t.responseType="text",t}function Io(e,t){return t.header&&(e=t.header.map(sn).join(t.delimiter)+`\n`+e),Ri(t.delimiter).parse(e+"")}Io.responseType="text";function hp(e){return typeof Buffer=="function"&&ke(Buffer.isBuffer)?Buffer.isBuffer(e):!1}function Lo(e,t){let n=t&&t.property?$t(t.property):ha;return Fe(e)&&!hp(e)?dp(n(e),t):n(JSON.parse(e))}Lo.responseType="json";function dp(e,t){return!Z(e)&&Ir(e)&&(e=[...e]),t&&t.copy?JSON.parse(JSON.stringify(e)):e}var pp={interior:(e,t)=>e!==t,exterior:(e,t)=>e===t};function Gu(e,t){let n,r,i,a;return e=Lo(e,t),t&&t.feature?(n=$o,i=t.feature):t&&t.mesh?(n=Oo,i=t.mesh,a=pp[t.filter]):B("Missing TopoJSON feature or mesh parameter."),r=(r=e.objects[i])?n(e,r,a):B("Invalid TopoJSON object: "+i),r&&r.features||[r]}Gu.responseType="json";var R4={dsv:Io,csv:Wu(","),tsv:Wu("	"),json:Lo,topojson:Gu};var Uo=op(null);var bp=0;var Yi="p_";function of(e){return e&&e.gradient}function bl(e,t,n){let r=e.gradient,i=e.id,a=r==="radial"?Yi:"";return i||(i=e.id="gradient_"+bp++,r==="radial"?(e.x1=Je(e.x1,.5),e.y1=Je(e.y1,.5),e.r1=Je(e.r1,0),e.x2=Je(e.x2,.5),e.y2=Je(e.y2,.5),e.r2=Je(e.r2,.5),a=Yi):(e.x1=Je(e.x1,0),e.y1=Je(e.y1,0),e.x2=Je(e.x2,1),e.y2=Je(e.y2,0))),t[i]=e,"url("+(n||"")+"#"+a+i+")"}function Je(e,t){return e??t}var ju={basis:{curve:cu},"basis-closed":{curve:lu},"basis-open":{curve:du},bundle:{curve:bu,tension:"beta",value:.85},cardinal:{curve:gu,tension:"tension",value:0},"cardinal-open":{curve:yu,tension:"tension",value:0},"cardinal-closed":{curve:mu,tension:"tension",value:0},"catmull-rom":{curve:vu,tension:"alpha",value:.5},"catmull-rom-closed":{curve:wu,tension:"alpha",value:.5},"catmull-rom-open":{curve:ku,tension:"alpha",value:.5},linear:{curve:br},"linear-closed":{curve:Su},monotone:{horizontal:Ru,vertical:Nu},natural:{curve:Du},step:{curve:$u},"step-after":{curve:Ou},"step-before":{curve:Pu}};function gl(e,t,n){var r=ae(ju,e)&&ju[e],i=null;return r&&(i=r.curve||r[t||"vertical"],r.tension&&n!=null&&(i=i[r.tension](n))),i}var gp={m:2,l:2,h:1,v:1,z:0,c:6,s:4,q:4,t:2,a:7},mp=/[mlhvzcsqta]([^mlhvzcsqta]*)/gi,yp=/^[+-]?(([0-9]*\\.[0-9]+)|([0-9]+\\.)|([0-9]+))([eE][+-]?[0-9]+)?/,_p=/^((\\s+,?\\s*)|(,\\s*))/,vp=/^[01]/;function ml(e){let t=[];return(e.match(mp)||[]).forEach(r=>{let i=r[0],a=i.toLowerCase(),o=gp[a],f=xp(a,o,r.slice(1).trim()),s=f.length;if(s<o||s&&s%o!==0)throw Error("Invalid SVG path, incorrect parameter count");if(t.push([i,...f.slice(0,o)]),s!==o){a==="m"&&(i=i==="M"?"L":"l");for(let c=o;c<s;c+=o)t.push([i,...f.slice(c,c+o)])}}),t}function xp(e,t,n){let r=[];for(let i=0;t&&i<n.length;)for(let a=0;a<t;++a){let o=e==="a"&&(a===3||a===4)?vp:yp,f=n.slice(i).match(o);if(f===null)throw Error("Invalid SVG path, incorrect parameter type");i+=f[0].length,r.push(+f[0]);let s=n.slice(i).match(_p);s!==null&&(i+=s[0].length)}return r}var Nt=Math.PI/180,wp=1e-14,Zt=Math.PI/2,Ke=Math.PI*2,An=Math.sqrt(3)/2,Fo={},qo={},yl=[].join;function Mp(e,t,n,r,i,a,o,f,s){let c=yl.call(arguments);if(Fo[c])return Fo[c];let l=o*Nt,u=Math.sin(l),h=Math.cos(l);n=Math.abs(n),r=Math.abs(r);let d=h*(f-e)*.5+u*(s-t)*.5,b=h*(s-t)*.5-u*(f-e)*.5,p=d*d/(n*n)+b*b/(r*r);p>1&&(p=Math.sqrt(p),n*=p,r*=p);let g=h/n,m=u/n,w=-u/r,x=h/r,v=g*f+m*s,C=w*f+x*s,_=g*e+m*t,k=w*e+x*t,z=1/((_-v)*(_-v)+(k-C)*(k-C))-.25;z<0&&(z=0);let U=Math.sqrt(z);a==i&&(U=-U);let W=.5*(v+_)-U*(k-C),S=.5*(C+k)+U*(_-v),T=Math.atan2(C-S,v-W),F=Math.atan2(k-S,_-W)-T;F<0&&a===1?F+=Ke:F>0&&a===0&&(F-=Ke);let ve=Math.ceil(Math.abs(F/(Zt+.001))),oe=[];for(let j=0;j<ve;++j){let xe=T+j*F/ve,Q=T+(j+1)*F/ve;oe[j]=[W,S,xe,Q,n,r,u,h]}return Fo[c]=oe}function kp(e){let t=yl.call(e);if(qo[t])return qo[t];var n=e[0],r=e[1],i=e[2],a=e[3],o=e[4],f=e[5],s=e[6],c=e[7];let l=c*o,u=-s*f,h=s*o,d=c*f,b=Math.cos(i),p=Math.sin(i),g=Math.cos(a),m=Math.sin(a),w=.5*(a-i),x=Math.sin(w*.5),v=8/3*x*x/Math.sin(w),C=n+b-v*p,_=r+p+v*b,k=n+g,E=r+m,z=k+v*m,U=E-v*g;return qo[t]=[l*C+u*_,h*C+d*_,l*z+u*U,h*z+d*U,l*k+u*E,h*k+d*E]}var Le=["l",0,0,0,0,0,0,0];function Tp(e,t,n){let r=Le[0]=e[0];if(r==="a"||r==="A")Le[1]=t*e[1],Le[2]=n*e[2],Le[3]=e[3],Le[4]=e[4],Le[5]=e[5],Le[6]=t*e[6],Le[7]=n*e[7];else if(r==="h"||r==="H")Le[1]=t*e[1];else if(r==="v"||r==="V")Le[1]=n*e[1];else for(var i=1,a=e.length;i<a;++i)Le[i]=(i%2==1?t:n)*e[i];return Le}function Wo(e,t,n,r,i,a){var o,f=null,s=0,c=0,l=0,u=0,h,d,b,p,g=0,m=0;n==null&&(n=0),r==null&&(r=0),i==null&&(i=1),a==null&&(a=i),e.beginPath&&e.beginPath();for(var w=0,x=t.length;w<x;++w){switch(o=t[w],(i!==1||a!==1)&&(o=Tp(o,i,a)),o[0]){case"l":s+=o[1],c+=o[2],e.lineTo(s+n,c+r);break;case"L":s=o[1],c=o[2],e.lineTo(s+n,c+r);break;case"h":s+=o[1],e.lineTo(s+n,c+r);break;case"H":s=o[1],e.lineTo(s+n,c+r);break;case"v":c+=o[1],e.lineTo(s+n,c+r);break;case"V":c=o[1],e.lineTo(s+n,c+r);break;case"m":s+=o[1],c+=o[2],g=s,m=c,e.moveTo(s+n,c+r);break;case"M":s=o[1],c=o[2],g=s,m=c,e.moveTo(s+n,c+r);break;case"c":h=s+o[5],d=c+o[6],l=s+o[3],u=c+o[4],e.bezierCurveTo(s+o[1]+n,c+o[2]+r,l+n,u+r,h+n,d+r),s=h,c=d;break;case"C":s=o[5],c=o[6],l=o[3],u=o[4],e.bezierCurveTo(o[1]+n,o[2]+r,l+n,u+r,s+n,c+r);break;case"s":h=s+o[3],d=c+o[4],l=2*s-l,u=2*c-u,e.bezierCurveTo(l+n,u+r,s+o[1]+n,c+o[2]+r,h+n,d+r),l=s+o[1],u=c+o[2],s=h,c=d;break;case"S":h=o[3],d=o[4],l=2*s-l,u=2*c-u,e.bezierCurveTo(l+n,u+r,o[1]+n,o[2]+r,h+n,d+r),s=h,c=d,l=o[1],u=o[2];break;case"q":h=s+o[3],d=c+o[4],l=s+o[1],u=c+o[2],e.quadraticCurveTo(l+n,u+r,h+n,d+r),s=h,c=d;break;case"Q":h=o[3],d=o[4],e.quadraticCurveTo(o[1]+n,o[2]+r,h+n,d+r),s=h,c=d,l=o[1],u=o[2];break;case"t":h=s+o[1],d=c+o[2],f[0].match(/[QqTt]/)===null?(l=s,u=c):f[0]==="t"?(l=2*s-b,u=2*c-p):f[0]==="q"&&(l=2*s-l,u=2*c-u),b=l,p=u,e.quadraticCurveTo(l+n,u+r,h+n,d+r),s=h,c=d,l=s+o[1],u=c+o[2];break;case"T":h=o[1],d=o[2],l=2*s-l,u=2*c-u,e.quadraticCurveTo(l+n,u+r,h+n,d+r),s=h,c=d;break;case"a":Xu(e,s+n,c+r,[o[1],o[2],o[3],o[4],o[5],o[6]+s+n,o[7]+c+r]),s+=o[6],c+=o[7];break;case"A":Xu(e,s+n,c+r,[o[1],o[2],o[3],o[4],o[5],o[6]+n,o[7]+r]),s=o[6],c=o[7];break;case"z":case"Z":s=g,c=m,e.closePath();break}f=o}}function Xu(e,t,n,r){let i=Mp(r[5],r[6],r[0],r[1],r[3],r[4],r[2],t,n);for(let a=0;a<i.length;++a){let o=kp(i[a]);e.bezierCurveTo(o[0],o[1],o[2],o[3],o[4],o[5])}}var Vu=.5773502691896257,Qu={circle:{draw:function(e,t){let n=Math.sqrt(t)/2;e.moveTo(n,0),e.arc(0,0,n,0,Ke)}},cross:{draw:function(e,t){var n=Math.sqrt(t)/2,r=n/2.5;e.moveTo(-n,-r),e.lineTo(-n,r),e.lineTo(-r,r),e.lineTo(-r,n),e.lineTo(r,n),e.lineTo(r,r),e.lineTo(n,r),e.lineTo(n,-r),e.lineTo(r,-r),e.lineTo(r,-n),e.lineTo(-r,-n),e.lineTo(-r,-r),e.closePath()}},diamond:{draw:function(e,t){let n=Math.sqrt(t)/2;e.moveTo(-n,0),e.lineTo(0,-n),e.lineTo(n,0),e.lineTo(0,n),e.closePath()}},square:{draw:function(e,t){var n=Math.sqrt(t),r=-n/2;e.rect(r,r,n,n)}},arrow:{draw:function(e,t){var n=Math.sqrt(t)/2,r=n/7,i=n/2.5,a=n/8;e.moveTo(-r,n),e.lineTo(r,n),e.lineTo(r,-a),e.lineTo(i,-a),e.lineTo(0,-n),e.lineTo(-i,-a),e.lineTo(-r,-a),e.closePath()}},wedge:{draw:function(e,t){var n=Math.sqrt(t)/2,r=An*n,i=r-n*Vu,a=n/4;e.moveTo(0,-r-i),e.lineTo(-a,r-i),e.lineTo(a,r-i),e.closePath()}},triangle:{draw:function(e,t){var n=Math.sqrt(t)/2,r=An*n,i=r-n*Vu;e.moveTo(0,-r-i),e.lineTo(-n,r-i),e.lineTo(n,r-i),e.closePath()}},"triangle-up":{draw:function(e,t){var n=Math.sqrt(t)/2,r=An*n;e.moveTo(0,-r),e.lineTo(-n,r),e.lineTo(n,r),e.closePath()}},"triangle-down":{draw:function(e,t){var n=Math.sqrt(t)/2,r=An*n;e.moveTo(0,r),e.lineTo(-n,-r),e.lineTo(n,-r),e.closePath()}},"triangle-right":{draw:function(e,t){var n=Math.sqrt(t)/2,r=An*n;e.moveTo(r,0),e.lineTo(-r,-n),e.lineTo(-r,n),e.closePath()}},"triangle-left":{draw:function(e,t){var n=Math.sqrt(t)/2,r=An*n;e.moveTo(-r,0),e.lineTo(r,-n),e.lineTo(r,n),e.closePath()}},stroke:{draw:function(e,t){let n=Math.sqrt(t)/2;e.moveTo(-n,0),e.lineTo(n,0)}}};function Sp(e){return ae(Qu,e)?Qu[e]:Cp(e)}var zo={};function Cp(e){if(!ae(zo,e)){let t=ml(e);zo[e]={draw:function(n,r){Wo(n,t,0,0,Math.sqrt(r)/2)}}}return zo[e]}var kt=.448084975506;function Ap(e){return e.x}function Np(e){return e.y}function Rp(e){return e.width}function Ep(e){return e.height}function ut(e){return typeof e=="function"?e:()=>+e}function $i(e,t,n){return Math.max(t,Math.min(e,n))}function Dp(){var e=Ap,t=Np,n=Rp,r=Ep,i=ut(0),a=i,o=i,f=i,s=null;function c(l,u,h){var d,b=u??+e.call(this,l),p=h??+t.call(this,l),g=+n.call(this,l),m=+r.call(this,l),w=Math.min(g,m)/2,x=$i(+i.call(this,l),0,w),v=$i(+a.call(this,l),0,w),C=$i(+o.call(this,l),0,w),_=$i(+f.call(this,l),0,w);if(s||(s=d=_i()),x<=0&&v<=0&&C<=0&&_<=0)s.rect(b,p,g,m);else{var k=b+g,E=p+m;s.moveTo(b+x,p),s.lineTo(k-v,p),s.bezierCurveTo(k-kt*v,p,k,p+kt*v,k,p+v),s.lineTo(k,E-_),s.bezierCurveTo(k,E-kt*_,k-kt*_,E,k-_,E),s.lineTo(b+C,E),s.bezierCurveTo(b+kt*C,E,b,E-kt*C,b,E-C),s.lineTo(b,p+x),s.bezierCurveTo(b,p+kt*x,b+kt*x,p,b+x,p),s.closePath()}if(d)return s=null,d+""||null}return c.x=function(l){return arguments.length?(e=ut(l),c):e},c.y=function(l){return arguments.length?(t=ut(l),c):t},c.width=function(l){return arguments.length?(n=ut(l),c):n},c.height=function(l){return arguments.length?(r=ut(l),c):r},c.cornerRadius=function(l,u,h,d){return arguments.length?(i=ut(l),a=u!=null?ut(u):i,f=h!=null?ut(h):i,o=d!=null?ut(d):a,c):i},c.context=function(l){return arguments.length?(s=l??null,c):s},c}function $p(){var e,t,n,r,i=null,a,o,f,s;function c(u,h,d){let b=d/2;if(a){var p=f-h,g=u-o;if(p||g){var m=Math.hypot(p,g),w=(p/=m)*s,x=(g/=m)*s,v=Math.atan2(g,p);i.moveTo(o-w,f-x),i.lineTo(u-p*b,h-g*b),i.arc(u,h,b,v-Math.PI,v),i.lineTo(o+w,f+x),i.arc(o,f,s,v,v+Math.PI)}else i.arc(u,h,b,0,Ke);i.closePath()}else a=1;o=u,f=h,s=b}function l(u){var h,d=u.length,b,p=!1,g;for(i==null&&(i=g=_i()),h=0;h<=d;++h)!(h<d&&r(b=u[h],h,u))===p&&(p=!p)&&(a=0),p&&c(+e(b,h,u),+t(b,h,u),+n(b,h,u));if(g)return i=null,g+""||null}return l.x=function(u){return arguments.length?(e=u,l):e},l.y=function(u){return arguments.length?(t=u,l):t},l.size=function(u){return arguments.length?(n=u,l):n},l.defined=function(u){return arguments.length?(r=u,l):r},l.context=function(u){return arguments.length?(u==null?i=null:i=u,l):i},l}function Nr(e,t){return e??t}var Rr=e=>e.x||0,Er=e=>e.y||0,Pp=e=>e.width||0,Op=e=>e.height||0,Ip=e=>(e.x||0)+(e.width||0),Lp=e=>(e.y||0)+(e.height||0),Up=e=>e.startAngle||0,Fp=e=>e.endAngle||0,qp=e=>e.padAngle||0,zp=e=>e.innerRadius||0,Yp=e=>e.outerRadius||0,Bp=e=>e.cornerRadius||0,Hp=e=>Nr(e.cornerRadiusTopLeft,e.cornerRadius)||0,Wp=e=>Nr(e.cornerRadiusTopRight,e.cornerRadius)||0,Gp=e=>Nr(e.cornerRadiusBottomRight,e.cornerRadius)||0,jp=e=>Nr(e.cornerRadiusBottomLeft,e.cornerRadius)||0,Xp=e=>Nr(e.size,64),Vp=e=>e.size||1,ra=e=>e.defined!==!1,Qp=e=>Sp(e.shape||"circle"),Zp=tu().startAngle(Up).endAngle(Fp).padAngle(qp).innerRadius(zp).outerRadius(Yp).cornerRadius(Bp),Jp=ko().x(Rr).y1(Er).y0(Lp).defined(ra),Kp=ko().y(Er).x1(Rr).x0(Ip).defined(ra),eb=Mo().x(Rr).y(Er).defined(ra),tb=Dp().x(Rr).y(Er).width(Pp).height(Op).cornerRadius(Hp,Wp,Gp,jp),nb=su().type(Qp).size(Xp),rb=$p().x(Rr).y(Er).defined(ra).size(Vp);function ff(e){return e.cornerRadius||e.cornerRadiusTopLeft||e.cornerRadiusTopRight||e.cornerRadiusBottomRight||e.cornerRadiusBottomLeft}function ib(e,t){return Zp.context(e)(t)}function ab(e,t){let n=t[0],r=n.interpolate||"linear";return(n.orient==="horizontal"?Kp:Jp).curve(gl(r,n.orient,n.tension)).context(e)(t)}function ob(e,t){let n=t[0],r=n.interpolate||"linear";return eb.curve(gl(r,n.orient,n.tension)).context(e)(t)}function $n(e,t,n,r){return tb.context(e)(t,n,r)}function fb(e,t){return(t.mark.shape||t.shape).context(e)(t)}function sb(e,t){return nb.context(e)(t)}function cb(e,t){return rb.context(e)(t)}var ub=1;function sf(e,t,n){var r=t.clip,i=e._defs,a=t.clip_id||(t.clip_id="clip"+ub++),o=i.clipping[a]||(i.clipping[a]={id:a});return ke(r)?o.path=r(null):ff(n)?o.path=$n(null,n,0,0):(o.width=n.width||0,o.height=n.height||0),"url(#"+a+")"}function He(e){this.clear(),e&&this.union(e)}He.prototype={clone(){return new He(this)},clear(){return this.x1=+Number.MAX_VALUE,this.y1=+Number.MAX_VALUE,this.x2=-Number.MAX_VALUE,this.y2=-Number.MAX_VALUE,this},empty(){return this.x1===+Number.MAX_VALUE&&this.y1===+Number.MAX_VALUE&&this.x2===-Number.MAX_VALUE&&this.y2===-Number.MAX_VALUE},equals(e){return this.x1===e.x1&&this.y1===e.y1&&this.x2===e.x2&&this.y2===e.y2},set(e,t,n,r){return n<e?(this.x2=e,this.x1=n):(this.x1=e,this.x2=n),r<t?(this.y2=t,this.y1=r):(this.y1=t,this.y2=r),this},add(e,t){return e<this.x1&&(this.x1=e),t<this.y1&&(this.y1=t),e>this.x2&&(this.x2=e),t>this.y2&&(this.y2=t),this},expand(e){return this.x1-=e,this.y1-=e,this.x2+=e,this.y2+=e,this},round(){return this.x1=Math.floor(this.x1),this.y1=Math.floor(this.y1),this.x2=Math.ceil(this.x2),this.y2=Math.ceil(this.y2),this},scale(e){return this.x1*=e,this.y1*=e,this.x2*=e,this.y2*=e,this},translate(e,t){return this.x1+=e,this.x2+=e,this.y1+=t,this.y2+=t,this},rotate(e,t,n){let r=this.rotatedPoints(e,t,n);return this.clear().add(r[0],r[1]).add(r[2],r[3]).add(r[4],r[5]).add(r[6],r[7])},rotatedPoints(e,t,n){var{x1:r,y1:i,x2:a,y2:o}=this,f=Math.cos(e),s=Math.sin(e),c=t-t*f+n*s,l=n-t*s-n*f;return[f*r-s*i+c,s*r+f*i+l,f*r-s*o+c,s*r+f*o+l,f*a-s*i+c,s*a+f*i+l,f*a-s*o+c,s*a+f*o+l]},union(e){return e.x1<this.x1&&(this.x1=e.x1),e.y1<this.y1&&(this.y1=e.y1),e.x2>this.x2&&(this.x2=e.x2),e.y2>this.y2&&(this.y2=e.y2),this},intersect(e){return e.x1>this.x1&&(this.x1=e.x1),e.y1>this.y1&&(this.y1=e.y1),e.x2<this.x2&&(this.x2=e.x2),e.y2<this.y2&&(this.y2=e.y2),this},encloses(e){return e&&this.x1<=e.x1&&this.x2>=e.x2&&this.y1<=e.y1&&this.y2>=e.y2},alignsWith(e){return e&&(this.x1==e.x1||this.x2==e.x2||this.y1==e.y1||this.y2==e.y2)},intersects(e){return e&&!(this.x2<e.x1||this.x1>e.x2||this.y2<e.y1||this.y1>e.y2)},contains(e,t){return!(e<this.x1||e>this.x2||t<this.y1||t>this.y2)},width(){return this.x2-this.x1},height(){return this.y2-this.y1}};function _l(e){this.mark=e,this.bounds=this.bounds||new He}function lb(e){_l.call(this,e),this.items=this.items||[]}pa(lb,_l);var Go=class{constructor(t){this._pending=0,this._loader=t||Uo()}pending(){return this._pending}sanitizeURL(t){let n=this;return Zu(n),n._loader.sanitize(t,{context:"href"}).then(r=>(yr(n),r)).catch(()=>(yr(n),null))}loadImage(t){let n=this,r=Iu();return Zu(n),n._loader.sanitize(t,{context:"image"}).then(i=>{let a=i.href;if(!a||!r)throw{url:a};let o=new r,f=ae(i,"crossOrigin")?i.crossOrigin:"anonymous";return f!=null&&(o.crossOrigin=f),o.onload=()=>yr(n),o.onerror=()=>yr(n),o.src=a,o}).catch(i=>(yr(n),{complete:!1,width:0,height:0,src:i&&i.url||""}))}ready(){let t=this;return new Promise(n=>{function r(i){t.pending()?setTimeout(()=>{r(!0)},10):n(i)}r(!1)})}};function Zu(e){e._pending+=1}function yr(e){e._pending-=1}function Pn(e,t,n){if(t.stroke&&t.opacity!==0&&t.strokeOpacity!==0){let r=t.strokeWidth!=null?+t.strokeWidth:1,i=(t.strokeCap==="square"?Math.SQRT2:1)*r/2;n&&(!t.strokeJoin||t.strokeJoin==="miter")&&(i=Math.max(i,(t.strokeMiterLimit!=null?+t.strokeMiterLimit:4)*r/2)),e.expand(i)}return e}var hb=Ke-1e-8,ia,Pi,Oi,en,jo,Ii,Xo,Vo,St=(e,t)=>ia.add(e,t),Li=(e,t)=>St(Pi=e,Oi=t),Ju=e=>St(e,ia.y1),Ku=e=>St(ia.x1,e),Jt=(e,t)=>jo*e+Xo*t,Kt=(e,t)=>Ii*e+Vo*t,Yo=(e,t)=>St(Jt(e,t),Kt(e,t)),Bo=(e,t)=>Li(Jt(e,t),Kt(e,t));function cf(e,t){return ia=e,t?(en=t*Nt,jo=Vo=Math.cos(en),Ii=Math.sin(en),Xo=-Ii):(jo=Vo=1,en=Ii=Xo=0),db}var db={beginPath(){},closePath(){},moveTo:Bo,lineTo:Bo,rect(e,t,n,r){en?(Yo(e+n,t),Yo(e+n,t+r),Yo(e,t+r),Bo(e,t)):(St(e+n,t+r),Li(e,t))},quadraticCurveTo(e,t,n,r){let i=Jt(e,t),a=Kt(e,t),o=Jt(n,r),f=Kt(n,r);el(Pi,i,o,Ju),el(Oi,a,f,Ku),Li(o,f)},bezierCurveTo(e,t,n,r,i,a){let o=Jt(e,t),f=Kt(e,t),s=Jt(n,r),c=Kt(n,r),l=Jt(i,a),u=Kt(i,a);tl(Pi,o,s,l,Ju),tl(Oi,f,c,u,Ku),Li(l,u)},arc(e,t,n,r,i,a){if(r+=en,i+=en,Pi=n*Math.cos(i)+e,Oi=n*Math.sin(i)+t,Math.abs(i-r)>hb)St(e-n,t-n),St(e+n,t+n);else{let o=c=>St(n*Math.cos(c)+e,n*Math.sin(c)+t),f,s;if(o(r),o(i),i!==r)if(r=r%Ke,r<0&&(r+=Ke),i=i%Ke,i<0&&(i+=Ke),i<r&&(a=!a,f=r,r=i,i=f),a)for(i-=Ke,f=r-r%Zt,s=0;s<4&&f>i;++s,f-=Zt)o(f);else for(f=r-r%Zt+Zt,s=0;s<4&&f<i;++s,f=f+Zt)o(f)}}};function el(e,t,n,r){let i=(e-t)/(e+n-2*t);0<i&&i<1&&r(e+(t-e)*i)}function tl(e,t,n,r,i){let a=r-e+3*t-3*n,o=e+n-2*t,f=e-t,s=0,c=0,l;Math.abs(a)>wp?(l=o*o+f*a,l>=0&&(l=Math.sqrt(l),s=(-o+l)/a,c=(-o-l)/a)):s=.5*f/o,0<s&&s<1&&i(nl(s,e,t,n,r)),0<c&&c<1&&i(nl(c,e,t,n,r))}function nl(e,t,n,r,i){let a=1-e,o=a*a,f=e*e;return o*a*t+3*o*e*n+3*a*f*r+f*e*i}var At=(At=Ni(1,1))?At.getContext("2d"):null,Qo=new He;function vl(e){return function(t,n){if(!At)return!0;e(At,t),Qo.clear().union(t.bounds).intersect(n).round();let{x1:r,y1:i,x2:a,y2:o}=Qo;for(let f=i;f<=o;++f)for(let s=r;s<=a;++s)if(At.isPointInPath(s,f))return!0;return!1}}function xl(e,t){return t.contains(e.x||0,e.y||0)}function wl(e,t){let n=e.x||0,r=e.y||0,i=e.width||0,a=e.height||0;return t.intersects(Qo.set(n,r,n+i,r+a))}function pb(e,t){let n=e.x||0,r=e.y||0,i=e.x2!=null?e.x2:n,a=e.y2!=null?e.y2:r;return vr(t,n,r,i,a)}function vr(e,t,n,r,i){let{x1:a,y1:o,x2:f,y2:s}=e,c=r-t,l=i-n,u=0,h=1,d,b,p,g;for(g=0;g<4;++g){if(g===0&&(d=-c,b=-(a-t)),g===1&&(d=c,b=f-t),g===2&&(d=-l,b=-(o-n)),g===3&&(d=l,b=s-n),Math.abs(d)<1e-10&&b<0)return!1;if(p=b/d,d<0){if(p>h)return!1;p>u&&(u=p)}else if(d>0){if(p<u)return!1;p<h&&(h=p)}}return!0}function Nn(e,t){e.globalCompositeOperation=t.blend||"source-over"}function Ye(e,t){return e??t}function rl(e,t){let n=t.length;for(let r=0;r<n;++r)e.addColorStop(t[r].offset,t[r].color);return e}function bb(e,t,n){let r=n.width(),i=n.height(),a;if(t.gradient==="radial")a=e.createRadialGradient(n.x1+Ye(t.x1,.5)*r,n.y1+Ye(t.y1,.5)*i,Math.max(r,i)*Ye(t.r1,0),n.x1+Ye(t.x2,.5)*r,n.y1+Ye(t.y2,.5)*i,Math.max(r,i)*Ye(t.r2,.5));else{let o=Ye(t.x1,0),f=Ye(t.y1,0),s=Ye(t.x2,1),c=Ye(t.y2,0);if(o===s||f===c||r===i)a=e.createLinearGradient(n.x1+o*r,n.y1+f*i,n.x1+s*r,n.y1+c*i);else{let l=Ni(Math.ceil(r),Math.ceil(i)),u=l.getContext("2d");return u.scale(r,i),u.fillStyle=rl(u.createLinearGradient(o,f,s,c),t.stops),u.fillRect(0,0,r,i),e.createPattern(l,"no-repeat")}}return rl(a,t.stops)}function Ml(e,t,n){return of(n)?bb(e,n,t.bounds):n}function Bi(e,t,n){return n*=t.fillOpacity==null?1:t.fillOpacity,n>0?(e.globalAlpha=n,e.fillStyle=Ml(e,t,t.fill),!0):!1}var gb=[];function Rn(e,t,n){var r=(r=t.strokeWidth)!=null?r:1;return r<=0?!1:(n*=t.strokeOpacity==null?1:t.strokeOpacity,n>0?(e.globalAlpha=n,e.strokeStyle=Ml(e,t,t.stroke),e.lineWidth=r,e.lineCap=t.strokeCap||"butt",e.lineJoin=t.strokeJoin||"miter",e.miterLimit=t.strokeMiterLimit!=null?t.strokeMiterLimit:4,e.setLineDash&&(e.setLineDash(t.strokeDash||gb),e.lineDashOffset=t.strokeDashOffset||0),!0):!1)}function mb(e,t){return e.zindex-t.zindex||e.index-t.index}function kl(e){if(!e.zdirty)return e.zitems;var t=e.items,n=[],r,i,a;for(i=0,a=t.length;i<a;++i)r=t[i],r.index=i,r.zindex&&n.push(r);return e.zdirty=!1,e.zitems=n.sort(mb)}function et(e,t){var n=e.items,r,i;if(!n||!n.length)return;let a=kl(e);if(a&&a.length){for(r=0,i=n.length;r<i;++r)n[r].zindex||t(n[r]);n=a}for(r=0,i=n.length;r<i;++r)t(n[r])}function Zo(e,t){var n=e.items,r,i;if(!n||!n.length)return null;let a=kl(e);for(a&&a.length&&(n=a),i=n.length;--i>=0;)if(r=t(n[i]))return r;if(n===a){for(n=e.items,i=n.length;--i>=0;)if(!n[i].zindex&&(r=t(n[i])))return r}return null}function uf(e){return function(t,n,r){et(n,i=>{(!r||r.intersects(i.bounds))&&Tl(e,t,i,i)})}}function yb(e){return function(t,n,r){n.items.length&&(!r||r.intersects(n.bounds))&&Tl(e,t,n.items[0],n.items)}}function Tl(e,t,n,r){var i=n.opacity==null?1:n.opacity;i!==0&&(e(t,r)||(Nn(t,n),n.fill&&Bi(t,n,i)&&t.fill(),n.stroke&&Rn(t,n,i)&&t.stroke()))}function aa(e){return e=e||Pr,function(t,n,r,i,a,o){return r*=t.pixelRatio,i*=t.pixelRatio,Zo(n,f=>{let s=f.bounds;if(!(s&&!s.contains(a,o)||!s)&&e(t,f,r,i,a,o))return f})}}function Dr(e,t){return function(n,r,i,a){var o=Array.isArray(r)?r[0]:r,f=t??o.fill,s=o.stroke&&n.isPointInStroke,c,l;return s&&(c=o.strokeWidth,l=o.strokeCap,n.lineWidth=c??1,n.lineCap=l??"butt"),e(n,r)?!1:f&&n.isPointInPath(i,a)||s&&n.isPointInStroke(i,a)}}function lf(e){return aa(Dr(e))}function nn(e,t){return"translate("+e+","+t+")"}function hf(e){return"rotate("+e+")"}function _b(e,t){return"scale("+e+","+t+")"}function Sl(e){return nn(e.x||0,e.y||0)}function vb(e){return nn(e.x||0,e.y||0)+(e.angle?" "+hf(e.angle):"")}function xb(e){return nn(e.x||0,e.y||0)+(e.angle?" "+hf(e.angle):"")+(e.scaleX||e.scaleY?" "+_b(e.scaleX||1,e.scaleY||1):"")}function df(e,t,n){function r(o,f){o("transform",vb(f)),o("d",t(null,f))}function i(o,f){return t(cf(o,f.angle),f),Pn(o,f,!0).translate(f.x||0,f.y||0)}function a(o,f){var s=f.x||0,c=f.y||0,l=f.angle||0;o.translate(s,c),l&&o.rotate(l*=Nt),o.beginPath(),t(o,f),l&&o.rotate(-l),o.translate(-s,-c)}return{type:e,tag:"path",nested:!1,attr:r,bound:i,draw:uf(a),pick:lf(a),isect:n||vl(a)}}var wb=df("arc",ib);function Mb(e,t){for(var n=e[0].orient==="horizontal"?t[1]:t[0],r=e[0].orient==="horizontal"?"y":"x",i=e.length,a=1/0,o,f;--i>=0;)e[i].defined!==!1&&(f=Math.abs(e[i][r]-n),f<a&&(a=f,o=e[i]));return o}function kb(e,t){for(var n=Math.pow(e[0].strokeWidth||1,2),r=e.length,i,a,o;--r>=0;)if(e[r].defined!==!1&&(i=e[r].x-t[0],a=e[r].y-t[1],o=i*i+a*a,o<n))return e[r];return null}function Tb(e,t){for(var n=e.length,r,i,a;--n>=0;)if(e[n].defined!==!1&&(r=e[n].x-t[0],i=e[n].y-t[1],a=r*r+i*i,r=e[n].size||1,a<r*r))return e[n];return null}function pf(e,t,n){function r(s,c){var l=c.mark.items;l.length&&s("d",t(null,l))}function i(s,c){var l=c.items;return l.length===0?s:(t(cf(s),l),Pn(s,l[0],!0))}function a(s,c){s.beginPath(),t(s,c)}let o=Dr(a);function f(s,c,l,u,h,d){var b=c.items,p=c.bounds;return!b||!b.length||p&&!p.contains(h,d)?null:(l*=s.pixelRatio,u*=s.pixelRatio,o(s,b,l,u)?b[0]:null)}return{type:e,tag:"path",nested:!0,attr:r,bound:i,draw:yb(a),pick:f,isect:xl,tip:n}}var Sb=pf("area",ab,Mb);function Cb(e,t){var n=t.clip;e.save(),ke(n)?(e.beginPath(),n(e),e.clip()):Cl(e,t.group)}function Cl(e,t){e.beginPath(),ff(t)?$n(e,t,0,0):e.rect(0,0,t.width||0,t.height||0),e.clip()}function Al(e){let t=Ye(e.strokeWidth,1);return e.strokeOffset!=null?e.strokeOffset:e.stroke&&t>.5&&t<1.5?.5-Math.abs(t-1):0}function Ab(e,t){e("transform",Sl(t))}function Nl(e,t){let n=Al(t);e("d",$n(null,t,n,n))}function Nb(e,t){e("class","background"),e("aria-hidden",!0),Nl(e,t)}function Rb(e,t){e("class","foreground"),e("aria-hidden",!0),t.strokeForeground?Nl(e,t):e("d","")}function Eb(e,t,n){let r=t.clip?sf(n,t,t):null;e("clip-path",r)}function Db(e,t){if(!t.clip&&t.items){let n=t.items,r=n.length;for(let i=0;i<r;++i)e.union(n[i].bounds)}return(t.clip||t.width||t.height)&&!t.noBound&&e.add(0,0).add(t.width||0,t.height||0),Pn(e,t),e.translate(t.x||0,t.y||0)}function Tr(e,t,n,r){let i=Al(t);e.beginPath(),$n(e,t,(n||0)+i,(r||0)+i)}var $b=Dr(Tr),Pb=Dr(Tr,!1),Ob=Dr(Tr,!0);function Ib(e,t,n,r){et(t,i=>{let a=i.x||0,o=i.y||0,f=i.strokeForeground,s=i.opacity==null?1:i.opacity;(i.stroke||i.fill)&&s&&(Tr(e,i,a,o),Nn(e,i),i.fill&&Bi(e,i,s)&&e.fill(),i.stroke&&!f&&Rn(e,i,s)&&e.stroke()),e.save(),e.translate(a,o),i.clip&&Cl(e,i),n&&n.translate(-a,-o),et(i,c=>{(c.marktype==="group"||r==null||r.includes(c.marktype))&&this.draw(e,c,n,r)}),n&&n.translate(a,o),e.restore(),f&&i.stroke&&s&&(Tr(e,i,a,o),Nn(e,i),Rn(e,i,s)&&e.stroke())})}function Lb(e,t,n,r,i,a){if(t.bounds&&!t.bounds.contains(i,a)||!t.items)return null;let o=n*e.pixelRatio,f=r*e.pixelRatio;return Zo(t,s=>{let c,l,u,h=s.bounds;if(h&&!h.contains(i,a))return;l=s.x||0,u=s.y||0;let d=l+(s.width||0),b=u+(s.height||0),p=s.clip;if(p&&(i<l||i>d||a<u||a>b))return;if(e.save(),e.translate(l,u),l=i-l,u=a-u,p&&ff(s)&&!Ob(e,s,o,f))return e.restore(),null;let g=s.strokeForeground,m=t.interactive!==!1;return m&&g&&s.stroke&&Pb(e,s,o,f)?(e.restore(),s):(c=Zo(s,w=>Ub(w,l,u)?this.pick(w,n,r,l,u):null),!c&&m&&(s.fill||!g&&s.stroke)&&$b(e,s,o,f)&&(c=s),e.restore(),c||null)})}function Ub(e,t,n){return(e.interactive!==!1||e.marktype==="group")&&e.bounds&&e.bounds.contains(t,n)}var Fb={type:"group",tag:"g",nested:!1,attr:Ab,bound:Db,draw:Ib,pick:Lb,isect:wl,content:Eb,background:Nb,foreground:Rb},Sr={xmlns:"http://www.w3.org/2000/svg","xmlns:xlink":"http://www.w3.org/1999/xlink",version:"1.1"};function bf(e,t){var n=e.image;return(!n||e.url&&e.url!==n.url)&&(n={complete:!1,width:0,height:0},t.loadImage(e.url).then(r=>{e.image=r,e.image.url=e.url})),n}function gf(e,t){return e.width!=null?e.width:!t||!t.width?0:e.aspect!==!1&&e.height?e.height*t.width/t.height:t.width}function mf(e,t){return e.height!=null?e.height:!t||!t.height?0:e.aspect!==!1&&e.width?e.width*t.height/t.width:t.height}function oa(e,t){return e==="center"?t/2:e==="right"?t:0}function fa(e,t){return e==="middle"?t/2:e==="bottom"?t:0}function qb(e,t,n){let r=bf(t,n),i=gf(t,r),a=mf(t,r),o=(t.x||0)-oa(t.align,i),f=(t.y||0)-fa(t.baseline,a),s=!r.src&&r.toDataURL?r.toDataURL():r.src||"";e("href",s,Sr["xmlns:xlink"],"xlink:href"),e("transform",nn(o,f)),e("width",i),e("height",a),e("preserveAspectRatio",t.aspect===!1?"none":"xMidYMid")}function zb(e,t){let n=t.image,r=gf(t,n),i=mf(t,n),a=(t.x||0)-oa(t.align,r),o=(t.y||0)-fa(t.baseline,i);return e.set(a,o,a+r,o+i)}function Yb(e,t,n){et(t,r=>{if(n&&!n.intersects(r.bounds))return;let i=bf(r,this),a=gf(r,i),o=mf(r,i);if(a===0||o===0)return;let f=(r.x||0)-oa(r.align,a),s=(r.y||0)-fa(r.baseline,o),c,l,u,h;r.aspect!==!1&&(l=i.width/i.height,u=r.width/r.height,l===l&&u===u&&l!==u&&(u<l?(h=a/l,s+=(o-h)/2,o=h):(h=o*l,f+=(a-h)/2,a=h))),(i.complete||i.toDataURL)&&(Nn(e,r),e.globalAlpha=(c=r.opacity)!=null?c:1,e.imageSmoothingEnabled=r.smooth!==!1,e.drawImage(i,f,s,a,o))})}var Bb={type:"image",tag:"image",nested:!1,attr:qb,bound:zb,draw:Yb,pick:aa(),isect:Pr,get:bf,xOffset:oa,yOffset:fa},Hb=pf("line",ob,kb);function Wb(e,t){var n=t.scaleX||1,r=t.scaleY||1;(n!==1||r!==1)&&e("vector-effect","non-scaling-stroke"),e("transform",xb(t)),e("d",t.path)}function Ui(e,t){var n=t.path;if(n==null)return!0;var r=t.x||0,i=t.y||0,a=t.scaleX||1,o=t.scaleY||1,f=(t.angle||0)*Nt,s=t.pathCache;(!s||s.path!==n)&&((t.pathCache=s=ml(n)).path=n),f&&e.rotate&&e.translate?(e.translate(r,i),e.rotate(f),Wo(e,s,0,0,a,o),e.rotate(-f),e.translate(-r,-i)):Wo(e,s,r,i,a,o)}function Gb(e,t){return Ui(cf(e,t.angle),t)?e.set(0,0,0,0):Pn(e,t,!0)}var jb={type:"path",tag:"path",nested:!1,attr:Wb,bound:Gb,draw:uf(Ui),pick:lf(Ui),isect:vl(Ui)};function Xb(e,t){e("d",$n(null,t))}function Vb(e,t){var n,r;return Pn(e.set(n=t.x||0,r=t.y||0,n+t.width||0,r+t.height||0),t)}function il(e,t){e.beginPath(),$n(e,t)}var Qb={type:"rect",tag:"path",nested:!1,attr:Xb,bound:Vb,draw:uf(il),pick:lf(il),isect:wl};function Zb(e,t){e("transform",Sl(t)),e("x2",t.x2!=null?t.x2-(t.x||0):0),e("y2",t.y2!=null?t.y2-(t.y||0):0)}function Jb(e,t){var n,r;return Pn(e.set(n=t.x||0,r=t.y||0,t.x2!=null?t.x2:n,t.y2!=null?t.y2:r),t)}function Rl(e,t,n){var r,i,a,o;return t.stroke&&Rn(e,t,n)?(r=t.x||0,i=t.y||0,a=t.x2!=null?t.x2:r,o=t.y2!=null?t.y2:i,e.beginPath(),e.moveTo(r,i),e.lineTo(a,o),!0):!1}function Kb(e,t,n){et(t,r=>{if(!(n&&!n.intersects(r.bounds))){var i=r.opacity==null?1:r.opacity;i&&Rl(e,r,i)&&(Nn(e,r),e.stroke())}})}function eg(e,t,n,r){return e.isPointInStroke?Rl(e,t,1)&&e.isPointInStroke(n,r):!1}var tg={type:"rule",tag:"line",nested:!1,attr:Zb,bound:Jb,draw:Kb,pick:aa(eg),isect:pb},ng=df("shape",fb),rg=df("symbol",sb,xl),al=ba(),rn={height:ht,measureWidth:yf,estimateWidth:Hi,width:Hi,canvas:El};El(!0);function El(e){rn.width=e&&At?yf:Hi}function Hi(e,t){return Dl(Rt(e,t),ht(e))}function Dl(e,t){return~~(.8*e.length*t)}function yf(e,t){return ht(e)<=0||!(t=Rt(e,t))?0:$l(t,_f(e))}function $l(e,t){let n=`(${t}) ${e}`,r=al.get(n);return r===void 0&&(At.font=t,r=At.measureText(e).width,al.set(n,r)),r}function ht(e){return e.fontSize!=null?+e.fontSize||0:11}function En(e){return e.lineHeight!=null?e.lineHeight:ht(e)+2}function ig(e){return Z(e)?e.length>1?e:e[0]:e}function sa(e){return ig(e.lineBreak&&e.text&&!Z(e.text)?e.text.split(e.lineBreak):e.text)}function Rt(e,t){let n=t==null?"":(t+"").trim();return e.limit>0&&n.length?og(e,n):n}function ag(e){if(rn.width===yf){let t=_f(e);return n=>$l(n,t)}else if(rn.width===Hi){let t=ht(e);return n=>Dl(n,t)}else return t=>rn.width(e,t)}function og(e,t){var n=+e.limit,r=ag(e);if(r(t)<n)return t;var i=e.ellipsis||"\\u2026",a=e.dir==="rtl",o=0,f=t.length,s;if(n-=r(i),a){for(;o<f;)s=o+f>>>1,r(t.slice(s))>n?o=s+1:f=s;return i+t.slice(o)}else{for(;o<f;)s=1+(o+f>>>1),r(t.slice(0,s))<n?o=s:f=s-1;return t.slice(0,o)+i}}function ca(e,t){var n=e.font;return(t&&n?String(n).replace(/"/g,"\'"):n)||"sans-serif"}function _f(e,t){return(e.fontStyle?e.fontStyle+" ":"")+(e.fontVariant?e.fontVariant+" ":"")+(e.fontWeight?e.fontWeight+" ":"")+ht(e)+"px "+ca(e,t)}function vf(e){var t=e.baseline,n=ht(e);return Math.round(t==="top"?.79*n:t==="middle"?.3*n:t==="bottom"?-.21*n:t==="line-top"?.29*n+.5*En(e):t==="line-bottom"?.29*n-.5*En(e):0)}var fg={left:"start",center:"middle",right:"end"},wr=new He;function ua(e){var t=e.x||0,n=e.y||0,r=e.radius||0,i;return r&&(i=(e.theta||0)-Zt,t+=r*Math.cos(i),n+=r*Math.sin(i)),wr.x1=t,wr.y1=n,wr}function sg(e,t){var n=t.dx||0,r=(t.dy||0)+vf(t),i=ua(t),a=i.x1,o=i.y1,f=t.angle||0,s;e("text-anchor",fg[t.align]||"start"),f?(s=nn(a,o)+" "+hf(f),(n||r)&&(s+=" "+nn(n,r))):s=nn(a+n,o+r),e("transform",s)}function xf(e,t,n){var r=rn.height(t),i=t.align,a=ua(t),o=a.x1,f=a.y1,s=t.dx||0,c=(t.dy||0)+vf(t)-Math.round(.8*r),l=sa(t),u;if(Z(l)?(r+=En(t)*(l.length-1),u=l.reduce((h,d)=>Math.max(h,rn.width(t,d)),0)):u=rn.width(t,l),i==="center"?s-=u/2:i==="right"&&(s-=u),e.set(s+=o,c+=f,s+u,c+r),t.angle&&!n)e.rotate(t.angle*Nt,o,f);else if(n===2)return e.rotatedPoints(t.angle*Nt,o,f);return e}function cg(e,t,n){et(t,r=>{var i=r.opacity==null?1:r.opacity,a,o,f,s,c,l,u;if(!(n&&!n.intersects(r.bounds)||i===0||r.fontSize<=0||r.text==null||r.text.length===0)){if(e.font=_f(r),e.textAlign=r.align||"left",a=ua(r),o=a.x1,f=a.y1,r.angle&&(e.save(),e.translate(o,f),e.rotate(r.angle*Nt),o=f=0),o+=r.dx||0,f+=(r.dy||0)+vf(r),l=sa(r),Nn(e,r),Z(l))for(c=En(r),s=0;s<l.length;++s)u=Rt(r,l[s]),r.fill&&Bi(e,r,i)&&e.fillText(u,o,f),r.stroke&&Rn(e,r,i)&&e.strokeText(u,o,f),f+=c;else u=Rt(r,l),r.fill&&Bi(e,r,i)&&e.fillText(u,o,f),r.stroke&&Rn(e,r,i)&&e.strokeText(u,o,f);r.angle&&e.restore()}})}function ug(e,t,n,r,i,a){if(t.fontSize<=0)return!1;if(!t.angle)return!0;var o=ua(t),f=o.x1,s=o.y1,c=xf(wr,t,1),l=-t.angle*Nt,u=Math.cos(l),h=Math.sin(l),d=u*i-h*a+(f-u*f+h*s),b=h*i+u*a+(s-h*f-u*s);return c.contains(d,b)}function lg(e,t){let n=xf(wr,e,2);return vr(t,n[0],n[1],n[2],n[3])||vr(t,n[0],n[1],n[4],n[5])||vr(t,n[4],n[5],n[6],n[7])||vr(t,n[2],n[3],n[6],n[7])}var hg={type:"text",tag:"text",nested:!1,attr:sg,bound:xf,draw:cg,pick:aa(ug),isect:lg},dg=pf("trail",cb,Tb),Et={arc:wb,area:Sb,group:Fb,image:Bb,line:Hb,path:jb,rect:Qb,rule:tg,shape:ng,symbol:rg,text:hg,trail:dg};function tn(e,t,n){return!e&&typeof document<"u"&&document.createElement&&(e=document),e?n?e.createElementNS(n,t):e.createElement(t):null}function Pl(e,t){t=t.toLowerCase();for(var n=e.childNodes,r=0,i=n.length;r<i;++r)if(n[r].tagName.toLowerCase()===t)return n[r]}function re(e,t,n,r){var i=e.childNodes[t],a;return(!i||i.tagName.toLowerCase()!==n.toLowerCase())&&(a=i||null,i=tn(e.ownerDocument,n,r),e.insertBefore(i,a)),i}function Be(e,t){for(var n=e.childNodes,r=n.length;r>t;)e.removeChild(n[--r]);return e}function Ol(e){return"mark-"+e.marktype+(e.role?" role-"+e.role:"")+(e.name?" "+e.name:"")}function Il(e,t){if(t.getScreenCTM){let n=pg(e,t.getScreenCTM());if(n)return n}return bg(e,t,t.getBoundingClientRect())}function pg(e,t){if(!t)return null;let n=t.a*t.d-t.b*t.c;if(!n)return null;let r=e.clientX-t.e,i=e.clientY-t.f;return[(t.d*r-t.c*i)/n,(t.a*i-t.b*r)/n]}function bg(e,t,n){let r=t.offsetWidth?n.width/t.offsetWidth:1,i=t.offsetHeight?n.height/t.offsetHeight:1;return[(e.clientX-n.left)/r-(t.clientLeft||0),(e.clientY-n.top)/i-(t.clientTop||0)]}function gg(e,t,n,r){var i=e&&e.mark,a,o;if(i&&(a=Et[i.marktype]).tip){for(o=Il(t,n),o[0]-=r[0],o[1]-=r[1];e=e.mark.group;)o[0]-=e.x||0,o[1]-=e.y||0;e=a.tip(i.items,o)}return e}var Wi=class{constructor(t,n){this._active=null,this._handlers={},this._loader=t||Uo(),this._tooltip=n||mg}initialize(t,n,r){return this._el=t,this._obj=r||null,this.origin(n)}element(){return this._el}canvas(){return this._el&&this._el.firstChild}origin(t){return arguments.length?(this._origin=t||[0,0],this):this._origin.slice()}scene(t){return arguments.length?(this._scene=t,this):this._scene}on(){}off(){}_handlerIndex(t,n,r){for(let i=t?t.length:0;--i>=0;)if(t[i].type===n&&(!r||t[i].handler===r))return i;return-1}handlers(t){let n=this._handlers,r=[];if(t)r.push(...n[this.eventName(t)]);else for(let i in n)r.push(...n[i]);return r}eventName(t){let n=t.indexOf(".");return n<0?t:t.slice(0,n)}handleHref(t,n,r){this._loader.sanitize(r,{context:"href"}).then(i=>{let a=new MouseEvent(t.type,t),o=tn(null,"a");for(let f in i)o.setAttribute(f,i[f]);o.dispatchEvent(a)}).catch(()=>{})}handleTooltip(t,n,r){if(n&&n.tooltip!=null){n=gg(n,t,this.canvas(),this._origin);let i=r&&n&&n.tooltip||null;this._tooltip.call(this._obj,this,t,n,i)}}getItemBoundingClientRect(t){let n=this.canvas();if(!n)return;let r=n.getBoundingClientRect(),i=this._origin,a=t.bounds,o=a.width(),f=a.height(),s=a.x1+i[0]+r.left,c=a.y1+i[1]+r.top;for(;t.mark&&(t=t.mark.group);)s+=t.x||0,c+=t.y||0;return{x:s,y:c,width:o,height:f,left:s,top:c,right:s+o,bottom:c+f}}};function mg(e,t,n,r){e.element().setAttribute("title",r||"")}var Dn=class{constructor(t){this._el=null,this._bgcolor=null,this._loader=new Go(t)}initialize(t,n,r,i,a){return this._el=t,this.resize(n,r,i,a)}element(){return this._el}canvas(){return this._el&&this._el.firstChild}background(t){return arguments.length===0?this._bgcolor:(this._bgcolor=t,this)}resize(t,n,r,i){return this._width=t,this._height=n,this._origin=r||[0,0],this._scale=i||1,this}dirty(){}render(t,n){let r=this;return r._call=function(){r._render(t,n)},r._call(),r._call=null,r}_render(){}renderAsync(t,n){let r=this.render(t,n);return this._ready?this._ready.then(()=>r):Promise.resolve(r)}_load(t,n){var r=this,i=r._loader[t](n);if(!r._ready){let a=r._call;r._ready=r._loader.ready().then(o=>{o&&a(),r._ready=null})}return i}sanitizeURL(t){return this._load("sanitizeURL",t)}loadImage(t){return this._load("loadImage",t)}},yg="keydown",_g="keypress",vg="keyup",Ll="dragenter",Fi="dragleave",Ul="dragover",Jo="pointerdown",xg="pointerup",Gi="pointermove",qi="pointerout",Fl="pointerover",Ko="mousedown",wg="mouseup",ql="mousemove",ji="mouseout",zl="mouseover",Xi="click",Mg="dblclick",kg="wheel",Yl="mousewheel",Vi="touchstart",Qi="touchmove",Zi="touchend",Tg=[yg,_g,vg,Ll,Fi,Ul,Jo,xg,Gi,qi,Fl,Ko,wg,ql,ji,zl,Xi,Mg,kg,Yl,Vi,Qi,Zi],ef=Gi,Mr=ji,tf=Xi,Ji=class extends Wi{constructor(t,n){super(t,n),this._down=null,this._touch=null,this._first=!0,this._events={},this.events=Tg,this.pointermove=fl([Gi,ql],[Fl,zl],[qi,ji]),this.dragover=fl([Ul],[Ll],[Fi]),this.pointerout=sl([qi,ji]),this.dragleave=sl([Fi])}initialize(t,n,r){return this._canvas=t&&Pl(t,"canvas"),[Xi,Ko,Jo,Gi,qi,Fi].forEach(i=>ol(this,i)),super.initialize(t,n,r)}canvas(){return this._canvas}context(){return this._canvas.getContext("2d")}DOMMouseScroll(t){this.fire(Yl,t)}pointerdown(t){this._down=this._active,this.fire(Jo,t)}mousedown(t){this._down=this._active,this.fire(Ko,t)}click(t){this._down===this._active&&(this.fire(Xi,t),this._down=null)}touchstart(t){this._touch=this.pickEvent(t.changedTouches[0]),this._first&&(this._active=this._touch,this._first=!1),this.fire(Vi,t,!0)}touchmove(t){this.fire(Qi,t,!0)}touchend(t){this.fire(Zi,t,!0),this._touch=null}fire(t,n,r){let i=r?this._touch:this._active,a=this._handlers[t];if(n.vegaType=t,t===tf&&i&&i.href?this.handleHref(n,i,i.href):(t===ef||t===Mr)&&this.handleTooltip(n,i,t!==Mr),a)for(let o=0,f=a.length;o<f;++o)a[o].handler.call(this._obj,n,i)}on(t,n){let r=this.eventName(t),i=this._handlers;return this._handlerIndex(i[r],t,n)<0&&(ol(this,t),(i[r]||(i[r]=[])).push({type:t,handler:n})),this}off(t,n){let r=this.eventName(t),i=this._handlers[r],a=this._handlerIndex(i,t,n);return a>=0&&i.splice(a,1),this}pickEvent(t){let n=Il(t,this._canvas),r=this._origin;return this.pick(this._scene,n[0],n[1],n[0]-r[0],n[1]-r[1])}pick(t,n,r,i,a){let o=this.context();return Et[t.marktype].pick.call(this,o,t,n,r,i,a)}},Sg=e=>e===Vi||e===Qi||e===Zi?[Vi,Qi,Zi]:[e];function ol(e,t){Sg(t).forEach(n=>Cg(e,n))}function Cg(e,t){let n=e.canvas();n&&!e._events[t]&&(e._events[t]=1,n.addEventListener(t,e[t]?r=>e[t](r):r=>e.fire(t,r)))}function xr(e,t,n){t.forEach(r=>e.fire(r,n))}function fl(e,t,n){return function(r){let i=this._active,a=this.pickEvent(r);a===i?xr(this,e,r):((!i||!i.exit)&&xr(this,n,r),this._active=a,xr(this,t,r),xr(this,e,r))}}function sl(e){return function(t){xr(this,e,t),this._active=null}}function Ag(){return typeof window<"u"&&window.devicePixelRatio||1}function Ng(e,t,n,r,i,a){let o=typeof HTMLElement<"u"&&e instanceof HTMLElement&&e.parentNode!=null,f=e.getContext("2d"),s=o?Ag():i;e.width=t*s,e.height=n*s;for(let c in a)f[c]=a[c];return o&&(e.style.width=t+"px",e.style.height=n+"px"),f.pixelRatio=s,f.setTransform(s,0,0,s,s*r[0],s*r[1]),e}var Cr=class extends Dn{constructor(t){super(t),this._options={},this._redraw=!1,this._dirty=new He,this._tempb=new He}initialize(t,n,r,i,a,o){return this._options=o||{},this._canvas=this._options.externalContext?null:Ni(1,1,this._options.type),t&&this._canvas&&(Be(t,0).appendChild(this._canvas),this._canvas.setAttribute("class","marks"),this._canvas.style.setProperty("vertical-align","bottom")),super.initialize(t,n,r,i,a)}resize(t,n,r,i){if(super.resize(t,n,r,i),this._canvas)Ng(this._canvas,this._width,this._height,this._origin,this._scale,this._options.context);else{let a=this._options.externalContext;a||B("CanvasRenderer is missing a valid canvas or context"),a.scale(this._scale,this._scale),a.translate(this._origin[0],this._origin[1])}return this._redraw=!0,this}canvas(){return this._canvas}context(){return this._options.externalContext||(this._canvas?this._canvas.getContext("2d"):null)}dirty(t){let n=this._tempb.clear().union(t.bounds),r=t.mark.group;for(;r;)n.translate(r.x||0,r.y||0),r=r.mark.group;this._dirty.union(n)}_render(t,n){let r=this.context(),i=this._origin,a=this._width,o=this._height,f=this._dirty,s=Rg(i,a,o);r.save();let c=this._redraw||f.empty()?(this._redraw=!1,s.expand(1)):Eg(r,s.intersect(f),i);return this.clear(-i[0],-i[1],a,o),this.draw(r,t,c,n),r.restore(),f.clear(),this}draw(t,n,r,i){if(n.marktype!=="group"&&i!=null&&!i.includes(n.marktype))return;let a=Et[n.marktype];n.clip&&Cb(t,n),a.draw.call(this,t,n,r,i),n.clip&&t.restore()}clear(t,n,r,i){let a=this._options,o=this.context();a.type!=="pdf"&&!a.externalContext&&o.clearRect(t,n,r,i),this._bgcolor!=null&&(o.fillStyle=this._bgcolor,o.fillRect(t,n,r,i))}},Rg=(e,t,n)=>new He().set(0,0,t,n).translate(-e[0],-e[1]);function Eg(e,t,n){return t.expand(1).round(),e.pixelRatio%1&&t.scale(e.pixelRatio).round().scale(1/e.pixelRatio),t.translate(-(n[0]%1),-(n[1]%1)),e.beginPath(),e.rect(t.x1,t.y1,t.width(),t.height()),e.clip(),t}var nf=class extends Wi{constructor(t,n){super(t,n);let r=this;r._hrefHandler=Ho(r,(i,a)=>{a&&a.href&&r.handleHref(i,a,a.href)}),r._tooltipHandler=Ho(r,(i,a)=>{r.handleTooltip(i,a,i.type!==Mr)})}initialize(t,n,r){let i=this._svg;return i&&(i.removeEventListener(tf,this._hrefHandler),i.removeEventListener(ef,this._tooltipHandler),i.removeEventListener(Mr,this._tooltipHandler)),this._svg=i=t&&Pl(t,"svg"),i&&(i.addEventListener(tf,this._hrefHandler),i.addEventListener(ef,this._tooltipHandler),i.addEventListener(Mr,this._tooltipHandler)),super.initialize(t,n,r)}canvas(){return this._svg}on(t,n){let r=this.eventName(t),i=this._handlers;if(this._handlerIndex(i[r],t,n)<0){let o={type:t,handler:n,listener:Ho(this,n)};(i[r]||(i[r]=[])).push(o),this._svg&&this._svg.addEventListener(r,o.listener)}return this}off(t,n){let r=this.eventName(t),i=this._handlers[r],a=this._handlerIndex(i,t,n);return a>=0&&(this._svg&&this._svg.removeEventListener(r,i[a].listener),i.splice(a,1)),this}},Ho=(e,t)=>n=>{let r=n.target.__data__;r=Array.isArray(r)?r[0]:r,n.vegaType=n.type,t.call(e._obj,n,r)},Bl="aria-hidden",wf="aria-label",Mf="role",kf="aria-roledescription",Hl="graphics-object",Tf="graphics-symbol",Wl=(e,t,n)=>({[Mf]:e,[kf]:t,[wf]:n||void 0}),Dg=dt(["axis-domain","axis-grid","axis-label","axis-tick","axis-title","legend-band","legend-entry","legend-gradient","legend-label","legend-title","legend-symbol","title"]),cl={axis:{desc:"axis",caption:Og},legend:{desc:"legend",caption:Ig},"title-text":{desc:"title",caption:e=>`Title text \'${ll(e)}\'`},"title-subtitle":{desc:"subtitle",caption:e=>`Subtitle text \'${ll(e)}\'`}},ul={ariaRole:Mf,ariaRoleDescription:kf,description:wf};function Gl(e,t){let n=t.aria===!1;if(e(Bl,n||void 0),n||t.description==null)for(let r in ul)e(ul[r],void 0);else{let r=t.mark.marktype;e(wf,t.description),e(Mf,t.ariaRole||(r==="group"?Hl:Tf)),e(kf,t.ariaRoleDescription||`${r} mark`)}}function jl(e){return e.aria===!1?{[Bl]:!0}:Dg[e.role]?null:cl[e.role]?Pg(e,cl[e.role]):$g(e)}function $g(e){let t=e.marktype,n=t==="group"||t==="text"||e.items.some(r=>r.description!=null&&r.aria!==!1);return Wl(n?Hl:Tf,`${t} mark container`,e.description)}function Pg(e,t){try{let n=e.items[0],r=t.caption||(()=>"");return Wl(t.role||Tf,t.desc,e.description||n.description||r(n))}catch{return null}}function ll(e){return We(e.text).join(" ")}function Og(e){let t=e.datum,n=e.orient,r=t.title?Xl(e):null,i=e.context,a=i.scales[t.scale].value,o=i.dataflow.locale(),f=a.type;return`${n==="left"||n==="right"?"Y":"X"}-axis`+(r?` titled \'${r}\'`:"")+` for a ${yo(f)?"discrete":f} scale with ${_o(o,a,e)}`}function Ig(e){let t=e.datum,n=t.title?Xl(e):null,r=`${t.type||""} legend`.trim(),i=t.scales,a=Object.keys(i),o=e.context,f=o.scales[i[a[0]]].value,s=o.dataflow.locale();return Ug(r)+(n?` titled \'${n}\'`:"")+` for ${Lg(a)} with ${_o(s,f,e)}`}function Xl(e){try{return We(ie(e.items).items[0].text).join(" ")}catch{return null}}function Lg(e){return e=e.map(t=>t+(t==="fill"||t==="stroke"?" color":"")),e.length<2?e[0]:e.slice(0,-1).join(", ")+" and "+ie(e)}function Ug(e){return e.length?e[0].toUpperCase()+e.slice(1):e}var Vl=e=>(e+"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"),Fg=e=>Vl(e).replace(/"/g,"&quot;").replace(/\\t/g,"&#x9;").replace(/\\n/g,"&#xA;").replace(/\\r/g,"&#xD;");function Ql(){let e="",t="",n="",r=[],i=()=>t=n="",a=s=>{t&&(e+=`${t}>${n}`,i()),r.push(s)},o=(s,c)=>(c!=null&&(t+=` ${s}="${Fg(c)}"`),f),f={open(s,...c){a(s),t="<"+s;for(let l of c)for(let u in l)o(u,l[u]);return f},close(){let s=r.pop();return t?e+=t+(n?`>${n}</${s}>`:"/>"):e+=`</${s}>`,i(),f},attr:o,text:s=>(n+=Vl(s),f),toString:()=>e};return f}var qg=e=>Zl(Ql(),e)+"";function Zl(e,t){if(e.open(t.tagName),t.hasAttributes()){let n=t.attributes,r=n.length;for(let i=0;i<r;++i)e.attr(n[i].name,n[i].value)}if(t.hasChildNodes()){let n=t.childNodes;for(let r of n)r.nodeType===3?e.text(r.nodeValue):Zl(e,r)}return e.close()}var Ki={fill:"fill",fillOpacity:"fill-opacity",stroke:"stroke",strokeOpacity:"stroke-opacity",strokeWidth:"stroke-width",strokeCap:"stroke-linecap",strokeJoin:"stroke-linejoin",strokeDash:"stroke-dasharray",strokeDashOffset:"stroke-dashoffset",strokeMiterLimit:"stroke-miterlimit",opacity:"opacity"},ea={blend:"mix-blend-mode"},Jl={fill:"none","stroke-miterlimit":4},_r=0,hl="http://www.w3.org/2000/xmlns/",V=Sr.xmlns,ta=class extends Dn{constructor(t){super(t),this._dirtyID=0,this._dirty=[],this._svg=null,this._root=null,this._defs=null}initialize(t,n,r,i,a){return this._defs={},this._clearDefs(),t&&(this._svg=re(t,0,"svg",V),this._svg.setAttributeNS(hl,"xmlns",V),this._svg.setAttributeNS(hl,"xmlns:xlink",Sr["xmlns:xlink"]),this._svg.setAttribute("version",Sr.version),this._svg.setAttribute("class","marks"),this._svg.style.setProperty("vertical-align","bottom"),Be(t,1),this._root=re(this._svg,_r,"g",V),Ct(this._root,Jl),Be(this._svg,_r+1)),this.background(this._bgcolor),super.initialize(t,n,r,i,a)}background(t){return arguments.length&&this._svg&&this._svg.style.setProperty("background-color",t),super.background(...arguments)}resize(t,n,r,i){return super.resize(t,n,r,i),this._svg&&(Ct(this._svg,{width:this._width*this._scale,height:this._height*this._scale,viewBox:`0 0 ${this._width} ${this._height}`}),this._root.setAttribute("transform",`translate(${this._origin})`)),this._dirty=[],this}canvas(){return this._svg}svg(){let t=this._svg,n=this._bgcolor;if(!t)return null;let r=t.getAttribute("style");t.removeAttribute("style");let i;n&&(i=re(t,_r,"rect",V),Ct(i,{width:this._width,height:this._height,fill:n}));let a=qg(t);return n&&t.removeChild(i),r&&t.setAttribute("style",r),a}_render(t,n){return this._dirtyCheck()&&(this._dirtyAll&&this._clearDefs(),this.mark(this._root,t,void 0,n),Be(this._root,1)),this.defs(),this._dirty=[],++this._dirtyID,this}dirty(t){t.dirty!==this._dirtyID&&(t.dirty=this._dirtyID,this._dirty.push(t))}isDirty(t){return this._dirtyAll||!t._svg||!t._svg.ownerSVGElement||t.dirty===this._dirtyID}_dirtyCheck(){this._dirtyAll=!0;let t=this._dirty;if(!t.length||!this._dirtyID)return!0;let n=++this._dirtyID,r,i,a,o,f,s,c;for(f=0,s=t.length;f<s;++f)if(r=t[f],i=r.mark,i.marktype!==a&&(a=i.marktype,o=Et[a]),i.zdirty&&i.dirty!==n&&(this._dirtyAll=!1,dl(r,n),i.items.forEach(l=>{l.dirty=n})),!i.zdirty){if(r.exit){o.nested&&i.items.length?(c=i.items[0],c._svg&&this._update(o,c._svg,c)):r._svg&&(c=r._svg.parentNode,c&&c.removeChild(r._svg)),r._svg=null;continue}r=o.nested?i.items[0]:r,r._update!==n&&(!r._svg||!r._svg.ownerSVGElement?(this._dirtyAll=!1,dl(r,n)):this._update(o,r._svg,r),r._update=n)}return!this._dirtyAll}mark(t,n,r,i){if(!this.isDirty(n))return n._svg;let a=this._svg,o=n.marktype,f=Et[o],s=n.interactive===!1?"none":null,c=f.tag==="g",l=pl(n,t,r,"g",a);if(o!=="group"&&i!=null&&!i.includes(o))return Be(l,0),n._svg;l.setAttribute("class",Ol(n));let u=jl(n);for(let p in u)de(l,p,u[p]);c||de(l,"pointer-events",s),de(l,"clip-path",n.clip?sf(this,n,n.group):null);let h=null,d=0,b=p=>{let g=this.isDirty(p),m=pl(p,l,h,f.tag,a);g&&(this._update(f,m,p),c&&Bg(this,m,p,i)),h=m,++d};return f.nested?n.items.length&&b(n.items[0]):et(n,b),Be(l,d),l}_update(t,n,r){lt=n,ue=n.__values__,Gl(kr,r),t.attr(kr,r,this);let i=Wg[t.type];i&&i.call(this,t,n,r),lt&&this.style(lt,r)}style(t,n){if(n!=null){for(let r in Ki){let i=r==="font"?ca(n):n[r];if(i===ue[r])continue;let a=Ki[r];i==null?t.removeAttribute(a):(of(i)&&(i=bl(i,this._defs.gradient,Kl())),t.setAttribute(a,i+"")),ue[r]=i}for(let r in ea)zi(t,ea[r],n[r])}}defs(){let t=this._svg,n=this._defs,r=n.el,i=0;for(let a in n.gradient)r||(n.el=r=re(t,_r+1,"defs",V)),i=zg(r,n.gradient[a],i);for(let a in n.clipping)r||(n.el=r=re(t,_r+1,"defs",V)),i=Yg(r,n.clipping[a],i);r&&(i===0?(t.removeChild(r),n.el=null):Be(r,i))}_clearDefs(){let t=this._defs;t.gradient={},t.clipping={}}};function dl(e,t){for(;e&&e.dirty!==t;e=e.mark.group)if(e.dirty=t,e.mark&&e.mark.dirty!==t)e.mark.dirty=t;else return}function zg(e,t,n){let r,i,a;if(t.gradient==="radial"){let o=re(e,n++,"pattern",V);Ct(o,{id:Yi+t.id,viewBox:"0,0,1,1",width:"100%",height:"100%",preserveAspectRatio:"xMidYMid slice"}),o=re(o,0,"rect",V),Ct(o,{width:1,height:1,fill:`url(${Kl()}#${t.id})`}),e=re(e,n++,"radialGradient",V),Ct(e,{id:t.id,fx:t.x1,fy:t.y1,fr:t.r1,cx:t.x2,cy:t.y2,r:t.r2})}else e=re(e,n++,"linearGradient",V),Ct(e,{id:t.id,x1:t.x1,x2:t.x2,y1:t.y1,y2:t.y2});for(r=0,i=t.stops.length;r<i;++r)a=re(e,r,"stop",V),a.setAttribute("offset",t.stops[r].offset),a.setAttribute("stop-color",t.stops[r].color);return Be(e,r),n}function Yg(e,t,n){let r;return e=re(e,n,"clipPath",V),e.setAttribute("id",t.id),t.path?(r=re(e,0,"path",V),r.setAttribute("d",t.path)):(r=re(e,0,"rect",V),Ct(r,{x:0,y:0,width:t.width,height:t.height})),Be(e,1),n+1}function Bg(e,t,n,r){t=t.lastChild.previousSibling;let i,a=0;et(n,o=>{i=e.mark(t,o,i,r),++a}),Be(t,1+a)}function pl(e,t,n,r,i){let a=e._svg,o;if(!a&&(o=t.ownerDocument,a=tn(o,r,V),e._svg=a,e.mark&&(a.__data__=e,a.__values__={fill:"default"},r==="g"))){let f=tn(o,"path",V);a.appendChild(f),f.__data__=e;let s=tn(o,"g",V);a.appendChild(s),s.__data__=e;let c=tn(o,"path",V);a.appendChild(c),c.__data__=e,c.__values__={fill:"default"}}return(a.ownerSVGElement!==i||Hg(a,n))&&t.insertBefore(a,n?n.nextSibling:t.firstChild),a}function Hg(e,t){return e.parentNode&&e.parentNode.childNodes.length>1&&e.previousSibling!=t}var lt=null,ue=null,Wg={group(e,t,n){let r=lt=t.childNodes[2];ue=r.__values__,e.foreground(kr,n,this),ue=t.__values__,lt=t.childNodes[1],e.content(kr,n,this);let i=lt=t.childNodes[0];e.background(kr,n,this);let a=n.mark.interactive===!1?"none":null;if(a!==ue.events&&(de(r,"pointer-events",a),de(i,"pointer-events",a),ue.events=a),n.strokeForeground&&n.stroke){let o=n.fill;de(r,"display",null),this.style(i,n),de(i,"stroke",null),o&&(n.fill=null),ue=r.__values__,this.style(r,n),o&&(n.fill=o),lt=null}else de(r,"display","none")},image(e,t,n){n.smooth===!1?(zi(t,"image-rendering","optimizeSpeed"),zi(t,"image-rendering","pixelated")):zi(t,"image-rendering",null)},text(e,t,n){let r=sa(n),i,a,o,f;Z(r)?(a=r.map(s=>Rt(n,s)),i=a.join(`\n`),i!==ue.text&&(Be(t,0),o=t.ownerDocument,f=En(n),a.forEach((s,c)=>{let l=tn(o,"tspan",V);l.__data__=n,l.textContent=s,c&&(l.setAttribute("x",0),l.setAttribute("dy",f)),t.appendChild(l)}),ue.text=i)):(a=Rt(n,r),a!==ue.text&&(t.textContent=a,ue.text=a)),de(t,"font-family",ca(n)),de(t,"font-size",ht(n)+"px"),de(t,"font-style",n.fontStyle),de(t,"font-variant",n.fontVariant),de(t,"font-weight",n.fontWeight)}};function kr(e,t,n){t!==ue[e]&&(n?Gg(lt,e,t,n):de(lt,e,t),ue[e]=t)}function zi(e,t,n){n!==ue[t]&&(n==null?e.style.removeProperty(t):e.style.setProperty(t,n+""),ue[t]=n)}function Ct(e,t){for(let n in t)de(e,n,t[n])}function de(e,t,n){n!=null?e.setAttribute(t,n):e.removeAttribute(t)}function Gg(e,t,n,r){n!=null?e.setAttributeNS(r,t,n):e.removeAttributeNS(r,t)}function Kl(){let e;return typeof window>"u"?"":(e=window.location).hash?e.href.slice(0,-e.hash.length):e.href}var rf=class extends Dn{constructor(t){super(t),this._text=null,this._defs={gradient:{},clipping:{}}}svg(){return this._text}_render(t){let n=Ql();n.open("svg",$e({},Sr,{class:"marks",width:this._width*this._scale,height:this._height*this._scale,viewBox:`0 0 ${this._width} ${this._height}`}));let r=this._bgcolor;return r&&r!=="transparent"&&r!=="none"&&n.open("rect",{width:this._width,height:this._height,fill:r}).close(),n.open("g",Jl,{transform:"translate("+this._origin+")"}),this.mark(n,t),n.close(),this.defs(n),this._text=n.close()+"",this}mark(t,n){let r=Et[n.marktype],i=r.tag,a=[Gl,r.attr];t.open("g",{class:Ol(n),"clip-path":n.clip?sf(this,n,n.group):null},jl(n),{"pointer-events":i!=="g"&&n.interactive===!1?"none":null});let o=f=>{let s=this.href(f);if(s&&t.open("a",s),t.open(i,this.attr(n,f,a,i!=="g"?i:null)),i==="text"){let c=sa(f);if(Z(c)){let l={x:0,dy:En(f)};for(let u=0;u<c.length;++u)t.open("tspan",u?l:null).text(Rt(f,c[u])).close()}else t.text(Rt(f,c))}else if(i==="g"){let c=f.strokeForeground,l=f.fill,u=f.stroke;c&&u&&(f.stroke=null),t.open("path",this.attr(n,f,r.background,"bgrect")).close(),t.open("g",this.attr(n,f,r.content)),et(f,h=>this.mark(t,h)),t.close(),c&&u?(l&&(f.fill=null),f.stroke=u,t.open("path",this.attr(n,f,r.foreground,"bgrect")).close(),l&&(f.fill=l)):t.open("path",this.attr(n,f,r.foreground,"bgfore")).close()}t.close(),s&&t.close()};return r.nested?n.items&&n.items.length&&o(n.items[0]):et(n,o),t.close()}href(t){let n=t.href,r;if(n){if(r=this._hrefs&&this._hrefs[n])return r;this.sanitizeURL(n).then(i=>{i["xlink:href"]=i.href,i.href=null,(this._hrefs||(this._hrefs={}))[n]=i})}return null}attr(t,n,r,i){let a={},o=(f,s,c,l)=>{a[l||f]=s};return Array.isArray(r)?r.forEach(f=>f(o,n,this)):r(o,n,this),i&&jg(a,n,t,i,this._defs),a}defs(t){let n=this._defs.gradient,r=this._defs.clipping;if(Object.keys(n).length+Object.keys(r).length!==0){t.open("defs");for(let a in n){let o=n[a],f=o.stops;o.gradient==="radial"?(t.open("pattern",{id:Yi+a,viewBox:"0,0,1,1",width:"100%",height:"100%",preserveAspectRatio:"xMidYMid slice"}),t.open("rect",{width:"1",height:"1",fill:"url(#"+a+")"}).close(),t.close(),t.open("radialGradient",{id:a,fx:o.x1,fy:o.y1,fr:o.r1,cx:o.x2,cy:o.y2,r:o.r2})):t.open("linearGradient",{id:a,x1:o.x1,x2:o.x2,y1:o.y1,y2:o.y2});for(let s=0;s<f.length;++s)t.open("stop",{offset:f[s].offset,"stop-color":f[s].color}).close();t.close()}for(let a in r){let o=r[a];t.open("clipPath",{id:a}),o.path?t.open("path",{d:o.path}).close():t.open("rect",{x:0,y:0,width:o.width,height:o.height}).close(),t.close()}t.close()}}};function jg(e,t,n,r,i){let a;if(t==null||(r==="bgrect"&&n.interactive===!1&&(e["pointer-events"]="none"),r==="bgfore"&&(n.interactive===!1&&(e["pointer-events"]="none"),e.display="none",t.fill!==null)))return e;r==="image"&&t.smooth===!1&&(a=["image-rendering: optimizeSpeed;","image-rendering: pixelated;"]),r==="text"&&(e["font-family"]=ca(t),e["font-size"]=ht(t)+"px",e["font-style"]=t.fontStyle,e["font-variant"]=t.fontVariant,e["font-weight"]=t.fontWeight);for(let o in Ki){let f=t[o],s=Ki[o];f==="transparent"&&(s==="fill"||s==="stroke")||f!=null&&(of(f)&&(f=bl(f,i.gradient,"")),e[s]=f)}for(let o in ea){let f=t[o];f!=null&&(a=a||[],a.push(`${ea[o]}: ${f};`))}return a&&(e.style=a.join(" ")),e}var Tt={svgMarkTypes:["text"],svgOnTop:!0,debug:!1};var na=class extends Dn{constructor(t){super(t),this._svgRenderer=new ta(t),this._canvasRenderer=new Cr(t)}initialize(t,n,r,i,a){this._root_el=re(t,0,"div");let o=re(this._root_el,0,"div"),f=re(this._root_el,1,"div");return this._root_el.style.position="relative",Tt.debug||(o.style.height="100%",f.style.position="absolute",f.style.top="0",f.style.left="0",f.style.height="100%",f.style.width="100%"),this._svgEl=Tt.svgOnTop?f:o,this._canvasEl=Tt.svgOnTop?o:f,this._svgEl.style.pointerEvents="none",this._canvasRenderer.initialize(this._canvasEl,n,r,i,a),this._svgRenderer.initialize(this._svgEl,n,r,i,a),super.initialize(t,n,r,i,a)}dirty(t){return Tt.svgMarkTypes.includes(t.mark.marktype)?this._svgRenderer.dirty(t):this._canvasRenderer.dirty(t),this}_render(t,n){let i=(n??["arc","area","image","line","path","rect","rule","shape","symbol","text","trail"]).filter(a=>!Tt.svgMarkTypes.includes(a));this._svgRenderer.render(t,Tt.svgMarkTypes),this._canvasRenderer.render(t,i)}resize(t,n,r,i){return super.resize(t,n,r,i),this._svgRenderer.resize(t,n,r,i),this._canvasRenderer.resize(t,n,r,i),this}background(t){return Tt.svgOnTop?this._canvasRenderer.background(t):this._svgRenderer.background(t),this}},af=class extends Ji{constructor(t,n){super(t,n)}initialize(t,n,r){let i=re(re(t,0,"div"),Tt.svgOnTop?0:1,"div");return super.initialize(i,n,r)}},Xg="canvas",Vg="hybrid",Qg="png",Zg="svg",Jg="none";var Ar={};Ar[Xg]=Ar[Qg]={renderer:Cr,headless:Cr,handler:Ji};Ar[Zg]={renderer:ta,headless:rf,handler:nf};Ar[Vg]={renderer:na,headless:na,handler:af};Ar[Jg]={};var U4=new He;var Kg=Math.sqrt(2*Math.PI);function e0(e,t,n){n=n??1;let r=(e-(t||0))/n;return Math.exp(-.5*r*r)/(n*Kg)}function t0(e,t,n){t=t||0,n=n??1;let r=(e-t)/n,i=Math.abs(r),a;if(i>37)a=0;else{let o=Math.exp(-i*i/2),f;i<7.07106781186547?(f=.0352624965998911*i+.700383064443688,f=f*i+6.37396220353165,f=f*i+33.912866078383,f=f*i+112.079291497871,f=f*i+221.213596169931,f=f*i+220.206867912376,a=o*f,f=.0883883476483184*i+1.75566716318264,f=f*i+16.064177579207,f=f*i+86.7807322029461,f=f*i+296.564248779674,f=f*i+637.333633378831,f=f*i+793.826512519948,f=f*i+440.413735824752,a=a/f):(f=i+.65,f=i+4/f,f=i+3/f,f=i+2/f,f=i+1/f,a=o/f/2.506628274631)}return r>0?1-a:a}var q4=.5*Math.PI/180;function n0(e,t){let n=e(t.type);if(!n)throw new Error("scale type "+t.type);let r=n();for(let[i,a]of t.props)typeof r[i]=="function"&&r[i](a);return r.domain(t.domain),r.range(t.range),r}var r0={timeunit(e,t,n){let r=Tc(e),i=(n?Oc:Pc)(r,t),a=(n?sr:fr)(r[r.length-1]).offset;return{floor:i,offset:a}}};var em={...r0,scale:e=>n0(O,e),symbol:Et.symbol,Bounds:He,densityNormal:e0,cumulativeNormal:t0};return s0(tm);})();\n';
var WORKER_LIBRARY_V5 = '"use strict";var __pwlib=(()=>{var aa=Object.defineProperty;var e0=Object.getOwnPropertyDescriptor;var t0=Object.getOwnPropertyNames;var n0=Object.prototype.hasOwnProperty;var Tf=(e,t)=>{for(var n in t)aa(e,n,{get:t[n],enumerable:!0})},r0=(e,t,n,r)=>{if(t&&typeof t=="object"||typeof t=="function")for(let i of t0(t))!n0.call(e,i)&&i!==n&&aa(e,i,{get:()=>t[i],enumerable:!(r=e0(t,i))||r.enumerable});return e};var i0=e=>r0(aa({},"__esModule",{value:!0}),e);var Vp={};Tf(Vp,{lib:()=>Xp});function Qt(e,t,n){return e.fields=t||[],e.fname=n,e}function a0(e){return e.length===1?o0(e[0]):f0(e)}var o0=e=>function(t){return t[e]},f0=e=>{let t=e.length;return function(n){for(let r=0;r<t;++r)n=n[e[r]];return n}};function B(e){throw Error(e)}function s0(e){let t=[],n=e.length,r=null,i=0,a="",o,f,s;e=e+"";function c(){t.push(a+e.substring(o,f)),a="",o=f+1}for(o=f=0;f<n;++f)if(s=e[f],s==="\\\\")a+=e.substring(o,f++),o=f;else if(s===r)c(),r=null,i=-1;else{if(r)continue;o===i&&s===\'"\'||o===i&&s==="\'"?(o=f+1,r=s):s==="."&&!i?f>o?c():o=f+1:s==="["?(f>o&&c(),i=o=f+1):s==="]"&&(i||B("Access path missing open bracket: "+e),i>0&&c(),i=0,o=f+1)}return i&&B("Access path missing closing bracket: "+e),r&&B("Access path missing closing quote: "+e),f>o&&(f++,c()),t}function oa(e,t,n){let r=s0(e);return e=r.length===1?r[0]:e,Qt((n&&n.get||a0)(r),[e],t||e)}var Qp=oa("id"),Sf=Qt(e=>e,[],"identity"),Jt=Qt(()=>0,[],"zero"),Cf=Qt(()=>1,[],"one"),fa=Qt(()=>!0,[],"true"),Jp=Qt(()=>!1,[],"false"),Kp=new Set(Object.getOwnPropertyNames(Object.prototype));var se=Array.isArray;function Mt(e){return e===Object(e)}function Ee(e){return e[e.length-1]}function sa(e){return e==null||e===""?null:+e}function kt(e){return e!=null?se(e)?e:[e]:[]}function it(e){return typeof e=="function"}function ca(e){return it(e)?e:()=>e}function je(e){for(let t,n,r=1,i=arguments.length;r<i;++r){t=arguments[r];for(n in t)e[n]=t[n]}return e}function me(e,t){return Object.hasOwn(e,t)}function Af(e,t,n){let r=e.prototype=Object.create(t.prototype);return Object.defineProperty(r,"constructor",{value:e,writable:!0,enumerable:!0,configurable:!0}),je(r,n)}function Nf(e){return e&&it(e[Symbol.iterator])}function Kt(e){return typeof e=="string"}var c0=1e4;function Rf(e){e=+e||c0;let t,n,r,i=()=>{t={},n={},r=0},a=(o,f)=>(++r>e&&(n=t,t={},r=1),t[o]=f);return i(),{clear:i,has:o=>me(t,o)||me(n,o),get:o=>me(t,o)?t[o]:me(n,o)?a(o,n[o]):void 0,set:(o,f)=>me(t,o)?t[o]=f:a(o,f)}}function Rr(e){return se(e)?"["+e.map(Rr)+"]":Mt(e)||Kt(e)?JSON.stringify(e).replace("\\u2028","\\\\u2028").replace("\\u2029","\\\\u2029"):e}function en(e){let t={},n=e.length;for(let r=0;r<n;++r)t[e[r]]=!0;return t}function Tt(e,t){return e==null||t==null?NaN:e<t?-1:e>t?1:e>=t?0:NaN}function ua(e,t){return e==null||t==null?NaN:t<e?-1:t>e?1:t>=e?0:NaN}function $r(e){let t,n,r;e.length!==2?(t=Tt,n=(f,s)=>Tt(e(f),s),r=(f,s)=>e(f)-s):(t=e===Tt||e===ua?e:u0,n=e,r=e);function i(f,s,c=0,l=f.length){if(c<l){if(t(s,s)!==0)return l;do{let u=c+l>>>1;n(f[u],s)<0?c=u+1:l=u}while(c<l)}return c}function a(f,s,c=0,l=f.length){if(c<l){if(t(s,s)!==0)return l;do{let u=c+l>>>1;n(f[u],s)<=0?c=u+1:l=u}while(c<l)}return c}function o(f,s,c=0,l=f.length){let u=i(f,s,c,l-1);return u>c&&r(f[u-1],s)>-r(f[u],s)?u-1:u}return{left:i,center:o,right:a}}function u0(){return 0}function la(e){return e===null?NaN:+e}var $f=$r(Tt),Dn=$f.right,l0=$f.left,h0=$r(la).center,ha=Dn;var d0=Math.sqrt(50),b0=Math.sqrt(10),g0=Math.sqrt(2);function Ef(e,t,n){let r=(t-e)/Math.max(0,n),i=Math.floor(Math.log10(r)),a=r/Math.pow(10,i),o=a>=d0?10:a>=b0?5:a>=g0?2:1,f,s,c;return i<0?(c=Math.pow(10,-i)/o,f=Math.round(e*c),s=Math.round(t*c),f/c<e&&++f,s/c>t&&--s,c=-c):(c=Math.pow(10,i)*o,f=Math.round(e/c),s=Math.round(t/c),f*c<e&&++f,s*c>t&&--s),s<f&&.5<=n&&n<2?Ef(e,t,n*2):[f,s,c]}function da(e,t,n){return t=+t,e=+e,n=+n,Ef(e,t,n)[2]}function ba(e,t,n){t=+t,e=+e,n=+n;let r=t<e,i=r?da(t,e,n):da(e,t,n);return(r?-1:1)*(i<0?1/-i:i)}function Er(e,t,n){e=+e,t=+t,n=(i=arguments.length)<2?(t=e,e=0,1):i<3?1:+n;for(var r=-1,i=Math.max(0,Math.ceil((t-e)/n))|0,a=new Array(i);++r<i;)a[r]=e+r*n;return a}function rn(e,t){return e==null||t==null?NaN:e<t?-1:e>t?1:e>=t?0:NaN}function p0(e,t){return e==null||t==null?NaN:t<e?-1:t>e?1:t>=e?0:NaN}function Or(e){let t,n,r;e.length!==2?(t=rn,n=(f,s)=>rn(e(f),s),r=(f,s)=>e(f)-s):(t=e===rn||e===p0?e:m0,n=e,r=e);function i(f,s,c=0,l=f.length){if(c<l){if(t(s,s)!==0)return l;do{let u=c+l>>>1;n(f[u],s)<0?c=u+1:l=u}while(c<l)}return c}function a(f,s,c=0,l=f.length){if(c<l){if(t(s,s)!==0)return l;do{let u=c+l>>>1;n(f[u],s)<=0?c=u+1:l=u}while(c<l)}return c}function o(f,s,c=0,l=f.length){let u=i(f,s,c,l-1);return u>c&&r(f[u-1],s)>-r(f[u],s)?u-1:u}return{left:i,center:o,right:a}}function m0(){return 0}function Pf(e){return e===null?NaN:+e}var Of=Or(rn),On=Of.right,ym=Of.left,_m=Or(Pf).center;var vm=If(Lf),xm=If(y0);function If(e){return function(t,n,r=n){if(!((n=+n)>=0))throw new RangeError("invalid rx");if(!((r=+r)>=0))throw new RangeError("invalid ry");let{data:i,width:a,height:o}=t;if(!((a=Math.floor(a))>=0))throw new RangeError("invalid width");if(!((o=Math.floor(o!==void 0?o:i.length/a))>=0))throw new RangeError("invalid height");if(!a||!o||!n&&!r)return t;let f=n&&e(n),s=r&&e(r),c=i.slice();return f&&s?(tn(f,c,i,a,o),tn(f,i,c,a,o),tn(f,c,i,a,o),nn(s,i,c,a,o),nn(s,c,i,a,o),nn(s,i,c,a,o)):f?(tn(f,i,c,a,o),tn(f,c,i,a,o),tn(f,i,c,a,o)):s&&(nn(s,i,c,a,o),nn(s,c,i,a,o),nn(s,i,c,a,o)),t}}function tn(e,t,n,r,i){for(let a=0,o=r*i;a<o;)e(t,n,a,a+=r,1)}function nn(e,t,n,r,i){for(let a=0,o=r*i;a<r;++a)e(t,n,a,a+o,r)}function y0(e){let t=Lf(e);return(n,r,i,a,o)=>{i<<=2,a<<=2,o<<=2,t(n,r,i+0,a+0,o),t(n,r,i+1,a+1,o),t(n,r,i+2,a+2,o),t(n,r,i+3,a+3,o)}}function Lf(e){let t=Math.floor(e);if(t===e)return _0(e);let n=e-t,r=2*e+1;return(i,a,o,f,s)=>{if(!((f-=s)>=o))return;let c=t*a[o],l=s*t,u=l+s;for(let h=o,d=o+l;h<d;h+=s)c+=a[Math.min(f,h)];for(let h=o,d=f;h<=d;h+=s)c+=a[Math.min(f,h+l)],i[h]=(c+n*(a[Math.max(o,h-u)]+a[Math.min(f,h+u)]))/r,c-=a[Math.max(o,h-l)]}}function _0(e){let t=2*e+1;return(n,r,i,a,o)=>{if(!((a-=o)>=i))return;let f=e*r[i],s=o*e;for(let c=i,l=i+s;c<l;c+=o)f+=r[Math.min(a,c)];for(let c=i,l=a;c<=l;c+=o)f+=r[Math.min(a,c+s)],n[c]=f/t,f-=r[Math.max(i,c-s)]}}var Pn=class extends Map{constructor(t,n=w0){if(super(),Object.defineProperties(this,{_intern:{value:new Map},_key:{value:n}}),t!=null)for(let[r,i]of t)this.set(r,i)}get(t){return super.get(Df(this,t))}has(t){return super.has(Df(this,t))}set(t,n){return super.set(v0(this,t),n)}delete(t){return super.delete(x0(this,t))}};function Df({_intern:e,_key:t},n){let r=t(n);return e.has(r)?e.get(r):n}function v0({_intern:e,_key:t},n){let r=t(n);return e.has(r)?e.get(r):(e.set(r,n),n)}function x0({_intern:e,_key:t},n){let r=t(n);return e.has(r)&&(n=e.get(r),e.delete(r)),n}function w0(e){return e!==null&&typeof e=="object"?e.valueOf():e}var M0=Array.prototype,wm=M0.slice;var k0=Math.sqrt(50),T0=Math.sqrt(10),S0=Math.sqrt(2);function Dr(e,t,n){let r=(t-e)/Math.max(0,n),i=Math.floor(Math.log10(r)),a=r/Math.pow(10,i),o=a>=k0?10:a>=T0?5:a>=S0?2:1,f,s,c;return i<0?(c=Math.pow(10,-i)/o,f=Math.round(e*c),s=Math.round(t*c),f/c<e&&++f,s/c>t&&--s,c=-c):(c=Math.pow(10,i)*o,f=Math.round(e/c),s=Math.round(t/c),f*c<e&&++f,s*c>t&&--s),s<f&&.5<=n&&n<2?Dr(e,t,n*2):[f,s,c]}function Ir(e,t,n){if(t=+t,e=+e,n=+n,!(n>0))return[];if(e===t)return[e];let r=t<e,[i,a,o]=r?Dr(t,e,n):Dr(e,t,n);if(!(a>=i))return[];let f=a-i+1,s=new Array(f);if(r)if(o<0)for(let c=0;c<f;++c)s[c]=(a-c)/-o;else for(let c=0;c<f;++c)s[c]=(a-c)*o;else if(o<0)for(let c=0;c<f;++c)s[c]=(i+c)/-o;else for(let c=0;c<f;++c)s[c]=(i+c)*o;return s}function Pr(e,t,n){return t=+t,e=+e,n=+n,Dr(e,t,n)[2]}function In(e,t,n){t=+t,e=+e,n=+n;let r=t<e,i=r?Pr(t,e,n):Pr(e,t,n);return(r?-1:1)*(i<0?1/-i:i)}function Uf(e,t,n=Pf){if(!(!(r=e.length)||isNaN(t=+t))){if(t<=0||r<2)return+n(e[0],0,e);if(t>=1)return+n(e[r-1],r-1,e);var r,i=(r-1)*t,a=Math.floor(i),o=+n(e[a],a,e),f=+n(e[a+1],a+1,e);return o+(f-o)*(i-a)}}var Mm=C0(Math.random);function C0(e){return function(n,r=0,i=n.length){let a=i-(r=+r);for(;a;){let o=e()*a--|0,f=n[a+r];n[a+r]=n[o+r],n[o+r]=f}return n}}var Na={};Tf(Na,{interpolate:()=>ot,interpolateArray:()=>H0,interpolateBasis:()=>us,interpolateBasisClosed:()=>ls,interpolateCubehelix:()=>sh,interpolateCubehelixLong:()=>zn,interpolateDate:()=>ps,interpolateDiscrete:()=>W0,interpolateHcl:()=>oh,interpolateHclLong:()=>fh,interpolateHsl:()=>rh,interpolateHslLong:()=>ih,interpolateHue:()=>X0,interpolateLab:()=>ah,interpolateNumber:()=>Se,interpolateNumberArray:()=>Aa,interpolateObject:()=>ms,interpolateRgb:()=>ka,interpolateRgbBasis:()=>Ca,interpolateRgbBasisClosed:()=>B0,interpolateRound:()=>Fn,interpolateString:()=>ys,interpolateTransformCss:()=>Q0,interpolateTransformSvg:()=>J0,interpolateZoom:()=>nh,piecewise:()=>Yn,quantize:()=>ch});function sn(e,t,n){e.prototype=t.prototype=n,n.constructor=e}function qn(e,t){var n=Object.create(e.prototype);for(var r in t)n[r]=t[r];return n}function at(){}var Nt=.7,fn=1/Nt,an="\\\\s*([+-]?\\\\d+)\\\\s*",Ln="\\\\s*([+-]?(?:\\\\d*\\\\.)?\\\\d+(?:[eE][+-]?\\\\d+)?)\\\\s*",Fe="\\\\s*([+-]?(?:\\\\d*\\\\.)?\\\\d+(?:[eE][+-]?\\\\d+)?)%\\\\s*",A0=/^#([0-9a-f]{3,8})$/,N0=new RegExp(`^rgb\\\\(${an},${an},${an}\\\\)$`),R0=new RegExp(`^rgb\\\\(${Fe},${Fe},${Fe}\\\\)$`),$0=new RegExp(`^rgba\\\\(${an},${an},${an},${Ln}\\\\)$`),E0=new RegExp(`^rgba\\\\(${Fe},${Fe},${Fe},${Ln}\\\\)$`),D0=new RegExp(`^hsl\\\\(${Ln},${Fe},${Fe}\\\\)$`),P0=new RegExp(`^hsla\\\\(${Ln},${Fe},${Fe},${Ln}\\\\)$`),qf={aliceblue:15792383,antiquewhite:16444375,aqua:65535,aquamarine:8388564,azure:15794175,beige:16119260,bisque:16770244,black:0,blanchedalmond:16772045,blue:255,blueviolet:9055202,brown:10824234,burlywood:14596231,cadetblue:6266528,chartreuse:8388352,chocolate:13789470,coral:16744272,cornflowerblue:6591981,cornsilk:16775388,crimson:14423100,cyan:65535,darkblue:139,darkcyan:35723,darkgoldenrod:12092939,darkgray:11119017,darkgreen:25600,darkgrey:11119017,darkkhaki:12433259,darkmagenta:9109643,darkolivegreen:5597999,darkorange:16747520,darkorchid:10040012,darkred:9109504,darksalmon:15308410,darkseagreen:9419919,darkslateblue:4734347,darkslategray:3100495,darkslategrey:3100495,darkturquoise:52945,darkviolet:9699539,deeppink:16716947,deepskyblue:49151,dimgray:6908265,dimgrey:6908265,dodgerblue:2003199,firebrick:11674146,floralwhite:16775920,forestgreen:2263842,fuchsia:16711935,gainsboro:14474460,ghostwhite:16316671,gold:16766720,goldenrod:14329120,gray:8421504,green:32768,greenyellow:11403055,grey:8421504,honeydew:15794160,hotpink:16738740,indianred:13458524,indigo:4915330,ivory:16777200,khaki:15787660,lavender:15132410,lavenderblush:16773365,lawngreen:8190976,lemonchiffon:16775885,lightblue:11393254,lightcoral:15761536,lightcyan:14745599,lightgoldenrodyellow:16448210,lightgray:13882323,lightgreen:9498256,lightgrey:13882323,lightpink:16758465,lightsalmon:16752762,lightseagreen:2142890,lightskyblue:8900346,lightslategray:7833753,lightslategrey:7833753,lightsteelblue:11584734,lightyellow:16777184,lime:65280,limegreen:3329330,linen:16445670,magenta:16711935,maroon:8388608,mediumaquamarine:6737322,mediumblue:205,mediumorchid:12211667,mediumpurple:9662683,mediumseagreen:3978097,mediumslateblue:8087790,mediumspringgreen:64154,mediumturquoise:4772300,mediumvioletred:13047173,midnightblue:1644912,mintcream:16121850,mistyrose:16770273,moccasin:16770229,navajowhite:16768685,navy:128,oldlace:16643558,olive:8421376,olivedrab:7048739,orange:16753920,orangered:16729344,orchid:14315734,palegoldenrod:15657130,palegreen:10025880,paleturquoise:11529966,palevioletred:14381203,papayawhip:16773077,peachpuff:16767673,peru:13468991,pink:16761035,plum:14524637,powderblue:11591910,purple:8388736,rebeccapurple:6697881,red:16711680,rosybrown:12357519,royalblue:4286945,saddlebrown:9127187,salmon:16416882,sandybrown:16032864,seagreen:3050327,seashell:16774638,sienna:10506797,silver:12632256,skyblue:8900331,slateblue:6970061,slategray:7372944,slategrey:7372944,snow:16775930,springgreen:65407,steelblue:4620980,tan:13808780,teal:32896,thistle:14204888,tomato:16737095,turquoise:4251856,violet:15631086,wheat:16113331,white:16777215,whitesmoke:16119285,yellow:16776960,yellowgreen:10145074};sn(at,cn,{copy(e){return Object.assign(new this.constructor,this,e)},displayable(){return this.rgb().displayable()},hex:Ff,formatHex:Ff,formatHex8:O0,formatHsl:I0,formatRgb:zf,toString:zf});function Ff(){return this.rgb().formatHex()}function O0(){return this.rgb().formatHex8()}function I0(){return Zf(this).formatHsl()}function zf(){return this.rgb().formatRgb()}function cn(e){var t,n;return e=(e+"").trim().toLowerCase(),(t=A0.exec(e))?(n=t[1].length,t=parseInt(t[1],16),n===6?Yf(t):n===3?new X(t>>8&15|t>>4&240,t>>4&15|t&240,(t&15)<<4|t&15,1):n===8?Lr(t>>24&255,t>>16&255,t>>8&255,(t&255)/255):n===4?Lr(t>>12&15|t>>8&240,t>>8&15|t>>4&240,t>>4&15|t&240,((t&15)<<4|t&15)/255):null):(t=N0.exec(e))?new X(t[1],t[2],t[3],1):(t=R0.exec(e))?new X(t[1]*255/100,t[2]*255/100,t[3]*255/100,1):(t=$0.exec(e))?Lr(t[1],t[2],t[3],t[4]):(t=E0.exec(e))?Lr(t[1]*255/100,t[2]*255/100,t[3]*255/100,t[4]):(t=D0.exec(e))?Gf(t[1],t[2]/100,t[3]/100,1):(t=P0.exec(e))?Gf(t[1],t[2]/100,t[3]/100,t[4]):qf.hasOwnProperty(e)?Yf(qf[e]):e==="transparent"?new X(NaN,NaN,NaN,0):null}function Yf(e){return new X(e>>16&255,e>>8&255,e&255,1)}function Lr(e,t,n,r){return r<=0&&(e=t=n=NaN),new X(e,t,n,r)}function va(e){return e instanceof at||(e=cn(e)),e?(e=e.rgb(),new X(e.r,e.g,e.b,e.opacity)):new X}function Rt(e,t,n,r){return arguments.length===1?va(e):new X(e,t,n,r??1)}function X(e,t,n,r){this.r=+e,this.g=+t,this.b=+n,this.opacity=+r}sn(X,Rt,qn(at,{brighter(e){return e=e==null?fn:Math.pow(fn,e),new X(this.r*e,this.g*e,this.b*e,this.opacity)},darker(e){return e=e==null?Nt:Math.pow(Nt,e),new X(this.r*e,this.g*e,this.b*e,this.opacity)},rgb(){return this},clamp(){return new X(Ct(this.r),Ct(this.g),Ct(this.b),qr(this.opacity))},displayable(){return-.5<=this.r&&this.r<255.5&&-.5<=this.g&&this.g<255.5&&-.5<=this.b&&this.b<255.5&&0<=this.opacity&&this.opacity<=1},hex:Bf,formatHex:Bf,formatHex8:L0,formatRgb:Hf,toString:Hf}));function Bf(){return`#${St(this.r)}${St(this.g)}${St(this.b)}`}function L0(){return`#${St(this.r)}${St(this.g)}${St(this.b)}${St((isNaN(this.opacity)?1:this.opacity)*255)}`}function Hf(){let e=qr(this.opacity);return`${e===1?"rgb(":"rgba("}${Ct(this.r)}, ${Ct(this.g)}, ${Ct(this.b)}${e===1?")":`, ${e})`}`}function qr(e){return isNaN(e)?1:Math.max(0,Math.min(1,e))}function Ct(e){return Math.max(0,Math.min(255,Math.round(e)||0))}function St(e){return e=Ct(e),(e<16?"0":"")+e.toString(16)}function Gf(e,t,n,r){return r<=0?e=t=n=NaN:n<=0||n>=1?e=t=NaN:t<=0&&(e=NaN),new De(e,t,n,r)}function Zf(e){if(e instanceof De)return new De(e.h,e.s,e.l,e.opacity);if(e instanceof at||(e=cn(e)),!e)return new De;if(e instanceof De)return e;e=e.rgb();var t=e.r/255,n=e.g/255,r=e.b/255,i=Math.min(t,n,r),a=Math.max(t,n,r),o=NaN,f=a-i,s=(a+i)/2;return f?(t===a?o=(n-r)/f+(n<r)*6:n===a?o=(r-t)/f+2:o=(t-n)/f+4,f/=s<.5?a+i:2-a-i,o*=60):f=s>0&&s<1?0:o,new De(o,f,s,e.opacity)}function zr(e,t,n,r){return arguments.length===1?Zf(e):new De(e,t,n,r??1)}function De(e,t,n,r){this.h=+e,this.s=+t,this.l=+n,this.opacity=+r}sn(De,zr,qn(at,{brighter(e){return e=e==null?fn:Math.pow(fn,e),new De(this.h,this.s,this.l*e,this.opacity)},darker(e){return e=e==null?Nt:Math.pow(Nt,e),new De(this.h,this.s,this.l*e,this.opacity)},rgb(){var e=this.h%360+(this.h<0)*360,t=isNaN(e)||isNaN(this.s)?0:this.s,n=this.l,r=n+(n<.5?n:1-n)*t,i=2*n-r;return new X(ga(e>=240?e-240:e+120,i,r),ga(e,i,r),ga(e<120?e+240:e-120,i,r),this.opacity)},clamp(){return new De(jf(this.h),Ur(this.s),Ur(this.l),qr(this.opacity))},displayable(){return(0<=this.s&&this.s<=1||isNaN(this.s))&&0<=this.l&&this.l<=1&&0<=this.opacity&&this.opacity<=1},formatHsl(){let e=qr(this.opacity);return`${e===1?"hsl(":"hsla("}${jf(this.h)}, ${Ur(this.s)*100}%, ${Ur(this.l)*100}%${e===1?")":`, ${e})`}`}}));function jf(e){return e=(e||0)%360,e<0?e+360:e}function Ur(e){return Math.max(0,Math.min(1,e||0))}function ga(e,t,n){return(e<60?t+(n-t)*e/60:e<180?n:e<240?t+(n-t)*(240-e)/60:t)*255}var Qf=Math.PI/180,Jf=180/Math.PI,Fr=18,Kf=.96422,es=1,ts=.82521,ns=4/29,on=6/29,rs=3*on*on,U0=on*on*on;function is(e){if(e instanceof ze)return new ze(e.l,e.a,e.b,e.opacity);if(e instanceof We)return as(e);e instanceof X||(e=va(e));var t=_a(e.r),n=_a(e.g),r=_a(e.b),i=pa((.2225045*t+.7168786*n+.0606169*r)/es),a,o;return t===n&&n===r?a=o=i:(a=pa((.4360747*t+.3850649*n+.1430804*r)/Kf),o=pa((.0139322*t+.0971045*n+.7141733*r)/ts)),new ze(116*i-16,500*(a-i),200*(i-o),e.opacity)}function Yr(e,t,n,r){return arguments.length===1?is(e):new ze(e,t,n,r??1)}function ze(e,t,n,r){this.l=+e,this.a=+t,this.b=+n,this.opacity=+r}sn(ze,Yr,qn(at,{brighter(e){return new ze(this.l+Fr*(e??1),this.a,this.b,this.opacity)},darker(e){return new ze(this.l-Fr*(e??1),this.a,this.b,this.opacity)},rgb(){var e=(this.l+16)/116,t=isNaN(this.a)?e:e+this.a/500,n=isNaN(this.b)?e:e-this.b/200;return t=Kf*ma(t),e=es*ma(e),n=ts*ma(n),new X(ya(3.1338561*t-1.6168667*e-.4906146*n),ya(-.9787684*t+1.9161415*e+.033454*n),ya(.0719453*t-.2289914*e+1.4052427*n),this.opacity)}}));function pa(e){return e>U0?Math.pow(e,1/3):e/rs+ns}function ma(e){return e>on?e*e*e:rs*(e-ns)}function ya(e){return 255*(e<=.0031308?12.92*e:1.055*Math.pow(e,1/2.4)-.055)}function _a(e){return(e/=255)<=.04045?e/12.92:Math.pow((e+.055)/1.055,2.4)}function q0(e){if(e instanceof We)return new We(e.h,e.c,e.l,e.opacity);if(e instanceof ze||(e=is(e)),e.a===0&&e.b===0)return new We(NaN,0<e.l&&e.l<100?0:NaN,e.l,e.opacity);var t=Math.atan2(e.b,e.a)*Jf;return new We(t<0?t+360:t,Math.sqrt(e.a*e.a+e.b*e.b),e.l,e.opacity)}function Br(e,t,n,r){return arguments.length===1?q0(e):new We(e,t,n,r??1)}function We(e,t,n,r){this.h=+e,this.c=+t,this.l=+n,this.opacity=+r}function as(e){if(isNaN(e.h))return new ze(e.l,0,0,e.opacity);var t=e.h*Qf;return new ze(e.l,Math.cos(t)*e.c,Math.sin(t)*e.c,e.opacity)}sn(We,Br,qn(at,{brighter(e){return new We(this.h,this.c,this.l+Fr*(e??1),this.opacity)},darker(e){return new We(this.h,this.c,this.l-Fr*(e??1),this.opacity)},rgb(){return as(this).rgb()}}));var os=-.14861,xa=1.78277,wa=-.29227,Hr=-.90649,Un=1.97294,Wf=Un*Hr,Xf=Un*xa,Vf=xa*wa-Hr*os;function F0(e){if(e instanceof At)return new At(e.h,e.s,e.l,e.opacity);e instanceof X||(e=va(e));var t=e.r/255,n=e.g/255,r=e.b/255,i=(Vf*r+Wf*t-Xf*n)/(Vf+Wf-Xf),a=r-i,o=(Un*(n-i)-wa*a)/Hr,f=Math.sqrt(o*o+a*a)/(Un*i*(1-i)),s=f?Math.atan2(o,a)*Jf-120:NaN;return new At(s<0?s+360:s,f,i,e.opacity)}function Te(e,t,n,r){return arguments.length===1?F0(e):new At(e,t,n,r??1)}function At(e,t,n,r){this.h=+e,this.s=+t,this.l=+n,this.opacity=+r}sn(At,Te,qn(at,{brighter(e){return e=e==null?fn:Math.pow(fn,e),new At(this.h,this.s,this.l*e,this.opacity)},darker(e){return e=e==null?Nt:Math.pow(Nt,e),new At(this.h,this.s,this.l*e,this.opacity)},rgb(){var e=isNaN(this.h)?0:(this.h+120)*Qf,t=+this.l,n=isNaN(this.s)?0:this.s*t*(1-t),r=Math.cos(e),i=Math.sin(e);return new X(255*(t+n*(os*r+xa*i)),255*(t+n*(wa*r+Hr*i)),255*(t+n*(Un*r)),this.opacity)}}));function cs(e,t,n,r,i){var a=e*e,o=a*e;return((1-3*e+3*a-o)*t+(4-6*a+3*o)*n+(1+3*e+3*a-3*o)*r+o*i)/6}function us(e){var t=e.length-1;return function(n){var r=n<=0?n=0:n>=1?(n=1,t-1):Math.floor(n*t),i=e[r],a=e[r+1],o=r>0?e[r-1]:2*i-a,f=r<t-1?e[r+2]:2*a-i;return cs((n-r/t)*t,o,i,a,f)}}function ls(e){var t=e.length;return function(n){var r=Math.floor(((n%=1)<0?++n:n)*t),i=e[(r+t-1)%t],a=e[r%t],o=e[(r+1)%t],f=e[(r+2)%t];return cs((n-r/t)*t,i,a,o,f)}}var jr=e=>()=>e;function hs(e,t){return function(n){return e+n*t}}function z0(e,t,n){return e=Math.pow(e,n),t=Math.pow(t,n)-e,n=1/n,function(r){return Math.pow(e+r*t,n)}}function Wr(e,t){var n=t-e;return n?hs(e,n>180||n<-180?n-360*Math.round(n/360):n):jr(isNaN(e)?t:e)}function Y0(e){return(e=+e)==1?V:function(t,n){return n-t?z0(t,n,e):jr(isNaN(t)?n:t)}}function V(e,t){var n=t-e;return n?hs(e,n):jr(isNaN(e)?t:e)}var ka=(function e(t){var n=Y0(t);function r(i,a){var o=n((i=Rt(i)).r,(a=Rt(a)).r),f=n(i.g,a.g),s=n(i.b,a.b),c=V(i.opacity,a.opacity);return function(l){return i.r=o(l),i.g=f(l),i.b=s(l),i.opacity=c(l),i+""}}return r.gamma=e,r})(1);function ds(e){return function(t){var n=t.length,r=new Array(n),i=new Array(n),a=new Array(n),o,f;for(o=0;o<n;++o)f=Rt(t[o]),r[o]=f.r||0,i[o]=f.g||0,a[o]=f.b||0;return r=e(r),i=e(i),a=e(a),f.opacity=1,function(s){return f.r=r(s),f.g=i(s),f.b=a(s),f+""}}}var Ca=ds(us),B0=ds(ls);function Aa(e,t){t||(t=[]);var n=e?Math.min(t.length,e.length):0,r=t.slice(),i;return function(a){for(i=0;i<n;++i)r[i]=e[i]*(1-a)+t[i]*a;return r}}function bs(e){return ArrayBuffer.isView(e)&&!(e instanceof DataView)}function H0(e,t){return(bs(t)?Aa:gs)(e,t)}function gs(e,t){var n=t?t.length:0,r=e?Math.min(n,e.length):0,i=new Array(r),a=new Array(n),o;for(o=0;o<r;++o)i[o]=ot(e[o],t[o]);for(;o<n;++o)a[o]=t[o];return function(f){for(o=0;o<r;++o)a[o]=i[o](f);return a}}function ps(e,t){var n=new Date;return e=+e,t=+t,function(r){return n.setTime(e*(1-r)+t*r),n}}function Se(e,t){return e=+e,t=+t,function(n){return e*(1-n)+t*n}}function ms(e,t){var n={},r={},i;(e===null||typeof e!="object")&&(e={}),(t===null||typeof t!="object")&&(t={});for(i in t)i in e?n[i]=ot(e[i],t[i]):r[i]=t[i];return function(a){for(i in n)r[i]=n[i](a);return r}}var Ta=/[-+]?(?:\\d+\\.?\\d*|\\.?\\d+)(?:[eE][-+]?\\d+)?/g,Ma=new RegExp(Ta.source,"g");function G0(e){return function(){return e}}function j0(e){return function(t){return e(t)+""}}function ys(e,t){var n=Ta.lastIndex=Ma.lastIndex=0,r,i,a,o=-1,f=[],s=[];for(e=e+"",t=t+"";(r=Ta.exec(e))&&(i=Ma.exec(t));)(a=i.index)>n&&(a=t.slice(n,a),f[o]?f[o]+=a:f[++o]=a),(r=r[0])===(i=i[0])?f[o]?f[o]+=i:f[++o]=i:(f[++o]=null,s.push({i:o,x:Se(r,i)})),n=Ma.lastIndex;return n<t.length&&(a=t.slice(n),f[o]?f[o]+=a:f[++o]=a),f.length<2?s[0]?j0(s[0].x):G0(t):(t=s.length,function(c){for(var l=0,u;l<t;++l)f[(u=s[l]).i]=u.x(c);return f.join("")})}function ot(e,t){var n=typeof t,r;return t==null||n==="boolean"?jr(t):(n==="number"?Se:n==="string"?(r=cn(t))?(t=r,ka):ys:t instanceof cn?ka:t instanceof Date?ps:bs(t)?Aa:Array.isArray(t)?gs:typeof t.valueOf!="function"&&typeof t.toString!="function"||isNaN(t)?ms:Se)(e,t)}function W0(e){var t=e.length;return function(n){return e[Math.max(0,Math.min(t-1,Math.floor(n*t)))]}}function X0(e,t){var n=Wr(+e,+t);return function(r){var i=n(r);return i-360*Math.floor(i/360)}}function Fn(e,t){return e=+e,t=+t,function(n){return Math.round(e*(1-n)+t*n)}}var fs=180/Math.PI,Sa={translateX:0,translateY:0,rotate:0,skewX:0,scaleX:1,scaleY:1};function _s(e,t,n,r,i,a){var o,f,s;return(o=Math.sqrt(e*e+t*t))&&(e/=o,t/=o),(s=e*n+t*r)&&(n-=e*s,r-=t*s),(f=Math.sqrt(n*n+r*r))&&(n/=f,r/=f,s/=f),e*r<t*n&&(e=-e,t=-t,s=-s,o=-o),{translateX:i,translateY:a,rotate:Math.atan2(t,e)*fs,skewX:Math.atan(s)*fs,scaleX:o,scaleY:f}}var Gr;function V0(e){let t=new(typeof DOMMatrix=="function"?DOMMatrix:WebKitCSSMatrix)(e+"");return t.isIdentity?Sa:_s(t.a,t.b,t.c,t.d,t.e,t.f)}function Z0(e){return e==null||(Gr||(Gr=document.createElementNS("http://www.w3.org/2000/svg","g")),Gr.setAttribute("transform",e),!(e=Gr.transform.baseVal.consolidate()))?Sa:(e=e.matrix,_s(e.a,e.b,e.c,e.d,e.e,e.f))}function vs(e,t,n,r){function i(c){return c.length?c.pop()+" ":""}function a(c,l,u,h,d,g){if(c!==u||l!==h){var b=d.push("translate(",null,t,null,n);g.push({i:b-4,x:Se(c,u)},{i:b-2,x:Se(l,h)})}else(u||h)&&d.push("translate("+u+t+h+n)}function o(c,l,u,h){c!==l?(c-l>180?l+=360:l-c>180&&(c+=360),h.push({i:u.push(i(u)+"rotate(",null,r)-2,x:Se(c,l)})):l&&u.push(i(u)+"rotate("+l+r)}function f(c,l,u,h){c!==l?h.push({i:u.push(i(u)+"skewX(",null,r)-2,x:Se(c,l)}):l&&u.push(i(u)+"skewX("+l+r)}function s(c,l,u,h,d,g){if(c!==u||l!==h){var b=d.push(i(d)+"scale(",null,",",null,")");g.push({i:b-4,x:Se(c,u)},{i:b-2,x:Se(l,h)})}else(u!==1||h!==1)&&d.push(i(d)+"scale("+u+","+h+")")}return function(c,l){var u=[],h=[];return c=e(c),l=e(l),a(c.translateX,c.translateY,l.translateX,l.translateY,u,h),o(c.rotate,l.rotate,u,h),f(c.skewX,l.skewX,u,h),s(c.scaleX,c.scaleY,l.scaleX,l.scaleY,u,h),c=l=null,function(d){for(var g=-1,b=h.length,p;++g<b;)u[(p=h[g]).i]=p.x(d);return u.join("")}}}var Q0=vs(V0,"px, ","px)","deg)"),J0=vs(Z0,", ",")",")"),K0=1e-12;function ss(e){return((e=Math.exp(e))+1/e)/2}function eh(e){return((e=Math.exp(e))-1/e)/2}function th(e){return((e=Math.exp(2*e))-1)/(e+1)}var nh=(function e(t,n,r){function i(a,o){var f=a[0],s=a[1],c=a[2],l=o[0],u=o[1],h=o[2],d=l-f,g=u-s,b=d*d+g*g,p,m;if(b<K0)m=Math.log(h/c)/t,p=function(k){return[f+k*d,s+k*g,c*Math.exp(t*k*m)]};else{var w=Math.sqrt(b),x=(h*h-c*c+r*b)/(2*c*n*w),v=(h*h-c*c-r*b)/(2*h*n*w),C=Math.log(Math.sqrt(x*x+1)-x),_=Math.log(Math.sqrt(v*v+1)-v);m=(_-C)/t,p=function(k){var $=k*m,F=ss(C),U=c/(n*w)*(F*th(t*$+C)-eh(C));return[f+U*d,s+U*g,c*F/ss(t*$+C)]}}return p.duration=Math.abs(m)*1e3*t/Math.SQRT2,p}return i.rho=function(a){var o=Math.max(.001,+a),f=o*o,s=f*f;return e(o,f,s)},i})(Math.SQRT2,2,4);function xs(e){return function(t,n){var r=e((t=zr(t)).h,(n=zr(n)).h),i=V(t.s,n.s),a=V(t.l,n.l),o=V(t.opacity,n.opacity);return function(f){return t.h=r(f),t.s=i(f),t.l=a(f),t.opacity=o(f),t+""}}}var rh=xs(Wr),ih=xs(V);function ah(e,t){var n=V((e=Yr(e)).l,(t=Yr(t)).l),r=V(e.a,t.a),i=V(e.b,t.b),a=V(e.opacity,t.opacity);return function(o){return e.l=n(o),e.a=r(o),e.b=i(o),e.opacity=a(o),e+""}}function ws(e){return function(t,n){var r=e((t=Br(t)).h,(n=Br(n)).h),i=V(t.c,n.c),a=V(t.l,n.l),o=V(t.opacity,n.opacity);return function(f){return t.h=r(f),t.c=i(f),t.l=a(f),t.opacity=o(f),t+""}}}var oh=ws(Wr),fh=ws(V);function Ms(e){return(function t(n){n=+n;function r(i,a){var o=e((i=Te(i)).h,(a=Te(a)).h),f=V(i.s,a.s),s=V(i.l,a.l),c=V(i.opacity,a.opacity);return function(l){return i.h=o(l),i.s=f(l),i.l=s(Math.pow(l,n)),i.opacity=c(l),i+""}}return r.gamma=t,r})(1)}var sh=Ms(Wr),zn=Ms(V);function Yn(e,t){t===void 0&&(t=e,e=ot);for(var n=0,r=t.length-1,i=t[0],a=new Array(r<0?0:r);n<r;)a[n]=e(i,i=t[++n]);return function(o){var f=Math.max(0,Math.min(r-1,Math.floor(o*=r)));return a[f](o-f)}}function ch(e,t){for(var n=new Array(t),r=0;r<t;++r)n[r]=e(r/(t-1));return n}function uh(e){return Math.abs(e=Math.round(e))>=1e21?e.toLocaleString("en").replace(/,/g,""):e.toString(10)}function Vr(e,t){if(!isFinite(e)||e===0)return null;var n=(e=t?e.toExponential(t-1):e.toExponential()).indexOf("e"),r=e.slice(0,n);return[r.length>1?r[0]+r.slice(2):r,+e.slice(n+1)]}function un(e){return e=Vr(Math.abs(e)),e?e[1]:NaN}function lh(e,t){return function(n,r){for(var i=n.length,a=[],o=0,f=e[0],s=0;i>0&&f>0&&(s+f+1>r&&(f=Math.max(1,r-s)),a.push(n.substring(i-=f,i+f)),!((s+=f+1)>r));)f=e[o=(o+1)%e.length];return a.reverse().join(t)}}function hh(e){return function(t){return t.replace(/[0-9]/g,function(n){return e[+n]})}}var dh=/^(?:(.)?([<>=^]))?([+\\-( ])?([$#])?(0)?(\\d+)?(,)?(\\.\\d+)?(~)?([a-z%])?$/i;function Xe(e){if(!(t=dh.exec(e)))throw new Error("invalid format: "+e);var t;return new Ra({fill:t[1],align:t[2],sign:t[3],symbol:t[4],zero:t[5],width:t[6],comma:t[7],precision:t[8]&&t[8].slice(1),trim:t[9],type:t[10]})}Xe.prototype=Ra.prototype;function Ra(e){this.fill=e.fill===void 0?" ":e.fill+"",this.align=e.align===void 0?">":e.align+"",this.sign=e.sign===void 0?"-":e.sign+"",this.symbol=e.symbol===void 0?"":e.symbol+"",this.zero=!!e.zero,this.width=e.width===void 0?void 0:+e.width,this.comma=!!e.comma,this.precision=e.precision===void 0?void 0:+e.precision,this.trim=!!e.trim,this.type=e.type===void 0?"":e.type+""}Ra.prototype.toString=function(){return this.fill+this.align+this.sign+this.symbol+(this.zero?"0":"")+(this.width===void 0?"":Math.max(1,this.width|0))+(this.comma?",":"")+(this.precision===void 0?"":"."+Math.max(0,this.precision|0))+(this.trim?"~":"")+this.type};function bh(e){e:for(var t=e.length,n=1,r=-1,i;n<t;++n)switch(e[n]){case".":r=i=n;break;case"0":r===0&&(r=n),i=n;break;default:if(!+e[n])break e;r>0&&(r=0);break}return r>0?e.slice(0,r)+e.slice(i+1):e}var Zr;function gh(e,t){var n=Vr(e,t);if(!n)return Zr=void 0,e.toPrecision(t);var r=n[0],i=n[1],a=i-(Zr=Math.max(-8,Math.min(8,Math.floor(i/3)))*3)+1,o=r.length;return a===o?r:a>o?r+new Array(a-o+1).join("0"):a>0?r.slice(0,a)+"."+r.slice(a):"0."+new Array(1-a).join("0")+Vr(e,Math.max(0,t+a-1))[0]}function ks(e,t){var n=Vr(e,t);if(!n)return e+"";var r=n[0],i=n[1];return i<0?"0."+new Array(-i).join("0")+r:r.length>i+1?r.slice(0,i+1)+"."+r.slice(i+1):r+new Array(i-r.length+2).join("0")}var Ts={"%":(e,t)=>(e*100).toFixed(t),b:e=>Math.round(e).toString(2),c:e=>e+"",d:uh,e:(e,t)=>e.toExponential(t),f:(e,t)=>e.toFixed(t),g:(e,t)=>e.toPrecision(t),o:e=>Math.round(e).toString(8),p:(e,t)=>ks(e*100,t),r:ks,s:gh,X:e=>Math.round(e).toString(16).toUpperCase(),x:e=>Math.round(e).toString(16)};function Ss(e){return e}var Cs=Array.prototype.map,As=["y","z","a","f","p","n","\\xB5","m","","k","M","G","T","P","E","Z","Y"];function Ns(e){var t=e.grouping===void 0||e.thousands===void 0?Ss:lh(Cs.call(e.grouping,Number),e.thousands+""),n=e.currency===void 0?"":e.currency[0]+"",r=e.currency===void 0?"":e.currency[1]+"",i=e.decimal===void 0?".":e.decimal+"",a=e.numerals===void 0?Ss:hh(Cs.call(e.numerals,String)),o=e.percent===void 0?"%":e.percent+"",f=e.minus===void 0?"\\u2212":e.minus+"",s=e.nan===void 0?"NaN":e.nan+"";function c(u,h){u=Xe(u);var d=u.fill,g=u.align,b=u.sign,p=u.symbol,m=u.zero,w=u.width,x=u.comma,v=u.precision,C=u.trim,_=u.type;_==="n"?(x=!0,_="g"):Ts[_]||(v===void 0&&(v=12),C=!0,_="g"),(m||d==="0"&&g==="=")&&(m=!0,d="0",g="=");var k=(h&&h.prefix!==void 0?h.prefix:"")+(p==="$"?n:p==="#"&&/[boxX]/.test(_)?"0"+_.toLowerCase():""),$=(p==="$"?r:/[%p]/.test(_)?o:"")+(h&&h.suffix!==void 0?h.suffix:""),F=Ts[_],U=/[defgprs%]/.test(_);v=v===void 0?6:/[gprs]/.test(_)?Math.max(1,Math.min(21,v)):Math.max(0,Math.min(20,v));function z(S){var T=k,A=$,q,de,ee;if(_==="c")A=F(S)+A,S="";else{S=+S;var Y=S<0||1/S<0;if(S=isNaN(S)?s:F(Math.abs(S),v),C&&(S=bh(S)),Y&&+S==0&&b!=="+"&&(Y=!1),T=(Y?b==="("?b:f:b==="-"||b==="("?"":b)+T,A=(_==="s"&&!isNaN(S)&&Zr!==void 0?As[8+Zr/3]:"")+A+(Y&&b==="("?")":""),U){for(q=-1,de=S.length;++q<de;)if(ee=S.charCodeAt(q),48>ee||ee>57){A=(ee===46?i+S.slice(q+1):S.slice(q))+A,S=S.slice(0,q);break}}}x&&!m&&(S=t(S,1/0));var be=T.length+S.length+A.length,W=be<w?new Array(w-be+1).join(d):"";switch(x&&m&&(S=t(W+S,W.length?w-A.length:1/0),W=""),g){case"<":S=T+S+A+W;break;case"=":S=T+W+S+A;break;case"^":S=W.slice(0,be=W.length>>1)+T+S+A+W.slice(be);break;default:S=W+T+S+A;break}return a(S)}return z.toString=function(){return u+""},z}function l(u,h){var d=Math.max(-8,Math.min(8,Math.floor(un(h)/3)))*3,g=Math.pow(10,-d),b=c((u=Xe(u),u.type="f",u),{suffix:As[8+d/3]});return function(p){return b(g*p)}}return{format:c,formatPrefix:l}}var Xr,ln,Bn;ph({thousands:",",grouping:[3],currency:["$",""]});function ph(e){return Xr=Ns(e),ln=Xr.format,Bn=Xr.formatPrefix,Xr}function Qr(e){return Math.max(0,-un(Math.abs(e)))}function Jr(e,t){return Math.max(0,Math.max(-8,Math.min(8,Math.floor(un(t)/3)))*3-un(Math.abs(e)))}function Kr(e,t){return e=Math.abs(e),t=Math.abs(t)-e,Math.max(0,un(t)-un(e))+1}var $a=new Date,Ea=new Date;function H(e,t,n,r){function i(a){return e(a=arguments.length===0?new Date:new Date(+a)),a}return i.floor=a=>(e(a=new Date(+a)),a),i.ceil=a=>(e(a=new Date(a-1)),t(a,1),e(a),a),i.round=a=>{let o=i(a),f=i.ceil(a);return a-o<f-a?o:f},i.offset=(a,o)=>(t(a=new Date(+a),o==null?1:Math.floor(o)),a),i.range=(a,o,f)=>{let s=[];if(a=i.ceil(a),f=f==null?1:Math.floor(f),!(a<o)||!(f>0))return s;let c;do s.push(c=new Date(+a)),t(a,f),e(a);while(c<a&&a<o);return s},i.filter=a=>H(o=>{if(o>=o)for(;e(o),!a(o);)o.setTime(o-1)},(o,f)=>{if(o>=o)if(f<0)for(;++f<=0;)for(;t(o,-1),!a(o););else for(;--f>=0;)for(;t(o,1),!a(o););}),n&&(i.count=(a,o)=>($a.setTime(+a),Ea.setTime(+o),e($a),e(Ea),Math.floor(n($a,Ea))),i.every=a=>(a=Math.floor(a),!isFinite(a)||!(a>0)?null:a>1?i.filter(r?o=>r(o)%a===0:o=>i.count(0,o)%a===0):i)),i}var ft=H(()=>{},(e,t)=>{e.setTime(+e+t)},(e,t)=>t-e);ft.every=e=>(e=Math.floor(e),!isFinite(e)||!(e>0)?null:e>1?H(t=>{t.setTime(Math.floor(t/e)*e)},(t,n)=>{t.setTime(+t+n*e)},(t,n)=>(n-t)/e):ft);var Nm=ft.range,Ve=1e3,Ce=Ve*60,Ze=Ce*60,Qe=Ze*24,Pa=Qe*7,Rs=Qe*30,Da=Qe*365,ye=H(e=>{e.setTime(e-e.getMilliseconds())},(e,t)=>{e.setTime(+e+t*Ve)},(e,t)=>(t-e)/Ve,e=>e.getUTCSeconds()),Rm=ye.range,hn=H(e=>{e.setTime(e-e.getMilliseconds()-e.getSeconds()*Ve)},(e,t)=>{e.setTime(+e+t*Ce)},(e,t)=>(t-e)/Ce,e=>e.getMinutes()),$m=hn.range,dn=H(e=>{e.setUTCSeconds(0,0)},(e,t)=>{e.setTime(+e+t*Ce)},(e,t)=>(t-e)/Ce,e=>e.getUTCMinutes()),Em=dn.range,bn=H(e=>{e.setTime(e-e.getMilliseconds()-e.getSeconds()*Ve-e.getMinutes()*Ce)},(e,t)=>{e.setTime(+e+t*Ze)},(e,t)=>(t-e)/Ze,e=>e.getHours()),Dm=bn.range,gn=H(e=>{e.setUTCMinutes(0,0,0)},(e,t)=>{e.setTime(+e+t*Ze)},(e,t)=>(t-e)/Ze,e=>e.getUTCHours()),Pm=gn.range,Ae=H(e=>e.setHours(0,0,0,0),(e,t)=>e.setDate(e.getDate()+t),(e,t)=>(t-e-(t.getTimezoneOffset()-e.getTimezoneOffset())*Ce)/Qe,e=>e.getDate()-1),Om=Ae.range,Pe=H(e=>{e.setUTCHours(0,0,0,0)},(e,t)=>{e.setUTCDate(e.getUTCDate()+t)},(e,t)=>(t-e)/Qe,e=>e.getUTCDate()-1),Im=Pe.range,$s=H(e=>{e.setUTCHours(0,0,0,0)},(e,t)=>{e.setUTCDate(e.getUTCDate()+t)},(e,t)=>(t-e)/Qe,e=>Math.floor(e/Qe)),Lm=$s.range;function $t(e){return H(t=>{t.setDate(t.getDate()-(t.getDay()+7-e)%7),t.setHours(0,0,0,0)},(t,n)=>{t.setDate(t.getDate()+n*7)},(t,n)=>(n-t-(n.getTimezoneOffset()-t.getTimezoneOffset())*Ce)/Pa)}var Je=$t(0),Hn=$t(1),mh=$t(2),yh=$t(3),Et=$t(4),_h=$t(5),vh=$t(6),Um=Je.range,qm=Hn.range,Fm=mh.range,zm=yh.range,Ym=Et.range,Bm=_h.range,Hm=vh.range;function Dt(e){return H(t=>{t.setUTCDate(t.getUTCDate()-(t.getUTCDay()+7-e)%7),t.setUTCHours(0,0,0,0)},(t,n)=>{t.setUTCDate(t.getUTCDate()+n*7)},(t,n)=>(n-t)/Pa)}var Ke=Dt(0),Gn=Dt(1),xh=Dt(2),wh=Dt(3),Pt=Dt(4),Mh=Dt(5),kh=Dt(6),Gm=Ke.range,jm=Gn.range,Wm=xh.range,Xm=wh.range,Vm=Pt.range,Zm=Mh.range,Qm=kh.range,Ot=H(e=>{e.setDate(1),e.setHours(0,0,0,0)},(e,t)=>{e.setMonth(e.getMonth()+t)},(e,t)=>t.getMonth()-e.getMonth()+(t.getFullYear()-e.getFullYear())*12,e=>e.getMonth()),Jm=Ot.range,It=H(e=>{e.setUTCDate(1),e.setUTCHours(0,0,0,0)},(e,t)=>{e.setUTCMonth(e.getUTCMonth()+t)},(e,t)=>t.getUTCMonth()-e.getUTCMonth()+(t.getUTCFullYear()-e.getUTCFullYear())*12,e=>e.getUTCMonth()),Km=It.range,_e=H(e=>{e.setMonth(0,1),e.setHours(0,0,0,0)},(e,t)=>{e.setFullYear(e.getFullYear()+t)},(e,t)=>t.getFullYear()-e.getFullYear(),e=>e.getFullYear());_e.every=e=>!isFinite(e=Math.floor(e))||!(e>0)?null:H(t=>{t.setFullYear(Math.floor(t.getFullYear()/e)*e),t.setMonth(0,1),t.setHours(0,0,0,0)},(t,n)=>{t.setFullYear(t.getFullYear()+n*e)});var e6=_e.range,ve=H(e=>{e.setUTCMonth(0,1),e.setUTCHours(0,0,0,0)},(e,t)=>{e.setUTCFullYear(e.getUTCFullYear()+t)},(e,t)=>t.getUTCFullYear()-e.getUTCFullYear(),e=>e.getUTCFullYear());ve.every=e=>!isFinite(e=Math.floor(e))||!(e>0)?null:H(t=>{t.setUTCFullYear(Math.floor(t.getUTCFullYear()/e)*e),t.setUTCMonth(0,1),t.setUTCHours(0,0,0,0)},(t,n)=>{t.setUTCFullYear(t.getUTCFullYear()+n*e)});var t6=ve.range;function Es(e,t,n,r,i,a){let o=[[ye,1,Ve],[ye,5,5*Ve],[ye,15,15*Ve],[ye,30,30*Ve],[a,1,Ce],[a,5,5*Ce],[a,15,15*Ce],[a,30,30*Ce],[i,1,Ze],[i,3,3*Ze],[i,6,6*Ze],[i,12,12*Ze],[r,1,Qe],[r,2,2*Qe],[n,1,Pa],[t,1,Rs],[t,3,3*Rs],[e,1,Da]];function f(c,l,u){let h=l<c;h&&([c,l]=[l,c]);let d=u&&typeof u.range=="function"?u:s(c,l,u),g=d?d.range(c,+l+1):[];return h?g.reverse():g}function s(c,l,u){let h=Math.abs(l-c)/u,d=Or(([,,p])=>p).right(o,h);if(d===o.length)return e.every(In(c/Da,l/Da,u));if(d===0)return ft.every(Math.max(In(c,l,u),1));let[g,b]=o[h/o[d-1][2]<o[d][2]/h?d-1:d];return g.every(b)}return[f,s]}var[Ds,Ps]=Es(ve,It,Ke,$s,gn,dn),[Os,Is]=Es(_e,Ot,Je,Ae,bn,hn);function Oa(e){if(0<=e.y&&e.y<100){var t=new Date(-1,e.m,e.d,e.H,e.M,e.S,e.L);return t.setFullYear(e.y),t}return new Date(e.y,e.m,e.d,e.H,e.M,e.S,e.L)}function Ia(e){if(0<=e.y&&e.y<100){var t=new Date(Date.UTC(-1,e.m,e.d,e.H,e.M,e.S,e.L));return t.setUTCFullYear(e.y),t}return new Date(Date.UTC(e.y,e.m,e.d,e.H,e.M,e.S,e.L))}function jn(e,t,n){return{y:e,m:t,d:n,H:0,M:0,S:0,L:0}}function Ws(e){var t=e.dateTime,n=e.date,r=e.time,i=e.periods,a=e.days,o=e.shortDays,f=e.months,s=e.shortMonths,c=Wn(i),l=Xn(i),u=Wn(a),h=Xn(a),d=Wn(o),g=Xn(o),b=Wn(f),p=Xn(f),m=Wn(s),w=Xn(s),x={a:ee,A:Y,b:be,B:W,c:null,d:Ys,e:Ys,f:Wh,g:rd,G:ad,H:Hh,I:Gh,j:jh,L:Xs,m:Xh,M:Vh,p:Vt,q:Zt,Q:Gs,s:js,S:Zh,u:Qh,U:Jh,V:Kh,w:ed,W:td,x:null,X:null,y:nd,Y:id,Z:od,"%":Hs},v={a:An,A:Nn,b:$e,B:Rn,c:null,d:Bs,e:Bs,f:ud,g:vd,G:wd,H:fd,I:sd,j:cd,L:Zs,m:ld,M:hd,p:$n,q:En,Q:Gs,s:js,S:dd,u:bd,U:gd,V:pd,w:md,W:yd,x:null,X:null,y:_d,Y:xd,Z:Md,"%":Hs},C={a:U,A:z,b:S,B:T,c:A,d:Fs,e:Fs,f:Fh,g:qs,G:Us,H:zs,I:zs,j:Ih,L:qh,m:Oh,M:Lh,p:F,q:Ph,Q:Yh,s:Bh,S:Uh,u:Nh,U:Rh,V:$h,w:Ah,W:Eh,x:q,X:de,y:qs,Y:Us,Z:Dh,"%":zh};x.x=_(n,x),x.X=_(r,x),x.c=_(t,x),v.x=_(n,v),v.X=_(r,v),v.c=_(t,v);function _(M,R){return function(E){var y=[],fe=-1,L=0,ge=M.length,pe,wt,kf;for(E instanceof Date||(E=new Date(+E));++fe<ge;)M.charCodeAt(fe)===37&&(y.push(M.slice(L,fe)),(wt=Ls[pe=M.charAt(++fe)])!=null?pe=M.charAt(++fe):wt=pe==="e"?" ":"0",(kf=R[pe])&&(pe=kf(E,wt)),y.push(pe),L=fe+1);return y.push(M.slice(L,fe)),y.join("")}}function k(M,R){return function(E){var y=jn(1900,void 0,1),fe=$(y,M,E+="",0),L,ge;if(fe!=E.length)return null;if("Q"in y)return new Date(y.Q);if("s"in y)return new Date(y.s*1e3+("L"in y?y.L:0));if(R&&!("Z"in y)&&(y.Z=0),"p"in y&&(y.H=y.H%12+y.p*12),y.m===void 0&&(y.m="q"in y?y.q:0),"V"in y){if(y.V<1||y.V>53)return null;"w"in y||(y.w=1),"Z"in y?(L=Ia(jn(y.y,0,1)),ge=L.getUTCDay(),L=ge>4||ge===0?Gn.ceil(L):Gn(L),L=Pe.offset(L,(y.V-1)*7),y.y=L.getUTCFullYear(),y.m=L.getUTCMonth(),y.d=L.getUTCDate()+(y.w+6)%7):(L=Oa(jn(y.y,0,1)),ge=L.getDay(),L=ge>4||ge===0?Hn.ceil(L):Hn(L),L=Ae.offset(L,(y.V-1)*7),y.y=L.getFullYear(),y.m=L.getMonth(),y.d=L.getDate()+(y.w+6)%7)}else("W"in y||"U"in y)&&("w"in y||(y.w="u"in y?y.u%7:"W"in y?1:0),ge="Z"in y?Ia(jn(y.y,0,1)).getUTCDay():Oa(jn(y.y,0,1)).getDay(),y.m=0,y.d="W"in y?(y.w+6)%7+y.W*7-(ge+5)%7:y.w+y.U*7-(ge+6)%7);return"Z"in y?(y.H+=y.Z/100|0,y.M+=y.Z%100,Ia(y)):Oa(y)}}function $(M,R,E,y){for(var fe=0,L=R.length,ge=E.length,pe,wt;fe<L;){if(y>=ge)return-1;if(pe=R.charCodeAt(fe++),pe===37){if(pe=R.charAt(fe++),wt=C[pe in Ls?R.charAt(fe++):pe],!wt||(y=wt(M,E,y))<0)return-1}else if(pe!=E.charCodeAt(y++))return-1}return y}function F(M,R,E){var y=c.exec(R.slice(E));return y?(M.p=l.get(y[0].toLowerCase()),E+y[0].length):-1}function U(M,R,E){var y=d.exec(R.slice(E));return y?(M.w=g.get(y[0].toLowerCase()),E+y[0].length):-1}function z(M,R,E){var y=u.exec(R.slice(E));return y?(M.w=h.get(y[0].toLowerCase()),E+y[0].length):-1}function S(M,R,E){var y=m.exec(R.slice(E));return y?(M.m=w.get(y[0].toLowerCase()),E+y[0].length):-1}function T(M,R,E){var y=b.exec(R.slice(E));return y?(M.m=p.get(y[0].toLowerCase()),E+y[0].length):-1}function A(M,R,E){return $(M,t,R,E)}function q(M,R,E){return $(M,n,R,E)}function de(M,R,E){return $(M,r,R,E)}function ee(M){return o[M.getDay()]}function Y(M){return a[M.getDay()]}function be(M){return s[M.getMonth()]}function W(M){return f[M.getMonth()]}function Vt(M){return i[+(M.getHours()>=12)]}function Zt(M){return 1+~~(M.getMonth()/3)}function An(M){return o[M.getUTCDay()]}function Nn(M){return a[M.getUTCDay()]}function $e(M){return s[M.getUTCMonth()]}function Rn(M){return f[M.getUTCMonth()]}function $n(M){return i[+(M.getUTCHours()>=12)]}function En(M){return 1+~~(M.getUTCMonth()/3)}return{format:function(M){var R=_(M+="",x);return R.toString=function(){return M},R},parse:function(M){var R=k(M+="",!1);return R.toString=function(){return M},R},utcFormat:function(M){var R=_(M+="",v);return R.toString=function(){return M},R},utcParse:function(M){var R=k(M+="",!0);return R.toString=function(){return M},R}}}var Ls={"-":"",_:" ",0:"0"},Z=/^\\s*\\d+/,Th=/^%/,Sh=/[\\\\^$*+?|[\\]().{}]/g;function D(e,t,n){var r=e<0?"-":"",i=(r?-e:e)+"",a=i.length;return r+(a<n?new Array(n-a+1).join(t)+i:i)}function Ch(e){return e.replace(Sh,"\\\\$&")}function Wn(e){return new RegExp("^(?:"+e.map(Ch).join("|")+")","i")}function Xn(e){return new Map(e.map((t,n)=>[t.toLowerCase(),n]))}function Ah(e,t,n){var r=Z.exec(t.slice(n,n+1));return r?(e.w=+r[0],n+r[0].length):-1}function Nh(e,t,n){var r=Z.exec(t.slice(n,n+1));return r?(e.u=+r[0],n+r[0].length):-1}function Rh(e,t,n){var r=Z.exec(t.slice(n,n+2));return r?(e.U=+r[0],n+r[0].length):-1}function $h(e,t,n){var r=Z.exec(t.slice(n,n+2));return r?(e.V=+r[0],n+r[0].length):-1}function Eh(e,t,n){var r=Z.exec(t.slice(n,n+2));return r?(e.W=+r[0],n+r[0].length):-1}function Us(e,t,n){var r=Z.exec(t.slice(n,n+4));return r?(e.y=+r[0],n+r[0].length):-1}function qs(e,t,n){var r=Z.exec(t.slice(n,n+2));return r?(e.y=+r[0]+(+r[0]>68?1900:2e3),n+r[0].length):-1}function Dh(e,t,n){var r=/^(Z)|([+-]\\d\\d)(?::?(\\d\\d))?/.exec(t.slice(n,n+6));return r?(e.Z=r[1]?0:-(r[2]+(r[3]||"00")),n+r[0].length):-1}function Ph(e,t,n){var r=Z.exec(t.slice(n,n+1));return r?(e.q=r[0]*3-3,n+r[0].length):-1}function Oh(e,t,n){var r=Z.exec(t.slice(n,n+2));return r?(e.m=r[0]-1,n+r[0].length):-1}function Fs(e,t,n){var r=Z.exec(t.slice(n,n+2));return r?(e.d=+r[0],n+r[0].length):-1}function Ih(e,t,n){var r=Z.exec(t.slice(n,n+3));return r?(e.m=0,e.d=+r[0],n+r[0].length):-1}function zs(e,t,n){var r=Z.exec(t.slice(n,n+2));return r?(e.H=+r[0],n+r[0].length):-1}function Lh(e,t,n){var r=Z.exec(t.slice(n,n+2));return r?(e.M=+r[0],n+r[0].length):-1}function Uh(e,t,n){var r=Z.exec(t.slice(n,n+2));return r?(e.S=+r[0],n+r[0].length):-1}function qh(e,t,n){var r=Z.exec(t.slice(n,n+3));return r?(e.L=+r[0],n+r[0].length):-1}function Fh(e,t,n){var r=Z.exec(t.slice(n,n+6));return r?(e.L=Math.floor(r[0]/1e3),n+r[0].length):-1}function zh(e,t,n){var r=Th.exec(t.slice(n,n+1));return r?n+r[0].length:-1}function Yh(e,t,n){var r=Z.exec(t.slice(n));return r?(e.Q=+r[0],n+r[0].length):-1}function Bh(e,t,n){var r=Z.exec(t.slice(n));return r?(e.s=+r[0],n+r[0].length):-1}function Ys(e,t){return D(e.getDate(),t,2)}function Hh(e,t){return D(e.getHours(),t,2)}function Gh(e,t){return D(e.getHours()%12||12,t,2)}function jh(e,t){return D(1+Ae.count(_e(e),e),t,3)}function Xs(e,t){return D(e.getMilliseconds(),t,3)}function Wh(e,t){return Xs(e,t)+"000"}function Xh(e,t){return D(e.getMonth()+1,t,2)}function Vh(e,t){return D(e.getMinutes(),t,2)}function Zh(e,t){return D(e.getSeconds(),t,2)}function Qh(e){var t=e.getDay();return t===0?7:t}function Jh(e,t){return D(Je.count(_e(e)-1,e),t,2)}function Vs(e){var t=e.getDay();return t>=4||t===0?Et(e):Et.ceil(e)}function Kh(e,t){return e=Vs(e),D(Et.count(_e(e),e)+(_e(e).getDay()===4),t,2)}function ed(e){return e.getDay()}function td(e,t){return D(Hn.count(_e(e)-1,e),t,2)}function nd(e,t){return D(e.getFullYear()%100,t,2)}function rd(e,t){return e=Vs(e),D(e.getFullYear()%100,t,2)}function id(e,t){return D(e.getFullYear()%1e4,t,4)}function ad(e,t){var n=e.getDay();return e=n>=4||n===0?Et(e):Et.ceil(e),D(e.getFullYear()%1e4,t,4)}function od(e){var t=e.getTimezoneOffset();return(t>0?"-":(t*=-1,"+"))+D(t/60|0,"0",2)+D(t%60,"0",2)}function Bs(e,t){return D(e.getUTCDate(),t,2)}function fd(e,t){return D(e.getUTCHours(),t,2)}function sd(e,t){return D(e.getUTCHours()%12||12,t,2)}function cd(e,t){return D(1+Pe.count(ve(e),e),t,3)}function Zs(e,t){return D(e.getUTCMilliseconds(),t,3)}function ud(e,t){return Zs(e,t)+"000"}function ld(e,t){return D(e.getUTCMonth()+1,t,2)}function hd(e,t){return D(e.getUTCMinutes(),t,2)}function dd(e,t){return D(e.getUTCSeconds(),t,2)}function bd(e){var t=e.getUTCDay();return t===0?7:t}function gd(e,t){return D(Ke.count(ve(e)-1,e),t,2)}function Qs(e){var t=e.getUTCDay();return t>=4||t===0?Pt(e):Pt.ceil(e)}function pd(e,t){return e=Qs(e),D(Pt.count(ve(e),e)+(ve(e).getUTCDay()===4),t,2)}function md(e){return e.getUTCDay()}function yd(e,t){return D(Gn.count(ve(e)-1,e),t,2)}function _d(e,t){return D(e.getUTCFullYear()%100,t,2)}function vd(e,t){return e=Qs(e),D(e.getUTCFullYear()%100,t,2)}function xd(e,t){return D(e.getUTCFullYear()%1e4,t,4)}function wd(e,t){var n=e.getUTCDay();return e=n>=4||n===0?Pt(e):Pt.ceil(e),D(e.getUTCFullYear()%1e4,t,4)}function Md(){return"+0000"}function Hs(){return"%"}function Gs(e){return+e}function js(e){return Math.floor(+e/1e3)}var pn,Vn,La,mn,ei;kd({dateTime:"%x, %X",date:"%-m/%-d/%Y",time:"%-I:%M:%S %p",periods:["AM","PM"],days:["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"],shortDays:["Sun","Mon","Tue","Wed","Thu","Fri","Sat"],months:["January","February","March","April","May","June","July","August","September","October","November","December"],shortMonths:["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]});function kd(e){return pn=Ws(e),Vn=pn.format,La=pn.parse,mn=pn.utcFormat,ei=pn.utcParse,pn}var Js="%Y-%m-%dT%H:%M:%S.%LZ";function Td(e){return e.toISOString()}var i6=Date.prototype.toISOString?Td:mn(Js);function Sd(e){var t=new Date(e);return isNaN(t)?null:t}var a6=+new Date("2000-01-01T00:00:00.000Z")?Sd:ei(Js);function Ye(e,t){switch(arguments.length){case 0:break;case 1:this.range(e);break;default:this.range(t).domain(e);break}return this}function st(e,t){switch(arguments.length){case 0:break;case 1:{typeof e=="function"?this.interpolator(e):this.range(e);break}default:{this.domain(e),typeof t=="function"?this.interpolator(t):this.range(t);break}}return this}var Ks=Symbol("implicit");function Zn(){var e=new Pn,t=[],n=[],r=Ks;function i(a){let o=e.get(a);if(o===void 0){if(r!==Ks)return r;e.set(a,o=t.push(a)-1)}return n[o%n.length]}return i.domain=function(a){if(!arguments.length)return t.slice();t=[],e=new Pn;for(let o of a)e.has(o)||e.set(o,t.push(o)-1);return i},i.range=function(a){return arguments.length?(n=Array.from(a),i):n.slice()},i.unknown=function(a){return arguments.length?(r=a,i):r},i.copy=function(){return Zn(t,n).unknown(r)},Ye.apply(i,arguments),i}function Cd(e){return function(){return e}}function Ua(e){return+e}var ec=[0,1];function ce(e){return e}function qa(e,t){return(t-=e=+e)?function(n){return(n-e)/t}:Cd(isNaN(t)?NaN:.5)}function Ad(e,t){var n;return e>t&&(n=e,e=t,t=n),function(r){return Math.max(e,Math.min(t,r))}}function Nd(e,t,n){var r=e[0],i=e[1],a=t[0],o=t[1];return i<r?(r=qa(i,r),a=n(o,a)):(r=qa(r,i),a=n(a,o)),function(f){return a(r(f))}}function Rd(e,t,n){var r=Math.min(e.length,t.length)-1,i=new Array(r),a=new Array(r),o=-1;for(e[r]<e[0]&&(e=e.slice().reverse(),t=t.slice().reverse());++o<r;)i[o]=qa(e[o],e[o+1]),a[o]=n(t[o],t[o+1]);return function(f){var s=On(e,f,1,r)-1;return a[s](i[s](f))}}function Qn(e,t){return t.domain(e.domain()).range(e.range()).interpolate(e.interpolate()).clamp(e.clamp()).unknown(e.unknown())}function ti(){var e=ec,t=ec,n=ot,r,i,a,o=ce,f,s,c;function l(){var h=Math.min(e.length,t.length);return o!==ce&&(o=Ad(e[0],e[h-1])),f=h>2?Rd:Nd,s=c=null,u}function u(h){return h==null||isNaN(h=+h)?a:(s||(s=f(e.map(r),t,n)))(r(o(h)))}return u.invert=function(h){return o(i((c||(c=f(t,e.map(r),Se)))(h)))},u.domain=function(h){return arguments.length?(e=Array.from(h,Ua),l()):e.slice()},u.range=function(h){return arguments.length?(t=Array.from(h),l()):t.slice()},u.rangeRound=function(h){return t=Array.from(h),n=Fn,l()},u.clamp=function(h){return arguments.length?(o=h?!0:ce,l()):o!==ce},u.interpolate=function(h){return arguments.length?(n=h,l()):n},u.unknown=function(h){return arguments.length?(a=h,u):a},function(h,d){return r=h,i=d,l()}}function fc(){return ti()(ce,ce)}function Fa(e,t,n,r){var i=In(e,t,n),a;switch(r=Xe(r??",f"),r.type){case"s":{var o=Math.max(Math.abs(e),Math.abs(t));return r.precision==null&&!isNaN(a=Jr(i,o))&&(r.precision=a),Bn(r,o)}case"":case"e":case"g":case"p":case"r":{r.precision==null&&!isNaN(a=Kr(i,Math.max(Math.abs(e),Math.abs(t))))&&(r.precision=a-(r.type==="e"));break}case"f":case"%":{r.precision==null&&!isNaN(a=Qr(i))&&(r.precision=a-(r.type==="%")*2);break}}return ln(r)}function Lt(e){var t=e.domain;return e.ticks=function(n){var r=t();return Ir(r[0],r[r.length-1],n??10)},e.tickFormat=function(n,r){var i=t();return Fa(i[0],i[i.length-1],n??10,r)},e.nice=function(n){n==null&&(n=10);var r=t(),i=0,a=r.length-1,o=r[i],f=r[a],s,c,l=10;for(f<o&&(c=o,o=f,f=c,c=i,i=a,a=c);l-- >0;){if(c=Pr(o,f,n),c===s)return r[i]=o,r[a]=f,t(r);if(c>0)o=Math.floor(o/c)*c,f=Math.ceil(f/c)*c;else if(c<0)o=Math.ceil(o*c)/c,f=Math.floor(f*c)/c;else break;s=c}return e},e}function za(){var e=fc();return e.copy=function(){return Qn(e,za())},Ye.apply(e,arguments),Lt(e)}function Ya(e){var t;function n(r){return r==null||isNaN(r=+r)?t:r}return n.invert=n,n.domain=n.range=function(r){return arguments.length?(e=Array.from(r,Ua),n):e.slice()},n.unknown=function(r){return arguments.length?(t=r,n):t},n.copy=function(){return Ya(e).unknown(t)},e=arguments.length?Array.from(e,Ua):[0,1],Lt(n)}function sc(e,t){e=e.slice();var n=0,r=e.length-1,i=e[n],a=e[r],o;return a<i&&(o=n,n=r,r=o,o=i,i=a,a=o),e[n]=t.floor(i),e[r]=t.ceil(a),e}function tc(e){return Math.log(e)}function nc(e){return Math.exp(e)}function $d(e){return-Math.log(-e)}function Ed(e){return-Math.exp(-e)}function Dd(e){return isFinite(e)?+("1e"+e):e<0?0:e}function Pd(e){return e===10?Dd:e===Math.E?Math.exp:t=>Math.pow(e,t)}function Od(e){return e===Math.E?Math.log:e===10&&Math.log10||e===2&&Math.log2||(e=Math.log(e),t=>Math.log(t)/e)}function rc(e){return(t,n)=>-e(-t,n)}function Ba(e){let t=e(tc,nc),n=t.domain,r=10,i,a;function o(){return i=Od(r),a=Pd(r),n()[0]<0?(i=rc(i),a=rc(a),e($d,Ed)):e(tc,nc),t}return t.base=function(f){return arguments.length?(r=+f,o()):r},t.domain=function(f){return arguments.length?(n(f),o()):n()},t.ticks=f=>{let s=n(),c=s[0],l=s[s.length-1],u=l<c;u&&([c,l]=[l,c]);let h=i(c),d=i(l),g,b,p=f==null?10:+f,m=[];if(!(r%1)&&d-h<p){if(h=Math.floor(h),d=Math.ceil(d),c>0){for(;h<=d;++h)for(g=1;g<r;++g)if(b=h<0?g/a(-h):g*a(h),!(b<c)){if(b>l)break;m.push(b)}}else for(;h<=d;++h)for(g=r-1;g>=1;--g)if(b=h>0?g/a(-h):g*a(h),!(b<c)){if(b>l)break;m.push(b)}m.length*2<p&&(m=Ir(c,l,p))}else m=Ir(h,d,Math.min(d-h,p)).map(a);return u?m.reverse():m},t.tickFormat=(f,s)=>{if(f==null&&(f=10),s==null&&(s=r===10?"s":","),typeof s!="function"&&(!(r%1)&&(s=Xe(s)).precision==null&&(s.trim=!0),s=ln(s)),f===1/0)return s;let c=Math.max(1,r*f/t.ticks().length);return l=>{let u=l/a(Math.round(i(l)));return u*r<r-.5&&(u*=r),u<=c?s(l):""}},t.nice=()=>n(sc(n(),{floor:f=>a(Math.floor(i(f))),ceil:f=>a(Math.ceil(i(f)))})),t}function Ha(){let e=Ba(ti()).domain([1,10]);return e.copy=()=>Qn(e,Ha()).base(e.base()),Ye.apply(e,arguments),e}function ic(e){return function(t){return Math.sign(t)*Math.log1p(Math.abs(t/e))}}function ac(e){return function(t){return Math.sign(t)*Math.expm1(Math.abs(t))*e}}function Ga(e){var t=1,n=e(ic(t),ac(t));return n.constant=function(r){return arguments.length?e(ic(t=+r),ac(t)):t},Lt(n)}function ja(){var e=Ga(ti());return e.copy=function(){return Qn(e,ja()).constant(e.constant())},Ye.apply(e,arguments)}function oc(e){return function(t){return t<0?-Math.pow(-t,e):Math.pow(t,e)}}function Id(e){return e<0?-Math.sqrt(-e):Math.sqrt(e)}function Ld(e){return e<0?-e*e:e*e}function Wa(e){var t=e(ce,ce),n=1;function r(){return n===1?e(ce,ce):n===.5?e(Id,Ld):e(oc(n),oc(1/n))}return t.exponent=function(i){return arguments.length?(n=+i,r()):n},Lt(t)}function ni(){var e=Wa(ti());return e.copy=function(){return Qn(e,ni()).exponent(e.exponent())},Ye.apply(e,arguments),e}function cc(){return ni.apply(null,arguments).exponent(.5)}function Xa(){var e=[],t=[],n=[],r;function i(){var o=0,f=Math.max(1,t.length);for(n=new Array(f-1);++o<f;)n[o-1]=Uf(e,o/f);return a}function a(o){return o==null||isNaN(o=+o)?r:t[On(n,o)]}return a.invertExtent=function(o){var f=t.indexOf(o);return f<0?[NaN,NaN]:[f>0?n[f-1]:e[0],f<n.length?n[f]:e[e.length-1]]},a.domain=function(o){if(!arguments.length)return e.slice();e=[];for(let f of o)f!=null&&!isNaN(f=+f)&&e.push(f);return e.sort(rn),i()},a.range=function(o){return arguments.length?(t=Array.from(o),i()):t.slice()},a.unknown=function(o){return arguments.length?(r=o,a):r},a.quantiles=function(){return n.slice()},a.copy=function(){return Xa().domain(e).range(t).unknown(r)},Ye.apply(a,arguments)}function Va(){var e=0,t=1,n=1,r=[.5],i=[0,1],a;function o(s){return s!=null&&s<=s?i[On(r,s,0,n)]:a}function f(){var s=-1;for(r=new Array(n);++s<n;)r[s]=((s+1)*t-(s-n)*e)/(n+1);return o}return o.domain=function(s){return arguments.length?([e,t]=s,e=+e,t=+t,f()):[e,t]},o.range=function(s){return arguments.length?(n=(i=Array.from(s)).length-1,f()):i.slice()},o.invertExtent=function(s){var c=i.indexOf(s);return c<0?[NaN,NaN]:c<1?[e,r[0]]:c>=n?[r[n-1],t]:[r[c-1],r[c]]},o.unknown=function(s){return arguments.length&&(a=s),o},o.thresholds=function(){return r.slice()},o.copy=function(){return Va().domain([e,t]).range(i).unknown(a)},Ye.apply(Lt(o),arguments)}function Za(){var e=[.5],t=[0,1],n,r=1;function i(a){return a!=null&&a<=a?t[On(e,a,0,r)]:n}return i.domain=function(a){return arguments.length?(e=Array.from(a),r=Math.min(e.length,t.length-1),i):e.slice()},i.range=function(a){return arguments.length?(t=Array.from(a),r=Math.min(e.length,t.length-1),i):t.slice()},i.invertExtent=function(a){var o=t.indexOf(a);return[e[o-1],e[o]]},i.unknown=function(a){return arguments.length?(n=a,i):n},i.copy=function(){return Za().domain(e).range(t).unknown(n)},Ye.apply(i,arguments)}function Ud(e){return new Date(e)}function qd(e){return e instanceof Date?+e:Math.round(e)}function Qa(e,t,n,r,i,a,o,f,s,c){var l=fc(),u=l.invert,h=l.domain,d=c(".%L"),g=c(":%S"),b=c("%I:%M"),p=c("%I %p"),m=c("%a %d"),w=c("%b %d"),x=c("%B"),v=c("%Y");function C(_){return(s(_)<_?d:f(_)<_?g:o(_)<_?b:a(_)<_?p:r(_)<_?i(_)<_?m:w:n(_)<_?x:v)(_)}return l.invert=function(_){return new Date(Math.round(u(_)))},l.domain=function(_){return arguments.length?h(Array.from(_,qd)):h().map(Ud)},l.ticks=function(_){var k=h();return e(k[0],k[k.length-1],_??10)},l.tickFormat=function(_,k){return k==null?C:c(k)},l.nice=function(_){var k=h();return(!_||typeof _.range!="function")&&(_=t(k[0],k[k.length-1],_??10)),_?h(sc(k,_)):l},l.copy=function(){return Qn(l,Qa(e,t,n,r,i,a,o,f,s,c))},l}function uc(){return Ye.apply(Qa(Os,Is,_e,Ot,Je,Ae,bn,hn,ye,Vn).domain([new Date(2e3,0,1),new Date(2e3,0,2)]),arguments)}function lc(){return Ye.apply(Qa(Ds,Ps,ve,It,Ke,Pe,gn,dn,ye,mn).domain([Date.UTC(2e3,0,1),Date.UTC(2e3,0,2)]),arguments)}function ri(){var e=0,t=1,n,r,i,a,o=ce,f=!1,s;function c(u){return u==null||isNaN(u=+u)?s:o(i===0?.5:(u=(a(u)-n)*i,f?Math.max(0,Math.min(1,u)):u))}c.domain=function(u){return arguments.length?([e,t]=u,n=a(e=+e),r=a(t=+t),i=n===r?0:1/(r-n),c):[e,t]},c.clamp=function(u){return arguments.length?(f=!!u,c):f},c.interpolator=function(u){return arguments.length?(o=u,c):o};function l(u){return function(h){var d,g;return arguments.length?([d,g]=h,o=u(d,g),c):[o(0),o(1)]}}return c.range=l(ot),c.rangeRound=l(Fn),c.unknown=function(u){return arguments.length?(s=u,c):s},function(u){return a=u,n=u(e),r=u(t),i=n===r?0:1/(r-n),c}}function ct(e,t){return t.domain(e.domain()).interpolator(e.interpolator()).clamp(e.clamp()).unknown(e.unknown())}function ii(){var e=Lt(ri()(ce));return e.copy=function(){return ct(e,ii())},st.apply(e,arguments)}function Ja(){var e=Ba(ri()).domain([1,10]);return e.copy=function(){return ct(e,Ja()).base(e.base())},st.apply(e,arguments)}function Ka(){var e=Ga(ri());return e.copy=function(){return ct(e,Ka()).constant(e.constant())},st.apply(e,arguments)}function ai(){var e=Wa(ri());return e.copy=function(){return ct(e,ai()).exponent(e.exponent())},st.apply(e,arguments)}function hc(){return ai.apply(null,arguments).exponent(.5)}function oi(){var e=0,t=.5,n=1,r=1,i,a,o,f,s,c=ce,l,u=!1,h;function d(b){return b==null||isNaN(b=+b)?h:(b=.5+((b=+l(b))-a)*(r*b<r*a?f:s),c(u?Math.max(0,Math.min(1,b)):b))}d.domain=function(b){return arguments.length?([e,t,n]=b,i=l(e=+e),a=l(t=+t),o=l(n=+n),f=i===a?0:.5/(a-i),s=a===o?0:.5/(o-a),r=a<i?-1:1,d):[e,t,n]},d.clamp=function(b){return arguments.length?(u=!!b,d):u},d.interpolator=function(b){return arguments.length?(c=b,d):c};function g(b){return function(p){var m,w,x;return arguments.length?([m,w,x]=p,c=Yn(b,[m,w,x]),d):[c(0),c(.5),c(1)]}}return d.range=g(ot),d.rangeRound=g(Fn),d.unknown=function(b){return arguments.length?(h=b,d):h},function(b){return l=b,i=b(e),a=b(t),o=b(n),f=i===a?0:.5/(a-i),s=a===o?0:.5/(o-a),r=a<i?-1:1,d}}function eo(){var e=Lt(oi()(ce));return e.copy=function(){return ct(e,eo())},st.apply(e,arguments)}function to(){var e=Ba(oi()).domain([.1,1,10]);return e.copy=function(){return ct(e,to()).base(e.base())},st.apply(e,arguments)}function no(){var e=Ga(oi());return e.copy=function(){return ct(e,no()).constant(e.constant())},st.apply(e,arguments)}function fi(){var e=Wa(oi());return e.copy=function(){return ct(e,fi()).exponent(e.exponent())},st.apply(e,arguments)}function dc(){return fi.apply(null,arguments).exponent(.5)}function N(e){for(var t=e.length/6|0,n=new Array(t),r=0;r<t;)n[r]="#"+e.slice(r*6,++r*6);return n}var bc=N("1f77b4ff7f0e2ca02cd627289467bd8c564be377c27f7f7fbcbd2217becf"),gc=N("7fc97fbeaed4fdc086ffff99386cb0f0027fbf5b17666666"),pc=N("1b9e77d95f027570b3e7298a66a61ee6ab02a6761d666666"),mc=N("4269d0efb118ff725c6cc5b03ca951ff8ab7a463f297bbf59c6b4e9498a0"),yc=N("a6cee31f78b4b2df8a33a02cfb9a99e31a1cfdbf6fff7f00cab2d66a3d9affff99b15928"),_c=N("fbb4aeb3cde3ccebc5decbe4fed9a6ffffcce5d8bdfddaecf2f2f2"),vc=N("b3e2cdfdcdaccbd5e8f4cae4e6f5c9fff2aef1e2cccccccc"),xc=N("e41a1c377eb84daf4a984ea3ff7f00ffff33a65628f781bf999999"),wc=N("66c2a5fc8d628da0cbe78ac3a6d854ffd92fe5c494b3b3b3"),Mc=N("8dd3c7ffffb3bebadafb807280b1d3fdb462b3de69fccde5d9d9d9bc80bdccebc5ffed6f"),p6=N("4e79a7f28e2ce1575976b7b259a14fedc949af7aa1ff9da79c755fbab0ab"),I=e=>Ca(e[e.length-1]),zd=new Array(3).concat("d8b365f5f5f55ab4ac","a6611adfc27d80cdc1018571","a6611adfc27df5f5f580cdc1018571","8c510ad8b365f6e8c3c7eae55ab4ac01665e","8c510ad8b365f6e8c3f5f5f5c7eae55ab4ac01665e","8c510abf812ddfc27df6e8c3c7eae580cdc135978f01665e","8c510abf812ddfc27df6e8c3f5f5f5c7eae580cdc135978f01665e","5430058c510abf812ddfc27df6e8c3c7eae580cdc135978f01665e003c30","5430058c510abf812ddfc27df6e8c3f5f5f5c7eae580cdc135978f01665e003c30").map(N),m6=I(zd),Yd=new Array(3).concat("af8dc3f7f7f77fbf7b","7b3294c2a5cfa6dba0008837","7b3294c2a5cff7f7f7a6dba0008837","762a83af8dc3e7d4e8d9f0d37fbf7b1b7837","762a83af8dc3e7d4e8f7f7f7d9f0d37fbf7b1b7837","762a839970abc2a5cfe7d4e8d9f0d3a6dba05aae611b7837","762a839970abc2a5cfe7d4e8f7f7f7d9f0d3a6dba05aae611b7837","40004b762a839970abc2a5cfe7d4e8d9f0d3a6dba05aae611b783700441b","40004b762a839970abc2a5cfe7d4e8f7f7f7d9f0d3a6dba05aae611b783700441b").map(N),y6=I(Yd),Bd=new Array(3).concat("e9a3c9f7f7f7a1d76a","d01c8bf1b6dab8e1864dac26","d01c8bf1b6daf7f7f7b8e1864dac26","c51b7de9a3c9fde0efe6f5d0a1d76a4d9221","c51b7de9a3c9fde0eff7f7f7e6f5d0a1d76a4d9221","c51b7dde77aef1b6dafde0efe6f5d0b8e1867fbc414d9221","c51b7dde77aef1b6dafde0eff7f7f7e6f5d0b8e1867fbc414d9221","8e0152c51b7dde77aef1b6dafde0efe6f5d0b8e1867fbc414d9221276419","8e0152c51b7dde77aef1b6dafde0eff7f7f7e6f5d0b8e1867fbc414d9221276419").map(N),_6=I(Bd),Hd=new Array(3).concat("998ec3f7f7f7f1a340","5e3c99b2abd2fdb863e66101","5e3c99b2abd2f7f7f7fdb863e66101","542788998ec3d8daebfee0b6f1a340b35806","542788998ec3d8daebf7f7f7fee0b6f1a340b35806","5427888073acb2abd2d8daebfee0b6fdb863e08214b35806","5427888073acb2abd2d8daebf7f7f7fee0b6fdb863e08214b35806","2d004b5427888073acb2abd2d8daebfee0b6fdb863e08214b358067f3b08","2d004b5427888073acb2abd2d8daebf7f7f7fee0b6fdb863e08214b358067f3b08").map(N),v6=I(Hd),Gd=new Array(3).concat("ef8a62f7f7f767a9cf","ca0020f4a58292c5de0571b0","ca0020f4a582f7f7f792c5de0571b0","b2182bef8a62fddbc7d1e5f067a9cf2166ac","b2182bef8a62fddbc7f7f7f7d1e5f067a9cf2166ac","b2182bd6604df4a582fddbc7d1e5f092c5de4393c32166ac","b2182bd6604df4a582fddbc7f7f7f7d1e5f092c5de4393c32166ac","67001fb2182bd6604df4a582fddbc7d1e5f092c5de4393c32166ac053061","67001fb2182bd6604df4a582fddbc7f7f7f7d1e5f092c5de4393c32166ac053061").map(N),x6=I(Gd),jd=new Array(3).concat("ef8a62ffffff999999","ca0020f4a582bababa404040","ca0020f4a582ffffffbababa404040","b2182bef8a62fddbc7e0e0e09999994d4d4d","b2182bef8a62fddbc7ffffffe0e0e09999994d4d4d","b2182bd6604df4a582fddbc7e0e0e0bababa8787874d4d4d","b2182bd6604df4a582fddbc7ffffffe0e0e0bababa8787874d4d4d","67001fb2182bd6604df4a582fddbc7e0e0e0bababa8787874d4d4d1a1a1a","67001fb2182bd6604df4a582fddbc7ffffffe0e0e0bababa8787874d4d4d1a1a1a").map(N),w6=I(jd),Wd=new Array(3).concat("fc8d59ffffbf91bfdb","d7191cfdae61abd9e92c7bb6","d7191cfdae61ffffbfabd9e92c7bb6","d73027fc8d59fee090e0f3f891bfdb4575b4","d73027fc8d59fee090ffffbfe0f3f891bfdb4575b4","d73027f46d43fdae61fee090e0f3f8abd9e974add14575b4","d73027f46d43fdae61fee090ffffbfe0f3f8abd9e974add14575b4","a50026d73027f46d43fdae61fee090e0f3f8abd9e974add14575b4313695","a50026d73027f46d43fdae61fee090ffffbfe0f3f8abd9e974add14575b4313695").map(N),M6=I(Wd),Xd=new Array(3).concat("fc8d59ffffbf91cf60","d7191cfdae61a6d96a1a9641","d7191cfdae61ffffbfa6d96a1a9641","d73027fc8d59fee08bd9ef8b91cf601a9850","d73027fc8d59fee08bffffbfd9ef8b91cf601a9850","d73027f46d43fdae61fee08bd9ef8ba6d96a66bd631a9850","d73027f46d43fdae61fee08bffffbfd9ef8ba6d96a66bd631a9850","a50026d73027f46d43fdae61fee08bd9ef8ba6d96a66bd631a9850006837","a50026d73027f46d43fdae61fee08bffffbfd9ef8ba6d96a66bd631a9850006837").map(N),k6=I(Xd),Vd=new Array(3).concat("fc8d59ffffbf99d594","d7191cfdae61abdda42b83ba","d7191cfdae61ffffbfabdda42b83ba","d53e4ffc8d59fee08be6f59899d5943288bd","d53e4ffc8d59fee08bffffbfe6f59899d5943288bd","d53e4ff46d43fdae61fee08be6f598abdda466c2a53288bd","d53e4ff46d43fdae61fee08bffffbfe6f598abdda466c2a53288bd","9e0142d53e4ff46d43fdae61fee08be6f598abdda466c2a53288bd5e4fa2","9e0142d53e4ff46d43fdae61fee08bffffbfe6f598abdda466c2a53288bd5e4fa2").map(N),T6=I(Vd),Zd=new Array(3).concat("e5f5f999d8c92ca25f","edf8fbb2e2e266c2a4238b45","edf8fbb2e2e266c2a42ca25f006d2c","edf8fbccece699d8c966c2a42ca25f006d2c","edf8fbccece699d8c966c2a441ae76238b45005824","f7fcfde5f5f9ccece699d8c966c2a441ae76238b45005824","f7fcfde5f5f9ccece699d8c966c2a441ae76238b45006d2c00441b").map(N),S6=I(Zd),Qd=new Array(3).concat("e0ecf49ebcda8856a7","edf8fbb3cde38c96c688419d","edf8fbb3cde38c96c68856a7810f7c","edf8fbbfd3e69ebcda8c96c68856a7810f7c","edf8fbbfd3e69ebcda8c96c68c6bb188419d6e016b","f7fcfde0ecf4bfd3e69ebcda8c96c68c6bb188419d6e016b","f7fcfde0ecf4bfd3e69ebcda8c96c68c6bb188419d810f7c4d004b").map(N),C6=I(Qd),Jd=new Array(3).concat("e0f3dba8ddb543a2ca","f0f9e8bae4bc7bccc42b8cbe","f0f9e8bae4bc7bccc443a2ca0868ac","f0f9e8ccebc5a8ddb57bccc443a2ca0868ac","f0f9e8ccebc5a8ddb57bccc44eb3d32b8cbe08589e","f7fcf0e0f3dbccebc5a8ddb57bccc44eb3d32b8cbe08589e","f7fcf0e0f3dbccebc5a8ddb57bccc44eb3d32b8cbe0868ac084081").map(N),A6=I(Jd),Kd=new Array(3).concat("fee8c8fdbb84e34a33","fef0d9fdcc8afc8d59d7301f","fef0d9fdcc8afc8d59e34a33b30000","fef0d9fdd49efdbb84fc8d59e34a33b30000","fef0d9fdd49efdbb84fc8d59ef6548d7301f990000","fff7ecfee8c8fdd49efdbb84fc8d59ef6548d7301f990000","fff7ecfee8c8fdd49efdbb84fc8d59ef6548d7301fb300007f0000").map(N),N6=I(Kd),e1=new Array(3).concat("ece2f0a6bddb1c9099","f6eff7bdc9e167a9cf02818a","f6eff7bdc9e167a9cf1c9099016c59","f6eff7d0d1e6a6bddb67a9cf1c9099016c59","f6eff7d0d1e6a6bddb67a9cf3690c002818a016450","fff7fbece2f0d0d1e6a6bddb67a9cf3690c002818a016450","fff7fbece2f0d0d1e6a6bddb67a9cf3690c002818a016c59014636").map(N),R6=I(e1),t1=new Array(3).concat("ece7f2a6bddb2b8cbe","f1eef6bdc9e174a9cf0570b0","f1eef6bdc9e174a9cf2b8cbe045a8d","f1eef6d0d1e6a6bddb74a9cf2b8cbe045a8d","f1eef6d0d1e6a6bddb74a9cf3690c00570b0034e7b","fff7fbece7f2d0d1e6a6bddb74a9cf3690c00570b0034e7b","fff7fbece7f2d0d1e6a6bddb74a9cf3690c00570b0045a8d023858").map(N),$6=I(t1),n1=new Array(3).concat("e7e1efc994c7dd1c77","f1eef6d7b5d8df65b0ce1256","f1eef6d7b5d8df65b0dd1c77980043","f1eef6d4b9dac994c7df65b0dd1c77980043","f1eef6d4b9dac994c7df65b0e7298ace125691003f","f7f4f9e7e1efd4b9dac994c7df65b0e7298ace125691003f","f7f4f9e7e1efd4b9dac994c7df65b0e7298ace125698004367001f").map(N),E6=I(n1),r1=new Array(3).concat("fde0ddfa9fb5c51b8a","feebe2fbb4b9f768a1ae017e","feebe2fbb4b9f768a1c51b8a7a0177","feebe2fcc5c0fa9fb5f768a1c51b8a7a0177","feebe2fcc5c0fa9fb5f768a1dd3497ae017e7a0177","fff7f3fde0ddfcc5c0fa9fb5f768a1dd3497ae017e7a0177","fff7f3fde0ddfcc5c0fa9fb5f768a1dd3497ae017e7a017749006a").map(N),D6=I(r1),i1=new Array(3).concat("edf8b17fcdbb2c7fb8","ffffcca1dab441b6c4225ea8","ffffcca1dab441b6c42c7fb8253494","ffffccc7e9b47fcdbb41b6c42c7fb8253494","ffffccc7e9b47fcdbb41b6c41d91c0225ea80c2c84","ffffd9edf8b1c7e9b47fcdbb41b6c41d91c0225ea80c2c84","ffffd9edf8b1c7e9b47fcdbb41b6c41d91c0225ea8253494081d58").map(N),P6=I(i1),a1=new Array(3).concat("f7fcb9addd8e31a354","ffffccc2e69978c679238443","ffffccc2e69978c67931a354006837","ffffccd9f0a3addd8e78c67931a354006837","ffffccd9f0a3addd8e78c67941ab5d238443005a32","ffffe5f7fcb9d9f0a3addd8e78c67941ab5d238443005a32","ffffe5f7fcb9d9f0a3addd8e78c67941ab5d238443006837004529").map(N),O6=I(a1),o1=new Array(3).concat("fff7bcfec44fd95f0e","ffffd4fed98efe9929cc4c02","ffffd4fed98efe9929d95f0e993404","ffffd4fee391fec44ffe9929d95f0e993404","ffffd4fee391fec44ffe9929ec7014cc4c028c2d04","ffffe5fff7bcfee391fec44ffe9929ec7014cc4c028c2d04","ffffe5fff7bcfee391fec44ffe9929ec7014cc4c02993404662506").map(N),I6=I(o1),f1=new Array(3).concat("ffeda0feb24cf03b20","ffffb2fecc5cfd8d3ce31a1c","ffffb2fecc5cfd8d3cf03b20bd0026","ffffb2fed976feb24cfd8d3cf03b20bd0026","ffffb2fed976feb24cfd8d3cfc4e2ae31a1cb10026","ffffccffeda0fed976feb24cfd8d3cfc4e2ae31a1cb10026","ffffccffeda0fed976feb24cfd8d3cfc4e2ae31a1cbd0026800026").map(N),L6=I(f1),s1=new Array(3).concat("deebf79ecae13182bd","eff3ffbdd7e76baed62171b5","eff3ffbdd7e76baed63182bd08519c","eff3ffc6dbef9ecae16baed63182bd08519c","eff3ffc6dbef9ecae16baed64292c62171b5084594","f7fbffdeebf7c6dbef9ecae16baed64292c62171b5084594","f7fbffdeebf7c6dbef9ecae16baed64292c62171b508519c08306b").map(N),U6=I(s1),c1=new Array(3).concat("e5f5e0a1d99b31a354","edf8e9bae4b374c476238b45","edf8e9bae4b374c47631a354006d2c","edf8e9c7e9c0a1d99b74c47631a354006d2c","edf8e9c7e9c0a1d99b74c47641ab5d238b45005a32","f7fcf5e5f5e0c7e9c0a1d99b74c47641ab5d238b45005a32","f7fcf5e5f5e0c7e9c0a1d99b74c47641ab5d238b45006d2c00441b").map(N),q6=I(c1),u1=new Array(3).concat("f0f0f0bdbdbd636363","f7f7f7cccccc969696525252","f7f7f7cccccc969696636363252525","f7f7f7d9d9d9bdbdbd969696636363252525","f7f7f7d9d9d9bdbdbd969696737373525252252525","fffffff0f0f0d9d9d9bdbdbd969696737373525252252525","fffffff0f0f0d9d9d9bdbdbd969696737373525252252525000000").map(N),F6=I(u1),l1=new Array(3).concat("efedf5bcbddc756bb1","f2f0f7cbc9e29e9ac86a51a3","f2f0f7cbc9e29e9ac8756bb154278f","f2f0f7dadaebbcbddc9e9ac8756bb154278f","f2f0f7dadaebbcbddc9e9ac8807dba6a51a34a1486","fcfbfdefedf5dadaebbcbddc9e9ac8807dba6a51a34a1486","fcfbfdefedf5dadaebbcbddc9e9ac8807dba6a51a354278f3f007d").map(N),z6=I(l1),h1=new Array(3).concat("fee0d2fc9272de2d26","fee5d9fcae91fb6a4acb181d","fee5d9fcae91fb6a4ade2d26a50f15","fee5d9fcbba1fc9272fb6a4ade2d26a50f15","fee5d9fcbba1fc9272fb6a4aef3b2ccb181d99000d","fff5f0fee0d2fcbba1fc9272fb6a4aef3b2ccb181d99000d","fff5f0fee0d2fcbba1fc9272fb6a4aef3b2ccb181da50f1567000d").map(N),Y6=I(h1),d1=new Array(3).concat("fee6cefdae6be6550d","feeddefdbe85fd8d3cd94701","feeddefdbe85fd8d3ce6550da63603","feeddefdd0a2fdae6bfd8d3ce6550da63603","feeddefdd0a2fdae6bfd8d3cf16913d948018c2d04","fff5ebfee6cefdd0a2fdae6bfd8d3cf16913d948018c2d04","fff5ebfee6cefdd0a2fdae6bfd8d3cf16913d94801a636037f2704").map(N),B6=I(d1);var H6=zn(Te(300,.5,0),Te(-240,.5,1)),G6=zn(Te(-100,.75,.35),Te(80,1.5,.8)),j6=zn(Te(260,.75,.35),Te(80,1.5,.8)),W6=Te();var X6=Rt(),V6=Math.PI/3,Z6=Math.PI*2/3;function si(e){var t=e.length;return function(n){return e[Math.max(0,Math.min(t-1,Math.floor(n*t)))]}}var Q6=si(N("44015444025645045745055946075a46085c460a5d460b5e470d60470e6147106347116447136548146748166848176948186a481a6c481b6d481c6e481d6f481f70482071482173482374482475482576482677482878482979472a7a472c7a472d7b472e7c472f7d46307e46327e46337f463480453581453781453882443983443a83443b84433d84433e85423f854240864241864142874144874045884046883f47883f48893e49893e4a893e4c8a3d4d8a3d4e8a3c4f8a3c508b3b518b3b528b3a538b3a548c39558c39568c38588c38598c375a8c375b8d365c8d365d8d355e8d355f8d34608d34618d33628d33638d32648e32658e31668e31678e31688e30698e306a8e2f6b8e2f6c8e2e6d8e2e6e8e2e6f8e2d708e2d718e2c718e2c728e2c738e2b748e2b758e2a768e2a778e2a788e29798e297a8e297b8e287c8e287d8e277e8e277f8e27808e26818e26828e26828e25838e25848e25858e24868e24878e23888e23898e238a8d228b8d228c8d228d8d218e8d218f8d21908d21918c20928c20928c20938c1f948c1f958b1f968b1f978b1f988b1f998a1f9a8a1e9b8a1e9c891e9d891f9e891f9f881fa0881fa1881fa1871fa28720a38620a48621a58521a68522a78522a88423a98324aa8325ab8225ac8226ad8127ad8128ae8029af7f2ab07f2cb17e2db27d2eb37c2fb47c31b57b32b67a34b67935b77937b87838b9773aba763bbb753dbc743fbc7340bd7242be7144bf7046c06f48c16e4ac16d4cc26c4ec36b50c46a52c56954c56856c66758c7655ac8645cc8635ec96260ca6063cb5f65cb5e67cc5c69cd5b6ccd5a6ece5870cf5773d05675d05477d1537ad1517cd2507fd34e81d34d84d44b86d54989d5488bd6468ed64590d74393d74195d84098d83e9bd93c9dd93ba0da39a2da37a5db36a8db34aadc32addc30b0dd2fb2dd2db5de2bb8de29bade28bddf26c0df25c2df23c5e021c8e020cae11fcde11dd0e11cd2e21bd5e21ad8e219dae319dde318dfe318e2e418e5e419e7e419eae51aece51befe51cf1e51df4e61ef6e620f8e621fbe723fde725")),J6=si(N("00000401000501010601010802010902020b02020d03030f03031204041405041606051806051a07061c08071e0907200a08220b09240c09260d0a290e0b2b100b2d110c2f120d31130d34140e36150e38160f3b180f3d19103f1a10421c10441d11471e114920114b21114e22115024125325125527125829115a2a115c2c115f2d11612f116331116533106734106936106b38106c390f6e3b0f703d0f713f0f72400f74420f75440f764510774710784910784a10794c117a4e117b4f127b51127c52137c54137d56147d57157e59157e5a167e5c167f5d177f5f187f601880621980641a80651a80671b80681c816a1c816b1d816d1d816e1e81701f81721f817320817521817621817822817922827b23827c23827e24828025828125818326818426818627818827818928818b29818c29818e2a81902a81912b81932b80942c80962c80982d80992d809b2e7f9c2e7f9e2f7fa02f7fa1307ea3307ea5317ea6317da8327daa337dab337cad347cae347bb0357bb2357bb3367ab5367ab73779b83779ba3878bc3978bd3977bf3a77c03a76c23b75c43c75c53c74c73d73c83e73ca3e72cc3f71cd4071cf4070d0416fd2426fd3436ed5446dd6456cd8456cd9466bdb476adc4869de4968df4a68e04c67e24d66e34e65e44f64e55064e75263e85362e95462ea5661eb5760ec5860ed5a5fee5b5eef5d5ef05f5ef1605df2625df2645cf3655cf4675cf4695cf56b5cf66c5cf66e5cf7705cf7725cf8745cf8765cf9785df9795df97b5dfa7d5efa7f5efa815ffb835ffb8560fb8761fc8961fc8a62fc8c63fc8e64fc9065fd9266fd9467fd9668fd9869fd9a6afd9b6bfe9d6cfe9f6dfea16efea36ffea571fea772fea973feaa74feac76feae77feb078feb27afeb47bfeb67cfeb77efeb97ffebb81febd82febf84fec185fec287fec488fec68afec88cfeca8dfecc8ffecd90fecf92fed194fed395fed597fed799fed89afdda9cfddc9efddea0fde0a1fde2a3fde3a5fde5a7fde7a9fde9aafdebacfcecaefceeb0fcf0b2fcf2b4fcf4b6fcf6b8fcf7b9fcf9bbfcfbbdfcfdbf")),K6=si(N("00000401000501010601010802010a02020c02020e03021004031204031405041706041907051b08051d09061f0a07220b07240c08260d08290e092b10092d110a30120a32140b34150b37160b39180c3c190c3e1b0c411c0c431e0c451f0c48210c4a230c4c240c4f260c51280b53290b552b0b572d0b592f0a5b310a5c320a5e340a5f3609613809623909633b09643d09653e0966400a67420a68440a68450a69470b6a490b6a4a0c6b4c0c6b4d0d6c4f0d6c510e6c520e6d540f6d550f6d57106e59106e5a116e5c126e5d126e5f136e61136e62146e64156e65156e67166e69166e6a176e6c186e6d186e6f196e71196e721a6e741a6e751b6e771c6d781c6d7a1d6d7c1d6d7d1e6d7f1e6c801f6c82206c84206b85216b87216b88226a8a226a8c23698d23698f24699025689225689326679526679727669827669a28659b29649d29649f2a63a02a63a22b62a32c61a52c60a62d60a82e5fa92e5eab2f5ead305dae305cb0315bb1325ab3325ab43359b63458b73557b93556ba3655bc3754bd3853bf3952c03a51c13a50c33b4fc43c4ec63d4dc73e4cc83f4bca404acb4149cc4248ce4347cf4446d04545d24644d34743d44842d54a41d74b3fd84c3ed94d3dda4e3cdb503bdd513ade5238df5337e05536e15635e25734e35933e45a31e55c30e65d2fe75e2ee8602de9612bea632aeb6429eb6628ec6726ed6925ee6a24ef6c23ef6e21f06f20f1711ff1731df2741cf3761bf37819f47918f57b17f57d15f67e14f68013f78212f78410f8850ff8870ef8890cf98b0bf98c0af98e09fa9008fa9207fa9407fb9606fb9706fb9906fb9b06fb9d07fc9f07fca108fca309fca50afca60cfca80dfcaa0ffcac11fcae12fcb014fcb216fcb418fbb61afbb81dfbba1ffbbc21fbbe23fac026fac228fac42afac62df9c72ff9c932f9cb35f8cd37f8cf3af7d13df7d340f6d543f6d746f5d949f5db4cf4dd4ff4df53f4e156f3e35af3e55df2e661f2e865f2ea69f1ec6df1ed71f1ef75f1f179f2f27df2f482f3f586f3f68af4f88ef5f992f6fa96f8fb9af9fc9dfafda1fcffa4")),e8=si(N("0d088710078813078916078a19068c1b068d1d068e20068f2206902406912605912805922a05932c05942e05952f059631059733059735049837049938049a3a049a3c049b3e049c3f049c41049d43039e44039e46039f48039f4903a04b03a14c02a14e02a25002a25102a35302a35502a45601a45801a45901a55b01a55c01a65e01a66001a66100a76300a76400a76600a76700a86900a86a00a86c00a86e00a86f00a87100a87201a87401a87501a87701a87801a87a02a87b02a87d03a87e03a88004a88104a78305a78405a78606a68707a68808a68a09a58b0aa58d0ba58e0ca48f0da4910ea3920fa39410a29511a19613a19814a099159f9a169f9c179e9d189d9e199da01a9ca11b9ba21d9aa31e9aa51f99a62098a72197a82296aa2395ab2494ac2694ad2793ae2892b02991b12a90b22b8fb32c8eb42e8db52f8cb6308bb7318ab83289ba3388bb3488bc3587bd3786be3885bf3984c03a83c13b82c23c81c33d80c43e7fc5407ec6417dc7427cc8437bc9447aca457acb4679cc4778cc4977cd4a76ce4b75cf4c74d04d73d14e72d24f71d35171d45270d5536fd5546ed6556dd7566cd8576bd9586ada5a6ada5b69db5c68dc5d67dd5e66de5f65de6164df6263e06363e16462e26561e26660e3685fe4695ee56a5de56b5de66c5ce76e5be76f5ae87059e97158e97257ea7457eb7556eb7655ec7754ed7953ed7a52ee7b51ef7c51ef7e50f07f4ff0804ef1814df1834cf2844bf3854bf3874af48849f48948f58b47f58c46f68d45f68f44f79044f79143f79342f89441f89540f9973ff9983ef99a3efa9b3dfa9c3cfa9e3bfb9f3afba139fba238fca338fca537fca636fca835fca934fdab33fdac33fdae32fdaf31fdb130fdb22ffdb42ffdb52efeb72dfeb82cfeba2cfebb2bfebd2afebe2afec029fdc229fdc328fdc527fdc627fdc827fdca26fdcb26fccd25fcce25fcd025fcd225fbd324fbd524fbd724fad824fada24f9dc24f9dd25f8df25f8e125f7e225f7e425f6e626f6e826f5e926f5eb27f4ed27f3ee27f3f027f2f227f1f426f1f525f0f724f0f921"));var K="year",ue="quarter",ne="month",G="week",le="date",te="day",et="dayofyear",xe="hours",we="minutes",Ne="seconds",Oe="milliseconds",g1=[K,ue,ne,G,le,te,et,xe,we,Ne,Oe],ro=g1.reduce((e,t,n)=>(e[t]=1+n,e),{});function Ac(e){let t=kt(e).slice(),n={};return t.length||B("Missing time unit."),t.forEach(i=>{me(ro,i)?n[i]=1:B(`Invalid time unit: ${i}.`)}),(n[G]||n[te]?1:0)+(n[ue]||n[ne]||n[le]?1:0)+(n[et]?1:0)>1&&B(`Incompatible time units: ${e}`),t.sort((i,a)=>ro[i]-ro[a]),t}var i8={[K]:"%Y ",[ue]:"Q%q ",[ne]:"%b ",[le]:"%d ",[G]:"W%U ",[te]:"%a ",[et]:"%j ",[xe]:"%H:00",[we]:"00:%M",[Ne]:":%S",[Oe]:".%L",[`${K}-${ne}`]:"%Y-%m ",[`${K}-${ne}-${le}`]:"%Y-%m-%d ",[`${xe}-${we}`]:"%H:%M"};var Ut=new Date;function oo(e){return Ut.setFullYear(e),Ut.setMonth(0),Ut.setDate(1),Ut.setHours(0,0,0,0),Ut}function p1(e){return Ae.count(oo(e.getFullYear())-1,e)}function kc(e){return Je.count(oo(e.getFullYear())-1,e)}function io(e){return oo(e).getDay()}function m1(e,t,n,r,i,a,o){if(0<=e&&e<100){let f=new Date(-1,t,n,r,i,a,o);return f.setFullYear(e),f}return new Date(e,t,n,r,i,a,o)}function y1(e){let t=Date.UTC(e.getUTCFullYear(),0,1);return Pe.count(t-1,e)}function Tc(e){let t=Date.UTC(e.getUTCFullYear(),0,1);return Ke.count(t-1,e)}function ao(e){return Ut.setTime(Date.UTC(e,0,1)),Ut.getUTCDay()}function _1(e,t,n,r,i,a,o){if(0<=e&&e<100){let f=new Date(Date.UTC(-1,t,n,r,i,a,o));return f.setUTCFullYear(n.y),f}return new Date(Date.UTC(e,t,n,r,i,a,o))}function Nc(e,t,n,r,i){let a=t||1,o=Ee(e),f=(m,w,x)=>(x=x||m,v1(n[x],r[x],m===o&&a,w)),s=new Date,c=en(e),l=c[K]?f(K):ca(2012),u=c[ne]?f(ne):c[ue]?f(ue):Jt,h=c[G]&&c[te]?f(te,1,G+te):c[G]?f(G,1):c[te]?f(te,1):c[le]?f(le,1):c[et]?f(et,1):Cf,d=c[xe]?f(xe):Jt,g=c[we]?f(we):Jt,b=c[Ne]?f(Ne):Jt,p=c[Oe]?f(Oe):Jt;return function(m){s.setTime(+m);let w=l(s);return i(w,u(s),h(s,w),d(s),g(s),b(s),p(s))}}function v1(e,t,n,r){let i=n<=1?e:r?(a,o)=>r+n*Math.floor((e(a,o)-r)/n):(a,o)=>n*Math.floor(e(a,o)/n);return t?(a,o)=>t(i(a,o),o):i}function yn(e,t,n){return t+e*7-(n+6)%7}var x1={[K]:e=>e.getFullYear(),[ue]:e=>Math.floor(e.getMonth()/3),[ne]:e=>e.getMonth(),[le]:e=>e.getDate(),[xe]:e=>e.getHours(),[we]:e=>e.getMinutes(),[Ne]:e=>e.getSeconds(),[Oe]:e=>e.getMilliseconds(),[et]:e=>p1(e),[G]:e=>kc(e),[G+te]:(e,t)=>yn(kc(e),e.getDay(),io(t)),[te]:(e,t)=>yn(1,e.getDay(),io(t))},w1={[ue]:e=>3*e,[G]:(e,t)=>yn(e,0,io(t))};function Rc(e,t){return Nc(e,t||1,x1,w1,m1)}var M1={[K]:e=>e.getUTCFullYear(),[ue]:e=>Math.floor(e.getUTCMonth()/3),[ne]:e=>e.getUTCMonth(),[le]:e=>e.getUTCDate(),[xe]:e=>e.getUTCHours(),[we]:e=>e.getUTCMinutes(),[Ne]:e=>e.getUTCSeconds(),[Oe]:e=>e.getUTCMilliseconds(),[et]:e=>y1(e),[G]:e=>Tc(e),[te]:(e,t)=>yn(1,e.getUTCDay(),ao(t)),[G+te]:(e,t)=>yn(Tc(e),e.getUTCDay(),ao(t))},k1={[ue]:e=>3*e,[G]:(e,t)=>yn(e,0,ao(t))};function $c(e,t){return Nc(e,t||1,M1,k1,_1)}var T1={[K]:_e,[ue]:Ot.every(3),[ne]:Ot,[G]:Je,[le]:Ae,[te]:Ae,[et]:Ae,[xe]:bn,[we]:hn,[Ne]:ye,[Oe]:ft},S1={[K]:ve,[ue]:It.every(3),[ne]:It,[G]:Ke,[le]:Pe,[te]:Pe,[et]:Pe,[xe]:gn,[we]:dn,[Ne]:ye,[Oe]:ft};function ir(e){return T1[e]}function ar(e){return S1[e]}var Jn=1e3,Kn=Jn*60,er=Kn*60,ci=er*24,C1=ci*7,Sc=ci*30,A1=ci*365,N1=[K,ne,le,xe,we,Ne,Oe],tr=N1.slice(0,-1),nr=tr.slice(0,-1),rr=nr.slice(0,-1),R1=rr.slice(0,-1),$1=[K,G],Cc=[K,ne],E1=[K],a8=[[tr,1,Jn],[tr,5,5*Jn],[tr,15,15*Jn],[tr,30,30*Jn],[nr,1,Kn],[nr,5,5*Kn],[nr,15,15*Kn],[nr,30,30*Kn],[rr,1,er],[rr,3,3*er],[rr,6,6*er],[rr,12,12*er],[R1,1,ci],[$1,1,C1],[Cc,1,Sc],[Cc,3,3*Sc],[E1,1,A1]];function P1(e,t,n){let r=e-t+n*2;return e?r>0?r:1:0}var O1="identity",so="linear",ut="log",co="pow",uo="sqrt",lo="symlog",or="time",fr="utc",_n="sequential",sr="diverging",ui="quantile",ho="quantize",Oc="threshold",I1="ordinal",L1="point",U1="band",q1="bin-ordinal",Q="continuous",cr="discrete",ur="discretizing",Ie="interpolating",bo="temporal";function F1(e){return function(t){let n=t[0],r=t[1],i;return r<n&&(i=n,n=r,r=i),[e.invert(n),e.invert(r)]}}function z1(e){return function(t){let n=e.range(),r=t[0],i=t[1],a=-1,o,f,s,c;for(i<r&&(f=r,r=i,i=f),s=0,c=n.length;s<c;++s)n[s]>=r&&n[s]<=i&&(a<0&&(a=s),o=s);if(!(a<0))return r=e.invertExtent(n[a]),i=e.invertExtent(n[o]),[r[0]===void 0?r[1]:r[0],i[1]===void 0?i[0]:i[1]]}}function go(){let e=Zn().unknown(void 0),t=e.domain,n=e.range,r=[0,1],i,a,o=!1,f=0,s=0,c=.5;delete e.unknown;function l(){let u=t().length,h=r[1]<r[0],d=r[1-h],g=P1(u,f,s),b=r[h-0];i=(d-b)/(g||1),o&&(i=Math.floor(i)),b+=(d-b-i*(u-f))*c,a=i*(1-f),o&&(b=Math.round(b),a=Math.round(a));let p=Er(u).map(m=>b+i*m);return n(h?p.reverse():p)}return e.domain=function(u){return arguments.length?(t(u),l()):t()},e.range=function(u){return arguments.length?(r=[+u[0],+u[1]],l()):r.slice()},e.rangeRound=function(u){return r=[+u[0],+u[1]],o=!0,l()},e.bandwidth=function(){return a},e.step=function(){return i},e.round=function(u){return arguments.length?(o=!!u,l()):o},e.padding=function(u){return arguments.length?(s=Math.max(0,Math.min(1,u)),f=s,l()):f},e.paddingInner=function(u){return arguments.length?(f=Math.max(0,Math.min(1,u)),l()):f},e.paddingOuter=function(u){return arguments.length?(s=Math.max(0,Math.min(1,u)),l()):s},e.align=function(u){return arguments.length?(c=Math.max(0,Math.min(1,u)),l()):c},e.invertRange=function(u){if(u[0]==null||u[1]==null)return;let h=r[1]<r[0],d=h?n().reverse():n(),g=d.length-1,b=+u[0],p=+u[1],m,w,x;if(!(b!==b||p!==p)&&(p<b&&(x=b,b=p,p=x),!(p<d[0]||b>r[1-h])))return m=Math.max(0,Dn(d,b)-1),w=b===p?m:Dn(d,p)-1,b-d[m]>a+1e-10&&++m,h&&(x=m,m=g-w,w=g-x),m>w?void 0:t().slice(m,w+1)},e.invert=function(u){let h=e.invertRange([u,u]);return h&&h[0]},e.copy=function(){return go().domain(t()).range(r).round(o).paddingInner(f).paddingOuter(s).align(c)},l()}function Ic(e){let t=e.copy;return e.padding=e.paddingOuter,delete e.paddingInner,e.copy=function(){return Ic(t())},e}function Y1(){return Ic(go().paddingInner(1))}var B1=Array.prototype.map;function H1(e){return B1.call(e,sa)}var G1=Array.prototype.slice;function Lc(){let e=[],t=[];function n(r){return r==null||r!==r?void 0:t[(ha(e,r)-1)%t.length]}return n.domain=function(r){return arguments.length?(e=H1(r),n):e.slice()},n.range=function(r){return arguments.length?(t=G1.call(r),n):t.slice()},n.tickFormat=function(r,i){return Fa(e[0],Ee(e),r??10,i)},n.copy=function(){return Lc().domain(n.domain()).range(n.range())},n}var li=new Map,j1=Symbol("vega_scale");function W1(e){return e[j1]=!0,e}function X1(e,t,n){let r=function(){let a=t();return a.invertRange||(a.invertRange=a.invert?F1(a):a.invertExtent?z1(a):void 0),a.type=e,W1(a)};return r.metadata=en(kt(n)),r}function O(e,t,n){return arguments.length>1?(li.set(e,X1(e,t,n)),this):V1(e)?li.get(e):void 0}O(O1,Ya);O(so,za,Q);O(ut,Ha,[Q,ut]);O(co,ni,Q);O(uo,cc,Q);O(lo,ja,Q);O(or,uc,[Q,bo]);O(fr,lc,[Q,bo]);O(_n,ii,[Q,Ie]);O(`${_n}-${so}`,ii,[Q,Ie]);O(`${_n}-${ut}`,Ja,[Q,Ie,ut]);O(`${_n}-${co}`,ai,[Q,Ie]);O(`${_n}-${uo}`,hc,[Q,Ie]);O(`${_n}-${lo}`,Ka,[Q,Ie]);O(`${sr}-${so}`,eo,[Q,Ie]);O(`${sr}-${ut}`,to,[Q,Ie,ut]);O(`${sr}-${co}`,fi,[Q,Ie]);O(`${sr}-${uo}`,dc,[Q,Ie]);O(`${sr}-${lo}`,no,[Q,Ie]);O(ui,Xa,[ur,ui]);O(ho,Va,ur);O(Oc,Za,ur);O(q1,Lc,[cr,ur]);O(I1,Zn,cr);O(U1,go,cr);O(L1,Y1,cr);function V1(e){return li.has(e)}function hi(e,t){let n=li.get(e);return n&&n.metadata[t]}function po(e){return hi(e,cr)}function Z1(e){return hi(e,ur)}function Q1(e){return hi(e,ut)}function J1(e){return hi(e,bo)}function K1(e,t,n){return Yn(e2(t||"rgb",n),e)}function e2(e,t){let n=Na[t2(e)];return t!=null&&n&&n.gamma?n.gamma(t):n}function t2(e){return"interpolate"+e.toLowerCase().split("-").map(t=>t[0].toUpperCase()+t.slice(1)).join("")}var n2={blues:"cfe1f2bed8eca8cee58fc1de74b2d75ba3cf4592c63181bd206fb2125ca40a4a90",greens:"d3eecdc0e6baabdda594d3917bc77d60ba6c46ab5e329a512089430e7735036429",greys:"e2e2e2d4d4d4c4c4c4b1b1b19d9d9d8888887575756262624d4d4d3535351e1e1e",oranges:"fdd8b3fdc998fdb87bfda55efc9244f87f2cf06b18e4580bd14904b93d029f3303",purples:"e2e1efd4d4e8c4c5e0b4b3d6a3a0cc928ec3827cb97566ae684ea25c3696501f8c",reds:"fdc9b4fcb49afc9e80fc8767fa7051f6573fec3f2fdc2a25c81b1db21218970b13",blueGreen:"d5efedc1e8e0a7ddd18bd2be70c6a958ba9144ad77319c5d2089460e7736036429",bluePurple:"ccddecbad0e4a8c2dd9ab0d4919cc98d85be8b6db28a55a6873c99822287730f71",greenBlue:"d3eecec5e8c3b1e1bb9bd8bb82cec269c2ca51b2cd3c9fc7288abd1675b10b60a1",orangeRed:"fddcaffdcf9bfdc18afdad77fb9562f67d53ee6545e24932d32d1ebf130da70403",purpleBlue:"dbdaebc8cee4b1c3de97b7d87bacd15b9fc93a90c01e7fb70b70ab056199045281",purpleBlueGreen:"dbd8eac8cee4b0c3de93b7d872acd1549fc83892bb1c88a3097f8702736b016353",purpleRed:"dcc9e2d3b3d7ce9eccd186c0da6bb2e14da0e23189d91e6fc61159ab07498f023a",redPurple:"fccfccfcbec0faa9b8f98faff571a5ec539ddb3695c41b8aa908808d0179700174",yellowGreen:"e4f4acd1eca0b9e2949ed68880c97c62bb6e47aa5e3297502083440e723b036034",yellowOrangeBrown:"feeaa1fedd84fecc63feb746fca031f68921eb7215db5e0bc54c05ab3d038f3204",yellowOrangeRed:"fee087fed16ffebd59fea849fd903efc7335f9522bee3423de1b20ca0b22af0225",blueOrange:"134b852f78b35da2cb9dcae1d2e5eff2f0ebfce0bafbbf74e8932fc5690d994a07",brownBlueGreen:"704108a0651ac79548e3c78af3e6c6eef1eac9e9e48ed1c74da79e187a72025147",purpleGreen:"5b1667834792a67fb6c9aed3e6d6e8eff0efd9efd5aedda971bb75368e490e5e29",purpleOrange:"4114696647968f83b7b9b4d6dadbebf3eeeafce0bafbbf74e8932fc5690d994a07",redBlue:"8c0d25bf363adf745ef4ae91fbdbc9f2efeed2e5ef9dcae15da2cb2f78b3134b85",redGrey:"8c0d25bf363adf745ef4ae91fcdccbfaf4f1e2e2e2c0c0c0969696646464343434",yellowGreenBlue:"eff9bddbf1b4bde5b594d5b969c5be45b4c22c9ec02182b82163aa23479c1c3185",redYellowBlue:"a50026d4322cf16e43fcac64fedd90faf8c1dcf1ecabd6e875abd04a74b4313695",redYellowGreen:"a50026d4322cf16e43fcac63fedd8df9f7aed7ee8ea4d86e64bc6122964f006837",pinkYellowGreen:"8e0152c0267edd72adf0b3d6faddedf5f3efe1f2cab6de8780bb474f9125276419",spectral:"9e0142d13c4bf0704afcac63fedd8dfbf8b0e0f3a1a9dda269bda94288b55e4fa2",viridis:"440154470e61481a6c482575472f7d443a834144873d4e8a39568c35608d31688e2d708e2a788e27818e23888e21918d1f988b1fa08822a8842ab07f35b77943bf7154c56866cc5d7ad1518fd744a5db36bcdf27d2e21be9e51afde725",magma:"0000040404130b0924150e3720114b2c11603b0f704a107957157e651a80721f817f24828c29819a2e80a8327db6377ac43c75d1426fde4968e95462f1605df76f5cfa7f5efc8f65fe9f6dfeaf78febf84fece91fddea0fcedaffcfdbf",inferno:"0000040403130c0826170c3b240c4f330a5f420a68500d6c5d126e6b176e781c6d86216b932667a12b62ae305cbb3755c73e4cd24644dd513ae65c30ed6925f3771af8850ffb9506fca50afcb519fac62df6d645f2e661f3f484fcffa4",plasma:"0d088723069033059742039d5002a25d01a66a00a87801a88405a7900da49c179ea72198b12a90ba3488c33d80cb4779d35171da5a69e16462e76e5bed7953f2834cf68f44fa9a3dfca636fdb32ffec029fcce25f9dc24f5ea27f0f921",cividis:"00205100235800265d002961012b65042e670831690d346b11366c16396d1c3c6e213f6e26426e2c456e31476e374a6e3c4d6e42506e47536d4c566d51586e555b6e5a5e6e5e616e62646f66676f6a6a706e6d717270717573727976737c79747f7c75827f758682768985778c8877908b78938e789691789a94789e9778a19b78a59e77a9a177aea575b2a874b6ab73bbaf71c0b26fc5b66dc9b96acebd68d3c065d8c462ddc85fe2cb5ce7cf58ebd355f0d652f3da4ff7de4cfae249fce647",rainbow:"6e40aa883eb1a43db3bf3cafd83fa4ee4395fe4b83ff576eff6659ff7847ff8c38f3a130e2b72fcfcc36bee044aff05b8ff4576ff65b52f6673af27828ea8d1ddfa319d0b81cbecb23abd82f96e03d82e14c6edb5a5dd0664dbf6e40aa",sinebow:"ff4040fc582af47218e78d0bd5a703bfbf00a7d5038de70b72f41858fc2a40ff402afc5818f4720be78d03d5a700bfbf03a7d50b8de71872f42a58fc4040ff582afc7218f48d0be7a703d5bf00bfd503a7e70b8df41872fc2a58ff4040",turbo:"23171b32204a3e2a71453493493eae4b49c54a53d7485ee44569ee4074f53c7ff8378af93295f72e9ff42ba9ef28b3e926bce125c5d925cdcf27d5c629dcbc2de3b232e9a738ee9d3ff39347f68950f9805afc7765fd6e70fe667cfd5e88fc5795fb51a1f84badf545b9f140c5ec3cd0e637dae034e4d931ecd12ef4c92bfac029ffb626ffad24ffa223ff9821ff8d1fff821dff771cfd6c1af76118f05616e84b14df4111d5380fcb2f0dc0260ab61f07ac1805a313029b0f00950c00910b00",browns:"eedbbdecca96e9b97ae4a865dc9856d18954c7784cc0673fb85536ad44339f3632",tealBlues:"bce4d89dd3d181c3cb65b3c245a2b9368fae347da0306a932c5985",teals:"bbdfdfa2d4d58ac9c975bcbb61b0af4da5a43799982b8b8c1e7f7f127273006667",warmGreys:"dcd4d0cec5c1c0b8b4b3aaa7a59c9998908c8b827f7e7673726866665c5a59504e",goldGreen:"f4d166d5ca60b6c35c98bb597cb25760a6564b9c533f8f4f33834a257740146c36",goldOrange:"f4d166f8be5cf8aa4cf5983bf3852aef701be2621fd65322c54923b142239e3a26",goldRed:"f4d166f6be59f9aa51fc964ef6834bee734ae56249db5247cf4244c43141b71d3e",lightGreyRed:"efe9e6e1dad7d5cbc8c8bdb9bbaea9cd967ddc7b43e15f19df4011dc000b",lightGreyTeal:"e4eaead6dcddc8ced2b7c2c7a6b4bc64b0bf22a6c32295c11f85be1876bc",lightMulti:"e0f1f2c4e9d0b0de9fd0e181f6e072f6c053f3993ef77440ef4a3c",lightOrange:"f2e7daf7d5baf9c499fab184fa9c73f68967ef7860e8645bde515bd43d5b",lightTealBlue:"e3e9e0c0dccf9aceca7abfc859afc0389fb9328dad2f7ca0276b95255988",darkBlue:"3232322d46681a5c930074af008cbf05a7ce25c0dd38daed50f3faffffff",darkGold:"3c3c3c584b37725e348c7631ae8b2bcfa424ecc31ef9de30fff184ffffff",darkGreen:"3a3a3a215748006f4d048942489e4276b340a6c63dd2d836ffeb2cffffaa",darkMulti:"3737371f5287197d8c29a86995ce3fffe800ffffff",darkRed:"3434347036339e3c38cc4037e75d1eec8620eeab29f0ce32ffeb2c"},r2={accent:gc,category10:bc,category20:"1f77b4aec7e8ff7f0effbb782ca02c98df8ad62728ff98969467bdc5b0d58c564bc49c94e377c2f7b6d27f7f7fc7c7c7bcbd22dbdb8d17becf9edae5",category20b:"393b795254a36b6ecf9c9ede6379398ca252b5cf6bcedb9c8c6d31bd9e39e7ba52e7cb94843c39ad494ad6616be7969c7b4173a55194ce6dbdde9ed6",category20c:"3182bd6baed69ecae1c6dbefe6550dfd8d3cfdae6bfdd0a231a35474c476a1d99bc7e9c0756bb19e9ac8bcbddcdadaeb636363969696bdbdbdd9d9d9",dark2:pc,observable10:mc,paired:yc,pastel1:_c,pastel2:vc,set1:xc,set2:wc,set3:Mc,tableau10:"4c78a8f58518e4575672b7b254a24beeca3bb279a2ff9da69d755dbab0ac",tableau20:"4c78a89ecae9f58518ffbf7954a24b88d27ab79a20f2cf5b43989483bcb6e45756ff9d9879706ebab0acd67195fcbfd2b279a2d6a5c99e765fd8b5a5"};function Uc(e){if(se(e))return e;let t=e.length/6|0,n=new Array(t);for(let r=0;r<t;)n[r]="#"+e.slice(r*6,++r*6);return n}function qc(e,t){for(let n in e)i2(n,t(e[n]))}var Ec={};qc(r2,Uc);qc(n2,e=>K1(Uc(e)));function i2(e,t){return e=e&&e.toLowerCase(),arguments.length>1?(Ec[e]=t,this):Ec[e]}var a2="symbol",o2="discrete";var f2=e=>se(e)?e.map(t=>String(t)):String(e),s2=(e,t)=>e[1]-t[1],c2=(e,t)=>t[1]-e[1];function u2(e,t,n){let r=e.range(),i=r[0],a=Ee(r),o=s2;if(i>a&&(r=a,a=i,i=r,o=c2),i=Math.floor(i),a=Math.ceil(a),t=t.map(f=>[f,e(f)]).filter(f=>i<=f[1]&&f[1]<=a).sort(o).map(f=>f[0]),n>0&&t.length>1){let f=[t[0],Ee(t)];for(;t.length>n&&t.length>=3;)t=t.filter((s,c)=>!(c%2));t.length<3&&(t=f)}return t}function Fc(e,t){return e.bins?u2(e,e.bins,t):e.ticks?e.ticks(t):e.domain()}function l2(e,t,n,r,i,a){let o=t.type,f=f2;if(o===or||i===or)f=e.timeFormat(r);else if(o===fr||i===fr)f=e.utcFormat(r);else if(Q1(o)){let s=e.formatFloat(r);if(a||t.bins)f=s;else{let c=zc(t,n,!1);f=l=>c(l)?s(l):""}}else if(t.tickFormat){let s=t.domain();f=e.formatSpan(s[0],s[s.length-1],n,r)}else r&&(f=e.format(r));return f}function zc(e,t,n){let r=Fc(e,t),i=e.base(),a=Math.log(i),o=Math.max(1,i*t/r.length),f=s=>{let c=s/Math.pow(i,Math.round(Math.log(s)/a));return c*i<i-.5&&(c*=i),c<=o};return n?r.filter(f):f}var fo={[ui]:"quantiles",[ho]:"thresholds",[Oc]:"domain"},Yc={[ui]:"quantiles",[ho]:"domain"};function h2(e,t){return e.bins?g2(e.bins):e.type===ut?zc(e,t,!0):fo[e.type]?b2(e[fo[e.type]]()):Fc(e,t)}function d2(e,t,n){let r=t[Yc[t.type]](),i=r.length,a=i>1?r[1]-r[0]:r[0],o;for(o=1;o<i;++o)a=Math.min(a,r[o]-r[o-1]);return e.formatSpan(0,a,30,n)}function b2(e){let t=[-1/0].concat(e);return t.max=1/0,t}function g2(e){let t=e.slice(0,-1);return t.max=Ee(e),t}var p2=e=>fo[e.type]||e.bins;function m2(e,t,n,r,i,a,o){let f=Yc[t.type]&&a!==or&&a!==fr?d2(e,t,i):l2(e,t,n,i,a,o);return r===a2&&p2(t)?y2(f):r===o2?_2(f):v2(f)}var y2=e=>(t,n,r)=>{let i=Dc(r[n+1],Dc(r.max,1/0)),a=Pc(t,e),o=Pc(i,e);return a&&o?a+" \\u2013 "+o:o?"< "+o:"\\u2265 "+a},Dc=(e,t)=>e??t,_2=e=>(t,n)=>n?e(t):null,v2=e=>t=>e(t),Pc=(e,t)=>Number.isFinite(e)?t(e):null;function x2(e,t,n,r){let i=r||t.type;return Kt(n)&&J1(i)&&(n=n.replace(/%a/g,"%A").replace(/%b/g,"%B")),!n&&i===or?e.timeFormat("%A, %d %B %Y, %X"):!n&&i===fr?e.utcFormat("%A, %d %B %Y, %X UTC"):m2(e,t,5,null,n,r,!0)}function mo(e,t,n){n=n||{};let r=Math.max(3,n.maxlen||7),i=x2(e,t,n.format,n.formatType);if(Z1(t.type)){let a=h2(t).slice(1).map(i),o=a.length;return`${o} boundar${o===1?"y":"ies"}: ${a.join(", ")}`}else if(po(t.type)){let a=t.domain(),o=a.length,f=o>r?a.slice(0,r-2).map(i).join(", ")+", ending with "+a.slice(-1).map(i):a.map(i).join(", ");return`${o} value${o===1?"":"s"}: ${f}`}else{let a=t.domain();return`values from ${i(a[0])} to ${i(Ee(a))}`}}var lr=Math.PI,yo=2*lr,qt=1e-6,w2=yo-qt;function Bc(e){this._+=e[0];for(let t=1,n=e.length;t<n;++t)this._+=arguments[t]+e[t]}function M2(e){let t=Math.floor(e);if(!(t>=0))throw new Error(`invalid digits: ${e}`);if(t>15)return Bc;let n=10**t;return function(r){this._+=r[0];for(let i=1,a=r.length;i<a;++i)this._+=Math.round(arguments[i]*n)/n+r[i]}}function Hc(e,t,n,r){return e===n&&t===r}function k2(e){let t=Math.floor(e);if(!(t<=15))return Hc;let n=10**t,r=function(i){return Math.round(i*n)};return function(i,a,o,f){return r(i)===r(o)&&r(a)===r(f)}}var vn=class{constructor(t){this._x0=this._y0=this._x1=this._y1=null,this._="",this._append=t==null?Bc:M2(t),this._equal=t==null?Hc:k2(t)}moveTo(t,n){this._append`M${this._x0=this._x1=+t},${this._y0=this._y1=+n}`}closePath(){this._x1!==null&&(this._x1=this._x0,this._y1=this._y0,this._append`Z`)}lineTo(t,n){this._append`L${this._x1=+t},${this._y1=+n}`}quadraticCurveTo(t,n,r,i){this._append`Q${+t},${+n},${this._x1=+r},${this._y1=+i}`}bezierCurveTo(t,n,r,i,a,o){this._append`C${+t},${+n},${+r},${+i},${this._x1=+a},${this._y1=+o}`}arcTo(t,n,r,i,a){if(t=+t,n=+n,r=+r,i=+i,a=+a,a<0)throw new Error(`negative radius: ${a}`);let o=this._x1,f=this._y1,s=r-t,c=i-n,l=o-t,u=f-n,h=l*l+u*u;if(this._x1===null)this._append`M${this._x1=t},${this._y1=n}`;else if(h>qt)if(!(Math.abs(u*s-c*l)>qt)||!a)this._append`L${this._x1=t},${this._y1=n}`;else{let d=r-o,g=i-f,b=s*s+c*c,p=d*d+g*g,m=Math.sqrt(b),w=Math.sqrt(h),x=a*Math.tan((lr-Math.acos((b+h-p)/(2*m*w)))/2),v=x/w,C=x/m;Math.abs(v-1)>qt&&this._append`L${t+v*l},${n+v*u}`,this._append`A${a},${a},0,0,${+(u*d>l*g)},${this._x1=t+C*s},${this._y1=n+C*c}`}}arc(t,n,r,i,a,o){if(t=+t,n=+n,r=+r,o=!!o,r<0)throw new Error(`negative radius: ${r}`);let f=r*Math.cos(i),s=r*Math.sin(i),c=t+f,l=n+s,u=1^o,h=o?i-a:a-i;if(this._x1===null?this._append`M${c},${l}`:(Math.abs(this._x1-c)>qt||Math.abs(this._y1-l)>qt)&&this._append`L${c},${l}`,!!r){if(h<0&&(h=h%yo+yo),h>w2)this._append`A${r},${r},0,1,${u},${t-f},${n-s}A${r},${r},0,1,${u},${this._x1=c},${this._y1=l}`;else if(h>qt){let d=t+r*Math.cos(a),g=n+r*Math.sin(a);if(h>=lr&&this._equal(c,l,d,g)){h/=2;let b=i+h;this._append`A${r},${r},0,${+(h>=lr)},${u},${t+r*Math.cos(b)},${n+r*Math.sin(b)}`}this._append`A${r},${r},0,${+(h>=lr)},${u},${this._x1=d},${this._y1=g}`}}}rect(t,n,r,i){this._append`M${this._x0=this._x1=+t},${this._y0=this._y1=+n}h${r=+r}v${+i}h${-r}Z`}toString(){return this._}};function di(){return new vn}di.prototype=vn.prototype;function P(e){return function(){return e}}var Gc=Math.abs,re=Math.atan2,lt=Math.cos,T2=Math.max,_o=Math.min,Me=Math.sin,ke=Math.sqrt,ie=1e-12,ht=Math.PI,gi=ht/2,_i=2*ht;function S2(e){return e>1?0:e<-1?ht:Math.acos(e)}function jc(e){return e>=1?gi:e<=-1?-gi:Math.asin(e)}function vi(e){let t=3;return e.digits=function(n){if(!arguments.length)return t;if(n==null)t=null;else{let r=Math.floor(n);if(!(r>=0))throw new RangeError(`invalid digits: ${n}`);t=r}return e},()=>new vn(t)}function C2(e){return e.innerRadius}function A2(e){return e.outerRadius}function N2(e){return e.startAngle}function R2(e){return e.endAngle}function $2(e){return e&&e.padAngle}function E2(e,t,n,r,i,a,o,f){var s=n-e,c=r-t,l=o-i,u=f-a,h=u*s-l*c;if(!(h*h<ie))return h=(l*(t-a)-u*(e-i))/h,[e+h*s,t+h*c]}function bi(e,t,n,r,i,a,o){var f=e-n,s=t-r,c=(o?a:-a)/ke(f*f+s*s),l=c*s,u=-c*f,h=e+l,d=t+u,g=n+l,b=r+u,p=(h+g)/2,m=(d+b)/2,w=g-h,x=b-d,v=w*w+x*x,C=i-a,_=h*b-g*d,k=(x<0?-1:1)*ke(T2(0,C*C*v-_*_)),$=(_*x-w*k)/v,F=(-_*w-x*k)/v,U=(_*x+w*k)/v,z=(-_*w+x*k)/v,S=$-p,T=F-m,A=U-p,q=z-m;return S*S+T*T>A*A+q*q&&($=U,F=z),{cx:$,cy:F,x01:-l,y01:-u,x11:$*(i/C-1),y11:F*(i/C-1)}}function Qc(){var e=C2,t=A2,n=P(0),r=null,i=N2,a=R2,o=$2,f=null,s=vi(c);function c(){var l,u,h=+e.apply(this,arguments),d=+t.apply(this,arguments),g=i.apply(this,arguments)-gi,b=a.apply(this,arguments)-gi,p=Gc(b-g),m=b>g;if(f||(f=l=s()),d<h&&(u=d,d=h,h=u),!(d>ie))f.moveTo(0,0);else if(p>_i-ie)f.moveTo(d*lt(g),d*Me(g)),f.arc(0,0,d,g,b,!m),h>ie&&(f.moveTo(h*lt(b),h*Me(b)),f.arc(0,0,h,b,g,m));else{var w=g,x=b,v=g,C=b,_=p,k=p,$=o.apply(this,arguments)/2,F=$>ie&&(r?+r.apply(this,arguments):ke(h*h+d*d)),U=_o(Gc(d-h)/2,+n.apply(this,arguments)),z=U,S=U,T,A;if(F>ie){var q=jc(F/h*Me($)),de=jc(F/d*Me($));(_-=q*2)>ie?(q*=m?1:-1,v+=q,C-=q):(_=0,v=C=(g+b)/2),(k-=de*2)>ie?(de*=m?1:-1,w+=de,x-=de):(k=0,w=x=(g+b)/2)}var ee=d*lt(w),Y=d*Me(w),be=h*lt(C),W=h*Me(C);if(U>ie){var Vt=d*lt(x),Zt=d*Me(x),An=h*lt(v),Nn=h*Me(v),$e;if(p<ht)if($e=E2(ee,Y,An,Nn,Vt,Zt,be,W)){var Rn=ee-$e[0],$n=Y-$e[1],En=Vt-$e[0],M=Zt-$e[1],R=1/Me(S2((Rn*En+$n*M)/(ke(Rn*Rn+$n*$n)*ke(En*En+M*M)))/2),E=ke($e[0]*$e[0]+$e[1]*$e[1]);z=_o(U,(h-E)/(R-1)),S=_o(U,(d-E)/(R+1))}else z=S=0}k>ie?S>ie?(T=bi(An,Nn,ee,Y,d,S,m),A=bi(Vt,Zt,be,W,d,S,m),f.moveTo(T.cx+T.x01,T.cy+T.y01),S<U?f.arc(T.cx,T.cy,S,re(T.y01,T.x01),re(A.y01,A.x01),!m):(f.arc(T.cx,T.cy,S,re(T.y01,T.x01),re(T.y11,T.x11),!m),f.arc(0,0,d,re(T.cy+T.y11,T.cx+T.x11),re(A.cy+A.y11,A.cx+A.x11),!m),f.arc(A.cx,A.cy,S,re(A.y11,A.x11),re(A.y01,A.x01),!m))):(f.moveTo(ee,Y),f.arc(0,0,d,w,x,!m)):f.moveTo(ee,Y),!(h>ie)||!(_>ie)?f.lineTo(be,W):z>ie?(T=bi(be,W,Vt,Zt,h,-z,m),A=bi(ee,Y,An,Nn,h,-z,m),f.lineTo(T.cx+T.x01,T.cy+T.y01),z<U?f.arc(T.cx,T.cy,z,re(T.y01,T.x01),re(A.y01,A.x01),!m):(f.arc(T.cx,T.cy,z,re(T.y01,T.x01),re(T.y11,T.x11),!m),f.arc(0,0,h,re(T.cy+T.y11,T.cx+T.x11),re(A.cy+A.y11,A.cx+A.x11),m),f.arc(A.cx,A.cy,z,re(A.y11,A.x11),re(A.y01,A.x01),!m))):f.arc(0,0,h,C,v,m)}if(f.closePath(),l)return f=null,l+""||null}return c.centroid=function(){var l=(+e.apply(this,arguments)+ +t.apply(this,arguments))/2,u=(+i.apply(this,arguments)+ +a.apply(this,arguments))/2-ht/2;return[lt(u)*l,Me(u)*l]},c.innerRadius=function(l){return arguments.length?(e=typeof l=="function"?l:P(+l),c):e},c.outerRadius=function(l){return arguments.length?(t=typeof l=="function"?l:P(+l),c):t},c.cornerRadius=function(l){return arguments.length?(n=typeof l=="function"?l:P(+l),c):n},c.padRadius=function(l){return arguments.length?(r=l==null?null:typeof l=="function"?l:P(+l),c):r},c.startAngle=function(l){return arguments.length?(i=typeof l=="function"?l:P(+l),c):i},c.endAngle=function(l){return arguments.length?(a=typeof l=="function"?l:P(+l),c):a},c.padAngle=function(l){return arguments.length?(o=typeof l=="function"?l:P(+l),c):o},c.context=function(l){return arguments.length?(f=l??null,c):f},c}var g8=Array.prototype.slice;function Jc(e){return typeof e=="object"&&"length"in e?e:Array.from(e)}function Kc(e){this._context=e}Kc.prototype={areaStart:function(){this._line=0},areaEnd:function(){this._line=NaN},lineStart:function(){this._point=0},lineEnd:function(){(this._line||this._line!==0&&this._point===1)&&this._context.closePath(),this._line=1-this._line},point:function(e,t){switch(e=+e,t=+t,this._point){case 0:this._point=1,this._line?this._context.lineTo(e,t):this._context.moveTo(e,t);break;case 1:this._point=2;default:this._context.lineTo(e,t);break}}};function hr(e){return new Kc(e)}function eu(e){return e[0]}function tu(e){return e[1]}function xo(e,t){var n=P(!0),r=null,i=hr,a=null,o=vi(f);e=typeof e=="function"?e:e===void 0?eu:P(e),t=typeof t=="function"?t:t===void 0?tu:P(t);function f(s){var c,l=(s=Jc(s)).length,u,h=!1,d;for(r==null&&(a=i(d=o())),c=0;c<=l;++c)!(c<l&&n(u=s[c],c,s))===h&&((h=!h)?a.lineStart():a.lineEnd()),h&&a.point(+e(u,c,s),+t(u,c,s));if(d)return a=null,d+""||null}return f.x=function(s){return arguments.length?(e=typeof s=="function"?s:P(+s),f):e},f.y=function(s){return arguments.length?(t=typeof s=="function"?s:P(+s),f):t},f.defined=function(s){return arguments.length?(n=typeof s=="function"?s:P(!!s),f):n},f.curve=function(s){return arguments.length?(i=s,r!=null&&(a=i(r)),f):i},f.context=function(s){return arguments.length?(s==null?r=a=null:a=i(r=s),f):r},f}function wo(e,t,n){var r=null,i=P(!0),a=null,o=hr,f=null,s=vi(c);e=typeof e=="function"?e:e===void 0?eu:P(+e),t=typeof t=="function"?t:P(t===void 0?0:+t),n=typeof n=="function"?n:n===void 0?tu:P(+n);function c(u){var h,d,g,b=(u=Jc(u)).length,p,m=!1,w,x=new Array(b),v=new Array(b);for(a==null&&(f=o(w=s())),h=0;h<=b;++h){if(!(h<b&&i(p=u[h],h,u))===m)if(m=!m)d=h,f.areaStart(),f.lineStart();else{for(f.lineEnd(),f.lineStart(),g=h-1;g>=d;--g)f.point(x[g],v[g]);f.lineEnd(),f.areaEnd()}m&&(x[h]=+e(p,h,u),v[h]=+t(p,h,u),f.point(r?+r(p,h,u):x[h],n?+n(p,h,u):v[h]))}if(w)return f=null,w+""||null}function l(){return xo().defined(i).curve(o).context(a)}return c.x=function(u){return arguments.length?(e=typeof u=="function"?u:P(+u),r=null,c):e},c.x0=function(u){return arguments.length?(e=typeof u=="function"?u:P(+u),c):e},c.x1=function(u){return arguments.length?(r=u==null?null:typeof u=="function"?u:P(+u),c):r},c.y=function(u){return arguments.length?(t=typeof u=="function"?u:P(+u),n=null,c):t},c.y0=function(u){return arguments.length?(t=typeof u=="function"?u:P(+u),c):t},c.y1=function(u){return arguments.length?(n=u==null?null:typeof u=="function"?u:P(+u),c):n},c.lineX0=c.lineY0=function(){return l().x(e).y(t)},c.lineY1=function(){return l().x(e).y(n)},c.lineX1=function(){return l().x(r).y(t)},c.defined=function(u){return arguments.length?(i=typeof u=="function"?u:P(!!u),c):i},c.curve=function(u){return arguments.length?(o=u,a!=null&&(f=o(a)),c):o},c.context=function(u){return arguments.length?(u==null?a=f=null:f=o(a=u),c):a},c}var p8=D2(hr);function nu(e){this._curve=e}nu.prototype={areaStart:function(){this._curve.areaStart()},areaEnd:function(){this._curve.areaEnd()},lineStart:function(){this._curve.lineStart()},lineEnd:function(){this._curve.lineEnd()},point:function(e,t){this._curve.point(t*Math.sin(e),t*-Math.cos(e))}};function D2(e){function t(n){return new nu(e(n))}return t._curve=e,t}var m8=ke(3);var P2={draw(e,t){let n=ke(t/ht);e.moveTo(n,0),e.arc(0,0,n,0,_i)}};var O2=ke(1/3),y8=O2*2;var ru=Me(ht/10)/Me(7*ht/10),_8=Me(_i/10)*ru,v8=-lt(_i/10)*ru;var x8=ke(3);var w8=ke(3);var M8=ke(3)/2,I2=1/ke(12),k8=(I2/2+1)*3;function iu(e,t){let n=null,r=vi(i);e=typeof e=="function"?e:P(e||P2),t=typeof t=="function"?t:P(t===void 0?64:+t);function i(){let a;if(n||(n=a=r()),e.apply(this,arguments).draw(n,+t.apply(this,arguments)),a)return n=null,a+""||null}return i.type=function(a){return arguments.length?(e=typeof a=="function"?a:P(a),i):e},i.size=function(a){return arguments.length?(t=typeof a=="function"?a:P(+a),i):t},i.context=function(a){return arguments.length?(n=a??null,i):n},i}function dt(){}function pi(e,t,n){e._context.bezierCurveTo((2*e._x0+e._x1)/3,(2*e._y0+e._y1)/3,(e._x0+2*e._x1)/3,(e._y0+2*e._y1)/3,(e._x0+4*e._x1+t)/6,(e._y0+4*e._y1+n)/6)}function xi(e){this._context=e}xi.prototype={areaStart:function(){this._line=0},areaEnd:function(){this._line=NaN},lineStart:function(){this._x0=this._x1=this._y0=this._y1=NaN,this._point=0},lineEnd:function(){switch(this._point){case 3:pi(this,this._x1,this._y1);case 2:this._context.lineTo(this._x1,this._y1);break}(this._line||this._line!==0&&this._point===1)&&this._context.closePath(),this._line=1-this._line},point:function(e,t){switch(e=+e,t=+t,this._point){case 0:this._point=1,this._line?this._context.lineTo(e,t):this._context.moveTo(e,t);break;case 1:this._point=2;break;case 2:this._point=3,this._context.lineTo((5*this._x0+this._x1)/6,(5*this._y0+this._y1)/6);default:pi(this,e,t);break}this._x0=this._x1,this._x1=e,this._y0=this._y1,this._y1=t}};function au(e){return new xi(e)}function ou(e){this._context=e}ou.prototype={areaStart:dt,areaEnd:dt,lineStart:function(){this._x0=this._x1=this._x2=this._x3=this._x4=this._y0=this._y1=this._y2=this._y3=this._y4=NaN,this._point=0},lineEnd:function(){switch(this._point){case 1:{this._context.moveTo(this._x2,this._y2),this._context.closePath();break}case 2:{this._context.moveTo((this._x2+2*this._x3)/3,(this._y2+2*this._y3)/3),this._context.lineTo((this._x3+2*this._x2)/3,(this._y3+2*this._y2)/3),this._context.closePath();break}case 3:{this.point(this._x2,this._y2),this.point(this._x3,this._y3),this.point(this._x4,this._y4);break}}},point:function(e,t){switch(e=+e,t=+t,this._point){case 0:this._point=1,this._x2=e,this._y2=t;break;case 1:this._point=2,this._x3=e,this._y3=t;break;case 2:this._point=3,this._x4=e,this._y4=t,this._context.moveTo((this._x0+4*this._x1+e)/6,(this._y0+4*this._y1+t)/6);break;default:pi(this,e,t);break}this._x0=this._x1,this._x1=e,this._y0=this._y1,this._y1=t}};function fu(e){return new ou(e)}function su(e){this._context=e}su.prototype={areaStart:function(){this._line=0},areaEnd:function(){this._line=NaN},lineStart:function(){this._x0=this._x1=this._y0=this._y1=NaN,this._point=0},lineEnd:function(){(this._line||this._line!==0&&this._point===3)&&this._context.closePath(),this._line=1-this._line},point:function(e,t){switch(e=+e,t=+t,this._point){case 0:this._point=1;break;case 1:this._point=2;break;case 2:this._point=3;var n=(this._x0+4*this._x1+e)/6,r=(this._y0+4*this._y1+t)/6;this._line?this._context.lineTo(n,r):this._context.moveTo(n,r);break;case 3:this._point=4;default:pi(this,e,t);break}this._x0=this._x1,this._x1=e,this._y0=this._y1,this._y1=t}};function cu(e){return new su(e)}function uu(e,t){this._basis=new xi(e),this._beta=t}uu.prototype={lineStart:function(){this._x=[],this._y=[],this._basis.lineStart()},lineEnd:function(){var e=this._x,t=this._y,n=e.length-1;if(n>0)for(var r=e[0],i=t[0],a=e[n]-r,o=t[n]-i,f=-1,s;++f<=n;)s=f/n,this._basis.point(this._beta*e[f]+(1-this._beta)*(r+s*a),this._beta*t[f]+(1-this._beta)*(i+s*o));this._x=this._y=null,this._basis.lineEnd()},point:function(e,t){this._x.push(+e),this._y.push(+t)}};var lu=(function e(t){function n(r){return t===1?new xi(r):new uu(r,t)}return n.beta=function(r){return e(+r)},n})(.85);function mi(e,t,n){e._context.bezierCurveTo(e._x1+e._k*(e._x2-e._x0),e._y1+e._k*(e._y2-e._y0),e._x2+e._k*(e._x1-t),e._y2+e._k*(e._y1-n),e._x2,e._y2)}function Mo(e,t){this._context=e,this._k=(1-t)/6}Mo.prototype={areaStart:function(){this._line=0},areaEnd:function(){this._line=NaN},lineStart:function(){this._x0=this._x1=this._x2=this._y0=this._y1=this._y2=NaN,this._point=0},lineEnd:function(){switch(this._point){case 2:this._context.lineTo(this._x2,this._y2);break;case 3:mi(this,this._x1,this._y1);break}(this._line||this._line!==0&&this._point===1)&&this._context.closePath(),this._line=1-this._line},point:function(e,t){switch(e=+e,t=+t,this._point){case 0:this._point=1,this._line?this._context.lineTo(e,t):this._context.moveTo(e,t);break;case 1:this._point=2,this._x1=e,this._y1=t;break;case 2:this._point=3;default:mi(this,e,t);break}this._x0=this._x1,this._x1=this._x2,this._x2=e,this._y0=this._y1,this._y1=this._y2,this._y2=t}};var hu=(function e(t){function n(r){return new Mo(r,t)}return n.tension=function(r){return e(+r)},n})(0);function ko(e,t){this._context=e,this._k=(1-t)/6}ko.prototype={areaStart:dt,areaEnd:dt,lineStart:function(){this._x0=this._x1=this._x2=this._x3=this._x4=this._x5=this._y0=this._y1=this._y2=this._y3=this._y4=this._y5=NaN,this._point=0},lineEnd:function(){switch(this._point){case 1:{this._context.moveTo(this._x3,this._y3),this._context.closePath();break}case 2:{this._context.lineTo(this._x3,this._y3),this._context.closePath();break}case 3:{this.point(this._x3,this._y3),this.point(this._x4,this._y4),this.point(this._x5,this._y5);break}}},point:function(e,t){switch(e=+e,t=+t,this._point){case 0:this._point=1,this._x3=e,this._y3=t;break;case 1:this._point=2,this._context.moveTo(this._x4=e,this._y4=t);break;case 2:this._point=3,this._x5=e,this._y5=t;break;default:mi(this,e,t);break}this._x0=this._x1,this._x1=this._x2,this._x2=e,this._y0=this._y1,this._y1=this._y2,this._y2=t}};var du=(function e(t){function n(r){return new ko(r,t)}return n.tension=function(r){return e(+r)},n})(0);function To(e,t){this._context=e,this._k=(1-t)/6}To.prototype={areaStart:function(){this._line=0},areaEnd:function(){this._line=NaN},lineStart:function(){this._x0=this._x1=this._x2=this._y0=this._y1=this._y2=NaN,this._point=0},lineEnd:function(){(this._line||this._line!==0&&this._point===3)&&this._context.closePath(),this._line=1-this._line},point:function(e,t){switch(e=+e,t=+t,this._point){case 0:this._point=1;break;case 1:this._point=2;break;case 2:this._point=3,this._line?this._context.lineTo(this._x2,this._y2):this._context.moveTo(this._x2,this._y2);break;case 3:this._point=4;default:mi(this,e,t);break}this._x0=this._x1,this._x1=this._x2,this._x2=e,this._y0=this._y1,this._y1=this._y2,this._y2=t}};var bu=(function e(t){function n(r){return new To(r,t)}return n.tension=function(r){return e(+r)},n})(0);function So(e,t,n){var r=e._x1,i=e._y1,a=e._x2,o=e._y2;if(e._l01_a>ie){var f=2*e._l01_2a+3*e._l01_a*e._l12_a+e._l12_2a,s=3*e._l01_a*(e._l01_a+e._l12_a);r=(r*f-e._x0*e._l12_2a+e._x2*e._l01_2a)/s,i=(i*f-e._y0*e._l12_2a+e._y2*e._l01_2a)/s}if(e._l23_a>ie){var c=2*e._l23_2a+3*e._l23_a*e._l12_a+e._l12_2a,l=3*e._l23_a*(e._l23_a+e._l12_a);a=(a*c+e._x1*e._l23_2a-t*e._l12_2a)/l,o=(o*c+e._y1*e._l23_2a-n*e._l12_2a)/l}e._context.bezierCurveTo(r,i,a,o,e._x2,e._y2)}function gu(e,t){this._context=e,this._alpha=t}gu.prototype={areaStart:function(){this._line=0},areaEnd:function(){this._line=NaN},lineStart:function(){this._x0=this._x1=this._x2=this._y0=this._y1=this._y2=NaN,this._l01_a=this._l12_a=this._l23_a=this._l01_2a=this._l12_2a=this._l23_2a=this._point=0},lineEnd:function(){switch(this._point){case 2:this._context.lineTo(this._x2,this._y2);break;case 3:this.point(this._x2,this._y2);break}(this._line||this._line!==0&&this._point===1)&&this._context.closePath(),this._line=1-this._line},point:function(e,t){if(e=+e,t=+t,this._point){var n=this._x2-e,r=this._y2-t;this._l23_a=Math.sqrt(this._l23_2a=Math.pow(n*n+r*r,this._alpha))}switch(this._point){case 0:this._point=1,this._line?this._context.lineTo(e,t):this._context.moveTo(e,t);break;case 1:this._point=2;break;case 2:this._point=3;default:So(this,e,t);break}this._l01_a=this._l12_a,this._l12_a=this._l23_a,this._l01_2a=this._l12_2a,this._l12_2a=this._l23_2a,this._x0=this._x1,this._x1=this._x2,this._x2=e,this._y0=this._y1,this._y1=this._y2,this._y2=t}};var pu=(function e(t){function n(r){return t?new gu(r,t):new Mo(r,0)}return n.alpha=function(r){return e(+r)},n})(.5);function mu(e,t){this._context=e,this._alpha=t}mu.prototype={areaStart:dt,areaEnd:dt,lineStart:function(){this._x0=this._x1=this._x2=this._x3=this._x4=this._x5=this._y0=this._y1=this._y2=this._y3=this._y4=this._y5=NaN,this._l01_a=this._l12_a=this._l23_a=this._l01_2a=this._l12_2a=this._l23_2a=this._point=0},lineEnd:function(){switch(this._point){case 1:{this._context.moveTo(this._x3,this._y3),this._context.closePath();break}case 2:{this._context.lineTo(this._x3,this._y3),this._context.closePath();break}case 3:{this.point(this._x3,this._y3),this.point(this._x4,this._y4),this.point(this._x5,this._y5);break}}},point:function(e,t){if(e=+e,t=+t,this._point){var n=this._x2-e,r=this._y2-t;this._l23_a=Math.sqrt(this._l23_2a=Math.pow(n*n+r*r,this._alpha))}switch(this._point){case 0:this._point=1,this._x3=e,this._y3=t;break;case 1:this._point=2,this._context.moveTo(this._x4=e,this._y4=t);break;case 2:this._point=3,this._x5=e,this._y5=t;break;default:So(this,e,t);break}this._l01_a=this._l12_a,this._l12_a=this._l23_a,this._l01_2a=this._l12_2a,this._l12_2a=this._l23_2a,this._x0=this._x1,this._x1=this._x2,this._x2=e,this._y0=this._y1,this._y1=this._y2,this._y2=t}};var yu=(function e(t){function n(r){return t?new mu(r,t):new ko(r,0)}return n.alpha=function(r){return e(+r)},n})(.5);function _u(e,t){this._context=e,this._alpha=t}_u.prototype={areaStart:function(){this._line=0},areaEnd:function(){this._line=NaN},lineStart:function(){this._x0=this._x1=this._x2=this._y0=this._y1=this._y2=NaN,this._l01_a=this._l12_a=this._l23_a=this._l01_2a=this._l12_2a=this._l23_2a=this._point=0},lineEnd:function(){(this._line||this._line!==0&&this._point===3)&&this._context.closePath(),this._line=1-this._line},point:function(e,t){if(e=+e,t=+t,this._point){var n=this._x2-e,r=this._y2-t;this._l23_a=Math.sqrt(this._l23_2a=Math.pow(n*n+r*r,this._alpha))}switch(this._point){case 0:this._point=1;break;case 1:this._point=2;break;case 2:this._point=3,this._line?this._context.lineTo(this._x2,this._y2):this._context.moveTo(this._x2,this._y2);break;case 3:this._point=4;default:So(this,e,t);break}this._l01_a=this._l12_a,this._l12_a=this._l23_a,this._l01_2a=this._l12_2a,this._l12_2a=this._l23_2a,this._x0=this._x1,this._x1=this._x2,this._x2=e,this._y0=this._y1,this._y1=this._y2,this._y2=t}};var vu=(function e(t){function n(r){return t?new _u(r,t):new To(r,0)}return n.alpha=function(r){return e(+r)},n})(.5);function xu(e){this._context=e}xu.prototype={areaStart:dt,areaEnd:dt,lineStart:function(){this._point=0},lineEnd:function(){this._point&&this._context.closePath()},point:function(e,t){e=+e,t=+t,this._point?this._context.lineTo(e,t):(this._point=1,this._context.moveTo(e,t))}};function wu(e){return new xu(e)}function Wc(e){return e<0?-1:1}function Xc(e,t,n){var r=e._x1-e._x0,i=t-e._x1,a=(e._y1-e._y0)/(r||i<0&&-0),o=(n-e._y1)/(i||r<0&&-0),f=(a*i+o*r)/(r+i);return(Wc(a)+Wc(o))*Math.min(Math.abs(a),Math.abs(o),.5*Math.abs(f))||0}function Vc(e,t){var n=e._x1-e._x0;return n?(3*(e._y1-e._y0)/n-t)/2:t}function vo(e,t,n){var r=e._x0,i=e._y0,a=e._x1,o=e._y1,f=(a-r)/3;e._context.bezierCurveTo(r+f,i+f*t,a-f,o-f*n,a,o)}function yi(e){this._context=e}yi.prototype={areaStart:function(){this._line=0},areaEnd:function(){this._line=NaN},lineStart:function(){this._x0=this._x1=this._y0=this._y1=this._t0=NaN,this._point=0},lineEnd:function(){switch(this._point){case 2:this._context.lineTo(this._x1,this._y1);break;case 3:vo(this,this._t0,Vc(this,this._t0));break}(this._line||this._line!==0&&this._point===1)&&this._context.closePath(),this._line=1-this._line},point:function(e,t){var n=NaN;if(e=+e,t=+t,!(e===this._x1&&t===this._y1)){switch(this._point){case 0:this._point=1,this._line?this._context.lineTo(e,t):this._context.moveTo(e,t);break;case 1:this._point=2;break;case 2:this._point=3,vo(this,Vc(this,n=Xc(this,e,t)),n);break;default:vo(this,this._t0,n=Xc(this,e,t));break}this._x0=this._x1,this._x1=e,this._y0=this._y1,this._y1=t,this._t0=n}}};function Mu(e){this._context=new ku(e)}(Mu.prototype=Object.create(yi.prototype)).point=function(e,t){yi.prototype.point.call(this,t,e)};function ku(e){this._context=e}ku.prototype={moveTo:function(e,t){this._context.moveTo(t,e)},closePath:function(){this._context.closePath()},lineTo:function(e,t){this._context.lineTo(t,e)},bezierCurveTo:function(e,t,n,r,i,a){this._context.bezierCurveTo(t,e,r,n,a,i)}};function Tu(e){return new yi(e)}function Su(e){return new Mu(e)}function Cu(e){this._context=e}Cu.prototype={areaStart:function(){this._line=0},areaEnd:function(){this._line=NaN},lineStart:function(){this._x=[],this._y=[]},lineEnd:function(){var e=this._x,t=this._y,n=e.length;if(n)if(this._line?this._context.lineTo(e[0],t[0]):this._context.moveTo(e[0],t[0]),n===2)this._context.lineTo(e[1],t[1]);else for(var r=Zc(e),i=Zc(t),a=0,o=1;o<n;++a,++o)this._context.bezierCurveTo(r[0][a],i[0][a],r[1][a],i[1][a],e[o],t[o]);(this._line||this._line!==0&&n===1)&&this._context.closePath(),this._line=1-this._line,this._x=this._y=null},point:function(e,t){this._x.push(+e),this._y.push(+t)}};function Zc(e){var t,n=e.length-1,r,i=new Array(n),a=new Array(n),o=new Array(n);for(i[0]=0,a[0]=2,o[0]=e[0]+2*e[1],t=1;t<n-1;++t)i[t]=1,a[t]=4,o[t]=4*e[t]+2*e[t+1];for(i[n-1]=2,a[n-1]=7,o[n-1]=8*e[n-1]+e[n],t=1;t<n;++t)r=i[t]/a[t-1],a[t]-=r,o[t]-=r*o[t-1];for(i[n-1]=o[n-1]/a[n-1],t=n-2;t>=0;--t)i[t]=(o[t]-i[t+1])/a[t];for(a[n-1]=(e[n]+i[n-1])/2,t=0;t<n-1;++t)a[t]=2*e[t+1]-i[t+1];return[i,a]}function Au(e){return new Cu(e)}function wi(e,t){this._context=e,this._t=t}wi.prototype={areaStart:function(){this._line=0},areaEnd:function(){this._line=NaN},lineStart:function(){this._x=this._y=NaN,this._point=0},lineEnd:function(){0<this._t&&this._t<1&&this._point===2&&this._context.lineTo(this._x,this._y),(this._line||this._line!==0&&this._point===1)&&this._context.closePath(),this._line>=0&&(this._t=1-this._t,this._line=1-this._line)},point:function(e,t){switch(e=+e,t=+t,this._point){case 0:this._point=1,this._line?this._context.lineTo(e,t):this._context.moveTo(e,t);break;case 1:this._point=2;default:{if(this._t<=0)this._context.lineTo(this._x,t),this._context.lineTo(e,t);else{var n=this._x*(1-this._t)+e*this._t;this._context.lineTo(n,this._y),this._context.lineTo(n,t)}break}}this._x=e,this._y=t}};function Nu(e){return new wi(e,.5)}function Ru(e){return new wi(e,0)}function $u(e){return new wi(e,1)}function Mi(e,t){if(typeof document<"u"&&document.createElement){let n=document.createElement("canvas");if(n&&n.getContext)return n.width=e,n.height=t,n}return null}var Eu=()=>typeof Image<"u"?Image:null;var Du={},Co={},Ao=34,dr=10,No=13;function Ou(e){return new Function("d","return {"+e.map(function(t,n){return JSON.stringify(t)+": d["+n+\'] || ""\'}).join(",")+"}")}function L2(e,t){var n=Ou(e);return function(r,i){return t(n(r),i,e)}}function Pu(e){var t=Object.create(null),n=[];return e.forEach(function(r){for(var i in r)i in t||n.push(t[i]=i)}),n}function he(e,t){var n=e+"",r=n.length;return r<t?new Array(t-r+1).join(0)+n:n}function U2(e){return e<0?"-"+he(-e,6):e>9999?"+"+he(e,6):he(e,4)}function q2(e){var t=e.getUTCHours(),n=e.getUTCMinutes(),r=e.getUTCSeconds(),i=e.getUTCMilliseconds();return isNaN(e)?"Invalid Date":U2(e.getUTCFullYear())+"-"+he(e.getUTCMonth()+1,2)+"-"+he(e.getUTCDate(),2)+(i?"T"+he(t,2)+":"+he(n,2)+":"+he(r,2)+"."+he(i,3)+"Z":r?"T"+he(t,2)+":"+he(n,2)+":"+he(r,2)+"Z":n||t?"T"+he(t,2)+":"+he(n,2)+"Z":"")}function ki(e){var t=new RegExp(\'["\'+e+`\n\\r]`),n=e.charCodeAt(0);function r(u,h){var d,g,b=i(u,function(p,m){if(d)return d(p,m-1);g=p,d=h?L2(p,h):Ou(p)});return b.columns=g||[],b}function i(u,h){var d=[],g=u.length,b=0,p=0,m,w=g<=0,x=!1;u.charCodeAt(g-1)===dr&&--g,u.charCodeAt(g-1)===No&&--g;function v(){if(w)return Co;if(x)return x=!1,Du;var _,k=b,$;if(u.charCodeAt(k)===Ao){for(;b++<g&&u.charCodeAt(b)!==Ao||u.charCodeAt(++b)===Ao;);return(_=b)>=g?w=!0:($=u.charCodeAt(b++))===dr?x=!0:$===No&&(x=!0,u.charCodeAt(b)===dr&&++b),u.slice(k+1,_-1).replace(/""/g,\'"\')}for(;b<g;){if(($=u.charCodeAt(_=b++))===dr)x=!0;else if($===No)x=!0,u.charCodeAt(b)===dr&&++b;else if($!==n)continue;return u.slice(k,_)}return w=!0,u.slice(k,g)}for(;(m=v())!==Co;){for(var C=[];m!==Du&&m!==Co;)C.push(m),m=v();h&&(C=h(C,p++))==null||d.push(C)}return d}function a(u,h){return u.map(function(d){return h.map(function(g){return l(d[g])}).join(e)})}function o(u,h){return h==null&&(h=Pu(u)),[h.map(l).join(e)].concat(a(u,h)).join(`\n`)}function f(u,h){return h==null&&(h=Pu(u)),a(u,h).join(`\n`)}function s(u){return u.map(c).join(`\n`)}function c(u){return u.map(l).join(e)}function l(u){return u==null?"":u instanceof Date?q2(u):t.test(u+="")?\'"\'+u.replace(/"/g,\'""\')+\'"\':u}return{parse:r,parseRows:i,format:o,formatBody:f,formatRows:s,formatRow:c,formatValue:l}}var Ft=ki(","),C8=Ft.parse,A8=Ft.parseRows,N8=Ft.format,R8=Ft.formatBody,$8=Ft.formatRows,E8=Ft.formatRow,D8=Ft.formatValue,zt=ki("	"),P8=zt.parse,O8=zt.parseRows,I8=zt.format,L8=zt.formatBody,U8=zt.formatRows,q8=zt.formatRow,F8=zt.formatValue;var z8=new Date("2019-01-01T00:00").getHours()||new Date("2019-07-01T00:00").getHours();function Ro(e){return e}function Ti(e){if(e==null)return Ro;var t,n,r=e.scale[0],i=e.scale[1],a=e.translate[0],o=e.translate[1];return function(f,s){s||(t=n=0);var c=2,l=f.length,u=new Array(l);for(u[0]=(t+=f[0])*r+a,u[1]=(n+=f[1])*i+o;c<l;)u[c]=f[c],++c;return u}}function Iu(e,t){for(var n,r=e.length,i=r-t;i<--r;)n=e[i],e[i++]=e[r],e[r]=n}function $o(e,t){return typeof t=="string"&&(t=e.objects[t]),t.type==="GeometryCollection"?{type:"FeatureCollection",features:t.geometries.map(function(n){return Lu(e,n)})}:Lu(e,t)}function Lu(e,t){var n=t.id,r=t.bbox,i=t.properties==null?{}:t.properties,a=Si(e,t);return n==null&&r==null?{type:"Feature",properties:i,geometry:a}:r==null?{type:"Feature",id:n,properties:i,geometry:a}:{type:"Feature",id:n,bbox:r,properties:i,geometry:a}}function Si(e,t){var n=Ti(e.transform),r=e.arcs;function i(l,u){u.length&&u.pop();for(var h=r[l<0?~l:l],d=0,g=h.length;d<g;++d)u.push(n(h[d],d));l<0&&Iu(u,g)}function a(l){return n(l)}function o(l){for(var u=[],h=0,d=l.length;h<d;++h)i(l[h],u);return u.length<2&&u.push(u[0]),u}function f(l){for(var u=o(l);u.length<4;)u.push(u[0]);return u}function s(l){return l.map(f)}function c(l){var u=l.type,h;switch(u){case"GeometryCollection":return{type:u,geometries:l.geometries.map(c)};case"Point":h=a(l.coordinates);break;case"MultiPoint":h=l.coordinates.map(a);break;case"LineString":h=o(l.arcs);break;case"MultiLineString":h=l.arcs.map(o);break;case"Polygon":h=s(l.arcs);break;case"MultiPolygon":h=l.arcs.map(s);break;default:return null}return{type:u,coordinates:h}}return c(t)}function Eo(e,t){var n={},r={},i={},a=[],o=-1;t.forEach(function(c,l){var u=e.arcs[c<0?~c:c],h;u.length<3&&!u[1][0]&&!u[1][1]&&(h=t[++o],t[o]=c,t[l]=h)}),t.forEach(function(c){var l=f(c),u=l[0],h=l[1],d,g;if(d=i[u])if(delete i[d.end],d.push(c),d.end=h,g=r[h]){delete r[g.start];var b=g===d?d:d.concat(g);r[b.start=d.start]=i[b.end=g.end]=b}else r[d.start]=i[d.end]=d;else if(d=r[h])if(delete r[d.start],d.unshift(c),d.start=u,g=i[u]){delete i[g.end];var p=g===d?d:g.concat(d);r[p.start=g.start]=i[p.end=d.end]=p}else r[d.start]=i[d.end]=d;else d=[c],r[d.start=u]=i[d.end=h]=d});function f(c){var l=e.arcs[c<0?~c:c],u=l[0],h;return e.transform?(h=[0,0],l.forEach(function(d){h[0]+=d[0],h[1]+=d[1]})):h=l[l.length-1],c<0?[h,u]:[u,h]}function s(c,l){for(var u in c){var h=c[u];delete l[h.start],delete h.start,delete h.end,h.forEach(function(d){n[d<0?~d:d]=1}),a.push(h)}}return s(i,r),s(r,i),t.forEach(function(c){n[c<0?~c:c]||a.push([c])}),a}function Do(e){return Si(e,Uu.apply(this,arguments))}function Uu(e,t,n){var r,i,a;if(arguments.length>1)r=F2(e,t,n);else for(i=0,r=new Array(a=e.arcs.length);i<a;++i)r[i]=i;return{type:"MultiLineString",arcs:Eo(e,r)}}function F2(e,t,n){var r=[],i=[],a;function o(u){var h=u<0?~u:u;(i[h]||(i[h]=[])).push({i:u,g:a})}function f(u){u.forEach(o)}function s(u){u.forEach(f)}function c(u){u.forEach(s)}function l(u){switch(a=u,u.type){case"GeometryCollection":u.geometries.forEach(l);break;case"LineString":f(u.arcs);break;case"MultiLineString":case"Polygon":s(u.arcs);break;case"MultiPolygon":c(u.arcs);break}}return l(t),i.forEach(n==null?function(u){r.push(u[0].i)}:function(u){n(u[0].g,u[u.length-1].g)&&r.push(u[0].i)}),r}function br(e){let t={};return n=>t[n]||(t[n]=e(n))}function B2(e,t){return n=>{let r=e(n),i=r.indexOf(t);if(i<0)return r;let a=H2(r,i),o=a<r.length?r.slice(a):"";for(;--a>i;)if(r[a]!=="0"){++a;break}return r.slice(0,a)+o}}function H2(e,t){let n=e.lastIndexOf("e"),r;if(n>0)return n;for(n=e.length;--n>t;)if(r=e.charCodeAt(n),r>=48&&r<=57)return n+1}function G2(e){let t=br(e.format),n=e.formatPrefix;return{format:t,formatPrefix:n,formatFloat(r){let i=Xe(r||",");if(i.precision==null){switch(i.precision=12,i.type){case"%":i.precision-=2;break;case"e":i.precision-=1;break}return B2(t(i),t(".1f")(1)[1])}else return t(i)},formatSpan(r,i,a,o){o=Xe(o??",f");let f=ba(r,i,a),s=Math.max(Math.abs(r),Math.abs(i)),c;if(o.precision==null)switch(o.type){case"s":return isNaN(c=Jr(f,s))||(o.precision=c),n(o,s);case"":case"e":case"g":case"p":case"r":{isNaN(c=Kr(f,s))||(o.precision=c-(o.type==="e"));break}case"f":case"%":{isNaN(c=Qr(f))||(o.precision=c-(o.type==="%")*2);break}}return t(o)}}}var j2;W2();function W2(){return j2=G2({format:ln,formatPrefix:Bn})}function qu(e,t,n){n=n||{},Mt(n)||B(`Invalid time multi-format specifier: ${n}`);let r=t(Ne),i=t(we),a=t(xe),o=t(le),f=t(G),s=t(ne),c=t(ue),l=t(K),u=e(n[Oe]||".%L"),h=e(n[Ne]||":%S"),d=e(n[we]||"%I:%M"),g=e(n[xe]||"%I %p"),b=e(n[le]||n[te]||"%a %d"),p=e(n[G]||"%b %d"),m=e(n[ne]||"%B"),w=e(n[ue]||"%B"),x=e(n[K]||"%Y");return v=>(r(v)<v?u:i(v)<v?h:a(v)<v?d:o(v)<v?g:s(v)<v?f(v)<v?b:p:l(v)<v?c(v)<v?m:w:x)(v)}function X2(e){let t=br(e.format),n=br(e.utcFormat);return{timeFormat:r=>Kt(r)?t(r):qu(t,ir,r),utcFormat:r=>Kt(r)?n(r):qu(n,ar,r),timeParse:br(e.parse),utcParse:br(e.utcParse)}}var V2;Z2();function Z2(){return V2=X2({format:Vn,parse:La,utcFormat:mn,utcParse:ei})}var Q2=/^(data:|([A-Za-z]+:)?\\/\\/)/,J2=/^(?:(?:(?:f|ht)tps?|mailto|tel|callto|cid|xmpp|file|data):|[^a-z]|[a-z+.\\-]+(?:[^a-z+.\\-:]|$))/i,K2=/[\\u0000-\\u0020\\u00A0\\u1680\\u180E\\u2000-\\u2029\\u205f\\u3000]/g,Fu="file://";function eb(e,t){return n=>({options:n||{},sanitize:nb,load:tb,fileAccess:!1,file:rb(),http:ab(e)})}async function tb(e,t){let n=await this.sanitize(e,t),r=n.href;return n.localFile?this.file(r):this.http(r,t)}async function nb(e,t){t=je({},this.options,t);let n=this.fileAccess,r={href:null},i,a,o,f=J2.test(e.replace(K2,""));(e==null||typeof e!="string"||!f)&&B("Sanitize failure, invalid URI: "+Rr(e));let s=Q2.test(e);return(o=t.baseURL)&&!s&&(!e.startsWith("/")&&!o.endsWith("/")&&(e="/"+e),e=o+e),a=(i=e.startsWith(Fu))||t.mode==="file"||t.mode!=="http"&&!s&&n,i?e=e.slice(Fu.length):e.startsWith("//")&&(t.defaultProtocol==="file"?(e=e.slice(2),a=!0):e=(t.defaultProtocol||"http")+":"+e),Object.defineProperty(r,"localFile",{value:!!a}),r.href=e,t.target&&(r.target=t.target+""),t.rel&&(r.rel=t.rel+""),t.context==="image"&&t.crossOrigin&&(r.crossOrigin=t.crossOrigin+""),r}function rb(e){return ib}async function ib(){B("No file system access.")}function ab(e){return e?async function(t,n){let r=je({},this.options.http,n),i=n&&n.response,a=await e(t,r);return a.ok?it(a[i])?a[i]():a.text():B(a.status+""+a.statusText)}:ob}async function ob(){B("No HTTP fetch method available.")}function zu(e){let t=function(n,r){let i={delimiter:e};return Po(n,r?je(r,i):i)};return t.responseType="text",t}function Po(e,t){return t.header&&(e=t.header.map(Rr).join(t.delimiter)+`\n`+e),ki(t.delimiter).parse(e+"")}Po.responseType="text";function fb(e){return typeof Buffer=="function"&&it(Buffer.isBuffer)?Buffer.isBuffer(e):!1}function Oo(e,t){let n=t&&t.property?oa(t.property):Sf;return Mt(e)&&!fb(e)?sb(n(e),t):n(JSON.parse(e))}Oo.responseType="json";function sb(e,t){return!se(e)&&Nf(e)&&(e=[...e]),t&&t.copy?JSON.parse(JSON.stringify(e)):e}var cb={interior:(e,t)=>e!==t,exterior:(e,t)=>e===t};function Yu(e,t){let n,r,i,a;return e=Oo(e,t),t&&t.feature?(n=$o,i=t.feature):t&&t.mesh?(n=Do,i=t.mesh,a=cb[t.filter]):B("Missing TopoJSON feature or mesh parameter."),r=(r=e.objects[i])?n(e,r,a):B("Invalid TopoJSON object: "+i),r&&r.features||[r]}Yu.responseType="json";var z3={dsv:Po,csv:zu(","),tsv:zu("	"),json:Oo,topojson:Yu};var Io=eb(typeof fetch<"u"&&fetch);var ub=0;var Ii="p_";function rf(e){return e&&e.gradient}function ll(e,t,n){let r=e.gradient,i=e.id,a=r==="radial"?Ii:"";return i||(i=e.id="gradient_"+ub++,r==="radial"?(e.x1=Be(e.x1,.5),e.y1=Be(e.y1,.5),e.r1=Be(e.r1,0),e.x2=Be(e.x2,.5),e.y2=Be(e.y2,.5),e.r2=Be(e.r2,.5),a=Ii):(e.x1=Be(e.x1,0),e.y1=Be(e.y1,0),e.x2=Be(e.x2,1),e.y2=Be(e.y2,0))),t[i]=e,"url("+(n||"")+"#"+a+i+")"}function Be(e,t){return e??t}var Bu={basis:{curve:au},"basis-closed":{curve:fu},"basis-open":{curve:cu},bundle:{curve:lu,tension:"beta",value:.85},cardinal:{curve:hu,tension:"tension",value:0},"cardinal-open":{curve:bu,tension:"tension",value:0},"cardinal-closed":{curve:du,tension:"tension",value:0},"catmull-rom":{curve:pu,tension:"alpha",value:.5},"catmull-rom-closed":{curve:yu,tension:"alpha",value:.5},"catmull-rom-open":{curve:vu,tension:"alpha",value:.5},linear:{curve:hr},"linear-closed":{curve:wu},monotone:{horizontal:Su,vertical:Tu},natural:{curve:Au},step:{curve:Nu},"step-after":{curve:$u},"step-before":{curve:Ru}};function hl(e,t,n){var r=me(Bu,e)&&Bu[e],i=null;return r&&(i=r.curve||r[t||"vertical"],r.tension&&n!=null&&(i=i[r.tension](n))),i}var lb={m:2,l:2,h:1,v:1,z:0,c:6,s:4,q:4,t:2,a:7},hb=/[mlhvzcsqta]([^mlhvzcsqta]+|$)/gi,db=/^[+-]?(([0-9]*\\.[0-9]+)|([0-9]+\\.)|([0-9]+))([eE][+-]?[0-9]+)?/,bb=/^((\\s+,?\\s*)|(,\\s*))/,gb=/^[01]/;function dl(e){let t=[];return(e.match(hb)||[]).forEach(r=>{let i=r[0],a=i.toLowerCase(),o=lb[a],f=pb(a,o,r.slice(1).trim()),s=f.length;if(s<o||s&&s%o!==0)throw Error("Invalid SVG path, incorrect parameter count");if(t.push([i,...f.slice(0,o)]),s!==o){a==="m"&&(i=i==="M"?"L":"l");for(let c=o;c<s;c+=o)t.push([i,...f.slice(c,c+o)])}}),t}function pb(e,t,n){let r=[];for(let i=0;t&&i<n.length;)for(let a=0;a<t;++a){let o=e==="a"&&(a===3||a===4)?gb:db,f=n.slice(i).match(o);if(f===null)throw Error("Invalid SVG path, incorrect parameter type");i+=f[0].length,r.push(+f[0]);let s=n.slice(i).match(bb);s!==null&&(i+=s[0].length)}return r}var _t=Math.PI/180,mb=1e-14,Yt=Math.PI/2,He=Math.PI*2,xn=Math.sqrt(3)/2,Lo={},Uo={},bl=[].join;function yb(e,t,n,r,i,a,o,f,s){let c=bl.call(arguments);if(Lo[c])return Lo[c];let l=o*_t,u=Math.sin(l),h=Math.cos(l);n=Math.abs(n),r=Math.abs(r);let d=h*(f-e)*.5+u*(s-t)*.5,g=h*(s-t)*.5-u*(f-e)*.5,b=d*d/(n*n)+g*g/(r*r);b>1&&(b=Math.sqrt(b),n*=b,r*=b);let p=h/n,m=u/n,w=-u/r,x=h/r,v=p*f+m*s,C=w*f+x*s,_=p*e+m*t,k=w*e+x*t,F=1/((_-v)*(_-v)+(k-C)*(k-C))-.25;F<0&&(F=0);let U=Math.sqrt(F);a==i&&(U=-U);let z=.5*(v+_)-U*(k-C),S=.5*(C+k)+U*(_-v),T=Math.atan2(C-S,v-z),q=Math.atan2(k-S,_-z)-T;q<0&&a===1?q+=He:q>0&&a===0&&(q-=He);let de=Math.ceil(Math.abs(q/(Yt+.001))),ee=[];for(let Y=0;Y<de;++Y){let be=T+Y*q/de,W=T+(Y+1)*q/de;ee[Y]=[z,S,be,W,n,r,u,h]}return Lo[c]=ee}function _b(e){let t=bl.call(e);if(Uo[t])return Uo[t];var n=e[0],r=e[1],i=e[2],a=e[3],o=e[4],f=e[5],s=e[6],c=e[7];let l=c*o,u=-s*f,h=s*o,d=c*f,g=Math.cos(i),b=Math.sin(i),p=Math.cos(a),m=Math.sin(a),w=.5*(a-i),x=Math.sin(w*.5),v=8/3*x*x/Math.sin(w),C=n+g-v*b,_=r+b+v*g,k=n+p,$=r+m,F=k+v*m,U=$-v*p;return Uo[t]=[l*C+u*_,h*C+d*_,l*F+u*U,h*F+d*U,l*k+u*$,h*k+d*$]}var Re=["l",0,0,0,0,0,0,0];function vb(e,t,n){let r=Re[0]=e[0];if(r==="a"||r==="A")Re[1]=t*e[1],Re[2]=n*e[2],Re[3]=e[3],Re[4]=e[4],Re[5]=e[5],Re[6]=t*e[6],Re[7]=n*e[7];else if(r==="h"||r==="H")Re[1]=t*e[1];else if(r==="v"||r==="V")Re[1]=n*e[1];else for(var i=1,a=e.length;i<a;++i)Re[i]=(i%2==1?t:n)*e[i];return Re}function Bo(e,t,n,r,i,a){var o,f=null,s=0,c=0,l=0,u=0,h,d,g,b,p=0,m=0;n==null&&(n=0),r==null&&(r=0),i==null&&(i=1),a==null&&(a=i),e.beginPath&&e.beginPath();for(var w=0,x=t.length;w<x;++w){switch(o=t[w],(i!==1||a!==1)&&(o=vb(o,i,a)),o[0]){case"l":s+=o[1],c+=o[2],e.lineTo(s+n,c+r);break;case"L":s=o[1],c=o[2],e.lineTo(s+n,c+r);break;case"h":s+=o[1],e.lineTo(s+n,c+r);break;case"H":s=o[1],e.lineTo(s+n,c+r);break;case"v":c+=o[1],e.lineTo(s+n,c+r);break;case"V":c=o[1],e.lineTo(s+n,c+r);break;case"m":s+=o[1],c+=o[2],p=s,m=c,e.moveTo(s+n,c+r);break;case"M":s=o[1],c=o[2],p=s,m=c,e.moveTo(s+n,c+r);break;case"c":h=s+o[5],d=c+o[6],l=s+o[3],u=c+o[4],e.bezierCurveTo(s+o[1]+n,c+o[2]+r,l+n,u+r,h+n,d+r),s=h,c=d;break;case"C":s=o[5],c=o[6],l=o[3],u=o[4],e.bezierCurveTo(o[1]+n,o[2]+r,l+n,u+r,s+n,c+r);break;case"s":h=s+o[3],d=c+o[4],l=2*s-l,u=2*c-u,e.bezierCurveTo(l+n,u+r,s+o[1]+n,c+o[2]+r,h+n,d+r),l=s+o[1],u=c+o[2],s=h,c=d;break;case"S":h=o[3],d=o[4],l=2*s-l,u=2*c-u,e.bezierCurveTo(l+n,u+r,o[1]+n,o[2]+r,h+n,d+r),s=h,c=d,l=o[1],u=o[2];break;case"q":h=s+o[3],d=c+o[4],l=s+o[1],u=c+o[2],e.quadraticCurveTo(l+n,u+r,h+n,d+r),s=h,c=d;break;case"Q":h=o[3],d=o[4],e.quadraticCurveTo(o[1]+n,o[2]+r,h+n,d+r),s=h,c=d,l=o[1],u=o[2];break;case"t":h=s+o[1],d=c+o[2],f[0].match(/[QqTt]/)===null?(l=s,u=c):f[0]==="t"?(l=2*s-g,u=2*c-b):f[0]==="q"&&(l=2*s-l,u=2*c-u),g=l,b=u,e.quadraticCurveTo(l+n,u+r,h+n,d+r),s=h,c=d,l=s+o[1],u=c+o[2];break;case"T":h=o[1],d=o[2],l=2*s-l,u=2*c-u,e.quadraticCurveTo(l+n,u+r,h+n,d+r),s=h,c=d;break;case"a":Hu(e,s+n,c+r,[o[1],o[2],o[3],o[4],o[5],o[6]+s+n,o[7]+c+r]),s+=o[6],c+=o[7];break;case"A":Hu(e,s+n,c+r,[o[1],o[2],o[3],o[4],o[5],o[6]+n,o[7]+r]),s=o[6],c=o[7];break;case"z":case"Z":s=p,c=m,e.closePath();break}f=o}}function Hu(e,t,n,r){let i=yb(r[5],r[6],r[0],r[1],r[3],r[4],r[2],t,n);for(let a=0;a<i.length;++a){let o=_b(i[a]);e.bezierCurveTo(o[0],o[1],o[2],o[3],o[4],o[5])}}var Gu=.5773502691896257,ju={circle:{draw:function(e,t){let n=Math.sqrt(t)/2;e.moveTo(n,0),e.arc(0,0,n,0,He)}},cross:{draw:function(e,t){var n=Math.sqrt(t)/2,r=n/2.5;e.moveTo(-n,-r),e.lineTo(-n,r),e.lineTo(-r,r),e.lineTo(-r,n),e.lineTo(r,n),e.lineTo(r,r),e.lineTo(n,r),e.lineTo(n,-r),e.lineTo(r,-r),e.lineTo(r,-n),e.lineTo(-r,-n),e.lineTo(-r,-r),e.closePath()}},diamond:{draw:function(e,t){let n=Math.sqrt(t)/2;e.moveTo(-n,0),e.lineTo(0,-n),e.lineTo(n,0),e.lineTo(0,n),e.closePath()}},square:{draw:function(e,t){var n=Math.sqrt(t),r=-n/2;e.rect(r,r,n,n)}},arrow:{draw:function(e,t){var n=Math.sqrt(t)/2,r=n/7,i=n/2.5,a=n/8;e.moveTo(-r,n),e.lineTo(r,n),e.lineTo(r,-a),e.lineTo(i,-a),e.lineTo(0,-n),e.lineTo(-i,-a),e.lineTo(-r,-a),e.closePath()}},wedge:{draw:function(e,t){var n=Math.sqrt(t)/2,r=xn*n,i=r-n*Gu,a=n/4;e.moveTo(0,-r-i),e.lineTo(-a,r-i),e.lineTo(a,r-i),e.closePath()}},triangle:{draw:function(e,t){var n=Math.sqrt(t)/2,r=xn*n,i=r-n*Gu;e.moveTo(0,-r-i),e.lineTo(-n,r-i),e.lineTo(n,r-i),e.closePath()}},"triangle-up":{draw:function(e,t){var n=Math.sqrt(t)/2,r=xn*n;e.moveTo(0,-r),e.lineTo(-n,r),e.lineTo(n,r),e.closePath()}},"triangle-down":{draw:function(e,t){var n=Math.sqrt(t)/2,r=xn*n;e.moveTo(0,r),e.lineTo(-n,-r),e.lineTo(n,-r),e.closePath()}},"triangle-right":{draw:function(e,t){var n=Math.sqrt(t)/2,r=xn*n;e.moveTo(r,0),e.lineTo(-r,-n),e.lineTo(-r,n),e.closePath()}},"triangle-left":{draw:function(e,t){var n=Math.sqrt(t)/2,r=xn*n;e.moveTo(-r,0),e.lineTo(r,-n),e.lineTo(r,n),e.closePath()}},stroke:{draw:function(e,t){let n=Math.sqrt(t)/2;e.moveTo(-n,0),e.lineTo(n,0)}}};function xb(e){return me(ju,e)?ju[e]:wb(e)}var qo={};function wb(e){if(!me(qo,e)){let t=dl(e);qo[e]={draw:function(n,r){Bo(n,t,0,0,Math.sqrt(r)/2)}}}return qo[e]}var bt=.448084975506;function Mb(e){return e.x}function kb(e){return e.y}function Tb(e){return e.width}function Sb(e){return e.height}function tt(e){return typeof e=="function"?e:()=>+e}function Ci(e,t,n){return Math.max(t,Math.min(e,n))}function Cb(){var e=Mb,t=kb,n=Tb,r=Sb,i=tt(0),a=i,o=i,f=i,s=null;function c(l,u,h){var d,g=u??+e.call(this,l),b=h??+t.call(this,l),p=+n.call(this,l),m=+r.call(this,l),w=Math.min(p,m)/2,x=Ci(+i.call(this,l),0,w),v=Ci(+a.call(this,l),0,w),C=Ci(+o.call(this,l),0,w),_=Ci(+f.call(this,l),0,w);if(s||(s=d=di()),x<=0&&v<=0&&C<=0&&_<=0)s.rect(g,b,p,m);else{var k=g+p,$=b+m;s.moveTo(g+x,b),s.lineTo(k-v,b),s.bezierCurveTo(k-bt*v,b,k,b+bt*v,k,b+v),s.lineTo(k,$-_),s.bezierCurveTo(k,$-bt*_,k-bt*_,$,k-_,$),s.lineTo(g+C,$),s.bezierCurveTo(g+bt*C,$,g,$-bt*C,g,$-C),s.lineTo(g,b+x),s.bezierCurveTo(g,b+bt*x,g+bt*x,b,g+x,b),s.closePath()}if(d)return s=null,d+""||null}return c.x=function(l){return arguments.length?(e=tt(l),c):e},c.y=function(l){return arguments.length?(t=tt(l),c):t},c.width=function(l){return arguments.length?(n=tt(l),c):n},c.height=function(l){return arguments.length?(r=tt(l),c):r},c.cornerRadius=function(l,u,h,d){return arguments.length?(i=tt(l),a=u!=null?tt(u):i,f=h!=null?tt(h):i,o=d!=null?tt(d):a,c):i},c.context=function(l){return arguments.length?(s=l??null,c):s},c}function Ab(){var e,t,n,r,i=null,a,o,f,s;function c(u,h,d){let g=d/2;if(a){var b=f-h,p=u-o;if(b||p){var m=Math.hypot(b,p),w=(b/=m)*s,x=(p/=m)*s,v=Math.atan2(p,b);i.moveTo(o-w,f-x),i.lineTo(u-b*g,h-p*g),i.arc(u,h,g,v-Math.PI,v),i.lineTo(o+w,f+x),i.arc(o,f,s,v,v+Math.PI)}else i.arc(u,h,g,0,He);i.closePath()}else a=1;o=u,f=h,s=g}function l(u){var h,d=u.length,g,b=!1,p;for(i==null&&(i=p=di()),h=0;h<=d;++h)!(h<d&&r(g=u[h],h,u))===b&&(b=!b)&&(a=0),b&&c(+e(g,h,u),+t(g,h,u),+n(g,h,u));if(p)return i=null,p+""||null}return l.x=function(u){return arguments.length?(e=u,l):e},l.y=function(u){return arguments.length?(t=u,l):t},l.size=function(u){return arguments.length?(n=u,l):n},l.defined=function(u){return arguments.length?(r=u,l):r},l.context=function(u){return arguments.length?(u==null?i=null:i=u,l):i},l}function Sr(e,t){return e??t}var Cr=e=>e.x||0,Ar=e=>e.y||0,Nb=e=>e.width||0,Rb=e=>e.height||0,$b=e=>(e.x||0)+(e.width||0),Eb=e=>(e.y||0)+(e.height||0),Db=e=>e.startAngle||0,Pb=e=>e.endAngle||0,Ob=e=>e.padAngle||0,Ib=e=>e.innerRadius||0,Lb=e=>e.outerRadius||0,Ub=e=>e.cornerRadius||0,qb=e=>Sr(e.cornerRadiusTopLeft,e.cornerRadius)||0,Fb=e=>Sr(e.cornerRadiusTopRight,e.cornerRadius)||0,zb=e=>Sr(e.cornerRadiusBottomRight,e.cornerRadius)||0,Yb=e=>Sr(e.cornerRadiusBottomLeft,e.cornerRadius)||0,Bb=e=>Sr(e.size,64),Hb=e=>e.size||1,Qi=e=>e.defined!==!1,Gb=e=>xb(e.shape||"circle"),jb=Qc().startAngle(Db).endAngle(Pb).padAngle(Ob).innerRadius(Ib).outerRadius(Lb).cornerRadius(Ub),Wb=wo().x(Cr).y1(Ar).y0(Eb).defined(Qi),Xb=wo().y(Ar).x1(Cr).x0($b).defined(Qi),Vb=xo().x(Cr).y(Ar).defined(Qi),Zb=Cb().x(Cr).y(Ar).width(Nb).height(Rb).cornerRadius(qb,Fb,zb,Yb),Qb=iu().type(Gb).size(Bb),Jb=Ab().x(Cr).y(Ar).defined(Qi).size(Hb);function af(e){return e.cornerRadius||e.cornerRadiusTopLeft||e.cornerRadiusTopRight||e.cornerRadiusBottomRight||e.cornerRadiusBottomLeft}function Kb(e,t){return jb.context(e)(t)}function eg(e,t){let n=t[0],r=n.interpolate||"linear";return(n.orient==="horizontal"?Xb:Wb).curve(hl(r,n.orient,n.tension)).context(e)(t)}function tg(e,t){let n=t[0],r=n.interpolate||"linear";return Vb.curve(hl(r,n.orient,n.tension)).context(e)(t)}function Sn(e,t,n,r){return Zb.context(e)(t,n,r)}function ng(e,t){return(t.mark.shape||t.shape).context(e)(t)}function rg(e,t){return Qb.context(e)(t)}function ig(e,t){return Jb.context(e)(t)}var ag=1;function of(e,t,n){var r=t.clip,i=e._defs,a=t.clip_id||(t.clip_id="clip"+ag++),o=i.clipping[a]||(i.clipping[a]={id:a});return it(r)?o.path=r(null):af(n)?o.path=Sn(null,n,0,0):(o.width=n.width||0,o.height=n.height||0),"url(#"+a+")"}function qe(e){this.clear(),e&&this.union(e)}qe.prototype={clone(){return new qe(this)},clear(){return this.x1=+Number.MAX_VALUE,this.y1=+Number.MAX_VALUE,this.x2=-Number.MAX_VALUE,this.y2=-Number.MAX_VALUE,this},empty(){return this.x1===+Number.MAX_VALUE&&this.y1===+Number.MAX_VALUE&&this.x2===-Number.MAX_VALUE&&this.y2===-Number.MAX_VALUE},equals(e){return this.x1===e.x1&&this.y1===e.y1&&this.x2===e.x2&&this.y2===e.y2},set(e,t,n,r){return n<e?(this.x2=e,this.x1=n):(this.x1=e,this.x2=n),r<t?(this.y2=t,this.y1=r):(this.y1=t,this.y2=r),this},add(e,t){return e<this.x1&&(this.x1=e),t<this.y1&&(this.y1=t),e>this.x2&&(this.x2=e),t>this.y2&&(this.y2=t),this},expand(e){return this.x1-=e,this.y1-=e,this.x2+=e,this.y2+=e,this},round(){return this.x1=Math.floor(this.x1),this.y1=Math.floor(this.y1),this.x2=Math.ceil(this.x2),this.y2=Math.ceil(this.y2),this},scale(e){return this.x1*=e,this.y1*=e,this.x2*=e,this.y2*=e,this},translate(e,t){return this.x1+=e,this.x2+=e,this.y1+=t,this.y2+=t,this},rotate(e,t,n){let r=this.rotatedPoints(e,t,n);return this.clear().add(r[0],r[1]).add(r[2],r[3]).add(r[4],r[5]).add(r[6],r[7])},rotatedPoints(e,t,n){var{x1:r,y1:i,x2:a,y2:o}=this,f=Math.cos(e),s=Math.sin(e),c=t-t*f+n*s,l=n-t*s-n*f;return[f*r-s*i+c,s*r+f*i+l,f*r-s*o+c,s*r+f*o+l,f*a-s*i+c,s*a+f*i+l,f*a-s*o+c,s*a+f*o+l]},union(e){return e.x1<this.x1&&(this.x1=e.x1),e.y1<this.y1&&(this.y1=e.y1),e.x2>this.x2&&(this.x2=e.x2),e.y2>this.y2&&(this.y2=e.y2),this},intersect(e){return e.x1>this.x1&&(this.x1=e.x1),e.y1>this.y1&&(this.y1=e.y1),e.x2<this.x2&&(this.x2=e.x2),e.y2<this.y2&&(this.y2=e.y2),this},encloses(e){return e&&this.x1<=e.x1&&this.x2>=e.x2&&this.y1<=e.y1&&this.y2>=e.y2},alignsWith(e){return e&&(this.x1==e.x1||this.x2==e.x2||this.y1==e.y1||this.y2==e.y2)},intersects(e){return e&&!(this.x2<e.x1||this.x1>e.x2||this.y2<e.y1||this.y1>e.y2)},contains(e,t){return!(e<this.x1||e>this.x2||t<this.y1||t>this.y2)},width(){return this.x2-this.x1},height(){return this.y2-this.y1}};function gl(e){this.mark=e,this.bounds=this.bounds||new qe}function og(e){gl.call(this,e),this.items=this.items||[]}Af(og,gl);var Ho=class{constructor(t){this._pending=0,this._loader=t||Io()}pending(){return this._pending}sanitizeURL(t){let n=this;return Wu(n),n._loader.sanitize(t,{context:"href"}).then(r=>(gr(n),r)).catch(()=>(gr(n),null))}loadImage(t){let n=this,r=Eu();return Wu(n),n._loader.sanitize(t,{context:"image"}).then(i=>{let a=i.href;if(!a||!r)throw{url:a};let o=new r,f=me(i,"crossOrigin")?i.crossOrigin:"anonymous";return f!=null&&(o.crossOrigin=f),o.onload=()=>gr(n),o.onerror=()=>gr(n),o.src=a,o}).catch(i=>(gr(n),{complete:!1,width:0,height:0,src:i&&i.url||""}))}ready(){let t=this;return new Promise(n=>{function r(i){t.pending()?setTimeout(()=>{r(!0)},10):n(i)}r(!1)})}};function Wu(e){e._pending+=1}function gr(e){e._pending-=1}function Cn(e,t,n){if(t.stroke&&t.opacity!==0&&t.strokeOpacity!==0){let r=t.strokeWidth!=null?+t.strokeWidth:1;e.expand(r+(n?fg(t,r):0))}return e}function fg(e,t){return e.strokeJoin&&e.strokeJoin!=="miter"?0:t}var sg=He-1e-8,Ji,Ai,Ni,Gt,Go,Ri,jo,Wo,pt=(e,t)=>Ji.add(e,t),$i=(e,t)=>pt(Ai=e,Ni=t),Xu=e=>pt(e,Ji.y1),Vu=e=>pt(Ji.x1,e),Bt=(e,t)=>Go*e+jo*t,Ht=(e,t)=>Ri*e+Wo*t,Fo=(e,t)=>pt(Bt(e,t),Ht(e,t)),zo=(e,t)=>$i(Bt(e,t),Ht(e,t));function ff(e,t){return Ji=e,t?(Gt=t*_t,Go=Wo=Math.cos(Gt),Ri=Math.sin(Gt),jo=-Ri):(Go=Wo=1,Gt=Ri=jo=0),cg}var cg={beginPath(){},closePath(){},moveTo:zo,lineTo:zo,rect(e,t,n,r){Gt?(Fo(e+n,t),Fo(e+n,t+r),Fo(e,t+r),zo(e,t)):(pt(e+n,t+r),$i(e,t))},quadraticCurveTo(e,t,n,r){let i=Bt(e,t),a=Ht(e,t),o=Bt(n,r),f=Ht(n,r);Zu(Ai,i,o,Xu),Zu(Ni,a,f,Vu),$i(o,f)},bezierCurveTo(e,t,n,r,i,a){let o=Bt(e,t),f=Ht(e,t),s=Bt(n,r),c=Ht(n,r),l=Bt(i,a),u=Ht(i,a);Qu(Ai,o,s,l,Xu),Qu(Ni,f,c,u,Vu),$i(l,u)},arc(e,t,n,r,i,a){if(r+=Gt,i+=Gt,Ai=n*Math.cos(i)+e,Ni=n*Math.sin(i)+t,Math.abs(i-r)>sg)pt(e-n,t-n),pt(e+n,t+n);else{let o=c=>pt(n*Math.cos(c)+e,n*Math.sin(c)+t),f,s;if(o(r),o(i),i!==r)if(r=r%He,r<0&&(r+=He),i=i%He,i<0&&(i+=He),i<r&&(a=!a,f=r,r=i,i=f),a)for(i-=He,f=r-r%Yt,s=0;s<4&&f>i;++s,f-=Yt)o(f);else for(f=r-r%Yt+Yt,s=0;s<4&&f<i;++s,f=f+Yt)o(f)}}};function Zu(e,t,n,r){let i=(e-t)/(e+n-2*t);0<i&&i<1&&r(e+(t-e)*i)}function Qu(e,t,n,r,i){let a=r-e+3*t-3*n,o=e+n-2*t,f=e-t,s=0,c=0,l;Math.abs(a)>mb?(l=o*o+f*a,l>=0&&(l=Math.sqrt(l),s=(-o+l)/a,c=(-o-l)/a)):s=.5*f/o,0<s&&s<1&&i(Ju(s,e,t,n,r)),0<c&&c<1&&i(Ju(c,e,t,n,r))}function Ju(e,t,n,r,i){let a=1-e,o=a*a,f=e*e;return o*a*t+3*o*e*n+3*a*f*r+f*e*i}var yt=(yt=Mi(1,1))?yt.getContext("2d"):null,Xo=new qe;function pl(e){return function(t,n){if(!yt)return!0;e(yt,t),Xo.clear().union(t.bounds).intersect(n).round();let{x1:r,y1:i,x2:a,y2:o}=Xo;for(let f=i;f<=o;++f)for(let s=r;s<=a;++s)if(yt.isPointInPath(s,f))return!0;return!1}}function ml(e,t){return t.contains(e.x||0,e.y||0)}function yl(e,t){let n=e.x||0,r=e.y||0,i=e.width||0,a=e.height||0;return t.intersects(Xo.set(n,r,n+i,r+a))}function ug(e,t){let n=e.x||0,r=e.y||0,i=e.x2!=null?e.x2:n,a=e.y2!=null?e.y2:r;return mr(t,n,r,i,a)}function mr(e,t,n,r,i){let{x1:a,y1:o,x2:f,y2:s}=e,c=r-t,l=i-n,u=0,h=1,d,g,b,p;for(p=0;p<4;++p){if(p===0&&(d=-c,g=-(a-t)),p===1&&(d=c,g=f-t),p===2&&(d=-l,g=-(o-n)),p===3&&(d=l,g=s-n),Math.abs(d)<1e-10&&g<0)return!1;if(b=g/d,d<0){if(b>h)return!1;b>u&&(u=b)}else if(d>0){if(b<u)return!1;b<h&&(h=b)}}return!0}function wn(e,t){e.globalCompositeOperation=t.blend||"source-over"}function Le(e,t){return e??t}function Ku(e,t){let n=t.length;for(let r=0;r<n;++r)e.addColorStop(t[r].offset,t[r].color);return e}function lg(e,t,n){let r=n.width(),i=n.height(),a;if(t.gradient==="radial")a=e.createRadialGradient(n.x1+Le(t.x1,.5)*r,n.y1+Le(t.y1,.5)*i,Math.max(r,i)*Le(t.r1,0),n.x1+Le(t.x2,.5)*r,n.y1+Le(t.y2,.5)*i,Math.max(r,i)*Le(t.r2,.5));else{let o=Le(t.x1,0),f=Le(t.y1,0),s=Le(t.x2,1),c=Le(t.y2,0);if(o===s||f===c||r===i)a=e.createLinearGradient(n.x1+o*r,n.y1+f*i,n.x1+s*r,n.y1+c*i);else{let l=Mi(Math.ceil(r),Math.ceil(i)),u=l.getContext("2d");return u.scale(r,i),u.fillStyle=Ku(u.createLinearGradient(o,f,s,c),t.stops),u.fillRect(0,0,r,i),e.createPattern(l,"no-repeat")}}return Ku(a,t.stops)}function _l(e,t,n){return rf(n)?lg(e,n,t.bounds):n}function Li(e,t,n){return n*=t.fillOpacity==null?1:t.fillOpacity,n>0?(e.globalAlpha=n,e.fillStyle=_l(e,t,t.fill),!0):!1}var hg=[];function Mn(e,t,n){var r=(r=t.strokeWidth)!=null?r:1;return r<=0?!1:(n*=t.strokeOpacity==null?1:t.strokeOpacity,n>0?(e.globalAlpha=n,e.strokeStyle=_l(e,t,t.stroke),e.lineWidth=r,e.lineCap=t.strokeCap||"butt",e.lineJoin=t.strokeJoin||"miter",e.miterLimit=t.strokeMiterLimit||10,e.setLineDash&&(e.setLineDash(t.strokeDash||hg),e.lineDashOffset=t.strokeDashOffset||0),!0):!1)}function dg(e,t){return e.zindex-t.zindex||e.index-t.index}function vl(e){if(!e.zdirty)return e.zitems;var t=e.items,n=[],r,i,a;for(i=0,a=t.length;i<a;++i)r=t[i],r.index=i,r.zindex&&n.push(r);return e.zdirty=!1,e.zitems=n.sort(dg)}function Ge(e,t){var n=e.items,r,i;if(!n||!n.length)return;let a=vl(e);if(a&&a.length){for(r=0,i=n.length;r<i;++r)n[r].zindex||t(n[r]);n=a}for(r=0,i=n.length;r<i;++r)t(n[r])}function Vo(e,t){var n=e.items,r,i;if(!n||!n.length)return null;let a=vl(e);for(a&&a.length&&(n=a),i=n.length;--i>=0;)if(r=t(n[i]))return r;if(n===a){for(n=e.items,i=n.length;--i>=0;)if(!n[i].zindex&&(r=t(n[i])))return r}return null}function sf(e){return function(t,n,r){Ge(n,i=>{(!r||r.intersects(i.bounds))&&xl(e,t,i,i)})}}function bg(e){return function(t,n,r){n.items.length&&(!r||r.intersects(n.bounds))&&xl(e,t,n.items[0],n.items)}}function xl(e,t,n,r){var i=n.opacity==null?1:n.opacity;i!==0&&(e(t,r)||(wn(t,n),n.fill&&Li(t,n,i)&&t.fill(),n.stroke&&Mn(t,n,i)&&t.stroke()))}function Ki(e){return e=e||fa,function(t,n,r,i,a,o){return r*=t.pixelRatio,i*=t.pixelRatio,Vo(n,f=>{let s=f.bounds;if(!(s&&!s.contains(a,o)||!s)&&e(t,f,r,i,a,o))return f})}}function Nr(e,t){return function(n,r,i,a){var o=Array.isArray(r)?r[0]:r,f=t??o.fill,s=o.stroke&&n.isPointInStroke,c,l;return s&&(c=o.strokeWidth,l=o.strokeCap,n.lineWidth=c??1,n.lineCap=l??"butt"),e(n,r)?!1:f&&n.isPointInPath(i,a)||s&&n.isPointInStroke(i,a)}}function cf(e){return Ki(Nr(e))}function Wt(e,t){return"translate("+e+","+t+")"}function uf(e){return"rotate("+e+")"}function gg(e,t){return"scale("+e+","+t+")"}function wl(e){return Wt(e.x||0,e.y||0)}function pg(e){return Wt(e.x||0,e.y||0)+(e.angle?" "+uf(e.angle):"")}function mg(e){return Wt(e.x||0,e.y||0)+(e.angle?" "+uf(e.angle):"")+(e.scaleX||e.scaleY?" "+gg(e.scaleX||1,e.scaleY||1):"")}function lf(e,t,n){function r(o,f){o("transform",pg(f)),o("d",t(null,f))}function i(o,f){return t(ff(o,f.angle),f),Cn(o,f).translate(f.x||0,f.y||0)}function a(o,f){var s=f.x||0,c=f.y||0,l=f.angle||0;o.translate(s,c),l&&o.rotate(l*=_t),o.beginPath(),t(o,f),l&&o.rotate(-l),o.translate(-s,-c)}return{type:e,tag:"path",nested:!1,attr:r,bound:i,draw:sf(a),pick:cf(a),isect:n||pl(a)}}var yg=lf("arc",Kb);function _g(e,t){for(var n=e[0].orient==="horizontal"?t[1]:t[0],r=e[0].orient==="horizontal"?"y":"x",i=e.length,a=1/0,o,f;--i>=0;)e[i].defined!==!1&&(f=Math.abs(e[i][r]-n),f<a&&(a=f,o=e[i]));return o}function vg(e,t){for(var n=Math.pow(e[0].strokeWidth||1,2),r=e.length,i,a,o;--r>=0;)if(e[r].defined!==!1&&(i=e[r].x-t[0],a=e[r].y-t[1],o=i*i+a*a,o<n))return e[r];return null}function xg(e,t){for(var n=e.length,r,i,a;--n>=0;)if(e[n].defined!==!1&&(r=e[n].x-t[0],i=e[n].y-t[1],a=r*r+i*i,r=e[n].size||1,a<r*r))return e[n];return null}function hf(e,t,n){function r(s,c){var l=c.mark.items;l.length&&s("d",t(null,l))}function i(s,c){var l=c.items;return l.length===0?s:(t(ff(s),l),Cn(s,l[0]))}function a(s,c){s.beginPath(),t(s,c)}let o=Nr(a);function f(s,c,l,u,h,d){var g=c.items,b=c.bounds;return!g||!g.length||b&&!b.contains(h,d)?null:(l*=s.pixelRatio,u*=s.pixelRatio,o(s,g,l,u)?g[0]:null)}return{type:e,tag:"path",nested:!0,attr:r,bound:i,draw:bg(a),pick:f,isect:ml,tip:n}}var wg=hf("area",eg,_g);function Mg(e,t){var n=t.clip;e.save(),it(n)?(e.beginPath(),n(e),e.clip()):Ml(e,t.group)}function Ml(e,t){e.beginPath(),af(t)?Sn(e,t,0,0):e.rect(0,0,t.width||0,t.height||0),e.clip()}function kl(e){let t=Le(e.strokeWidth,1);return e.strokeOffset!=null?e.strokeOffset:e.stroke&&t>.5&&t<1.5?.5-Math.abs(t-1):0}function kg(e,t){e("transform",wl(t))}function Tl(e,t){let n=kl(t);e("d",Sn(null,t,n,n))}function Tg(e,t){e("class","background"),e("aria-hidden",!0),Tl(e,t)}function Sg(e,t){e("class","foreground"),e("aria-hidden",!0),t.strokeForeground?Tl(e,t):e("d","")}function Cg(e,t,n){let r=t.clip?of(n,t,t):null;e("clip-path",r)}function Ag(e,t){if(!t.clip&&t.items){let n=t.items,r=n.length;for(let i=0;i<r;++i)e.union(n[i].bounds)}return(t.clip||t.width||t.height)&&!t.noBound&&e.add(0,0).add(t.width||0,t.height||0),Cn(e,t),e.translate(t.x||0,t.y||0)}function wr(e,t,n,r){let i=kl(t);e.beginPath(),Sn(e,t,(n||0)+i,(r||0)+i)}var Ng=Nr(wr),Rg=Nr(wr,!1),$g=Nr(wr,!0);function Eg(e,t,n,r){Ge(t,i=>{let a=i.x||0,o=i.y||0,f=i.strokeForeground,s=i.opacity==null?1:i.opacity;(i.stroke||i.fill)&&s&&(wr(e,i,a,o),wn(e,i),i.fill&&Li(e,i,s)&&e.fill(),i.stroke&&!f&&Mn(e,i,s)&&e.stroke()),e.save(),e.translate(a,o),i.clip&&Ml(e,i),n&&n.translate(-a,-o),Ge(i,c=>{(c.marktype==="group"||r==null||r.includes(c.marktype))&&this.draw(e,c,n,r)}),n&&n.translate(a,o),e.restore(),f&&i.stroke&&s&&(wr(e,i,a,o),wn(e,i),Mn(e,i,s)&&e.stroke())})}function Dg(e,t,n,r,i,a){if(t.bounds&&!t.bounds.contains(i,a)||!t.items)return null;let o=n*e.pixelRatio,f=r*e.pixelRatio;return Vo(t,s=>{let c,l,u,h=s.bounds;if(h&&!h.contains(i,a))return;l=s.x||0,u=s.y||0;let d=l+(s.width||0),g=u+(s.height||0),b=s.clip;if(b&&(i<l||i>d||a<u||a>g))return;if(e.save(),e.translate(l,u),l=i-l,u=a-u,b&&af(s)&&!$g(e,s,o,f))return e.restore(),null;let p=s.strokeForeground,m=t.interactive!==!1;return m&&p&&s.stroke&&Rg(e,s,o,f)?(e.restore(),s):(c=Vo(s,w=>Pg(w,l,u)?this.pick(w,n,r,l,u):null),!c&&m&&(s.fill||!p&&s.stroke)&&Ng(e,s,o,f)&&(c=s),e.restore(),c||null)})}function Pg(e,t,n){return(e.interactive!==!1||e.marktype==="group")&&e.bounds&&e.bounds.contains(t,n)}var Og={type:"group",tag:"g",nested:!1,attr:kg,bound:Ag,draw:Eg,pick:Dg,isect:yl,content:Cg,background:Tg,foreground:Sg},Mr={xmlns:"http://www.w3.org/2000/svg","xmlns:xlink":"http://www.w3.org/1999/xlink",version:"1.1"};function df(e,t){var n=e.image;return(!n||e.url&&e.url!==n.url)&&(n={complete:!1,width:0,height:0},t.loadImage(e.url).then(r=>{e.image=r,e.image.url=e.url})),n}function bf(e,t){return e.width!=null?e.width:!t||!t.width?0:e.aspect!==!1&&e.height?e.height*t.width/t.height:t.width}function gf(e,t){return e.height!=null?e.height:!t||!t.height?0:e.aspect!==!1&&e.width?e.width*t.height/t.width:t.height}function ea(e,t){return e==="center"?t/2:e==="right"?t:0}function ta(e,t){return e==="middle"?t/2:e==="bottom"?t:0}function Ig(e,t,n){let r=df(t,n),i=bf(t,r),a=gf(t,r),o=(t.x||0)-ea(t.align,i),f=(t.y||0)-ta(t.baseline,a),s=!r.src&&r.toDataURL?r.toDataURL():r.src||"";e("href",s,Mr["xmlns:xlink"],"xlink:href"),e("transform",Wt(o,f)),e("width",i),e("height",a),e("preserveAspectRatio",t.aspect===!1?"none":"xMidYMid")}function Lg(e,t){let n=t.image,r=bf(t,n),i=gf(t,n),a=(t.x||0)-ea(t.align,r),o=(t.y||0)-ta(t.baseline,i);return e.set(a,o,a+r,o+i)}function Ug(e,t,n){Ge(t,r=>{if(n&&!n.intersects(r.bounds))return;let i=df(r,this),a=bf(r,i),o=gf(r,i);if(a===0||o===0)return;let f=(r.x||0)-ea(r.align,a),s=(r.y||0)-ta(r.baseline,o),c,l,u,h;r.aspect!==!1&&(l=i.width/i.height,u=r.width/r.height,l===l&&u===u&&l!==u&&(u<l?(h=a/l,s+=(o-h)/2,o=h):(h=o*l,f+=(a-h)/2,a=h))),(i.complete||i.toDataURL)&&(wn(e,r),e.globalAlpha=(c=r.opacity)!=null?c:1,e.imageSmoothingEnabled=r.smooth!==!1,e.drawImage(i,f,s,a,o))})}var qg={type:"image",tag:"image",nested:!1,attr:Ig,bound:Lg,draw:Ug,pick:Ki(),isect:fa,get:df,xOffset:ea,yOffset:ta},Fg=hf("line",tg,vg);function zg(e,t){var n=t.scaleX||1,r=t.scaleY||1;(n!==1||r!==1)&&e("vector-effect","non-scaling-stroke"),e("transform",mg(t)),e("d",t.path)}function Ei(e,t){var n=t.path;if(n==null)return!0;var r=t.x||0,i=t.y||0,a=t.scaleX||1,o=t.scaleY||1,f=(t.angle||0)*_t,s=t.pathCache;(!s||s.path!==n)&&((t.pathCache=s=dl(n)).path=n),f&&e.rotate&&e.translate?(e.translate(r,i),e.rotate(f),Bo(e,s,0,0,a,o),e.rotate(-f),e.translate(-r,-i)):Bo(e,s,r,i,a,o)}function Yg(e,t){return Ei(ff(e,t.angle),t)?e.set(0,0,0,0):Cn(e,t,!0)}var Bg={type:"path",tag:"path",nested:!1,attr:zg,bound:Yg,draw:sf(Ei),pick:cf(Ei),isect:pl(Ei)};function Hg(e,t){e("d",Sn(null,t))}function Gg(e,t){var n,r;return Cn(e.set(n=t.x||0,r=t.y||0,n+t.width||0,r+t.height||0),t)}function el(e,t){e.beginPath(),Sn(e,t)}var jg={type:"rect",tag:"path",nested:!1,attr:Hg,bound:Gg,draw:sf(el),pick:cf(el),isect:yl};function Wg(e,t){e("transform",wl(t)),e("x2",t.x2!=null?t.x2-(t.x||0):0),e("y2",t.y2!=null?t.y2-(t.y||0):0)}function Xg(e,t){var n,r;return Cn(e.set(n=t.x||0,r=t.y||0,t.x2!=null?t.x2:n,t.y2!=null?t.y2:r),t)}function Sl(e,t,n){var r,i,a,o;return t.stroke&&Mn(e,t,n)?(r=t.x||0,i=t.y||0,a=t.x2!=null?t.x2:r,o=t.y2!=null?t.y2:i,e.beginPath(),e.moveTo(r,i),e.lineTo(a,o),!0):!1}function Vg(e,t,n){Ge(t,r=>{if(!(n&&!n.intersects(r.bounds))){var i=r.opacity==null?1:r.opacity;i&&Sl(e,r,i)&&(wn(e,r),e.stroke())}})}function Zg(e,t,n,r){return e.isPointInStroke?Sl(e,t,1)&&e.isPointInStroke(n,r):!1}var Qg={type:"rule",tag:"line",nested:!1,attr:Wg,bound:Xg,draw:Vg,pick:Ki(Zg),isect:ug},Jg=lf("shape",ng),Kg=lf("symbol",rg,ml),tl=Rf(),Xt={height:rt,measureWidth:pf,estimateWidth:Ui,width:Ui,canvas:Cl};Cl(!0);function Cl(e){Xt.width=e&&yt?pf:Ui}function Ui(e,t){return Al(vt(e,t),rt(e))}function Al(e,t){return~~(.8*e.length*t)}function pf(e,t){return rt(e)<=0||!(t=vt(e,t))?0:Nl(t,mf(e))}function Nl(e,t){let n=`(${t}) ${e}`,r=tl.get(n);return r===void 0&&(yt.font=t,r=yt.measureText(e).width,tl.set(n,r)),r}function rt(e){return e.fontSize!=null?+e.fontSize||0:11}function kn(e){return e.lineHeight!=null?e.lineHeight:rt(e)+2}function ep(e){return se(e)?e.length>1?e:e[0]:e}function na(e){return ep(e.lineBreak&&e.text&&!se(e.text)?e.text.split(e.lineBreak):e.text)}function vt(e,t){let n=t==null?"":(t+"").trim();return e.limit>0&&n.length?np(e,n):n}function tp(e){if(Xt.width===pf){let t=mf(e);return n=>Nl(n,t)}else if(Xt.width===Ui){let t=rt(e);return n=>Al(n,t)}else return t=>Xt.width(e,t)}function np(e,t){var n=+e.limit,r=tp(e);if(r(t)<n)return t;var i=e.ellipsis||"\\u2026",a=e.dir==="rtl",o=0,f=t.length,s;if(n-=r(i),a){for(;o<f;)s=o+f>>>1,r(t.slice(s))>n?o=s+1:f=s;return i+t.slice(o)}else{for(;o<f;)s=1+(o+f>>>1),r(t.slice(0,s))<n?o=s:f=s-1;return t.slice(0,o)+i}}function ra(e,t){var n=e.font;return(t&&n?String(n).replace(/"/g,"\'"):n)||"sans-serif"}function mf(e,t){return(e.fontStyle?e.fontStyle+" ":"")+(e.fontVariant?e.fontVariant+" ":"")+(e.fontWeight?e.fontWeight+" ":"")+rt(e)+"px "+ra(e,t)}function yf(e){var t=e.baseline,n=rt(e);return Math.round(t==="top"?.79*n:t==="middle"?.3*n:t==="bottom"?-.21*n:t==="line-top"?.29*n+.5*kn(e):t==="line-bottom"?.29*n-.5*kn(e):0)}var rp={left:"start",center:"middle",right:"end"},_r=new qe;function ia(e){var t=e.x||0,n=e.y||0,r=e.radius||0,i;return r&&(i=(e.theta||0)-Yt,t+=r*Math.cos(i),n+=r*Math.sin(i)),_r.x1=t,_r.y1=n,_r}function ip(e,t){var n=t.dx||0,r=(t.dy||0)+yf(t),i=ia(t),a=i.x1,o=i.y1,f=t.angle||0,s;e("text-anchor",rp[t.align]||"start"),f?(s=Wt(a,o)+" "+uf(f),(n||r)&&(s+=" "+Wt(n,r))):s=Wt(a+n,o+r),e("transform",s)}function _f(e,t,n){var r=Xt.height(t),i=t.align,a=ia(t),o=a.x1,f=a.y1,s=t.dx||0,c=(t.dy||0)+yf(t)-Math.round(.8*r),l=na(t),u;if(se(l)?(r+=kn(t)*(l.length-1),u=l.reduce((h,d)=>Math.max(h,Xt.width(t,d)),0)):u=Xt.width(t,l),i==="center"?s-=u/2:i==="right"&&(s-=u),e.set(s+=o,c+=f,s+u,c+r),t.angle&&!n)e.rotate(t.angle*_t,o,f);else if(n===2)return e.rotatedPoints(t.angle*_t,o,f);return e}function ap(e,t,n){Ge(t,r=>{var i=r.opacity==null?1:r.opacity,a,o,f,s,c,l,u;if(!(n&&!n.intersects(r.bounds)||i===0||r.fontSize<=0||r.text==null||r.text.length===0)){if(e.font=mf(r),e.textAlign=r.align||"left",a=ia(r),o=a.x1,f=a.y1,r.angle&&(e.save(),e.translate(o,f),e.rotate(r.angle*_t),o=f=0),o+=r.dx||0,f+=(r.dy||0)+yf(r),l=na(r),wn(e,r),se(l))for(c=kn(r),s=0;s<l.length;++s)u=vt(r,l[s]),r.fill&&Li(e,r,i)&&e.fillText(u,o,f),r.stroke&&Mn(e,r,i)&&e.strokeText(u,o,f),f+=c;else u=vt(r,l),r.fill&&Li(e,r,i)&&e.fillText(u,o,f),r.stroke&&Mn(e,r,i)&&e.strokeText(u,o,f);r.angle&&e.restore()}})}function op(e,t,n,r,i,a){if(t.fontSize<=0)return!1;if(!t.angle)return!0;var o=ia(t),f=o.x1,s=o.y1,c=_f(_r,t,1),l=-t.angle*_t,u=Math.cos(l),h=Math.sin(l),d=u*i-h*a+(f-u*f+h*s),g=h*i+u*a+(s-h*f-u*s);return c.contains(d,g)}function fp(e,t){let n=_f(_r,e,2);return mr(t,n[0],n[1],n[2],n[3])||mr(t,n[0],n[1],n[4],n[5])||mr(t,n[4],n[5],n[6],n[7])||mr(t,n[2],n[3],n[6],n[7])}var sp={type:"text",tag:"text",nested:!1,attr:ip,bound:_f,draw:ap,pick:Ki(op),isect:fp},cp=hf("trail",ig,xg),xt={arc:yg,area:wg,group:Og,image:qg,line:Fg,path:Bg,rect:jg,rule:Qg,shape:Jg,symbol:Kg,text:sp,trail:cp};function jt(e,t,n){return!e&&typeof document<"u"&&document.createElement&&(e=document),e?n?e.createElementNS(n,t):e.createElement(t):null}function Rl(e,t){t=t.toLowerCase();for(var n=e.childNodes,r=0,i=n.length;r<i;++r)if(n[r].tagName.toLowerCase()===t)return n[r]}function J(e,t,n,r){var i=e.childNodes[t],a;return(!i||i.tagName.toLowerCase()!==n.toLowerCase())&&(a=i||null,i=jt(e.ownerDocument,n,r),e.insertBefore(i,a)),i}function Ue(e,t){for(var n=e.childNodes,r=n.length;r>t;)e.removeChild(n[--r]);return e}function $l(e){return"mark-"+e.marktype+(e.role?" role-"+e.role:"")+(e.name?" "+e.name:"")}function El(e,t){let n=t.getBoundingClientRect();return[e.clientX-n.left-(t.clientLeft||0),e.clientY-n.top-(t.clientTop||0)]}function up(e,t,n,r){var i=e&&e.mark,a,o;if(i&&(a=xt[i.marktype]).tip){for(o=El(t,n),o[0]-=r[0],o[1]-=r[1];e=e.mark.group;)o[0]-=e.x||0,o[1]-=e.y||0;e=a.tip(i.items,o)}return e}var qi=class{constructor(t,n){this._active=null,this._handlers={},this._loader=t||Io(),this._tooltip=n||lp}initialize(t,n,r){return this._el=t,this._obj=r||null,this.origin(n)}element(){return this._el}canvas(){return this._el&&this._el.firstChild}origin(t){return arguments.length?(this._origin=t||[0,0],this):this._origin.slice()}scene(t){return arguments.length?(this._scene=t,this):this._scene}on(){}off(){}_handlerIndex(t,n,r){for(let i=t?t.length:0;--i>=0;)if(t[i].type===n&&(!r||t[i].handler===r))return i;return-1}handlers(t){let n=this._handlers,r=[];if(t)r.push(...n[this.eventName(t)]);else for(let i in n)r.push(...n[i]);return r}eventName(t){let n=t.indexOf(".");return n<0?t:t.slice(0,n)}handleHref(t,n,r){this._loader.sanitize(r,{context:"href"}).then(i=>{let a=new MouseEvent(t.type,t),o=jt(null,"a");for(let f in i)o.setAttribute(f,i[f]);o.dispatchEvent(a)}).catch(()=>{})}handleTooltip(t,n,r){if(n&&n.tooltip!=null){n=up(n,t,this.canvas(),this._origin);let i=r&&n&&n.tooltip||null;this._tooltip.call(this._obj,this,t,n,i)}}getItemBoundingClientRect(t){let n=this.canvas();if(!n)return;let r=n.getBoundingClientRect(),i=this._origin,a=t.bounds,o=a.width(),f=a.height(),s=a.x1+i[0]+r.left,c=a.y1+i[1]+r.top;for(;t.mark&&(t=t.mark.group);)s+=t.x||0,c+=t.y||0;return{x:s,y:c,width:o,height:f,left:s,top:c,right:s+o,bottom:c+f}}};function lp(e,t,n,r){e.element().setAttribute("title",r||"")}var Tn=class{constructor(t){this._el=null,this._bgcolor=null,this._loader=new Ho(t)}initialize(t,n,r,i,a){return this._el=t,this.resize(n,r,i,a)}element(){return this._el}canvas(){return this._el&&this._el.firstChild}background(t){return arguments.length===0?this._bgcolor:(this._bgcolor=t,this)}resize(t,n,r,i){return this._width=t,this._height=n,this._origin=r||[0,0],this._scale=i||1,this}dirty(){}render(t,n){let r=this;return r._call=function(){r._render(t,n)},r._call(),r._call=null,r}_render(){}renderAsync(t,n){let r=this.render(t,n);return this._ready?this._ready.then(()=>r):Promise.resolve(r)}_load(t,n){var r=this,i=r._loader[t](n);if(!r._ready){let a=r._call;r._ready=r._loader.ready().then(o=>{o&&a(),r._ready=null})}return i}sanitizeURL(t){return this._load("sanitizeURL",t)}loadImage(t){return this._load("loadImage",t)}},hp="keydown",dp="keypress",bp="keyup",Dl="dragenter",Di="dragleave",Pl="dragover",Zo="pointerdown",gp="pointerup",Fi="pointermove",Pi="pointerout",Ol="pointerover",Qo="mousedown",pp="mouseup",Il="mousemove",zi="mouseout",Ll="mouseover",Yi="click",mp="dblclick",yp="wheel",Ul="mousewheel",Bi="touchstart",Hi="touchmove",Gi="touchend",_p=[hp,dp,bp,Dl,Di,Pl,Zo,gp,Fi,Pi,Ol,Qo,pp,Il,zi,Ll,Yi,mp,yp,Ul,Bi,Hi,Gi],Jo=Fi,vr=zi,Ko=Yi,ji=class extends qi{constructor(t,n){super(t,n),this._down=null,this._touch=null,this._first=!0,this._events={},this.events=_p,this.pointermove=rl([Fi,Il],[Ol,Ll],[Pi,zi]),this.dragover=rl([Pl],[Dl],[Di]),this.pointerout=il([Pi,zi]),this.dragleave=il([Di])}initialize(t,n,r){return this._canvas=t&&Rl(t,"canvas"),[Yi,Qo,Zo,Fi,Pi,Di].forEach(i=>nl(this,i)),super.initialize(t,n,r)}canvas(){return this._canvas}context(){return this._canvas.getContext("2d")}DOMMouseScroll(t){this.fire(Ul,t)}pointerdown(t){this._down=this._active,this.fire(Zo,t)}mousedown(t){this._down=this._active,this.fire(Qo,t)}click(t){this._down===this._active&&(this.fire(Yi,t),this._down=null)}touchstart(t){this._touch=this.pickEvent(t.changedTouches[0]),this._first&&(this._active=this._touch,this._first=!1),this.fire(Bi,t,!0)}touchmove(t){this.fire(Hi,t,!0)}touchend(t){this.fire(Gi,t,!0),this._touch=null}fire(t,n,r){let i=r?this._touch:this._active,a=this._handlers[t];if(n.vegaType=t,t===Ko&&i&&i.href?this.handleHref(n,i,i.href):(t===Jo||t===vr)&&this.handleTooltip(n,i,t!==vr),a)for(let o=0,f=a.length;o<f;++o)a[o].handler.call(this._obj,n,i)}on(t,n){let r=this.eventName(t),i=this._handlers;return this._handlerIndex(i[r],t,n)<0&&(nl(this,t),(i[r]||(i[r]=[])).push({type:t,handler:n})),this}off(t,n){let r=this.eventName(t),i=this._handlers[r],a=this._handlerIndex(i,t,n);return a>=0&&i.splice(a,1),this}pickEvent(t){let n=El(t,this._canvas),r=this._origin;return this.pick(this._scene,n[0],n[1],n[0]-r[0],n[1]-r[1])}pick(t,n,r,i,a){let o=this.context();return xt[t.marktype].pick.call(this,o,t,n,r,i,a)}},vp=e=>e===Bi||e===Hi||e===Gi?[Bi,Hi,Gi]:[e];function nl(e,t){vp(t).forEach(n=>xp(e,n))}function xp(e,t){let n=e.canvas();n&&!e._events[t]&&(e._events[t]=1,n.addEventListener(t,e[t]?r=>e[t](r):r=>e.fire(t,r)))}function yr(e,t,n){t.forEach(r=>e.fire(r,n))}function rl(e,t,n){return function(r){let i=this._active,a=this.pickEvent(r);a===i?yr(this,e,r):((!i||!i.exit)&&yr(this,n,r),this._active=a,yr(this,t,r),yr(this,e,r))}}function il(e){return function(t){yr(this,e,t),this._active=null}}function wp(){return typeof window<"u"&&window.devicePixelRatio||1}function Mp(e,t,n,r,i,a){let o=typeof HTMLElement<"u"&&e instanceof HTMLElement&&e.parentNode!=null,f=e.getContext("2d"),s=o?wp():i;e.width=t*s,e.height=n*s;for(let c in a)f[c]=a[c];return o&&s!==1&&(e.style.width=t+"px",e.style.height=n+"px"),f.pixelRatio=s,f.setTransform(s,0,0,s,s*r[0],s*r[1]),e}var kr=class extends Tn{constructor(t){super(t),this._options={},this._redraw=!1,this._dirty=new qe,this._tempb=new qe}initialize(t,n,r,i,a,o){return this._options=o||{},this._canvas=this._options.externalContext?null:Mi(1,1,this._options.type),t&&this._canvas&&(Ue(t,0).appendChild(this._canvas),this._canvas.setAttribute("class","marks")),super.initialize(t,n,r,i,a)}resize(t,n,r,i){if(super.resize(t,n,r,i),this._canvas)Mp(this._canvas,this._width,this._height,this._origin,this._scale,this._options.context);else{let a=this._options.externalContext;a||B("CanvasRenderer is missing a valid canvas or context"),a.scale(this._scale,this._scale),a.translate(this._origin[0],this._origin[1])}return this._redraw=!0,this}canvas(){return this._canvas}context(){return this._options.externalContext||(this._canvas?this._canvas.getContext("2d"):null)}dirty(t){let n=this._tempb.clear().union(t.bounds),r=t.mark.group;for(;r;)n.translate(r.x||0,r.y||0),r=r.mark.group;this._dirty.union(n)}_render(t,n){let r=this.context(),i=this._origin,a=this._width,o=this._height,f=this._dirty,s=kp(i,a,o);r.save();let c=this._redraw||f.empty()?(this._redraw=!1,s.expand(1)):Tp(r,s.intersect(f),i);return this.clear(-i[0],-i[1],a,o),this.draw(r,t,c,n),r.restore(),f.clear(),this}draw(t,n,r,i){if(n.marktype!=="group"&&i!=null&&!i.includes(n.marktype))return;let a=xt[n.marktype];n.clip&&Mg(t,n),a.draw.call(this,t,n,r,i),n.clip&&t.restore()}clear(t,n,r,i){let a=this._options,o=this.context();a.type!=="pdf"&&!a.externalContext&&o.clearRect(t,n,r,i),this._bgcolor!=null&&(o.fillStyle=this._bgcolor,o.fillRect(t,n,r,i))}},kp=(e,t,n)=>new qe().set(0,0,t,n).translate(-e[0],-e[1]);function Tp(e,t,n){return t.expand(1).round(),e.pixelRatio%1&&t.scale(e.pixelRatio).round().scale(1/e.pixelRatio),t.translate(-(n[0]%1),-(n[1]%1)),e.beginPath(),e.rect(t.x1,t.y1,t.width(),t.height()),e.clip(),t}var ef=class extends qi{constructor(t,n){super(t,n);let r=this;r._hrefHandler=Yo(r,(i,a)=>{a&&a.href&&r.handleHref(i,a,a.href)}),r._tooltipHandler=Yo(r,(i,a)=>{r.handleTooltip(i,a,i.type!==vr)})}initialize(t,n,r){let i=this._svg;return i&&(i.removeEventListener(Ko,this._hrefHandler),i.removeEventListener(Jo,this._tooltipHandler),i.removeEventListener(vr,this._tooltipHandler)),this._svg=i=t&&Rl(t,"svg"),i&&(i.addEventListener(Ko,this._hrefHandler),i.addEventListener(Jo,this._tooltipHandler),i.addEventListener(vr,this._tooltipHandler)),super.initialize(t,n,r)}canvas(){return this._svg}on(t,n){let r=this.eventName(t),i=this._handlers;if(this._handlerIndex(i[r],t,n)<0){let o={type:t,handler:n,listener:Yo(this,n)};(i[r]||(i[r]=[])).push(o),this._svg&&this._svg.addEventListener(r,o.listener)}return this}off(t,n){let r=this.eventName(t),i=this._handlers[r],a=this._handlerIndex(i,t,n);return a>=0&&(this._svg&&this._svg.removeEventListener(r,i[a].listener),i.splice(a,1)),this}},Yo=(e,t)=>n=>{let r=n.target.__data__;r=Array.isArray(r)?r[0]:r,n.vegaType=n.type,t.call(e._obj,n,r)},ql="aria-hidden",vf="aria-label",xf="role",wf="aria-roledescription",Fl="graphics-object",Mf="graphics-symbol",zl=(e,t,n)=>({[xf]:e,[wf]:t,[vf]:n||void 0}),Sp=en(["axis-domain","axis-grid","axis-label","axis-tick","axis-title","legend-band","legend-entry","legend-gradient","legend-label","legend-title","legend-symbol","title"]),al={axis:{desc:"axis",caption:Np},legend:{desc:"legend",caption:Rp},"title-text":{desc:"title",caption:e=>`Title text \'${fl(e)}\'`},"title-subtitle":{desc:"subtitle",caption:e=>`Subtitle text \'${fl(e)}\'`}},ol={ariaRole:xf,ariaRoleDescription:wf,description:vf};function Yl(e,t){let n=t.aria===!1;if(e(ql,n||void 0),n||t.description==null)for(let r in ol)e(ol[r],void 0);else{let r=t.mark.marktype;e(vf,t.description),e(xf,t.ariaRole||(r==="group"?Fl:Mf)),e(wf,t.ariaRoleDescription||`${r} mark`)}}function Bl(e){return e.aria===!1?{[ql]:!0}:Sp[e.role]?null:al[e.role]?Ap(e,al[e.role]):Cp(e)}function Cp(e){let t=e.marktype,n=t==="group"||t==="text"||e.items.some(r=>r.description!=null&&r.aria!==!1);return zl(n?Fl:Mf,`${t} mark container`,e.description)}function Ap(e,t){try{let n=e.items[0],r=t.caption||(()=>"");return zl(t.role||Mf,t.desc,n.description||r(n))}catch{return null}}function fl(e){return kt(e.text).join(" ")}function Np(e){let t=e.datum,n=e.orient,r=t.title?Hl(e):null,i=e.context,a=i.scales[t.scale].value,o=i.dataflow.locale(),f=a.type;return`${n==="left"||n==="right"?"Y":"X"}-axis`+(r?` titled \'${r}\'`:"")+` for a ${po(f)?"discrete":f} scale with ${mo(o,a,e)}`}function Rp(e){let t=e.datum,n=t.title?Hl(e):null,r=`${t.type||""} legend`.trim(),i=t.scales,a=Object.keys(i),o=e.context,f=o.scales[i[a[0]]].value,s=o.dataflow.locale();return Ep(r)+(n?` titled \'${n}\'`:"")+` for ${$p(a)} with ${mo(s,f,e)}`}function Hl(e){try{return kt(Ee(e.items).items[0].text).join(" ")}catch{return null}}function $p(e){return e=e.map(t=>t+(t==="fill"||t==="stroke"?" color":"")),e.length<2?e[0]:e.slice(0,-1).join(", ")+" and "+Ee(e)}function Ep(e){return e.length?e[0].toUpperCase()+e.slice(1):e}var Gl=e=>(e+"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"),Dp=e=>Gl(e).replace(/"/g,"&quot;").replace(/\\t/g,"&#x9;").replace(/\\n/g,"&#xA;").replace(/\\r/g,"&#xD;");function jl(){let e="",t="",n="",r=[],i=()=>t=n="",a=s=>{t&&(e+=`${t}>${n}`,i()),r.push(s)},o=(s,c)=>(c!=null&&(t+=` ${s}="${Dp(c)}"`),f),f={open(s){a(s),t="<"+s;for(var c=arguments.length,l=new Array(c>1?c-1:0),u=1;u<c;u++)l[u-1]=arguments[u];for(let h of l)for(let d in h)o(d,h[d]);return f},close(){let s=r.pop();return t?e+=t+(n?`>${n}</${s}>`:"/>"):e+=`</${s}>`,i(),f},attr:o,text:s=>(n+=Gl(s),f),toString:()=>e};return f}var Pp=e=>Wl(jl(),e)+"";function Wl(e,t){if(e.open(t.tagName),t.hasAttributes()){let n=t.attributes,r=n.length;for(let i=0;i<r;++i)e.attr(n[i].name,n[i].value)}if(t.hasChildNodes()){let n=t.childNodes;for(let r of n)r.nodeType===3?e.text(r.nodeValue):Wl(e,r)}return e.close()}var Wi={fill:"fill",fillOpacity:"fill-opacity",stroke:"stroke",strokeOpacity:"stroke-opacity",strokeWidth:"stroke-width",strokeCap:"stroke-linecap",strokeJoin:"stroke-linejoin",strokeDash:"stroke-dasharray",strokeDashOffset:"stroke-dashoffset",strokeMiterLimit:"stroke-miterlimit",opacity:"opacity"},Xi={blend:"mix-blend-mode"},Xl={fill:"none","stroke-miterlimit":10},pr=0,sl="http://www.w3.org/2000/xmlns/",j=Mr.xmlns,Vi=class extends Tn{constructor(t){super(t),this._dirtyID=0,this._dirty=[],this._svg=null,this._root=null,this._defs=null}initialize(t,n,r,i,a){return this._defs={},this._clearDefs(),t&&(this._svg=J(t,0,"svg",j),this._svg.setAttributeNS(sl,"xmlns",j),this._svg.setAttributeNS(sl,"xmlns:xlink",Mr["xmlns:xlink"]),this._svg.setAttribute("version",Mr.version),this._svg.setAttribute("class","marks"),Ue(t,1),this._root=J(this._svg,pr,"g",j),mt(this._root,Xl),Ue(this._svg,pr+1)),this.background(this._bgcolor),super.initialize(t,n,r,i,a)}background(t){return arguments.length&&this._svg&&this._svg.style.setProperty("background-color",t),super.background(...arguments)}resize(t,n,r,i){return super.resize(t,n,r,i),this._svg&&(mt(this._svg,{width:this._width*this._scale,height:this._height*this._scale,viewBox:`0 0 ${this._width} ${this._height}`}),this._root.setAttribute("transform",`translate(${this._origin})`)),this._dirty=[],this}canvas(){return this._svg}svg(){let t=this._svg,n=this._bgcolor;if(!t)return null;let r;n&&(t.removeAttribute("style"),r=J(t,pr,"rect",j),mt(r,{width:this._width,height:this._height,fill:n}));let i=Pp(t);return n&&(t.removeChild(r),this._svg.style.setProperty("background-color",n)),i}_render(t,n){return this._dirtyCheck()&&(this._dirtyAll&&this._clearDefs(),this.mark(this._root,t,void 0,n),Ue(this._root,1)),this.defs(),this._dirty=[],++this._dirtyID,this}dirty(t){t.dirty!==this._dirtyID&&(t.dirty=this._dirtyID,this._dirty.push(t))}isDirty(t){return this._dirtyAll||!t._svg||!t._svg.ownerSVGElement||t.dirty===this._dirtyID}_dirtyCheck(){this._dirtyAll=!0;let t=this._dirty;if(!t.length||!this._dirtyID)return!0;let n=++this._dirtyID,r,i,a,o,f,s,c;for(f=0,s=t.length;f<s;++f)if(r=t[f],i=r.mark,i.marktype!==a&&(a=i.marktype,o=xt[a]),i.zdirty&&i.dirty!==n&&(this._dirtyAll=!1,cl(r,n),i.items.forEach(l=>{l.dirty=n})),!i.zdirty){if(r.exit){o.nested&&i.items.length?(c=i.items[0],c._svg&&this._update(o,c._svg,c)):r._svg&&(c=r._svg.parentNode,c&&c.removeChild(r._svg)),r._svg=null;continue}r=o.nested?i.items[0]:r,r._update!==n&&(!r._svg||!r._svg.ownerSVGElement?(this._dirtyAll=!1,cl(r,n)):this._update(o,r._svg,r),r._update=n)}return!this._dirtyAll}mark(t,n,r,i){if(!this.isDirty(n))return n._svg;let a=this._svg,o=n.marktype,f=xt[o],s=n.interactive===!1?"none":null,c=f.tag==="g",l=ul(n,t,r,"g",a);if(o!=="group"&&i!=null&&!i.includes(o))return Ue(l,0),n._svg;l.setAttribute("class",$l(n));let u=Bl(n);for(let b in u)oe(l,b,u[b]);c||oe(l,"pointer-events",s),oe(l,"clip-path",n.clip?of(this,n,n.group):null);let h=null,d=0,g=b=>{let p=this.isDirty(b),m=ul(b,l,h,f.tag,a);p&&(this._update(f,m,b),c&&Lp(this,m,b,i)),h=m,++d};return f.nested?n.items.length&&g(n.items[0]):Ge(n,g),Ue(l,d),l}_update(t,n,r){nt=n,ae=n.__values__,Yl(xr,r),t.attr(xr,r,this);let i=qp[t.type];i&&i.call(this,t,n,r),nt&&this.style(nt,r)}style(t,n){if(n!=null){for(let r in Wi){let i=r==="font"?ra(n):n[r];if(i===ae[r])continue;let a=Wi[r];i==null?t.removeAttribute(a):(rf(i)&&(i=ll(i,this._defs.gradient,Vl())),t.setAttribute(a,i+"")),ae[r]=i}for(let r in Xi)Oi(t,Xi[r],n[r])}}defs(){let t=this._svg,n=this._defs,r=n.el,i=0;for(let a in n.gradient)r||(n.el=r=J(t,pr+1,"defs",j)),i=Op(r,n.gradient[a],i);for(let a in n.clipping)r||(n.el=r=J(t,pr+1,"defs",j)),i=Ip(r,n.clipping[a],i);r&&(i===0?(t.removeChild(r),n.el=null):Ue(r,i))}_clearDefs(){let t=this._defs;t.gradient={},t.clipping={}}};function cl(e,t){for(;e&&e.dirty!==t;e=e.mark.group)if(e.dirty=t,e.mark&&e.mark.dirty!==t)e.mark.dirty=t;else return}function Op(e,t,n){let r,i,a;if(t.gradient==="radial"){let o=J(e,n++,"pattern",j);mt(o,{id:Ii+t.id,viewBox:"0,0,1,1",width:"100%",height:"100%",preserveAspectRatio:"xMidYMid slice"}),o=J(o,0,"rect",j),mt(o,{width:1,height:1,fill:`url(${Vl()}#${t.id})`}),e=J(e,n++,"radialGradient",j),mt(e,{id:t.id,fx:t.x1,fy:t.y1,fr:t.r1,cx:t.x2,cy:t.y2,r:t.r2})}else e=J(e,n++,"linearGradient",j),mt(e,{id:t.id,x1:t.x1,x2:t.x2,y1:t.y1,y2:t.y2});for(r=0,i=t.stops.length;r<i;++r)a=J(e,r,"stop",j),a.setAttribute("offset",t.stops[r].offset),a.setAttribute("stop-color",t.stops[r].color);return Ue(e,r),n}function Ip(e,t,n){let r;return e=J(e,n,"clipPath",j),e.setAttribute("id",t.id),t.path?(r=J(e,0,"path",j),r.setAttribute("d",t.path)):(r=J(e,0,"rect",j),mt(r,{x:0,y:0,width:t.width,height:t.height})),Ue(e,1),n+1}function Lp(e,t,n,r){t=t.lastChild.previousSibling;let i,a=0;Ge(n,o=>{i=e.mark(t,o,i,r),++a}),Ue(t,1+a)}function ul(e,t,n,r,i){let a=e._svg,o;if(!a&&(o=t.ownerDocument,a=jt(o,r,j),e._svg=a,e.mark&&(a.__data__=e,a.__values__={fill:"default"},r==="g"))){let f=jt(o,"path",j);a.appendChild(f),f.__data__=e;let s=jt(o,"g",j);a.appendChild(s),s.__data__=e;let c=jt(o,"path",j);a.appendChild(c),c.__data__=e,c.__values__={fill:"default"}}return(a.ownerSVGElement!==i||Up(a,n))&&t.insertBefore(a,n?n.nextSibling:t.firstChild),a}function Up(e,t){return e.parentNode&&e.parentNode.childNodes.length>1&&e.previousSibling!=t}var nt=null,ae=null,qp={group(e,t,n){let r=nt=t.childNodes[2];ae=r.__values__,e.foreground(xr,n,this),ae=t.__values__,nt=t.childNodes[1],e.content(xr,n,this);let i=nt=t.childNodes[0];e.background(xr,n,this);let a=n.mark.interactive===!1?"none":null;if(a!==ae.events&&(oe(r,"pointer-events",a),oe(i,"pointer-events",a),ae.events=a),n.strokeForeground&&n.stroke){let o=n.fill;oe(r,"display",null),this.style(i,n),oe(i,"stroke",null),o&&(n.fill=null),ae=r.__values__,this.style(r,n),o&&(n.fill=o),nt=null}else oe(r,"display","none")},image(e,t,n){n.smooth===!1?(Oi(t,"image-rendering","optimizeSpeed"),Oi(t,"image-rendering","pixelated")):Oi(t,"image-rendering",null)},text(e,t,n){let r=na(n),i,a,o,f;se(r)?(a=r.map(s=>vt(n,s)),i=a.join(`\n`),i!==ae.text&&(Ue(t,0),o=t.ownerDocument,f=kn(n),a.forEach((s,c)=>{let l=jt(o,"tspan",j);l.__data__=n,l.textContent=s,c&&(l.setAttribute("x",0),l.setAttribute("dy",f)),t.appendChild(l)}),ae.text=i)):(a=vt(n,r),a!==ae.text&&(t.textContent=a,ae.text=a)),oe(t,"font-family",ra(n)),oe(t,"font-size",rt(n)+"px"),oe(t,"font-style",n.fontStyle),oe(t,"font-variant",n.fontVariant),oe(t,"font-weight",n.fontWeight)}};function xr(e,t,n){t!==ae[e]&&(n?Fp(nt,e,t,n):oe(nt,e,t),ae[e]=t)}function Oi(e,t,n){n!==ae[t]&&(n==null?e.style.removeProperty(t):e.style.setProperty(t,n+""),ae[t]=n)}function mt(e,t){for(let n in t)oe(e,n,t[n])}function oe(e,t,n){n!=null?e.setAttribute(t,n):e.removeAttribute(t)}function Fp(e,t,n,r){n!=null?e.setAttributeNS(r,t,n):e.removeAttributeNS(r,t)}function Vl(){let e;return typeof window>"u"?"":(e=window.location).hash?e.href.slice(0,-e.hash.length):e.href}var tf=class extends Tn{constructor(t){super(t),this._text=null,this._defs={gradient:{},clipping:{}}}svg(){return this._text}_render(t){let n=jl();n.open("svg",je({},Mr,{class:"marks",width:this._width*this._scale,height:this._height*this._scale,viewBox:`0 0 ${this._width} ${this._height}`}));let r=this._bgcolor;return r&&r!=="transparent"&&r!=="none"&&n.open("rect",{width:this._width,height:this._height,fill:r}).close(),n.open("g",Xl,{transform:"translate("+this._origin+")"}),this.mark(n,t),n.close(),this.defs(n),this._text=n.close()+"",this}mark(t,n){let r=xt[n.marktype],i=r.tag,a=[Yl,r.attr];t.open("g",{class:$l(n),"clip-path":n.clip?of(this,n,n.group):null},Bl(n),{"pointer-events":i!=="g"&&n.interactive===!1?"none":null});let o=f=>{let s=this.href(f);if(s&&t.open("a",s),t.open(i,this.attr(n,f,a,i!=="g"?i:null)),i==="text"){let c=na(f);if(se(c)){let l={x:0,dy:kn(f)};for(let u=0;u<c.length;++u)t.open("tspan",u?l:null).text(vt(f,c[u])).close()}else t.text(vt(f,c))}else if(i==="g"){let c=f.strokeForeground,l=f.fill,u=f.stroke;c&&u&&(f.stroke=null),t.open("path",this.attr(n,f,r.background,"bgrect")).close(),t.open("g",this.attr(n,f,r.content)),Ge(f,h=>this.mark(t,h)),t.close(),c&&u?(l&&(f.fill=null),f.stroke=u,t.open("path",this.attr(n,f,r.foreground,"bgrect")).close(),l&&(f.fill=l)):t.open("path",this.attr(n,f,r.foreground,"bgfore")).close()}t.close(),s&&t.close()};return r.nested?n.items&&n.items.length&&o(n.items[0]):Ge(n,o),t.close()}href(t){let n=t.href,r;if(n){if(r=this._hrefs&&this._hrefs[n])return r;this.sanitizeURL(n).then(i=>{i["xlink:href"]=i.href,i.href=null,(this._hrefs||(this._hrefs={}))[n]=i})}return null}attr(t,n,r,i){let a={},o=(f,s,c,l)=>{a[l||f]=s};return Array.isArray(r)?r.forEach(f=>f(o,n,this)):r(o,n,this),i&&zp(a,n,t,i,this._defs),a}defs(t){let n=this._defs.gradient,r=this._defs.clipping;if(Object.keys(n).length+Object.keys(r).length!==0){t.open("defs");for(let a in n){let o=n[a],f=o.stops;o.gradient==="radial"?(t.open("pattern",{id:Ii+a,viewBox:"0,0,1,1",width:"100%",height:"100%",preserveAspectRatio:"xMidYMid slice"}),t.open("rect",{width:"1",height:"1",fill:"url(#"+a+")"}).close(),t.close(),t.open("radialGradient",{id:a,fx:o.x1,fy:o.y1,fr:o.r1,cx:o.x2,cy:o.y2,r:o.r2})):t.open("linearGradient",{id:a,x1:o.x1,x2:o.x2,y1:o.y1,y2:o.y2});for(let s=0;s<f.length;++s)t.open("stop",{offset:f[s].offset,"stop-color":f[s].color}).close();t.close()}for(let a in r){let o=r[a];t.open("clipPath",{id:a}),o.path?t.open("path",{d:o.path}).close():t.open("rect",{x:0,y:0,width:o.width,height:o.height}).close(),t.close()}t.close()}}};function zp(e,t,n,r,i){let a;if(t==null||(r==="bgrect"&&n.interactive===!1&&(e["pointer-events"]="none"),r==="bgfore"&&(n.interactive===!1&&(e["pointer-events"]="none"),e.display="none",t.fill!==null)))return e;r==="image"&&t.smooth===!1&&(a=["image-rendering: optimizeSpeed;","image-rendering: pixelated;"]),r==="text"&&(e["font-family"]=ra(t),e["font-size"]=rt(t)+"px",e["font-style"]=t.fontStyle,e["font-variant"]=t.fontVariant,e["font-weight"]=t.fontWeight);for(let o in Wi){let f=t[o],s=Wi[o];f==="transparent"&&(s==="fill"||s==="stroke")||f!=null&&(rf(f)&&(f=ll(f,i.gradient,"")),e[s]=f)}for(let o in Xi){let f=t[o];f!=null&&(a=a||[],a.push(`${Xi[o]}: ${f};`))}return a&&(e.style=a.join(" ")),e}var gt={svgMarkTypes:["text"],svgOnTop:!0,debug:!1};var Zi=class extends Tn{constructor(t){super(t),this._svgRenderer=new Vi(t),this._canvasRenderer=new kr(t)}initialize(t,n,r,i,a){this._root_el=J(t,0,"div");let o=J(this._root_el,0,"div"),f=J(this._root_el,1,"div");return this._root_el.style.position="relative",gt.debug||(o.style.height="100%",f.style.position="absolute",f.style.top="0",f.style.left="0",f.style.height="100%",f.style.width="100%"),this._svgEl=gt.svgOnTop?f:o,this._canvasEl=gt.svgOnTop?o:f,this._svgEl.style.pointerEvents="none",this._canvasRenderer.initialize(this._canvasEl,n,r,i,a),this._svgRenderer.initialize(this._svgEl,n,r,i,a),super.initialize(t,n,r,i,a)}dirty(t){return gt.svgMarkTypes.includes(t.mark.marktype)?this._svgRenderer.dirty(t):this._canvasRenderer.dirty(t),this}_render(t,n){let i=(n??["arc","area","image","line","path","rect","rule","shape","symbol","text","trail"]).filter(a=>!gt.svgMarkTypes.includes(a));this._svgRenderer.render(t,gt.svgMarkTypes),this._canvasRenderer.render(t,i)}resize(t,n,r,i){return super.resize(t,n,r,i),this._svgRenderer.resize(t,n,r,i),this._canvasRenderer.resize(t,n,r,i),this}background(t){return gt.svgOnTop?this._canvasRenderer.background(t):this._svgRenderer.background(t),this}},nf=class extends ji{constructor(t,n){super(t,n)}initialize(t,n,r){let i=J(J(t,0,"div"),gt.svgOnTop?0:1,"div");return super.initialize(i,n,r)}},Yp="canvas",Bp="hybrid",Hp="png",Gp="svg",jp="none";var Tr={};Tr[Yp]=Tr[Hp]={renderer:kr,headless:kr,handler:ji};Tr[Gp]={renderer:Vi,headless:tf,handler:ef};Tr[Bp]={renderer:Zi,headless:Zi,handler:nf};Tr[jp]={};var V3=new qe;var Wp=Math.sqrt(2*Math.PI);function Zl(e,t,n){n=n??1;let r=(e-(t||0))/n;return Math.exp(-.5*r*r)/(n*Wp)}function Ql(e,t,n){t=t||0,n=n??1;let r=(e-t)/n,i=Math.abs(r),a;if(i>37)a=0;else{let o=Math.exp(-i*i/2),f;i<7.07106781186547?(f=.0352624965998911*i+.700383064443688,f=f*i+6.37396220353165,f=f*i+33.912866078383,f=f*i+112.079291497871,f=f*i+221.213596169931,f=f*i+220.206867912376,a=o*f,f=.0883883476483184*i+1.75566716318264,f=f*i+16.064177579207,f=f*i+86.7807322029461,f=f*i+296.564248779674,f=f*i+637.333633378831,f=f*i+793.826512519948,f=f*i+440.413735824752,a=a/f):(f=i+.65,f=i+4/f,f=i+3/f,f=i+2/f,f=i+1/f,a=o/f/2.506628274631)}return r>0?1-a:a}var Q3=.5*Math.PI/180;function Jl(e,t){let n=e(t.type);if(!n)throw new Error("scale type "+t.type);let r=n();for(let[i,a]of t.props)typeof r[i]=="function"&&r[i](a);return r.domain(t.domain),r.range(t.range),r}var Kl={timeunit(e,t,n){let r=Ac(e),i=(n?$c:Rc)(r,t),a=(n?ar:ir)(r[r.length-1]).offset;return{floor:i,offset:a}}};var Xp={...Kl,scale:e=>Jl(O,e),symbol:xt.symbol,Bounds:qe,densityNormal:Zl,cumulativeNormal:Ql};return i0(Vp);})();\n';

// src/runtime/derived.ts
function installWorkerLibrary(pool, vegaVersion = "") {
  const lib2 = String(vegaVersion).startsWith("5.") ? WORKER_LIBRARY_V5 : WORKER_LIBRARY;
  const src = `${lib2}
globalThis.__pwvt = __pwlib.lib;
return 0;`;
  for (let t = 0; t < pool.size; t++) {
    pool.run(t, { op: "kernel", key: "pv:lib", src, cols: [], bufs: [], args: {}, start: 0, end: 0 }, import_resident.Priority.High).catch((err) => {
      if (!/terminated/.test(String(err && err.message))) console.warn("paraweb-vega: worker library failed to load:", err);
    });
  }
}
var MAX_DICT = 1 << 16;
var MAX_CACHED = 16;
var caches = /* @__PURE__ */ new WeakMap();
function cached(rel, pool, sig, make, keys) {
  let m = caches.get(rel.base);
  if (!m) {
    m = /* @__PURE__ */ new Map();
    caches.set(rel.base, m);
  }
  let p = m.get(sig);
  if (p) {
    m.delete(sig);
    m.set(sig, p);
    return p;
  }
  p = make();
  m.set(sig, p);
  if (m.size > MAX_CACHED) {
    const [oldSig, old] = m.entries().next().value;
    m.delete(oldSig);
    old.then((c) => pool.dropColumns(keys(c)), () => {
    });
  }
  p.catch(() => m.delete(sig));
  return p;
}
function fieldSig(rel, name) {
  const d = rel.derived.get(name);
  if (!d) return name;
  const deps = d.kind === "expr" ? d.info.fields : d.kind === "col" ? [] : [d.field];
  if (d.kind === "map") return derivedSig(d);
  return derivedSig(d) + "{" + deps.map((f) => fieldSig({ ...rel, derived: d.env }, f)).join(",") + "}";
}
var derivedCounter = 0;
function derivedNumeric(rel, name, pool) {
  const sig = "num:" + fieldSig(rel, name);
  return cached(rel, pool, sig, async () => {
    const n = rel.base.tuples.length;
    const view = new Float64Array(new SharedArrayBuffer(8 * Math.max(1, n)));
    const rc = new RowCode(rel, pool);
    const v = rc.field(name);
    const src = `${rc.prelude()}
const out = bufs[0];
let poison = 0;
for (let i = start; i < end; i++) { const r = ${v}; const x = r == null || r === '' ? NaN : +r; out[i] = x; if (x !== x && r != null && r === r && typeof r !== "number") poison = 1; }
return poison;`;
    const flags = n ? (await (0, import_resident14.map)({ key: kernelKey("pv:dnum:", src), src }, {
      pool,
      n,
      cols: rc.cols,
      bufs: [{ buffer: view.buffer, type: "f64" }],
      args: { P: rc.P }
    })).flat() : [];
    const key2 = `${rel.base.table.id}:dnum${++derivedCounter}`;
    pool.ensureColumn(key2, "f64", view.buffer);
    return { key: key2, view, poison: flags.some((f) => f) };
  }, (c) => [c.key]);
}
function derivedDictionary(rel, name, pool) {
  const sig = "dict:" + fieldSig(rel, name);
  return cached(rel, pool, sig, async () => {
    const n = rel.base.tuples.length;
    const view = new Int32Array(new SharedArrayBuffer(4 * Math.max(1, n)));
    const rc = new RowCode(rel, pool);
    const v = rc.field(name);
    const src = `${rc.prelude()}
const codes = bufs[0], D = new Map(), vals = [], L = ${MAX_DICT};
for (let i = start; i < end; i++) {
  const r = ${v};
  const k = r instanceof Date ? "\\u0001D" + (+r) : r;
  let c = D.get(k);
  if (c === undefined) {
    if (r !== null && typeof r === "object" && !(r instanceof Date)) return null;
    c = vals.length; if (c >= L) return null;
    D.set(k, c); vals.push(r);
  }
  codes[i] = c;
}
return vals;`;
    const parts = n ? (await (0, import_resident14.map)({ key: kernelKey("pv:ddict:", src), src }, {
      pool,
      n,
      cols: rc.cols,
      bufs: [{ buffer: view.buffer, type: "i32" }],
      args: { P: rc.P }
    })).map((c) => c[0]) : [];
    if (parts.some((p) => p === null)) throw new Unsupported("derived group-by field " + name + " (values)");
    const codes = /* @__PURE__ */ new Map();
    const values = [];
    const keyOf = (r) => r instanceof Date ? "D" + +r : r;
    const remaps = parts.map((vals) => Int32Array.from(vals, (r) => {
      const k = keyOf(r);
      let c = codes.get(k);
      if (c === void 0) {
        c = values.length;
        codes.set(k, c);
        values.push(r);
      }
      return c;
    }));
    if (values.length > MAX_DICT) throw new Unsupported("derived group-by field " + name + " (cardinality)");
    if (parts.length > 1 || remaps.some((r) => r.some((g, l) => g !== l))) {
      const remap = `const codes = bufs[0], m = args.remaps[args.t];
for (let i = start; i < end; i++) codes[i] = m[codes[i]];`;
      await (0, import_resident14.map)({ key: "pv:remap", src: remap }, {
        pool,
        n,
        bufs: [{ buffer: view.buffer, type: "i32" }],
        args: { remaps }
      });
    }
    const key2 = `${rel.base.table.id}:ddict${++derivedCounter}`;
    pool.ensureColumn(key2, "i32", view.buffer);
    return { key: key2, view, values, codes, card: Math.max(1, values.length) };
  }, (c) => [c.key]);
}

// src/runtime/density.ts
var import_resident15 = __toESM(require_resident());
var MAX_KEYS2 = 1 << 20;
var MIN_RADIANS2 = 0.5 * Math.PI / 180;
function scaleY(init, points) {
  let ymin = init, ymax = init;
  for (const p of points) {
    const y = p[1];
    if (y < ymin) ymin = y;
    if (y > ymax) ymax = y;
  }
  return 1 / (ymax - ymin);
}
function angleDelta(p, q, r, sx, sy) {
  const a0 = Math.atan2(sy * (r[1] - p[1]), sx * (r[0] - p[0])), a1 = Math.atan2(sy * (q[1] - p[1]), sx * (q[0] - p[0]));
  return Math.abs(a0 - a1);
}
function needed(get, extent2, minSteps, maxSteps) {
  const need = /* @__PURE__ */ new Set();
  minSteps = minSteps || 25;
  maxSteps = Math.max(minSteps, maxSteps || 200);
  const point = (x) => {
    const y = get(x);
    if (y === void 0) need.add(x);
    return [x, y];
  };
  const minX = extent2[0], maxX = extent2[1], span = maxX - minX, stop = span / maxSteps;
  const prev = [point(minX)], next = [];
  if (minSteps === maxSteps) {
    for (let i = 1; i < maxSteps; ++i) point(minX + i / minSteps * span);
    point(maxX);
    return [...need];
  }
  next.push(point(maxX));
  for (let i = minSteps; --i > 0; ) next.push(point(minX + i / minSteps * span));
  if (need.size) return [...need];
  let p0 = prev[0];
  let p1 = next[next.length - 1];
  const sx = 1 / span, sy = scaleY(p0[1], next);
  while (p1) {
    const pm = point((p0[0] + p1[0]) / 2);
    if (pm[1] === void 0) {
      p0 = p1;
      next.pop();
      p1 = next[next.length - 1];
      continue;
    }
    const dx = pm[0] - p0[0] >= stop;
    if (dx && angleDelta(p0, pm, p1, sx, sy) > MIN_RADIANS2) next.push(pm);
    else {
      p0 = p1;
      next.pop();
    }
    p1 = next[next.length - 1];
  }
  return [...need];
}
async function computeDensity(vega, rel, pool, p) {
  const table = rel.base.table;
  let value;
  let tag = null;
  if (rel.derived.has(p.field)) {
    const c = await derivedNumeric(rel, p.field, pool);
    if (c.poison) throw new Unsupported("density field with values that are not numbers");
    value = c;
  } else {
    const col = table.exprColumn(p.field);
    if (!col || col.kind !== "num" || col.hasNaN) throw new Unsupported("density field " + p.field);
    value = { key: col.key, view: col.view };
    if (col.tag) {
      if (col.tag.some((g) => g === 2)) throw new Unsupported("density field with undefined values");
      tag = { key: col.tagKey, view: col.tag };
      pool.ensureColumn(tag.key, "u8", tag.view.buffer);
    }
  }
  pool.ensureColumn(value.key, "f64", value.view.buffer);
  const dicts = await Promise.all(p.groupby.map((g) => derivedDictionary(rel, g, pool)));
  const cards = dicts.map((d) => d.card);
  if (cards.reduce((a, b) => a * b, 1) > MAX_KEYS2) throw new Unsupported("density groups");
  dicts.forEach((d) => pool.ensureColumn(d.key, "i32", d.view.buffer));
  const rows = await selectRows(rel, pool);
  const m = rows.length;
  if (!m) throw new Unsupported("density of no rows");
  const sb2 = (a, type) => ({ buffer: a.buffer, type });
  const cols = [value.key, ...dicts.map((d) => d.key), ...tag ? [tag.key] : []];
  const isNull = tag ? `cols[${cols.length - 1}][i] !== 0` : "false";
  let keyExpr = "0", mul = 1;
  const terms = [];
  dicts.forEach((_d, j) => {
    terms.push(mul === 1 ? `cols[${j + 1}][i]` : `cols[${j + 1}][i] * ${mul}`);
    mul *= cards[j];
  });
  if (terms.length) keyExpr = terms.join(" + ");
  const statSrc = `const R = bufs[0], V = cols[0], G = new Map();
for (let j = start; j < end; j++) {
  const i = R[j], v = V[i], nul = ${isNull};
  if (!nul && v !== v) return null;
  const k = ${keyExpr};
  let e = G.get(k);
  if (!e) { e = [j, 0, Infinity, -Infinity, 0, 0]; G.set(k, e); }
  e[1]++;
  if (!nul) { if (v < e[2]) e[2] = v; if (v > e[3]) e[3] = v; e[4] += v; e[5]++; }
}
return [...G];`;
  const parts = (await (0, import_resident15.map)({ key: kernelKey("pv:kde:stat:", statSrc), src: statSrc }, { pool, n: m, cols, bufs: [sb2(rows, "i32")] })).flat();
  if (parts.some((x) => x === null)) throw new Unsupported("density field with missing values");
  const byKey = /* @__PURE__ */ new Map();
  for (const part of parts) for (const [k, e] of part) {
    const g = byKey.get(k);
    if (!g) byKey.set(k, { key: k, first: e[0], count: e[1], min: e[2], max: e[3], sum: e[4], valid: e[5], dims: [] });
    else {
      g.first = Math.min(g.first, e[0]);
      g.count += e[1];
      if (e[2] < g.min) g.min = e[2];
      if (e[3] > g.max) g.max = e[3];
      g.sum += e[4];
      g.valid += e[5];
    }
  }
  const groups = [...byKey.values()].sort((a, b) => a.first - b.first);
  if (groups.some((g) => !g.valid)) throw new Unsupported("density group without values");
  const strings = /* @__PURE__ */ new Set();
  for (const g of groups) {
    let k = g.key;
    g.dims = dicts.map((d, j) => {
      const c = k % cards[j];
      k = Math.floor(k / cards[j]);
      return d.values[c];
    });
    const s = g.dims.map((v) => v == null ? "" : String(v)).join(",");
    if (strings.has(s)) throw new Unsupported("density groups with equal names");
    strings.add(s);
  }
  const gidx = new Int32Array(Math.max(1, mul)).fill(-1);
  groups.forEach((g, j) => {
    gidx[g.key] = j;
  });
  const G = groups.length;
  let bw;
  if (p.bandwidth) bw = groups.map(() => p.bandwidth);
  else {
    const means = groups.map((g) => g.sum / g.valid);
    const devSrc = `const R = bufs[0], V = cols[0], gidx = args.gidx, mean = args.mean, acc = new Float64Array(args.G);
for (let j = start; j < end; j++) { const i = R[j]; if (${isNull}) continue; const v = V[i], g = gidx[${keyExpr}], d = v - mean[g]; acc[g] += d * d; }
return acc;`;
    const dev = (await (0, import_resident15.map)({ key: kernelKey("pv:kde:dev:", devSrc), src: devSrc }, {
      pool,
      n: m,
      cols,
      bufs: [sb2(rows, "i32")],
      args: { gidx, mean: means, G }
    })).flat();
    const m2 = new Float64Array(G);
    for (const a of dev) for (let g = 0; g < G; g++) m2[g] += a[g];
    const gcol = new Float64Array(new SharedArrayBuffer(8 * Math.max(1, table.length)));
    const gSrc = `const R = bufs[0], out = bufs[1], gidx = args.gidx;
for (let j = start; j < end; j++) { const i = R[j]; out[i] = gidx[${keyExpr}]; }`;
    await (0, import_resident15.map)({ key: kernelKey("pv:kde:g:", gSrc), src: gSrc }, { pool, n: m, cols, bufs: [sb2(rows, "i32"), sb2(gcol, "f64")], args: { gidx } });
    const gkey = `${table.id}:kdeg:${Math.random().toString(36).slice(2)}`;
    pool.ensureColumn(gkey, "f64", gcol.buffer);
    let valid = rows;
    if (tag) {
      const t = tag.view, out2 = new Int32Array(new SharedArrayBuffer(4 * Math.max(1, m)));
      let w = 0;
      for (let j = 0; j < m; j++) if (t[rows[j]] === 0) out2[w++] = rows[j];
      valid = out2.subarray(0, w);
    }
    const sorted = await sortRows(pool, valid, G > 1 ? [{ key: gkey, view: gcol, order: 1 }, { key: value.key, view: value.view, order: 1 }] : [{ key: value.key, view: value.view, order: 1 }]);
    pool.dropColumns([gkey]);
    let off = 0;
    bw = groups.map((g, j) => {
      const n = g.valid;
      const variance = n > 1 ? m2[j] / (n - 1) : void 0;
      const d = variance ? Math.sqrt(variance) : variance;
      const at = (q) => value.view[sorted[off + q]];
      const quant = (pr) => {
        if (n < 2) return at(0);
        const h2 = (n - 1) * pr, i0 = Math.floor(h2), v0 = at(i0), v1 = at(i0 + 1);
        return v0 + (v1 - v0) * (h2 - i0);
      };
      const q0 = quant(0.25), q2 = quant(0.75);
      off += n;
      const h = (q2 - q0) / 1.34;
      const v = Math.min(d, h) || d || Math.abs(q0) || 1;
      return 1.06 * v * Math.pow(g.count, -0.2);
    });
  }
  let minsteps = p.minsteps, maxsteps = p.maxsteps;
  let domain = p.extent;
  if (p.shared) {
    if (!domain) domain = [Math.min(...groups.map((g) => g.min)), Math.max(...groups.map((g) => g.max))];
    minsteps = maxsteps;
  }
  const local = groups.map((g) => domain || [g.min, g.max]);
  const memo = groups.map(() => /* @__PURE__ */ new Map());
  const kernel = p.method === "pdf" ? "L.densityNormal" : "L.cumulativeNormal";
  const evalSrc = `const L = globalThis.__pwvt, K = ${kernel};
const R = bufs[0], V = cols[0], gidx = args.gidx, X = args.X, OFF = args.off, BW = args.bw, acc = new Float64Array(args.tot);
for (let j = start; j < end; j++) {
  const i = R[j], v = ${isNull} ? 0 : V[i], g = gidx[${keyExpr}], xs = X[g];
  if (!xs.length) continue;
  const o = OFF[g], b = BW[g];
  for (let q = 0; q < xs.length; q++) acc[o + q] += K((xs[q] - v) / b, 0, 1);
}
return acc;`;
  for (let round = 0; round < 64; round++) {
    const X = groups.map((_g, j) => needed((x) => memo[j].get(x), local[j], minsteps, maxsteps));
    const tot = X.reduce((s, xs) => s + xs.length, 0);
    if (!tot) break;
    const off = [];
    let o = 0;
    for (const xs of X) {
      off.push(o);
      o += xs.length;
    }
    const res = (await (0, import_resident15.map)({ key: kernelKey("pv:kde:eval:", evalSrc), src: evalSrc }, {
      pool,
      n: m,
      cols,
      bufs: [sb2(rows, "i32")],
      args: { gidx, X, off, bw, tot }
    })).flat();
    const y = new Float64Array(tot);
    for (const a of res) for (let q = 0; q < tot; q++) y[q] += a[q];
    X.forEach((xs, j) => xs.forEach((x, q) => {
      const s = y[off[j] + q], n = groups[j].count;
      memo[j].set(x, p.method === "pdf" ? s / bw[j] / n : s / n);
    }));
  }
  const out = [];
  const names = p.groupby;
  groups.forEach((g, j) => {
    const scale = p.counts ? g.count : 1;
    const f = (x) => {
      const v = memo[j].get(x);
      if (v === void 0) throw new Unsupported("density sample outside the computed points");
      return v;
    };
    for (const v of vega.sampleCurve(f, local[j], minsteps, maxsteps)) {
      const t = {};
      for (let i = 0; i < names.length; ++i) t[names[i]] = g.dims[i];
      t[p.as[0]] = v[0];
      t[p.as[1]] = v[1] * scale;
      out.push(t);
    }
  });
  return out;
}

// src/runtime/operators.ts
var QUANTILE_OPS = /* @__PURE__ */ new Set(["median", "q1", "q3"]);
var CODE = "$pwcode";
var SORT = "$pwsort";
var infoCache = /* @__PURE__ */ new WeakMap();
function exprInfo(fn) {
  if (!fn || typeof fn[CODE] !== "string") return null;
  let info = infoCache.get(fn);
  if (!info) {
    info = analyze(fn[CODE]);
    infoCache.set(fn, info);
  }
  return info;
}
var conjCache = /* @__PURE__ */ new WeakMap();
function exprConjuncts(fn) {
  let c = conjCache.get(fn);
  if (!c) {
    c = conjuncts(fn[CODE]).map((code) => ({ code, info: analyze(code), range: matchRange(code) }));
    conjCache.set(fn, c);
  }
  return c;
}
var codeInfo = /* @__PURE__ */ new Map();
function analyzeCached(code) {
  let i = codeInfo.get(code);
  if (!i) {
    if (codeInfo.size > 4096) codeInfo.clear();
    i = analyze(code);
    codeInfo.set(code, i);
  }
  return i;
}
function compilable(fn) {
  const info = exprInfo(fn);
  return !!info && (!info.unsupported || readsSelection(info.code));
}
function params(info, _, extra) {
  const P = {};
  for (const k of info.params) {
    const v = extra && k in extra ? extra[k] : _[k];
    if (!cloneable(v)) throw new Unsupported("parameter " + k);
    P[k] = v;
  }
  return P;
}
function plainField(vega, f) {
  if (!f) return null;
  const name = vega.accessorName(f);
  const fields = vega.accessorFields(f);
  if (!name || fields.length !== 1 || fields[0] !== name) return null;
  if (f[CODE] !== void 0) return null;
  return /[.[\]\\]/.test(name) ? null : name;
}
function groupField(vega, f) {
  const plain2 = plainField(vega, f);
  if (plain2) return { field: plain2, name: plain2 };
  if (!f || f[CODE] !== void 0) return null;
  const fields = vega.accessorFields(f), name = vega.accessorName(f);
  if (!name || fields.length !== 1 || /[.[\]\\]/.test(fields[0])) return null;
  const m = /^function[^{]*\{\s*return _\[("(?:[^"\\]|\\.)*")\];\s*\}$/.exec(String(f));
  return m && JSON.parse(m[1]) === fields[0] ? { field: fields[0], name } : null;
}
var MOD_CACHE = "_:mod:_";
var joinCounter = 0;
function keepModified(_) {
  const s = Object.create(_);
  Object.defineProperty(s, MOD_CACHE, { value: _[MOD_CACHE], writable: true });
  return s;
}
function defineOperators(vega, rt, opts) {
  const originals = {};
  const replaced = {};
  const isParallel = (op) => !!(op && op._pwParallel);
  function inputRelation(op, pulse) {
    const src = op.source;
    if (isParallel(src)) {
      const r = src._pwRelation();
      if (r) return r;
      if (src._pwLazy) throw new Error("paraweb-vega: lazy operator without relation");
    }
    const tuples = pulse.source;
    if (!Array.isArray(tuples) || tuples.length < opts.minRows || !src || src.value !== tuples) return null;
    if (op._pwBaseSrc !== tuples || pulse.changed()) {
      if (op._pwBase) op._pwBase.table.dispose(rt.pool());
      op._pwBase = makeBase(tuples.slice(), tuples);
      op._pwBaseSrc = tuples;
    }
    return baseRelation(op._pwBase);
  }
  function lazyTargets(op, valueIsTuples) {
    for (const x of op.targets()) {
      const src = x.source;
      if (src === op) {
        if (!isParallel(x) || !x._pwConsumes()) return false;
      } else if (Array.isArray(src) && src.includes(op)) {
        return false;
      } else if (valueIsTuples) {
        return false;
      }
    }
    return true;
  }
  function withRoot(arr, rel) {
    const root = rel.base.source && rel.base.source.root;
    if (root && arr && arr !== rel.base.source) arr.root = root;
    return arr;
  }
  function lazyPulse(op, pulse, out) {
    const r = pulse.fork(pulse.NO_SOURCE | pulse.NO_FIELDS);
    let cache = null;
    const tuples = () => {
      if (!cache) {
        cache = withRoot(materializeSync(out, rt.pool(), vega), out);
        op._pwGiven = out;
      }
      return cache;
    };
    const current = () => pulse.dataflow._clock === r.stamp;
    for (const f of ["source", "add"]) {
      Object.defineProperty(r, f, {
        configurable: true,
        enumerable: true,
        get: () => !current() ? f === "add" ? [] : null : f === "add" ? tuples().slice() : tuples(),
        set: (v) => {
          Object.defineProperty(r, f, { value: v, writable: true, configurable: true, enumerable: true });
        }
      });
    }
    return r;
  }
  function checkRelation(rel) {
    const rc = new RowCode(rel, rt.pool());
    predicateCode(rc, rel.preds);
    for (const name of rel.derived.keys()) rc.field(name);
  }
  function changesetPulse2(pulse, ch, source) {
    const p = pulse.fork(pulse.NO_FIELDS | (source ? pulse.NO_SOURCE : 0));
    p.add = ch.add;
    p.rem = ch.rem;
    p.mod = ch.mod;
    if (source) p.source = source;
    if (ch.fields.length) p.modifies(ch.fields);
    return p;
  }
  function define(type, impl) {
    const Orig = vega.transforms[type];
    if (!Orig) return;
    originals[type] = Orig;
    const fallbackTransform = Orig.prototype.transform;
    function P(params2) {
      Orig.call(this, params2);
      this._pwRel = null;
      this._pwLazy = false;
      this._pwFallback = false;
      this._pwOutMat = null;
      this._pwInMat = null;
      this._pwOut = [];
      this._pwLastSig = null;
    }
    P.Definition = Orig.Definition;
    vega.inherits(P, Orig, {
      _pwParallel: true,
      _pwConsumes() {
        return !this._pwFallback && impl.consumes(this);
      },
      _pwRelation() {
        return this._pwRel;
      },
      /** Run Vega's operator on the materialized input relation (sticky). */
      _pwVega(_, pulse, rel, reason) {
        if (!this._pwFallback) {
          this._pwFallback = true;
          if (opts.onFallback) opts.onFallback(type, reason);
          if (type === "aggregate") this.value = null;
        }
        this._pwRel = null;
        this._pwLazy = false;
        const mat = this._pwInMat || (this._pwInMat = new Materializer(vega));
        const k = keepModified(_);
        return mat.update(rel, rt.pool()).then((ch) => {
          const p = changesetPulse2(pulse, ch, withRoot(ch.source(), rel));
          return fallbackTransform.call(this, k, p);
        });
      },
      transform(_, pulse) {
        const rel = inputRelation(this, pulse);
        if (!rel) {
          if (this._pwRel || this._pwInMat) {
            this._pwRel = null;
            this._pwInMat = null;
          }
          return fallbackTransform.call(this, _, pulse);
        }
        if (this._pwFallback) return this._pwVega(_, pulse, rel, "");
        if (impl.kind === "sink") {
          try {
            return impl.run(this, _, rel, pulse);
          } catch (e) {
            if (!(e instanceof Unsupported)) throw e;
            return this._pwVega(_, pulse, rel, e.message);
          }
        }
        let out;
        try {
          out = impl.next(this, _, rel);
          checkRelation(out);
        } catch (e) {
          if (!(e instanceof Unsupported)) throw e;
          return this._pwVega(_, pulse, rel, e.message);
        }
        this._pwRel = out;
        this._pwLazy = lazyTargets(this, !!impl.viaVega || !!impl.valueIsTuples);
        if (impl.effect) {
          const lazy = this._pwLazy;
          const k = keepModified(_);
          return Promise.resolve(impl.effect(this, _, out, pulse)).then((r) => {
            if (r) {
              out = r;
              this._pwRel = r;
              checkRelation(r);
            }
            return this._pwEmit(k, pulse, out, lazy);
          }).catch((e) => {
            if (!(e instanceof Unsupported)) throw e;
            return this._pwVega(k, pulse, rel, e.message);
          });
        }
        const emitted = this._pwEmit(_, pulse, out, this._pwLazy);
        if (!emitted || typeof emitted.then !== "function") return emitted;
        const k2 = keepModified(_);
        return emitted.catch((e) => {
          if (!(e instanceof Unsupported)) throw e;
          return this._pwVega(k2, pulse, rel, e.message);
        });
      },
      _pwEmit(_, pulse, out, lazy) {
        if (lazy) {
          this._pwOutMat = null;
          this._pwGiven = null;
          return lazyPulse(this, pulse, out);
        }
        if (impl.viaVega) {
          const mat2 = this._pwInMat || (this._pwInMat = new Materializer(vega));
          const k = keepModified(_);
          return mat2.update(out, rt.pool()).then((ch) => fallbackTransform.call(this, k, changesetPulse2(pulse, ch)));
        }
        const fresh = !this._pwOutMat;
        const mat = this._pwOutMat || (this._pwOutMat = new Materializer(vega));
        const given = fresh ? this._pwGiven : null;
        this._pwGiven = null;
        const primed = given ? mat.update(given, rt.pool()) : Promise.resolve();
        return primed.then(() => mat.update(out, rt.pool())).then(async (ch) => {
          let source;
          if (out.derive || out.collectAt === out.preds.length) source = ch.source();
          else if (out.collectAt === void 0) source = out.base.source;
          else {
            const sm = this._pwSrcMat || (this._pwSrcMat = new Materializer(vega));
            source = (await sm.update({ ...out, preds: out.preds.slice(0, out.collectAt), derived: /* @__PURE__ */ new Map() }, rt.pool())).source();
          }
          return changesetPulse2(pulse, ch, withRoot(source, out));
        });
      }
    });
    replaced[type] = P;
  }
  async function sortKeys(rel, cmp) {
    const info = cmp && cmp[SORT];
    if (!info) throw new Unsupported("comparator");
    const pool = rt.pool();
    const keys = [];
    for (let i = 0; i < info.paths.length; i++) {
      const path = info.paths[i];
      const m = path && /^\[("(?:[^"\\]|\\.)*")\]$/.exec(path);
      if (!m) throw new Unsupported("sort field");
      const name = JSON.parse(m[1]);
      const order = info.orders[i] < 0 ? -1 : 1;
      const d = rel.derived.get(name);
      if (d) {
        if (d.kind === "expr") throw new Unsupported("sort by an expression field");
        const c = await derivedNumeric(rel, name, pool);
        for (let j = 0; j < c.view.length; j++) if (c.view[j] !== c.view[j]) throw new Unsupported("sort field with missing values");
        keys.push({ key: c.key, view: c.view, order });
        continue;
      }
      const col = rel.base.table.exprColumn(name);
      if (!col) throw new Unsupported("sort field " + name);
      if (col.kind === "num" && !col.tag && !col.hasNaN) {
        keys.push({ key: col.key, view: col.view, order });
        continue;
      }
      if (col.kind === "date" && col.tag.every((g) => g === 0)) {
        keys.push({ key: col.key, view: col.view, order });
        continue;
      }
      const dict = col.kind === "dict" ? col : null;
      if (!dict) throw new Unsupported("sort field with missing values");
      const asc = (u, v) => (u < v || u == null) && v != null ? -1 : (u > v || v == null) && u != null ? 1 : (v = v instanceof Date ? +v : v, u = u instanceof Date ? +u : u) !== u && v === v ? -1 : v !== v && u === u ? 1 : 0;
      const idx = dict.values.map((_v, j) => j).sort((a, b) => asc(dict.values[a], dict.values[b]));
      const rank = new Float64Array(dict.values.length);
      let r = 0;
      idx.forEach((j, q) => {
        if (q > 0 && asc(dict.values[idx[q - 1]], dict.values[j]) !== 0) r = q;
        rank[j] = r;
      });
      const n = rel.base.tuples.length;
      const view = new Float64Array(new SharedArrayBuffer(8 * Math.max(1, n)));
      const src = "const c = cols[0], out = bufs[0], rank = args.rank;\nfor (let i = start; i < end; i++) out[i] = rank[c[i]];";
      pool.ensureColumn(dict.key, "i32", dict.view.buffer);
      if (n) await (0, import_resident16.map)({ key: "pv:sort:rank", src }, { pool, n, cols: [dict.key], bufs: [{ buffer: view.buffer, type: "f64" }], args: { rank: Array.from(rank) } });
      const key2 = `${rel.base.table.id}:rank:${name}:${++joinCounter}`;
      keys.push({ key: key2, view, order });
    }
    return keys;
  }
  {
    const Orig = vega.transforms.collect;
    define("collect", {
      kind: "stream",
      viaVega: true,
      // A sorted collect takes a relation too, but always creates its tuples (see below).
      consumes: () => true,
      next: (_op, _, rel) => {
        if (_.sort) throw new Unsupported("sort");
        return { ...rel, collectAt: rel.preds.length };
      }
    });
    const P = replaced.collect;
    const t = P.prototype.transform;
    P.prototype.transform = function(_, pulse) {
      if (isParallel(this.source) && this.source._pwRelation() && _.sort && !this._pwFallback) {
        const rel = this.source._pwRelation();
        if (lazyTargets(this, true)) {
          this._pwRel = { ...rel, orderCmp: _.sort, collectAt: rel.preds.length };
          this._pwLazy = true;
          return pulse.fork(pulse.NO_SOURCE | pulse.NO_FIELDS);
        }
        let keys;
        try {
          keys = sortKeys(rel, _.sort);
        } catch (e) {
          if (!(e instanceof Unsupported)) throw e;
          return this._pwVega(_, pulse, rel, e.message);
        }
        const mat = this._pwInMat || (this._pwInMat = new Materializer(vega));
        const k = keepModified(_);
        const pool = rt.pool();
        return Promise.all([keys, mat.update(rel, pool)]).then(async ([ks, ch]) => {
          const sorted = await sortRows(pool, mat.selectedShared(), ks);
          const ranks = ks.filter((x) => x.key.includes(":rank:")).map((x) => x.key);
          if (ranks.length) pool.dropColumns(ranks);
          const value = new Array(sorted.length);
          for (let j = 0; j < sorted.length; j++) value[j] = mat.tuple(sorted[j]);
          const out = changesetPulse2(pulse, ch, value);
          this.value = value;
          this.modified(true);
          this._pwRel = { ...rel, orderCmp: _.sort };
          this._pwLazy = false;
          return out;
        }, (e) => {
          if (!(e instanceof Unsupported)) throw e;
          return this._pwVega(k, pulse, rel, e.message);
        });
      }
      if (isParallel(this.source) && this.source._pwRelation()) return t.call(this, _, pulse);
      const r = Orig.prototype.transform.call(this, _, pulse);
      if (pulse.changed() || !this._pwBase || this._pwBaseSrc !== this.value) {
        this._pwStale = true;
      }
      this._pwRel = null;
      return r;
    };
    P.prototype._pwRelation = function() {
      if (this._pwRel) return this._pwRel;
      const tuples = this.value;
      if (!Array.isArray(tuples) || tuples.length < opts.minRows) return null;
      if (this._pwStale || !this._pwBase) {
        if (this._pwBase) this._pwBase.table.dispose(rt.pool());
        this._pwBase = makeBase(tuples.slice(), tuples);
        this._pwBaseSrc = tuples;
        this._pwStale = false;
      }
      return baseRelation(this._pwBase);
    };
  }
  define("relay", {
    kind: "stream",
    consumes: () => true,
    next: (_op, _, rel) => {
      if (!_.derive || rel.derive) return rel;
      const r = { ...rel, derive: true };
      return { ...r, sig: relationSig(r) };
    }
  });
  define("filter", {
    kind: "stream",
    consumes: (op) => !!op._argval && compilable(op._argval.expr),
    next: (_op, _, rel) => {
      const info = exprInfo(_.expr);
      if (!info) throw new Unsupported("expression source");
      if (info.unsupported && !readsSelection(info.code)) throw new Unsupported(info.unsupported);
      const preds = [...rel.preds];
      const numeric = (f) => {
        if (rel.derived.has(f)) return false;
        const col = rel.base.table.exprColumn(f);
        return !!col && col.kind === "num" && !col.tag;
      };
      for (const c of exprConjuncts(_.expr)) {
        if (readsSelection(c.code)) {
          const br = brushRanges(c.code, _);
          if (br && br.every((b) => numeric(b.field))) {
            for (const b of br) {
              const k = "#brush:" + b.field;
              preds.push({
                info: analyzeCached(`this.inrange(datum[${JSON.stringify(b.field)}],_[${JSON.stringify(k)}])`),
                P: { [k]: b.value },
                range: { field: b.field, value: b.value }
              });
            }
            continue;
          }
          const sp = specializeSelections(c.code, _);
          if (!sp) throw new Unsupported("selection store");
          const si = analyzeCached(sp.code);
          if (si.unsupported) throw new Unsupported(si.unsupported);
          preds.push({ info: si, P: params(si, _, sp.extra) });
          continue;
        }
        if (c.info.unsupported) throw new Unsupported(c.info.unsupported);
        const P = params(c.info, _);
        const pred = { info: c.info, P };
        if (c.range && numeric(c.range.field)) {
          const v = P[c.range.param];
          if (!v) pred.range = { field: c.range.field, value: null };
          else if (Array.isArray(v) && typeof v[0] === "number" && typeof v[1] === "number" && v[0] <= v[1]) {
            pred.range = { field: c.range.field, value: [v[0], v[1]] };
          }
        }
        preds.push(pred);
      }
      const r = { ...rel, preds };
      return { ...r, sig: relationSig(r) };
    }
  });
  define("formula", {
    kind: "stream",
    consumes: (op) => {
      const info = op._argval && exprInfo(op._argval.expr);
      return !!info && !info.unsupported;
    },
    // (Selection tests in formulas are rare; they run on Vega.)
    next: (_op, _, rel) => {
      const info = exprInfo(_.expr);
      if (!info) throw new Unsupported("expression source");
      if (info.unsupported) throw new Unsupported(info.unsupported);
      if (_.initonly && info.params.length) throw new Unsupported("initonly");
      const d = { kind: "expr", name: _.as, env: rel.derived, info, P: params(info, _), fn: _.expr };
      const derived = new Map(rel.derived);
      preserveBase(rel, _.as);
      derived.delete(_.as);
      derived.set(_.as, d);
      const r = { ...rel, derived };
      return { ...r, sig: relationSig(r) };
    }
  });
  define("bin", {
    kind: "stream",
    consumes: (op) => !!(op._argval && plainField(vega, op._argval.field)),
    next: (op, _, rel) => {
      const field2 = plainField(vega, _.field);
      if (!field2) throw new Unsupported("bin field");
      if (!_.extent || _.extent.length < 2) throw new Unsupported("bin extent");
      const f = originals.bin.prototype._bins.call(op, _);
      const rb = resolveBin(_, [+_.extent[0], +_.extent[1]]);
      const same = (a, b) => a === b || a !== a && b !== b;
      if (!same(rb.start, f.start) || !same(rb.step, f.step)) throw new Unsupported("bin parameters");
      const as = _.as || ["bin0", "bin1"];
      const band = _.interval !== false;
      const derived = new Map(rel.derived);
      const parts = band ? [0, 1] : [0];
      for (const part of parts) {
        const d = {
          kind: "bin",
          name: as[part],
          env: rel.derived,
          field: field2,
          part,
          start: rb.start,
          stop: rb.stop,
          step: rb.step,
          fn: f
        };
        derived.delete(as[part]);
        preserveBase(rel, as[part]);
        derived.set(as[part], d);
      }
      const r = { ...rel, derived };
      return { ...r, sig: relationSig(r) };
    }
  });
  define("timeunit", {
    kind: "stream",
    consumes: (op) => !!(op._argval && op._argval.units && plainField(vega, op._argval.field)),
    next: (op, _, rel) => {
      const field2 = plainField(vega, _.field);
      if (!field2) throw new Unsupported("timeunit field");
      if (!_.units) throw new Unsupported("timeunit without units");
      const utc = _.timezone === "utc";
      const step = _.step || 1;
      originals.timeunit.prototype._floor.call(op, _, null);
      const fn = lib.timeunit(_.units, step, utc);
      const as = _.as || ["unit0", "unit1"];
      const band = _.interval !== false;
      const derived = new Map(rel.derived);
      for (const part of band ? [0, 1] : [0]) {
        const d = {
          kind: "time",
          name: as[part],
          env: rel.derived,
          field: field2,
          part,
          units: _.units,
          step,
          utc,
          floor: fn.floor,
          offset: fn.offset
        };
        derived.delete(as[part]);
        preserveBase(rel, as[part]);
        derived.set(as[part], d);
      }
      const r = { ...rel, derived };
      return { ...r, sig: relationSig(r) };
    }
  });
  async function aggregateParams(rel, groupby, ops, fields, as) {
    const pool = rt.pool();
    const table = rel.base.table;
    const filter = rel.preds.filter((p) => p.range).map((p) => ({ field: p.range.field, range: p.range.value }));
    const others = rel.preds.filter((p) => !p.range);
    const bins = [];
    const binOf = /* @__PURE__ */ new Map();
    const group = [];
    const groupCols = {};
    const measureCols = {};
    for (const g of groupby) {
      const d = rel.derived.get(g);
      if (!d) {
        if (!table.exprColumn(g)) throw new Unsupported("group-by field " + g);
        group.push(g);
        continue;
      }
      if (d.kind === "bin") {
        let column;
        if (d.env.has(d.field)) {
          column = await derivedNumeric({ ...rel, derived: d.env }, d.field, pool);
        } else {
          const col = table.exprColumn(d.field);
          if (!col || col.kind !== "num") throw new Unsupported("bin of non-numeric field " + d.field);
          if (col.hasNaN) throw new Unsupported("bin of a field with NaN values");
        }
        if (column) for (let i = 0; i < column.view.length; i++) {
          if (column.view[i] !== column.view[i]) {
            column = void 0;
            break;
          }
        }
        if (d.env.has(d.field) && !column) {
          groupCols[g] = await derivedDictionary(rel, g, pool);
          group.push(g);
          continue;
        }
        const k = `${d.field}|${d.start}|${d.stop}|${d.step}|${column ? column.key : ""}`;
        let b = binOf.get(k);
        if (!b) {
          b = { field: d.field, resolved: { start: d.start, stop: d.stop, step: d.step }, as: [null, null], column };
          binOf.set(k, b);
          bins.push(b);
        }
        b.as[d.part] = g;
        continue;
      }
      groupCols[g] = await derivedDictionary(rel, g, pool);
      group.push(g);
    }
    for (const b of bins) if (!b.as[0]) throw new Unsupported("bin end without bin start");
    for (const f of fields) {
      if (f && rel.derived.has(f) && !measureCols[f]) {
        const c = await derivedNumeric(rel, f, pool);
        if (c.poison) throw new Unsupported("measure " + f + " with values that are not numbers");
        measureCols[f] = c;
      }
    }
    const params2 = { groupby: group, bins, ops, fields, as, filter };
    if (Object.keys(groupCols).length) params2.groupCols = groupCols;
    if (Object.keys(measureCols).length) params2.measureCols = measureCols;
    if (others.length) {
      params2.where = (slot) => {
        const rc = new RowCode(rel, pool, slot);
        const cond = predicateCode(rc, others);
        return { prelude: rc.prelude(), cond, P: rc.P };
      };
    }
    return params2;
  }
  define("aggregate", {
    kind: "sink",
    consumes: (op) => {
      const a = op._argval;
      if (!a || a.cross || a.drop === false || a.key) return false;
      if (vega.array(a.groupby).some((g) => !groupField(vega, g))) return false;
      if (vega.array(a.fields).some((f) => f && !plainField(vega, f))) return false;
      return (a.ops || ["count"]).every((o) => SUPPORTED_OPS.has(o) || QUANTILE_OPS.has(o));
    },
    run: (op, _, rel, pulse) => {
      if (_.cross || _.drop === false || _.key) throw new Unsupported("cross, drop or key");
      const gf = vega.array(_.groupby).map((g) => {
        const n = groupField(vega, g);
        if (!n) throw new Unsupported("group-by accessor");
        return n;
      });
      const groupby = gf.map((g) => g.field);
      if (new Set(groupby).size !== groupby.length) throw new Unsupported("group-by field read twice");
      const renames = gf.filter((g) => g.name !== g.field);
      const ops = _.ops && _.ops.length ? _.ops : ["count"];
      const fields = vega.array(_.fields).map((f) => {
        if (!f) return null;
        const n = plainField(vega, f);
        if (!n) throw new Unsupported("field accessor");
        return n;
      });
      for (const o of ops) if (!SUPPORTED_OPS.has(o) && !QUANTILE_OPS.has(o)) throw new Unsupported("op " + o);
      const as = (_.as || []).map((a) => a ?? null);
      const sig = rel.sig + "|" + JSON.stringify([groupby, ops, fields, as]);
      if (sig === op._pwLastSig) return pulse.StopPropagation;
      const engine = op._pwEngine || (op._pwEngine = new AggregateEngine(rt));
      const stats = {};
      const out = pulse.fork(pulse.NO_SOURCE | pulse.NO_FIELDS);
      const k = keepModified(_);
      let aparams;
      return aggregateParams(rel, groupby, ops, fields, as).then((params2) => {
        op._pwLastSig = sig;
        aparams = params2;
        if (ops.some((o) => QUANTILE_OPS.has(o))) return aggregateWithQuantiles(op, rel, params2).then((r) => r.rows);
        return engine.run(rel.base.table, params2, { name: _.name }, stats);
      }, (e) => {
        if (!(e instanceof Unsupported)) throw e;
        op.value = null;
        return op._pwVega(k, pulse, rel, e.message).then((p) => {
          if (op._pwOut.length && p && p.rem) {
            p.rem = p.rem.concat(op._pwOut);
            op._pwOut = [];
          }
          return { fallback: p };
        });
      }).then(async (rows) => {
        if (rows && rows.fallback) return rows.fallback;
        const keyOf = (r) => groupby.map((g) => {
          const v = r[g];
          return v === null ? "N" : v === void 0 ? "U" : v instanceof Date ? "d" + +v : typeof v === "number" ? "n" + (Object.is(v, -0) ? "-0" : String(v)) : typeof v + ":" + String(v);
        }).join("\0");
        const prev = op._pwGroups || /* @__PURE__ */ new Map();
        const next = /* @__PURE__ */ new Map();
        const fresh = [];
        out.mod = [];
        for (const r of rows) {
          const key2 = keyOf(r), t = prev.get(key2);
          if (t) {
            for (const f in t) if (f !== "_vgsid_" && !(f in r)) delete t[f];
            Object.assign(t, r);
            out.mod.push(t);
            next.set(key2, t);
          } else fresh.push([key2, r]);
        }
        if (fresh.length > 1) {
          const first = await firstRows(rel, aparams, keyOf);
          fresh.sort((a, b) => (first.get(a[0]) ?? Infinity) - (first.get(b[0]) ?? Infinity));
        }
        out.add = fresh.map(([key2, r]) => {
          const t = vega.ingest(r);
          next.set(key2, t);
          return t;
        });
        out.rem = [...prev].filter(([key2]) => !next.has(key2)).map(([, t]) => t);
        op._pwGroups = next;
        op._pwOut = [...next.values()];
        const cells = /* @__PURE__ */ Object.create(null);
        const outNames = gf.map((g) => g.name);
        for (const t of op._pwOut) {
          const key2 = outNames.length === 0 ? "" : outNames.length === 1 ? String(t[outNames[0]]) : outNames.map((n) => t[n]).join("|");
          cells[key2] = { tuple: t };
        }
        op.value = cells;
        if (renames.length) for (const t of [...out.add, ...out.mod]) {
          for (const g of renames) {
            t[g.name] = t[g.field];
            if (!as.includes(g.field)) delete t[g.field];
          }
        }
        if (rows.length) out.modifies(Object.keys(out.add[0] || out.mod[0]));
        else out.modifies([...gf.map((g) => g.name), ...ops.map((o, i) => as[i] || o)]);
        return out;
      });
    }
  });
  async function aggregateWithQuantiles(op, rel, params2) {
    const pool = rt.pool();
    const table = rel.base.table;
    const ops = params2.ops, fields = params2.fields, as = params2.as;
    const qi = ops.map((o, i) => QUANTILE_OPS.has(o) ? i : -1).filter((i) => i >= 0);
    const bi = ops.map((o, i) => QUANTILE_OPS.has(o) ? -1 : i).filter((i) => i >= 0);
    const COUNT = "\0pwcount";
    const bparams = {
      ...params2,
      ops: bi.length ? bi.map((i) => ops[i]) : ["count"],
      fields: bi.length ? bi.map((i) => fields[i]) : [null],
      as: bi.length ? bi.map((i) => as[i]) : [COUNT]
    };
    const plan = await planAggregate(pool, table, bparams);
    if (plan.spec.dims.some((d) => d.kind === "bucket")) throw new Unsupported("group count");
    const ex = await executePlan(pool, table, plan, op._pwScratchQ || (op._pwScratchQ = {}));
    const keys = [];
    const rows = emitRows(plan, ex.final, keys);
    if (!bi.length) for (const r of rows) delete r[COUNT];
    const rowOf = /* @__PURE__ */ new Map();
    keys.forEach((k, j) => rowOf.set(k, rows[j]));
    const sel = await selectRows(rel, pool);
    const n = table.length;
    const gk = new Float64Array(new SharedArrayBuffer(8 * Math.max(1, n)));
    const src = `const fp = args.fp;
${groupKeySource(plan.spec)}
const R = bufs[0], out = bufs[1];
for (let j = start; j < end; j++) { const i = R[j]; out[i] = groupKey(i); }`;
    if (sel.length) await (0, import_resident16.map)({ key: kernelKey("pv:qgk:", src), src }, {
      pool,
      n: sel.length,
      cols: plan.cols,
      args: { fp: plan.fp },
      bufs: [{ buffer: sel.buffer, type: "i32" }, { buffer: gk.buffer, type: "f64" }]
    });
    const gkey = `${table.id}:qgk:${++joinCounter}`;
    pool.ensureColumn(gkey, "f64", gk.buffer);
    const P = { q1: 0.25, median: 0.5, q3: 0.75 };
    try {
      for (const i of qi) {
        const f = fields[i];
        if (!f) throw new Unsupported("quantile without field");
        const name = as[i] || ops[i] + "_" + f;
        for (const r of rows) r[name] = void 0;
        let view, key2, tag = null;
        const mc = params2.measureCols && params2.measureCols[f];
        if (mc) {
          view = mc.view;
          key2 = mc.key;
        } else {
          const c = table.exprColumn(f);
          if (!c || c.kind !== "num") throw new Unsupported("quantile of a non-numeric field");
          view = c.view;
          key2 = c.key;
          tag = c.tag || null;
        }
        const valid = new Int32Array(new SharedArrayBuffer(4 * Math.max(1, sel.length)));
        let w = 0;
        for (let j = 0; j < sel.length; j++) {
          const r = sel[j];
          if ((!tag || tag[r] === 0) && view[r] === view[r]) valid[w++] = r;
        }
        const sorted = await sortRows(pool, valid.subarray(0, w), [{ key: gkey, view: gk, order: 1 }, { key: key2, view, order: 1 }]);
        const p = P[ops[i]];
        for (let s0 = 0; s0 < sorted.length; ) {
          const k = gk[sorted[s0]];
          let e = s0 + 1;
          while (e < sorted.length && gk[sorted[e]] === k) e++;
          const cnt = e - s0, at = (q) => view[sorted[s0 + q]];
          let v;
          if (cnt < 2) v = at(0);
          else {
            const h = (cnt - 1) * p, i0 = Math.floor(h), v0 = at(i0);
            v = v0 + (at(i0 + 1) - v0) * (h - i0);
          }
          const row = rowOf.get(k);
          if (row) row[name] = v;
          s0 = e;
        }
      }
    } finally {
      pool.dropColumns([gkey]);
    }
    const names = ops.map((o, i) => as[i] || o + (fields[i] ? "_" + fields[i] : ""));
    return { rows, keys, plan, names };
  }
  const rowIndex = /* @__PURE__ */ new WeakMap();
  async function firstRows(rel, params2, keyOf) {
    const table = rel.base.table;
    let col = rowIndex.get(table);
    if (!col) {
      const n = table.length, view = new Float64Array(new SharedArrayBuffer(8 * Math.max(1, n)));
      for (let i = 0; i < n; i++) view[i] = i;
      col = { key: `${table.id}:rowindex`, view };
      rt.pool().ensureColumn(col.key, "f64", view.buffer);
      rowIndex.set(table, col);
    }
    const ROW = "\0row", FIRST = "\0first";
    const rows = await runAggregate(rt.pool(), table, {
      ...params2,
      ops: ["min"],
      fields: [ROW],
      as: [FIRST],
      measureCols: { ...params2.measureCols || {}, [ROW]: col }
    }, {}, void 0, null);
    return new Map(rows.map((r) => [keyOf(r), r[FIRST]]));
  }
  const MAX_JOIN_KEYS = 1 << 20;
  define("joinaggregate", {
    kind: "stream",
    consumes: (op) => {
      const a = op._argval;
      if (!a || a.key) return false;
      if (vega.array(a.groupby).some((g) => !plainField(vega, g))) return false;
      if (vega.array(a.fields).some((f) => f && !plainField(vega, f))) return false;
      return (a.ops || ["count"]).every((o) => SUPPORTED_OPS.has(o) || QUANTILE_OPS.has(o));
    },
    next: (_op, _, rel) => {
      if (_.key) throw new Unsupported("key");
      for (const g of vega.array(_.groupby)) if (!plainField(vega, g)) throw new Unsupported("group-by accessor");
      for (const f of vega.array(_.fields)) if (f && !plainField(vega, f)) throw new Unsupported("field accessor");
      for (const o of _.ops || ["count"]) if (!SUPPORTED_OPS.has(o) && !QUANTILE_OPS.has(o)) throw new Unsupported("op " + o);
      return rel;
    },
    effect: async (op, _, rel) => {
      const pool = rt.pool();
      const table = rel.base.table;
      const groupby = vega.array(_.groupby).map((g) => plainField(vega, g));
      const ops = _.ops && _.ops.length ? _.ops : ["count"];
      const fields = vega.array(_.fields).map((f) => f ? plainField(vega, f) : null);
      const as = (_.as || []).map((a) => a ?? null);
      const params2 = await aggregateParams(rel, groupby, ops, fields, as);
      let plan, keys = [], rows, names;
      if (ops.some((o) => QUANTILE_OPS.has(o))) {
        ({ plan, keys, rows, names } = await aggregateWithQuantiles(op, rel, params2));
        if (plan.K > MAX_JOIN_KEYS) throw new Unsupported("group count");
      } else {
        plan = await planAggregate(pool, table, params2);
        if (plan.K > MAX_JOIN_KEYS || plan.spec.dims.some((d) => d.kind === "bucket")) throw new Unsupported("group count");
        const ex = await executePlan(pool, table, plan, op._pwScratch || (op._pwScratch = {}));
        rows = emitRows(plan, ex.final, keys);
        names = plan.outputs.map((o) => o.name);
      }
      const vals = names.map(() => new Array(plan.K));
      rows.forEach((r2, j) => names.forEach((name, m) => {
        vals[m][keys[j]] = r2[name];
      }));
      const n = table.length;
      let jc = op._pwJoin;
      if (!jc || jc.table !== table || jc.names.join("\0") !== names.join("\0")) {
        if (jc) pool.dropColumns(jc.cols.flatMap((c) => [c.key, c.tagKey]));
        const id2 = ++joinCounter;
        jc = op._pwJoin = {
          table,
          names,
          version: 0,
          cols: names.map((_n, m) => {
            const key2 = `${table.id}:join${id2}:${m}`;
            const c = {
              key: key2,
              tagKey: key2 + ":tag",
              view: new Float64Array(new SharedArrayBuffer(8 * Math.max(1, n))),
              tag: new Uint8Array(new SharedArrayBuffer(Math.max(1, n)))
            };
            pool.ensureColumn(c.key, "f64", c.view.buffer);
            pool.ensureColumn(c.tagKey, "u8", c.tag.buffer);
            return c;
          })
        };
      }
      const src = `const fp = args.fp, vals = args.vals;
${groupKeySource(plan.spec)}
for (let i = start; i < end; i++) { const k = groupKey(i);
  for (let m = 0; m < vals.length; m++) { const v = vals[m][k], o = bufs[2 * m], g = bufs[2 * m + 1];
    if (typeof v === "number") { o[i] = v; g[i] = 0; } else g[i] = v === null ? 1 : 2; } }`;
      if (n) await (0, import_resident16.map)({ key: kernelKey("pv:join:", src), src }, {
        pool,
        n,
        cols: plan.cols,
        args: { fp: plan.fp, vals },
        bufs: jc.cols.flatMap((c) => [
          { buffer: c.view.buffer, type: "f64" },
          { buffer: c.tag.buffer, type: "u8" }
        ])
      });
      const version = ++jc.version;
      const derived = new Map(rel.derived);
      names.forEach((name, m) => {
        derived.delete(name);
        preserveBase(rel, name);
        derived.set(name, { kind: "col", name, env: rel.derived, col: { ...jc.cols[m], version } });
      });
      const r = { ...rel, derived };
      return { ...r, sig: relationSig(r) };
    }
  });
  const windowProblem = (a) => {
    const f = a.frame || [null, 0];
    if (!Array.isArray(f) || f.length !== 2 || f.some((x) => x != null && !Number.isFinite(+x))) return "window frame";
    const ops = a.ops || [];
    for (const o of ops) if (!WINDOW_RANK_OPS.has(o) && !WINDOW_AGG_OPS.has(o) && !WINDOW_VALUE_OPS.has(o)) return "window op " + o;
    const dflt = f[0] == null && f[1] === 0;
    if (!dflt && ops.some((o) => o === "min" || o === "max") && (f[0] == null || f[1] == null || Math.abs(+f[0]) + Math.abs(+f[1]) + 1 > MAX_SCAN_FRAME)) return "window min or max over an unbounded or wide frame";
    if (vega.array(a.groupby).some((g) => !plainField(vega, g))) return "group-by accessor";
    if (vega.array(a.fields).some((x) => x && !plainField(vega, x))) return "field accessor";
    const prm = vega.array(a.params);
    if (ops.some((o, i) => o === "nth_value" && !(+prm[i] > 0))) return "nth_value";
    return null;
  };
  define("window", {
    kind: "stream",
    consumes: (op) => !!op._argval && windowProblem(op._argval) === null,
    next: (_op, _, rel) => {
      const why = windowProblem(_);
      if (why) throw new Unsupported(why);
      return rel;
    },
    effect: async (op, _, rel) => {
      const pool = rt.pool();
      const table = rel.base.table;
      const n = rel.base.tuples.length;
      const groupby = vega.array(_.groupby).map((g) => plainField(vega, g));
      const ops = _.ops || [];
      const fields = vega.array(_.fields).map((x) => x ? plainField(vega, x) : null);
      const prm = vega.array(_.params);
      const as = _.as || [];
      const groupKeys = [];
      for (const g of groupby) {
        const d = await derivedDictionary(rel, g, pool);
        const view = new Float64Array(new SharedArrayBuffer(8 * Math.max(1, n)));
        const src = "const c = cols[0], out = bufs[0];\nfor (let i = start; i < end; i++) out[i] = c[i];";
        pool.ensureColumn(d.key, "i32", d.view.buffer);
        if (n) await (0, import_resident16.map)({ key: "pv:win:codes", src }, { pool, n, cols: [d.key], bufs: [{ buffer: view.buffer, type: "f64" }] });
        groupKeys.push({ key: `${table.id}:wg:${g}:${++joinCounter}`, view, order: 1 });
      }
      const orderOnly = !_.sort && !!rel.orderCmp;
      const sortK = _.sort ? await sortKeys(rel, _.sort) : rel.orderCmp ? await sortKeys(rel, rel.orderCmp) : [];
      const wops = [];
      for (let i = 0; i < ops.length; i++) {
        const o = ops[i], f = fields[i];
        if (WINDOW_VALUE_OPS.has(o)) {
          if (!f) throw new Unsupported("window value op without field");
          const param = o === "nth_value" ? +prm[i] : +prm[i] || 1;
          const d = rel.derived.get(f);
          if (d) {
            if (d.kind !== "col") throw new Unsupported("window value op on a derived field");
            wops.push({ op: o, param, value: { key: d.col.key, view: d.col.view, tagKey: d.col.tagKey, tag: d.col.tag } });
            continue;
          }
          const c = table.exprColumn(f);
          if (!c || c.kind !== "num") throw new Unsupported("window value op on a non-numeric field");
          wops.push({ op: o, param, value: { key: c.key, view: c.view, tagKey: c.tag ? c.tagKey : null, tag: c.tag || null } });
          continue;
        }
        if (WINDOW_AGG_OPS.has(o) && o !== "count") {
          if (!f) throw new Unsupported("window aggregate without field");
          const c = rel.derived.has(f) ? await derivedNumeric(rel, f, pool) : table.numeric(f);
          if (c.poison) throw new Unsupported("window measure " + f + " with values that are not numbers");
          wops.push({ op: o, measure: { key: c.key, view: c.view } });
        } else wops.push({ op: o });
      }
      const rows = await selectRows(rel, pool);
      const fr = _.frame || [null, 0];
      const frame = [fr[0] == null ? null : +fr[0], fr[1] == null ? null : +fr[1]];
      const outs = await computeWindow(pool, n, rows, groupKeys, sortK, wops, !!_.ignorePeers, orderOnly, frame);
      pool.dropColumns([...groupKeys, ...sortK].map((k) => k.key).filter((k) => k.includes(":wg:") || k.includes(":rank:")));
      if (op._pwWinKeys) pool.dropColumns(op._pwWinKeys);
      op._pwWinKeys = [];
      const id2 = ++joinCounter;
      const derived = new Map(rel.derived);
      ops.forEach((o, i) => {
        const name = as[i] || o + (fields[i] ? "_" + fields[i] : "");
        const key2 = `${table.id}:win${id2}:${i}`;
        pool.ensureColumn(key2, "f64", outs[i].view.buffer);
        pool.ensureColumn(key2 + ":tag", "u8", outs[i].tag.buffer);
        op._pwWinKeys.push(key2, key2 + ":tag");
        derived.delete(name);
        preserveBase(rel, name);
        derived.set(name, { kind: "col", name, env: rel.derived, col: { key: key2, view: outs[i].view, tagKey: key2 + ":tag", tag: outs[i].tag, version: 0 } });
      });
      const r = { ...rel, derived };
      return { ...r, sig: relationSig(r) };
    }
  });
  let lookupVersion = 0;
  const lookupKeys = /* @__PURE__ */ new Map();
  define("lookup", {
    kind: "stream",
    consumes: (op) => {
      const a = op._argval;
      return !!a && !!a.values && vega.array(a.fields).every((f) => !!plainField(vega, f));
    },
    next: (_op, _, rel) => {
      if (!_.values) throw new Unsupported("lookup without values");
      if (!_.index || typeof _.index.get !== "function") throw new Unsupported("lookup index");
      for (const f of vega.array(_.fields)) if (!plainField(vega, f)) throw new Unsupported("lookup key accessor");
      return rel;
    },
    effect: async (_op, _, rel) => {
      const pool = rt.pool();
      const keys = vega.array(_.fields).map((f) => plainField(vega, f));
      const values = vega.array(_.values);
      const n = keys.length, m = values.length;
      let as = _.as;
      if (n > 1 && !as) throw new Unsupported("lookup without as");
      if (as && as.length !== n * m) throw new Unsupported("lookup as");
      as = as || values.map((f) => vega.accessorName(f));
      const dflt = _.default == null ? null : _.default;
      const derived = new Map(rel.derived);
      let k = 0;
      for (let i = 0; i < n; i++) {
        const dict = await derivedDictionary(rel, keys[i], pool);
        pool.ensureColumn(dict.key, "i32", dict.view.buffer);
        const tables = values.map(() => new Array(dict.values.length));
        dict.values.forEach((kv, c) => {
          const u = _.index.get(kv);
          values.forEach((f, j) => {
            tables[j][c] = u == null ? dflt : f(u);
          });
        });
        for (let j = 0; j < m; j++, k++) {
          const name = as[k], table = tables[j];
          for (const x of table) {
            if (!(x == null || typeof x === "number" || typeof x === "string" || typeof x === "boolean" || x instanceof Date)) {
              throw new Unsupported("lookup value that is not a number, string, boolean or date");
            }
          }
          const tk = dict.key + "\0" + JSON.stringify(table.map((x) => x instanceof Date ? { $d: +x } : x === void 0 ? { $u: 1 } : x));
          let version = lookupKeys.get(tk);
          if (version === void 0) {
            if (lookupKeys.size > 4096) lookupKeys.clear();
            version = ++lookupVersion;
            lookupKeys.set(tk, version);
          }
          derived.delete(name);
          preserveBase(rel, name);
          derived.set(name, { kind: "map", name, env: rel.derived, field: keys[i], table, dict: { key: dict.key, view: dict.view }, version });
        }
      }
      const r = { ...rel, derived };
      return { ...r, sig: relationSig(r) };
    }
  });
  define("kde", {
    kind: "sink",
    consumes: (op) => {
      const a = op._argval;
      return !!a && !!plainField(vega, a.field) && vega.array(a.groupby).every((g) => !!plainField(vega, g));
    },
    run: (op, _, rel, pulse) => {
      const field2 = plainField(vega, _.field);
      if (!field2) throw new Unsupported("density field accessor");
      const groupby = vega.array(_.groupby).map((g) => {
        const n = plainField(vega, g);
        if (!n) throw new Unsupported("group-by accessor");
        return n;
      });
      const as = _.as || ["value", "density"];
      const params2 = {
        field: field2,
        groupby,
        method: _.cumulative ? "cdf" : "pdf",
        counts: !!_.counts,
        bandwidth: _.bandwidth || 0,
        extent: _.extent ? [+_.extent[0], +_.extent[1]] : null,
        shared: _.resolve === "shared",
        minsteps: _.steps || _.minsteps || 25,
        maxsteps: _.steps || _.maxsteps || 200,
        as: [as[0], as[1]]
      };
      const sig = rel.sig + "|" + JSON.stringify(params2);
      if (sig === op._pwLastSig) return pulse.StopPropagation;
      const out = pulse.fork(pulse.NO_SOURCE | pulse.NO_FIELDS);
      const k = keepModified(_);
      return computeDensity(vega, rel, rt.pool(), params2).then((rows) => {
        op._pwLastSig = sig;
        const values = rows.map((r) => vega.ingest(r));
        if (op.value) out.rem = op.value;
        op.value = out.add = out.source = values;
        op._pwOut = values;
        return out;
      }, (e) => {
        if (!(e instanceof Unsupported)) throw e;
        op._pwOut = [];
        return op._pwVega(k, pulse, rel, e.message);
      });
    }
  });
  define("extent", {
    kind: "stream",
    consumes: (op) => !!(op._argval && plainField(vega, op._argval.field)),
    next: (_op, _, rel) => {
      if (!plainField(vega, _.field)) throw new Unsupported("extent field");
      return rel;
    },
    effect: (op, _, rel, pulse) => {
      const field2 = plainField(vega, _.field);
      const sig = rel.sig + "|" + field2;
      if (sig === op._pwLastSig) return;
      return aggregateParams(rel, [], ["min", "max"], [field2, field2], ["min", "max"]).then((params2) => runAggregate(rt.pool(), rel.base.table, params2, op._pwScratch || (op._pwScratch = {}), void 0, null)).then((rows) => {
        let min = rows.length ? rows[0].min : void 0, max = rows.length ? rows[0].max : void 0;
        if (!Number.isFinite(min) || !Number.isFinite(max)) {
          if (rows.length || rel.base.tuples.length) pulse.dataflow.warn(`Infinite extent for field "${field2}": [${min ?? Infinity}, ${max ?? -Infinity}]`);
          min = max = void 0;
        }
        op._pwLastSig = sig;
        op.value = [min, max];
      });
    }
  });
  {
    const Orig = vega.transforms.sieve;
    define("sieve", {
      kind: "stream",
      valueIsTuples: true,
      // Only a sieve that no operator reads, neither as pulse nor as value.
      consumes: (op) => op.targets().length === 0,
      next: (_op, _, rel) => rel
    });
    const P = replaced.sieve;
    const t = P.prototype.transform;
    P.prototype.transform = function(_, pulse) {
      if (isParallel(this.source) && this.source._pwLazy) {
        const r = t.call(this, _, pulse);
        const rel = this._pwRel;
        let cache = null;
        const tuples = () => cache || (cache = withRoot(materializeSync(rel, rt.pool(), vega), rel));
        Object.defineProperty(this, "value", {
          configurable: true,
          enumerable: true,
          get: tuples,
          set: (v) => {
            delete this.value;
            this.value = v;
          }
        });
        if (r && r !== pulse.StopPropagation) for (const f of ["source", "add"]) {
          Object.defineProperty(r, f, {
            configurable: true,
            enumerable: true,
            get: () => {
              if (pulse.dataflow._clock !== r.stamp) return f === "add" ? [] : null;
              const v = tuples();
              return f === "add" ? v.slice() : v;
            },
            set: (v) => {
              Object.defineProperty(r, f, { value: v, writable: true, configurable: true, enumerable: true });
            }
          });
        }
        return r;
      }
      if (Object.getOwnPropertyDescriptor(this, "value")?.get) delete this.value;
      return Orig.prototype.transform.call(this, _, pulse);
    };
  }
  return { originals, replaced };
}
function recordExpressionSource(vega) {
  const ctx = vega.runtimeContext(new vega.Dataflow(), vega.transforms, {});
  const proto = Object.getPrototypeOf(ctx);
  const orig = proto.parameterExpression;
  if (orig.$pwPatched) return () => {
  };
  const patched = function(expr) {
    const fn = orig.call(this, expr);
    try {
      fn[CODE] = expr.code;
    } catch {
    }
    return fn;
  };
  patched.$pwPatched = true;
  proto.parameterExpression = patched;
  const cg = ctx.expr && ctx.expr.codegen;
  const origCmp = cg && cg.comparator;
  if (cg && origCmp && !origCmp.$pwPatched) {
    const cmp = function(fields, orders) {
      const fn = origCmp.call(this, fields, orders);
      try {
        fn[SORT] = { paths: fields.map((f) => f && f.path || null), orders: orders.slice(0, fields.length) };
      } catch {
      }
      return fn;
    };
    cmp.$pwPatched = true;
    cg.comparator = cmp;
  }
  return () => {
    proto.parameterExpression = orig;
    if (cg && origCmp) cg.comparator = origCmp;
  };
}

// src/runtime/farm.ts
function uniqueList(id2) {
  const list = [];
  const ids = {};
  list.add = (x) => {
    const k = id2(x);
    if (!ids[k]) {
      ids[k] = 1;
      list.push(x);
    }
    return list;
  };
  list.remove = (x) => {
    const k = id2(x);
    if (ids[k]) {
      ids[k] = 0;
      const i = list.indexOf(x);
      if (i >= 0) list.splice(i, 1);
    }
    return list;
  };
  return list;
}
async function asyncCallback(df, cb) {
  try {
    await cb.call(df, df);
  } catch (err) {
    df.error(err);
  }
}
function upstream(op, visit) {
  const src = op.source;
  if (src) {
    if (Array.isArray(src)) {
      for (const x of src) if (visit(x)) return true;
    } else if (visit(src)) return true;
  }
  const argops = op._argops;
  if (argops) {
    for (const a of argops) if (visit(a.op)) return true;
  }
  return false;
}
function installFarm(vega, onStats, concurrent = true) {
  const proto = vega.Dataflow.prototype;
  const original = proto.evaluate;
  if (original.$pwFarm) return () => {
  };
  const Pulse = vega.Pulse;
  const id2 = vega.id;
  const evaluate = async function(encode, prerun, postrun) {
    const df = this;
    const async = [];
    if (df._pulse) {
      df.error("Dataflow already running. Use runAsync() to chain invocations.");
      return df;
    }
    if (df._pending) await df._pending;
    if (prerun) await asyncCallback(df, prerun);
    if (!df._touched.length) {
      df.debug("Dataflow invoked, but nothing to do.");
      return df;
    }
    const stamp = ++df._clock;
    df._pulse = new Pulse(df, stamp, encode);
    const Stop = df._pulse.StopPropagation;
    df._touched.forEach((op) => df._enqueue(op, true));
    df._touched = uniqueList(id2);
    let count = 0;
    let error2 = null;
    let maxConcurrent = 0;
    const pending = /* @__PURE__ */ new Map();
    const held = [];
    const heldSet = /* @__PURE__ */ new Set();
    let memo = /* @__PURE__ */ new Map();
    const blocked = (op) => {
      let b = memo.get(op);
      if (b !== void 0) return b;
      memo.set(op, false);
      b = upstream(op, (x) => pending.has(x) || heldSet.has(x) || blocked(x));
      memo.set(op, b);
      return b;
    };
    const finish = (op, next) => {
      if (next !== Stop && op._targets) op._targets.forEach((t) => df._enqueue(t));
      ++count;
    };
    try {
      for (; ; ) {
        while (!error2 && df._heap.size() > 0) {
          const op = df._heap.pop();
          if (op.rank !== op.qrank) {
            df._enqueue(op, true);
            continue;
          }
          if ((pending.size || held.length) && (!concurrent || !op._pwParallel || blocked(op))) {
            held.push(op);
            heldSet.add(op);
            memo.set(op, true);
            continue;
          }
          let next = op.run(df._getPulse(op, encode));
          if (next.then) {
            const done = next.then(
              (r) => {
                pending.delete(op);
                finish(op, r);
              },
              (err) => {
                pending.delete(op);
                if (!error2) error2 = { err };
              }
            );
            pending.set(op, done);
            memo.set(op, true);
            if (pending.size > maxConcurrent) maxConcurrent = pending.size;
            continue;
          }
          if (next.async) {
            async.push(next.async);
            next = Stop;
          }
          finish(op, next);
        }
        if (!pending.size) break;
        await Promise.race(pending.values());
        if (error2) {
          await Promise.all(pending.values());
          break;
        }
        for (const op of held) df._heap.push(op);
        held.length = 0;
        heldSet.clear();
        memo = /* @__PURE__ */ new Map();
      }
    } catch (err) {
      if (!error2) error2 = { err };
      await Promise.all(pending.values());
    }
    if (error2) df._heap.clear();
    df._input = {};
    df._pulse = null;
    df.debug(`Pulse ${stamp}: ${count} operators`);
    if (onStats) onStats({ maxConcurrent });
    if (error2) {
      df._postrun = [];
      df.error(error2.err);
    }
    if (df._postrun.length) {
      const pr = df._postrun.sort((a, b) => b.priority - a.priority);
      df._postrun = [];
      const outer = df._pwNested;
      df._pwNested = [];
      try {
        for (let i = 0; i < pr.length; ++i) {
          await asyncCallback(df, pr[i].callback);
          while (df._pwNested.length) await df._pwNested.shift();
        }
      } finally {
        df._pwNested = outer;
      }
    }
    if (postrun) await asyncCallback(df, postrun);
    if (async.length) {
      Promise.all(async).then((cb) => df.runAsync(null, () => {
        cb.forEach((f) => {
          try {
            f(df);
          } catch (err) {
            df.error(err);
          }
        });
      }));
    }
    return df;
  };
  const entry = function(...args) {
    const parent = this._pwNested;
    const p = evaluate.apply(this, args);
    if (parent) parent.push(p.catch(() => {
    }));
    return p;
  };
  entry.$pwFarm = true;
  proto.evaluate = entry;
  return () => {
    if (proto.evaluate === entry) proto.evaluate = original;
  };
}

// src/runtime/dense.ts
var import_resident17 = __toESM(require_resident());
var ENC = "$pwenc";
var VISUAL = /* @__PURE__ */ new Set([
  "x",
  "y",
  "size",
  "shape",
  "angle",
  "fill",
  "stroke",
  "opacity",
  "fillOpacity",
  "strokeOpacity",
  "strokeWidth",
  "strokeDash",
  "strokeDashOffset",
  "strokeCap",
  "strokeJoin",
  "strokeMiterLimit",
  "blend"
]);
var NONVISUAL = /* @__PURE__ */ new Set(["description", "ariaRoleDescription", "aria", "ariaRole", "tooltip", "href", "cursor"]);
var SETS = /* @__PURE__ */ new Set(["enter", "update", "exit"]);
var SCALE_PROPS = ["clamp", "unknown", "padding", "paddingInner", "paddingOuter", "align", "round", "base", "exponent", "constant"];
function resetPaint(g) {
  g.globalAlpha = 1;
  g.globalCompositeOperation = "source-over";
  if ("filter" in g) g.filter = "none";
  g.shadowColor = "rgba(0,0,0,0)";
}
var MAX_STRIPES = 8;
function stripeCuts(Y1, Y2, m, S, H, s, off) {
  const step = Math.max(1, Math.floor(m / 65536));
  const ys = [];
  for (let j = 0; j < m; j += step) {
    const c = (Y1[j] + Y2[j]) / 2 * s + off;
    if (c === c) ys.push(c);
  }
  ys.sort((a, b) => a - b);
  const cuts = [0];
  for (let q = 1; q < S; q++) {
    const v = ys.length ? Math.round(ys[Math.min(ys.length - 1, Math.floor(q * ys.length / S))]) : Math.round(q * H / S);
    cuts.push(Math.min(H, Math.max(cuts[q - 1], v)));
  }
  cuts.push(H);
  return cuts;
}
async function orderedRows(st, rel, pool) {
  const rc = new RowCode(rel, pool);
  const cond = predicateCode(rc, rel.preds);
  const prelude = rc.prelude();
  const d = await (0, import_resident17.filter)({ key: kernelKey("pv:sel:", prelude, cond), prelude, cond }, st.state, { pool, cols: rc.cols, args: { P: rc.P } });
  if (!d.add.length && !d.rem.length) return st.order;
  const m = st.state.selected;
  const out = new Int32Array(new SharedArrayBuffer(4 * Math.max(1, m)));
  let w = 0;
  if (d.rem.length) {
    const mask = st.state.mask;
    for (let j = 0; j < st.order.length; j++) {
      const r = st.order[j];
      if (mask[r]) out[w++] = r;
    }
  } else {
    out.set(st.order);
    w = st.order.length;
  }
  out.set(d.add, w);
  st.order = out.subarray(0, m);
  return st.order;
}
var frac = (v) => {
  const f = v - Math.floor(v);
  return f > 1 - 1e-9 ? 0 : f;
};
function changesetPulse(pulse, ch, source) {
  const p = pulse.fork(pulse.NO_FIELDS | (source ? pulse.NO_SOURCE : 0));
  p.add = ch.add;
  p.rem = ch.rem;
  p.mod = ch.mod;
  if (source) p.source = source;
  if (ch.fields.length) p.modifies(ch.fields);
  return p;
}
var MOD_CACHE2 = "_:mod:_";
function keepModified2(_) {
  const s = Object.create(_);
  Object.defineProperty(s, MOD_CACHE2, { value: _[MOD_CACHE2], writable: true });
  return s;
}
function scaleDescriptor(s) {
  const props = [];
  for (const k of SCALE_PROPS) {
    if (typeof s[k] !== "function") continue;
    const v = s[k]();
    if (typeof v === "symbol" || typeof v === "function" || !cloneable(v)) continue;
    props.push([k, v]);
  }
  const domain = s.domain(), range = s.range();
  if (!cloneable(domain) || !cloneable(range)) throw new Unsupported("scale " + s.type + " (domain or range)");
  return { type: s.type, domain, range, props };
}
var sameValue = (a, b) => a === b || a !== a && b !== b || a instanceof Date && b instanceof Date && +a === +b;
function validateScale(vega, s, desc) {
  let r;
  try {
    r = rebuildScale(vega.scale, desc);
  } catch {
    throw new Unsupported("scale " + desc.type);
  }
  const d = desc.domain;
  const samples = [];
  const num = (v) => typeof v === "number" || v instanceof Date;
  if (d.length >= 2 && d.every(num) && typeof s.invert === "function") {
    const lo = +d[0], hi = +d[d.length - 1];
    const date = d[0] instanceof Date;
    for (let k = 0; k <= 40; k++) {
      const v = lo + (hi - lo) * (k / 40 * 1.2 - 0.1);
      samples.push(date ? new Date(v) : v);
    }
    for (const v of d) samples.push(v);
  } else {
    for (const v of d) samples.push(v);
  }
  for (const v of samples) if (!sameValue(s(v), r(v))) throw new Unsupported("scale " + desc.type + " (outputs differ)");
}
function defineDense(vega, rt, opts) {
  const T = vega.transforms;
  const OrigDataJoin = T.datajoin, OrigEncode = T.encode, OrigBound = T.bound;
  const OrigMark = T.mark, OrigCollect = T.collect;
  const symbol = vega.Marks.symbol;
  const origDraw = symbol.draw, origPick = symbol.pick;
  const isParallel = (op) => !!(op && op._pwParallel);
  const infoCache2 = /* @__PURE__ */ new Map();
  const analyzeCached2 = (code) => {
    let i = infoCache2.get(code);
    if (!i) {
      i = analyze(code);
      infoCache2.set(code, i);
    }
    return i;
  };
  const validated = /* @__PURE__ */ new Set();
  function staticInfo(dj) {
    if (dj._pwStatic !== void 0) return dj._pwStatic;
    const find = (op, C) => (op._targets || []).find((x) => x.source === op && x instanceof C);
    let s = null;
    const collect = find(dj, OrigCollect);
    const mark = collect && find(collect, OrigMark);
    const encode = mark && find(mark, OrigEncode);
    const def = mark && mark._argval && mark._argval.markdef;
    const ok = encode && def && def.marktype === "symbol" && !(dj._argval && dj._argval.key) && !(collect._argval && collect._argval.sort) && (dj._targets || []).length === 1;
    if (ok) {
      const encoders = encode._argval.encoders || {};
      const merged = /* @__PURE__ */ new Map();
      let good = Object.keys(encoders).every((k) => SETS.has(k));
      for (const set of ["enter", "update"]) {
        const e = encoders[set];
        if (!e) continue;
        const rec = e[ENC];
        if (!rec || rec.marktype !== "symbol") {
          good = false;
          break;
        }
        for (const [name, code] of Object.entries(rec.channels)) {
          if (NONVISUAL.has(name)) continue;
          if (!VISUAL.has(name)) {
            good = false;
            break;
          }
          merged.set(name, code);
        }
      }
      if (good) {
        const channels = [...merged].map(([n, c]) => [n, analyzeCached2(c)]);
        if (channels.every(([, i]) => !i.unsupported)) {
          const params2 = [...new Set(channels.flatMap(([, i]) => i.params))];
          s = { collect, mark, encode, channels, params: params2 };
        }
      }
    }
    dj._pwStatic = s;
    return s;
  }
  function DataJoin(params2) {
    OrigDataJoin.call(this, params2);
    this._pwDenseRel = null;
    this._pwFallback = false;
    this._pwInMat = null;
    this._pwBase = null;
  }
  vega.inherits(DataJoin, OrigDataJoin, {
    _pwParallel: true,
    _pwLazy: false,
    _pwConsumes() {
      return !this._pwFallback && !!staticInfo(this);
    },
    _pwRelation() {
      return null;
    },
    transform(_, pulse) {
      const src = this.source;
      let rel = null;
      if (isParallel(src)) {
        rel = src._pwRelation();
      } else if (Array.isArray(pulse.source) && pulse.source.length >= opts.minRows && src && src.value === pulse.source) {
        if (this._pwBaseSrc !== pulse.source || pulse.changed()) {
          if (this._pwBase) this._pwBase.table.dispose(rt.pool());
          this._pwBase = makeBase(pulse.source.slice(), pulse.source);
          this._pwBaseSrc = pulse.source;
        }
        rel = baseRelation(this._pwBase);
      }
      const df = pulse.dataflow;
      const dense = !!rel && !this._pwFallback && !!staticInfo(this) && rel.base.tuples.length >= opts.minRows && df._renderType !== "svg" && !rel.orderCmp;
      if (dense) {
        const out = pulse.fork(pulse.NO_SOURCE | pulse.NO_FIELDS);
        if (this.value) {
          const rem = [];
          this.value.forEach((x) => {
            if (!x.exit) rem.push(x);
          });
          out.rem = rem;
          this.value = null;
        }
        this._pwInMat = null;
        this._pwDenseRel = rel;
        return out;
      }
      this._pwDenseRel = null;
      if (rel && isParallel(src) && src._pwLazy) {
        const mat = this._pwInMat || (this._pwInMat = new Materializer(vega));
        const k = keepModified2(_);
        return mat.update(rel, rt.pool()).then((ch) => OrigDataJoin.prototype.transform.call(this, k, changesetPulse(pulse, ch, ch.source())));
      }
      return OrigDataJoin.prototype.transform.call(this, _, pulse);
    }
  });
  function fallback(dj, df, reason) {
    dj._pwFallback = true;
    dj._pwDenseRel = null;
    if (opts.onFallback) opts.onFallback("mark", reason);
    df.touch(dj);
    df.runAfter((v) => {
      v.runAsync();
    });
  }
  function dirty(df, scene, b) {
    if (b && b.x1 <= b.x2 && b.y1 <= b.y2) df.dirty({ bounds: b, mark: scene });
  }
  function clearDense(df, scene) {
    const d = scene && scene._pwDense;
    if (!d) return;
    dirty(df, scene, d.bounds);
    if (d.stripes) {
      for (const [, b] of d.stripes) if (b && b.close) b.close();
    }
    scene._pwDense = null;
  }
  function Encode(params2) {
    OrigEncode.call(this, params2);
    this._pwDJ = void 0;
    this._pwLastSig = null;
    this._pwBufs = null;
  }
  vega.inherits(Encode, OrigEncode, {
    transform(_, pulse) {
      if (this._pwDJ === void 0) {
        const mark = this.source, collect = mark && mark.source, dj2 = collect && collect.source;
        this._pwDJ = dj2 instanceof DataJoin && staticInfo(dj2) && staticInfo(dj2).encode === this ? dj2 : null;
      }
      const dj = this._pwDJ;
      const scene = this.source && this.source.value;
      if (!dj || !dj._pwDenseRel) {
        if (scene && scene._pwDense) {
          clearDense(pulse.dataflow, scene);
          this._pwLastSig = null;
        }
        this._pwOrder = null;
        return OrigEncode.prototype.transform.call(this, _, pulse);
      }
      const enc = pulse.encode;
      if (enc && enc !== "enter" && enc !== "update" && !Array.isArray(enc)) return pulse.StopPropagation;
      let job;
      try {
        job = this._pwDense(_, dj, scene, pulse);
      } catch (e) {
        if (!(e instanceof Unsupported)) throw e;
        fallback(dj, pulse.dataflow, e.message);
        return pulse.StopPropagation;
      }
      if (!job) return pulse.StopPropagation;
      return job.then(() => pulse.fork(pulse.NO_SOURCE | pulse.NO_FIELDS), (e) => {
        if (!(e instanceof Unsupported)) throw e;
        fallback(dj, pulse.dataflow, e.message);
        return pulse.StopPropagation;
      });
    },
    _pwDense(_, dj, scene, pulse) {
      const info = staticInfo(dj);
      const rel = dj._pwDenseRel;
      const df = pulse.dataflow;
      const pool = rt.pool();
      const r = df._renderer;
      const g = df._renderType === "canvas" && r && r.context ? r.context() : null;
      const s = g && g.pixelRatio || 1;
      const P = {};
      const scaleKeys = [];
      for (const k of info.params) {
        const v = _[k];
        if (k[0] === "%" && typeof v === "function") {
          const desc = scaleDescriptor(v);
          const dk = JSON.stringify(desc);
          if (!validated.has(dk)) {
            validateScale(vega, v, desc);
            validated.add(dk);
          }
          P[k] = desc;
          scaleKeys.push(k);
        } else {
          if (!cloneable(v)) throw new Unsupported("encode parameter " + k);
          P[k] = v;
        }
      }
      const raster = !!g;
      let fx = 0, fy = 0;
      if (raster) {
        if (scene._pwFrac) [fx, fy] = scene._pwFrac;
        else {
          const o = r._origin || [0, 0];
          let ox = o[0], oy = o[1];
          for (let gi = scene.group; gi; gi = gi.mark && gi.mark.group) {
            ox += gi.x || 0;
            oy += gi.y || 0;
          }
          fx = frac(ox * s);
          fy = frac(oy * s);
        }
      }
      const sig = rel.sig + "|" + JSON.stringify(P) + "|" + s + "|" + raster + "|" + fx + "|" + fy;
      if (sig === this._pwLastSig && scene._pwDense) return null;
      const rc = new RowCode(rel, pool);
      const lines = info.channels.map(([name, ci]) => `o[${JSON.stringify(name)}] = ${rc.expr(ci, P)};`);
      const checkPaint = info.channels.some(([n]) => n === "fill" || n === "stroke") ? `if ((o.fill !== null && typeof o.fill === "object") || (o.stroke !== null && typeof o.stroke === "object")) return 1;` : "";
      const prelude = `${rc.prelude()}
const L = globalThis.__pwvt, M = L.symbol;
for (const k of args.SK) P[k] = L.scale(P[k]);
const o = {}, scene = { items: [o] };
function enc(i) {
${lines.join("\n")}
${checkPaint}
return 0;
}`;
      return (async () => {
        const t03 = performance.now();
        let st = this._pwOrder;
        if (!st || st.base !== rel.base) {
          st = this._pwOrder = { base: rel.base, state: new import_resident9.FilterState(rel.base.tuples.length), order: new Int32Array(0) };
        }
        const rows = await orderedRows(st, rel, pool);
        const t12 = performance.now();
        const m = rows.length;
        let bufs = this._pwBufs;
        if (!bufs || bufs.cap < m) {
          const cap = Math.max(m, 1024);
          const f = () => new Float64Array(new SharedArrayBuffer(8 * cap));
          bufs = this._pwBufs = { cap, X1: f(), Y1: f(), X2: f(), Y2: f() };
        }
        const sb2 = (a, type) => ({ buffer: a.buffer, type });
        const MAXV = Number.MAX_VALUE;
        const boundSrc = `${prelude}
const R = bufs[0], X1 = bufs[1], Y1 = bufs[2], X2 = bufs[3], Y2 = bufs[4], B = new L.Bounds();
let x1 = ${MAXV}, y1 = ${MAXV}, x2 = -${MAXV}, y2 = -${MAXV};
for (let j = start; j < end; j++) {
  if (enc(R[j])) return null;
  M.bound(B.clear(), o);
  X1[j] = B.x1; Y1[j] = B.y1; X2[j] = B.x2; Y2[j] = B.y2;
  if (B.x1 < x1) x1 = B.x1; if (B.y1 < y1) y1 = B.y1; if (B.x2 > x2) x2 = B.x2; if (B.y2 > y2) y2 = B.y2;
}
return [x1, y1, x2, y2];`;
        const common = { pool, cols: rc.cols, args: { P: rc.P, SK: scaleKeys } };
        const parts = m ? (await (0, import_resident17.map)({ key: kernelKey("pv:dense:b:", boundSrc), src: boundSrc }, {
          ...common,
          n: m,
          bufs: [sb2(rows, "i32"), sb2(bufs.X1, "f64"), sb2(bufs.Y1, "f64"), sb2(bufs.X2, "f64"), sb2(bufs.Y2, "f64")]
        })).flat() : [];
        if (parts.some((p) => p === null)) throw new Unsupported("gradient paint");
        const t2 = performance.now();
        const b = { x1: MAXV, y1: MAXV, x2: -MAXV, y2: -MAXV };
        for (const p of parts) {
          if (p[0] < b.x1) b.x1 = p[0];
          if (p[1] < b.y1) b.y1 = p[1];
          if (p[2] > b.x2) b.x2 = p[2];
          if (p[3] > b.y2) b.y2 = p[3];
        }
        let stripes = null;
        let X0 = 0, Y0 = 0;
        if (raster && m && b.x1 <= b.x2 && b.y1 <= b.y2) {
          const LIM = 16384;
          X0 = Math.max(Math.floor(b.x1 * s + fx), -LIM);
          Y0 = Math.max(Math.floor(b.y1 * s + fy), -LIM);
          const W = Math.min(Math.ceil(b.x2 * s + fx), LIM) - X0, H = Math.min(Math.ceil(b.y2 * s + fy), LIM) - Y0;
          if (W > 0 && H > 0) {
            const S = Math.min(pool.size, MAX_STRIPES, H);
            const cuts = stripeCuts(bufs.Y1, bufs.Y2, m, S, H, s, fy - Y0);
            const drawSrc = `${prelude}
if (typeof OffscreenCanvas === "undefined") return null;
const R = bufs[0], Y1 = bufs[1], Y2 = bufs[2], s = args.s, out = [];
for (let q = start; q < end; q++) {
  const t0 = args.cuts[q], t1 = args.cuts[q + 1];
  if (t1 <= t0) continue;
  // Software rasterization: GPU-backed canvases of all workers are drawn one after the other by the GPU process.
  const cv = new OffscreenCanvas(args.W, t1 - t0), g = cv.getContext("2d", { willReadFrequently: true });
  g.pixelRatio = s;
  g.setTransform(s, 0, 0, s, args.fx - args.X0, args.fy - (args.Y0 + t0));
  const lo = (args.Y0 + t0 - args.fy) / s, hi = (args.Y0 + t1 - args.fy) / s;
  for (let j = 0; j < args.m; j++) {
    if (!(Y2[j] >= lo && Y1[j] <= hi)) continue;
    enc(R[j]);
    M.draw(g, scene, null);
  }
  out.push([t0, cv.transferToImageBitmap()]);
}
return out;`;
            const res = await (0, import_resident17.map)({ key: kernelKey("pv:dense:d:", drawSrc), src: drawSrc }, {
              ...common,
              n: S,
              threads: S,
              bufs: [sb2(rows, "i32"), sb2(bufs.Y1, "f64"), sb2(bufs.Y2, "f64")],
              args: { ...common.args, s, X0, Y0, fx, fy, W, cuts, m }
            });
            const flat = res.flat();
            if (flat.every((x) => x !== null)) stripes = flat.flat();
          }
        }
        const t3 = performance.now();
        clearDense(df, scene);
        const d = {
          ms: { rows: t12 - t03, bound: t2 - t12, draw: t3 - t2 },
          rows,
          m,
          X1: bufs.X1,
          Y1: bufs.Y1,
          X2: bufs.X2,
          Y2: bufs.Y2,
          bounds: b,
          X0,
          Y0,
          s,
          fx,
          fy,
          stripes,
          rel,
          encode: this,
          df,
          tuples: /* @__PURE__ */ new Map()
        };
        scene._pwDense = d;
        this._pwLastSig = sig;
      })();
    }
  });
  function Bound(params2) {
    OrigBound.call(this, params2);
  }
  vega.inherits(Bound, OrigBound, {
    transform(_, pulse) {
      const out = OrigBound.prototype.transform.call(this, _, pulse);
      const mark = _.mark, d = mark && mark._pwDense;
      if (d && out && out !== pulse.StopPropagation) {
        mark.bounds.clear().union(d.bounds);
        const clip = mark.clip;
        if (clip && typeof clip !== "function") mark.bounds.intersect(new vega.Bounds().set(0, 0, mark.group.width, mark.group.height));
        out.mod = [{ mark, bounds: new vega.Bounds().union(mark.bounds), _pwPlaceholder: true }];
      }
      return out;
    }
  });
  symbol.draw = function(context, scene, bounds) {
    const d = scene._pwDense;
    if (!d) return origDraw.call(this, context, scene, bounds);
    if (!d.stripes) return;
    const tr = context.getTransform ? context.getTransform() : null;
    const s = d.s;
    if (tr && tr.a === s && tr.d === s && tr.b === 0 && tr.c === 0 && Math.abs(frac(tr.e) - d.fx) < 1e-6 && Math.abs(frac(tr.f) - d.fy) < 1e-6) {
      const ox = Math.round(tr.e - d.fx) + d.X0, oy = Math.round(tr.f - d.fy) + d.Y0;
      context.save();
      resetPaint(context);
      context.setTransform(1, 0, 0, 1, 0, 0);
      for (const [t03, bmp] of d.stripes) context.drawImage(bmp, ox, oy + t03);
      context.restore();
      return;
    }
    context.save();
    resetPaint(context);
    for (const [t03, bmp] of d.stripes) {
      context.drawImage(bmp, (d.X0 - d.fx) / s, (d.Y0 + t03 - d.fy) / s, bmp.width / s, bmp.height / s);
    }
    context.restore();
    if (tr && tr.a === s && tr.d === s && tr.b === 0 && tr.c === 0 && !d.rerequested && context === d.df._renderer?.context()) {
      d.rerequested = true;
      scene._pwFrac = [frac(tr.e), frac(tr.f)];
      setTimeout(() => {
        d.df.touch(d.encode);
        d.df.runAsync();
      }, 0);
    }
  };
  function itemOf(scene, d, j) {
    const i = d.rows[j];
    let t = d.tuples.get(i);
    if (!t) {
      t = d.rel.base.tuples[i];
      if (d.rel.derive) {
        const c = vega.ingest({});
        for (const k in t) c[k] = t[k];
        t = c;
      }
      {
        const ev = mainEvaluator(d.rel);
        for (const dv of d.rel.derived.values()) t[dv.name] = ev(dv, t, i);
      }
      if (d.tuples.size > 256) d.tuples.clear();
      d.tuples.set(i, t);
    }
    const item = { mark: scene, datum: t, bounds: new vega.Bounds() };
    const _ = d.encode._argval, encoders = _.encoders;
    if (encoders.enter) encoders.enter(item, _);
    if (encoders.update) encoders.update(item, _);
    symbol.bound(item.bounds, item);
    return item;
  }
  symbol.pick = function(context, scene, x, y, gx, gy) {
    const d = scene._pwDense;
    if (!d) return origPick.call(this, context, scene, x, y, gx, gy);
    const { X1, Y1, X2, Y2 } = d;
    for (let j = d.m - 1; j >= 0; j--) {
      if (!(X1[j] <= gx && gx <= X2[j] && Y1[j] <= gy && gy <= Y2[j])) continue;
      const item = itemOf(scene, d, j);
      const hit = origPick.call(this, context, { items: [item], marktype: "symbol" }, x, y, gx, gy);
      if (hit) return hit;
    }
    return null;
  };
  const replaced = { datajoin: DataJoin, encode: Encode, bound: Bound };
  const originals = { datajoin: OrigDataJoin, encode: OrigEncode, bound: OrigBound };
  const restore = () => {
    symbol.draw = origDraw;
    symbol.pick = origPick;
  };
  return { replaced, originals, restore };
}
function recordEncoderSource(vega) {
  const ctx = vega.runtimeContext(new vega.Dataflow(), vega.transforms, {});
  const proto = Object.getPrototypeOf(ctx);
  const orig = proto.encodeExpression;
  if (orig.$pwPatched) return () => {
  };
  const patched = function(encode) {
    const fn = orig.call(this, encode);
    try {
      const channels = {};
      for (const name in encode.channels) channels[name] = encode.channels[name].code;
      fn[ENC] = { marktype: encode.marktype, channels };
    } catch {
    }
    return fn;
  };
  patched.$pwPatched = true;
  proto.encodeExpression = patched;
  return () => {
    proto.encodeExpression = orig;
  };
}

// src/index.ts
function isNode() {
  const p = globalThis.process;
  return !!(p && p.versions && p.versions.node) && typeof globalThis.window === "undefined";
}
function registerParaweb(vega, options = {}) {
  if (typeof SharedArrayBuffer === "undefined") {
    console.warn(
      "paraweb-vega: SharedArrayBuffer is unavailable, so Vega runs unchanged; serve the page with Cross-Origin-Opener-Policy: same-origin and Cross-Origin-Embedder-Policy: require-corp to run it in parallel."
    );
    const none = () => {
      throw new Error("paraweb-vega is inactive (no SharedArrayBuffer)");
    };
    return {
      get pool() {
        return none();
      },
      ready: Promise.resolve(),
      gpu: false,
      active: false,
      registerTable: none,
      unregisterTable() {
      },
      terminate() {
      }
    };
  }
  let pool = null;
  const tables = /* @__PURE__ */ new Map();
  const getPool = () => {
    if (!pool) {
      const factory = options.workerFactory ?? (isNode() ? (0, import_resident.nodeWorkerFactory)() : (0, import_resident.browserWorkerFactory)());
      pool = new import_resident.ResidentPool(options.threads ?? (0, import_resident.defaultThreads)(), factory);
      installWorkerLibrary(pool, vega.version);
    }
    return pool;
  };
  let gpu = null;
  const ready = options.gpu ? GpuBackend.create().then((g) => {
    gpu = g;
  }, (err) => {
    console.warn("paraweb-vega: WebGPU unavailable, using workers:", err && err.message || err);
  }) : Promise.resolve();
  const rt = {
    pool: getPool,
    gpu: () => gpu,
    table: (name) => tables.get(name),
    preagg: options.preaggregate ?? false,
    onBuild: options.onPreaggBuild,
    onStats: options.onStats
  };
  vega.transforms["pwaggregate"] = definePwAggregate(vega, rt);
  vega.transforms["pwfilter"] = definePwFilter(vega, rt);
  let restore = null;
  if (options.operators ?? true) {
    const unpatch = recordExpressionSource(vega);
    const { originals, replaced } = defineOperators(vega, rt, {
      minRows: options.minRows ?? 1e4,
      onFallback: options.onFallback
    });
    Object.assign(vega.transforms, replaced);
    restore = () => {
      Object.assign(vega.transforms, originals);
      unpatch();
    };
    const denseMin = options.denseMarks ?? 2e4;
    if (denseMin !== false) {
      const unrecord = recordEncoderSource(vega);
      const dense = defineDense(vega, rt, { minRows: denseMin, onFallback: options.onFallback });
      Object.assign(vega.transforms, dense.replaced);
      const prev = restore;
      restore = () => {
        Object.assign(vega.transforms, dense.originals);
        dense.restore();
        unrecord();
        prev();
      };
    }
  }
  {
    const unfarm = installFarm(vega, options.onFarmStats, options.farm ?? true);
    const prev = restore;
    restore = () => {
      if (prev) prev();
      unfarm();
    };
  }
  return {
    get pool() {
      return getPool();
    },
    ready,
    get gpu() {
      return gpu !== null;
    },
    registerTable(name, columns) {
      const t = columns instanceof ColumnTable ? columns : ColumnTable.fromColumns(columns);
      const old = tables.get(name);
      if (old && old !== t) old.dispose(pool);
      tables.set(name, t);
      return t;
    },
    unregisterTable(name) {
      const old = tables.get(name);
      if (old) old.dispose(pool);
      tables.delete(name);
    },
    terminate() {
      if (restore) {
        restore();
        restore = null;
      }
      if (pool) pool.terminate();
      pool = null;
      if (gpu) gpu.destroy();
      gpu = null;
    }
  };
}
var export_FilterState = import_resident9.FilterState;
var export_Priority = import_resident.Priority;
var export_WorkerPool = import_resident.ResidentPool;
var export_browserWorkerFactory = import_resident.browserWorkerFactory;
var export_defaultThreads = import_resident.defaultThreads;
var export_inlineWorkerFactory = import_resident.inlineWorkerFactory;
var export_nodeWorkerFactory = import_resident.nodeWorkerFactory;
export {
  ColumnTable,
  export_FilterState as FilterState,
  GpuBackend,
  export_Priority as Priority,
  SUPPORTED_OPS,
  export_WorkerPool as WorkerPool,
  answerPreagg,
  export_browserWorkerFactory as browserWorkerFactory,
  bucketOf,
  buildConfig,
  buildPreagg,
  export_defaultThreads as defaultThreads,
  generateKernelSource,
  gpuEligible,
  export_inlineWorkerFactory as inlineWorkerFactory,
  export_nodeWorkerFactory as nodeWorkerFactory,
  registerParaweb,
  resolveBin,
  runAggregate,
  runFilter
};
//# sourceMappingURL=paraweb-vega.mjs.map
