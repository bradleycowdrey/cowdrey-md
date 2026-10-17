// Builds desktop/dist: the web app with every CDN library copied in, so the Mac app works offline.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const nm = path.join(here, 'node_modules');
const dist = path.join(here, 'dist');
const vendor = path.join(dist, 'vendor');

function localFor(url) {
  // https://cdn.jsdelivr.net/npm/<package>@<version>/<file>  ->  node_modules/<package>/<file>
  const m = url.match(/^https:\/\/cdn\.jsdelivr\.net\/npm\/((?:@[^/]+\/)?[^@/]+)@[^/]+\/(.+)$/);
  return m ? `${m[1]}/${m[2]}` : null;
}

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(vendor, { recursive: true });

let html = fs.readFileSync(path.join(here, '..', 'index.html'), 'utf8');
html = html.replace(/<script src="(https:[^"]+)"/g, (whole, url) => {
  const rel = localFor(url);
  if (!rel) throw new Error(`No local copy mapped for ${url}`);
  const src = path.join(nm, rel);
  if (!fs.existsSync(src)) throw new Error(`Missing ${src}. Run npm ci in desktop/ first.`);
  const dest = path.join(vendor, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  return `<script src="vendor/${rel}"`;
});

// MathJax loads TeX extensions on demand from beside tex-svg.js
fs.cpSync(path.join(nm, 'mathjax/es5/input'), path.join(vendor, 'mathjax/es5/input'), { recursive: true });

fs.writeFileSync(path.join(dist, 'index.html'), html); // index.html is a complete document
console.log('desktop/dist ready');
