// Builds desktop/dist: the web app with every CDN library copied in, so the Mac app works offline.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const nm = path.join(here, 'node_modules');
const dist = path.join(here, 'dist');
const vendor = path.join(dist, 'vendor');

function localFor(url) {
  let m;
  if ((m = url.match(/codemirror\/5\.65\.16\/(.+)\.min\.js$/))) return `codemirror/${m[1] === 'codemirror' ? 'lib/codemirror' : m[1]}.js`;
  if (url.includes('/markdown-it/14.1.0/')) return 'markdown-it/dist/markdown-it.min.js';
  if ((m = url.match(/npm\/(markdown-it-[a-z]+)@[\d.]+\/(.+)$/))) return `${m[1]}/${m[2]}`;
  if (url.includes('/highlight.js/11.9.0/')) return '@highlightjs/cdn-assets/highlight.min.js';
  if (url.includes('/dompurify/3.1.6/')) return 'dompurify/dist/purify.min.js';
  if (url.includes('lucide@0.441.0')) return 'lucide/dist/umd/lucide.min.js';
  if (url.includes('mermaid@10.9.1')) return 'mermaid/dist/mermaid.min.js';
  if ((m = url.match(/mathjax@3\.2\.2\/(.+)$/))) return `mathjax/${m[1]}`;
  return null;
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

const doc = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
</head>
<body>
${html}
</body>
</html>
`;
fs.writeFileSync(path.join(dist, 'index.html'), doc);
console.log('desktop/dist ready');
