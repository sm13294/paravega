/**
 * Runs one browser test bundle (build.mjs) in Chromium, in a page served with
 * cross-origin isolation, and prints its console output.
 *
 *   node test/browser/build.mjs
 *   node test/browser/run.cjs <correctness|resident|copycost|scenes>
 *     [--query=a=1&b=2] [--vega=5] [--vegatest=<vega>/packages/vega/test] [--out=file]
 *
 * --vegatest serves Vega's test directory at /vegatest/ (scenes only); the page
 * then runs in the time zone of Vega's test script (TZ=America/Los_Angeles),
 * or in --tz=<zone>. --out
 * writes the console output (and the result object, as JSON, if the test sets
 * one). The exit code is the test's.
 */
const puppeteer = require("puppeteer");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

const test = process.argv[2];
const arg = (name, def) => { const a = process.argv.find(x => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : def; };
const query = arg("query", ""), vegaV = arg("vega", "6"), vegatest = arg("vegatest", null), out = arg("out", null);
const PORT = 8790;
const MIME = { ".json": "application/json", ".csv": "text/csv", ".tsv": "text/tab-separated-values", ".js": "text/javascript", ".txt": "text/plain", ".png": "image/png" };

(async () => {
  const server = spawn("node", [path.join(__dirname, "../../bench/serve.cjs")], { stdio: "ignore", env: { ...process.env, PORT: String(PORT) } });
  await new Promise(r => setTimeout(r, 800));
  const args = ["--no-sandbox", "--enable-unsafe-webgpu", "--enable-features=Vulkan", os.platform() === "darwin" ? "--use-angle=metal" : "--use-angle=vulkan"];
  const browser = await puppeteer.launch({ headless: "new", args, protocolTimeout: 3600000 });
  const lines = [];
  let code = 1;
  try {
    const page = await browser.newPage();
    page.on("console", m => { const t = m.text(); lines.push(t); console.log(t); });
    page.on("response", r => { if (r.status() >= 400) console.log(`(${r.status()} ${new URL(r.url()).pathname})`); });
    page.on("pageerror", e => { lines.push("pageerror " + e.message); console.log("pageerror", e.message); });
    const tz = arg("tz", vegatest ? "America/Los_Angeles" : null);
    if (tz) await page.emulateTimezone(tz);
    if (vegatest) {
      await page.setRequestInterception(true);
      page.on("request", req => {
        const u = new URL(req.url());
        if (!u.pathname.startsWith("/vegatest/")) return req.continue();
        const f = path.join(vegatest, decodeURIComponent(u.pathname.slice("/vegatest/".length)));
        if (!f.startsWith(path.resolve(vegatest)) || !fs.existsSync(f)) return req.respond({ status: 404, body: "" });
        req.respond({ status: 200, contentType: MIME[path.extname(f)] || "application/octet-stream", headers: { "Cross-Origin-Resource-Policy": "same-origin" }, body: fs.readFileSync(f) });
      });
    }
    const q = new URLSearchParams(query); q.set("test", test); if (vegaV === "5") q.set("vega", "5");
    await page.goto(`http://localhost:${PORT}/test/browser/runner.html?${q}`, { waitUntil: "load" });
    await page.waitForFunction("window.__pwExit !== undefined", { timeout: 0, polling: 500 });
    code = await page.evaluate("window.__pwExit");
    const result = await page.evaluate("window.__pwResult ?? null");
    const ua = await page.evaluate("navigator.userAgent");
    if (out) fs.writeFileSync(out, result ? JSON.stringify({ ...result, userAgent: ua }, null, 2) : lines.join("\n") + `\n(${ua})\n`);
  } finally {
    await browser.close();
    server.kill();
  }
  process.exit(code);
})().catch(e => { console.error(e); process.exit(1); });
