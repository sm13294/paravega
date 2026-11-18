// Assembles the showcase as a static site in showcase/site/:
// the page (src/), the dashboard specification of the paper
// (demo/crossfilterSpec.js), ParaVega's browser bundle, and Vega's browser
// build, all same-origin so that the page can be cross-origin isolated.
//   npm run vega:build && node showcase/build.mjs
// Deploy the site/ folder as it is (Vercel or Netlify read vercel.json or
// _headers for the isolation headers; on GitHub Pages, coi-sw.js adds them).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const site = path.join(here, "site");
fs.rmSync(site, { recursive: true, force: true });
fs.mkdirSync(site, { recursive: true });
const copy = (from, to = path.basename(from)) => fs.copyFileSync(from, path.join(site, to));
for (const f of fs.readdirSync(path.join(here, "src"))) copy(path.join(here, "src", f), f);
copy(path.join(root, "demo/crossfilterSpec.js"));
copy(path.join(root, "dist/paraweb-vega.mjs"));
copy(path.join(root, "node_modules/vega/build/vega.min.js"));
copy(path.join(root, "node_modules/vega/LICENSE"), "LICENSE-vega.txt");
fs.writeFileSync(path.join(site, ".nojekyll"), "");
console.log("showcase site in " + path.relative(root, site) + ": " + fs.readdirSync(site).join(", "));
