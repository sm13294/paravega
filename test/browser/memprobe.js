// Diagnostic: does performance.measureUserAgentSpecificMemory count a
// SharedArrayBuffer once, or once per worker that holds it? One 400 MB SAB,
// shared with 0, 1, 4 and 16 workers that each keep a Float64Array view.
const MB = 1048576;
const sab = new SharedArrayBuffer(400 * MB);
new Float64Array(sab).fill(1);
const src = `let keep; self.onmessage = e => { keep = new Float64Array(e.data); let s = 0; for (let i = 0; i < keep.length; i += 4096) s += keep[i]; postMessage(s); };`;
const url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
const workers = [];
const out = [];
const measure = async label => {
  const m = await performance.measureUserAgentSpecificMemory();
  out.push({ label, mb: Math.round(m.bytes / MB) });
  console.log(label, Math.round(m.bytes / MB), "MB");
};
await measure("main only");
for (const n of [1, 4, 16]) {
  while (workers.length < n) {
    const w = new Worker(url);
    await new Promise(r => { w.onmessage = r; w.postMessage(sab); });
    workers.push(w);
  }
  await measure(`${n} workers`);
}
// Workers without the SAB, for the cost of a worker itself.
for (const w of workers) w.terminate();
const idle = [];
for (let i = 0; i < 16; i++) { const w = new Worker(URL.createObjectURL(new Blob(["self.onmessage = () => postMessage(0);"]))); await new Promise(r => { w.onmessage = r; w.postMessage(0); }); idle.push(w); }
await measure("16 idle workers, no SAB");
globalThis.__pwResult = { out };
globalThis.__pwExit = 0;
