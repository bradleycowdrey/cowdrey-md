// Mac App Store screenshots (2880x1800, RGB PNG) of the real app, as the Mac App Store build runs it.
// Run: (cd desktop && npm ci && node build.mjs) && node tests/mac-screenshots.mjs [out-dir]
// These are the raw captures (docs/app-store/raw). scripts/store-frames turns them into the framed screenshots
// in docs/app-store that the App Store listing workflow uploads.
// The page is desktop/dist (the offline bundle the Mac app ships), at 1440x900 points and 2x pixels, with the
// Mac app's native bridge stood in for, so it shows what the Mac app shows. Documents are the app's own sample
// and fictional text written here.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch { playwright = require('/opt/node22/lib/node_modules/playwright'); }
const exe = fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;
const DIST = path.join(root, 'desktop/dist');
const OUT = path.resolve(process.argv[2] || path.join(root, 'docs/app-store/raw'));
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const TERMS_HASH = /TERMS_BUILT = \{ hash: '([0-9a-f]{8})'/.exec(html)[1];
const TYPES = { '.js': 'application/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };

const browser = await playwright.chromium.launch({ executablePath: exe });

// A fictional project plan, with a table, tasks, a callout and a diagram.
const PLAN = `# Harbor Street Garden

A community garden on the empty lot at Harbor Street, planned with the neighbours over the winter.

## Goals

- Twenty raised beds, four of them wheelchair height
- A tool shed and a rain barrel for every four beds
- Open to everyone from **April to October**

> [!NOTE]
> The city lends the lot for three years, free of charge.

## Budget

| Item | Count | Cost |
|:-----|------:|-----:|
| Raised beds | 20 | $2,400 |
| Rain barrels | 5 | $450 |
| Tool shed | 1 | $1,200 |
| **Total** | | **$4,050** |

## Next steps

- [x] Survey the neighbours
- [x] Draw the site plan
- [ ] Order the timber
- [ ] Build day on ==March 14==

\`\`\`mermaid
flowchart LR
  A[Survey] --> B[Site plan] --> C[Build day] --> D[First harvest]
\`\`\`
`;

// Fictional lecture notes with math.
const NOTES = `# Orbits, in three equations

Notes for a short talk on why the planets move the way they do.

## Kepler's third law

The square of a planet's period grows with the cube of its distance from the Sun:

$$T^2 = \\frac{4\\pi^2}{G M} \\, a^3$$

## Escape velocity

To leave a planet of mass $M$ and radius $r$ for good, a rocket needs at least

$$v_e = \\sqrt{\\frac{2 G M}{r}}$$

## Energy of an orbit

$$E = -\\frac{G M m}{2a}$$

The orbit's energy depends only on its size $a$, never on its shape.

| Planet | $a$ (AU) | $T$ (years) |
|:--|--:|--:|
| Mercury | 0.39 | 0.24 |
| Earth | 1.00 | 1.00 |
| Jupiter | 5.20 | 11.86 |
`;

async function page({ scheme = 'dark', settings = {}, doc }) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: scheme });
  const p = await ctx.newPage();
  await p.addInitScript(([hash, settings, doc]) => {
    localStorage.setItem('cowdrey.md:terms', JSON.stringify(hash));
    localStorage.setItem('cowdrey.md:updateChecked', String(Date.now()));
    localStorage.setItem('cowdrey.md:settings', JSON.stringify(settings));
    if (doc && !localStorage.getItem('cowdrey.md:index')) {
      localStorage.setItem('cowdrey.md:index', JSON.stringify([{ id: 'dshot', title: doc.title, autoTitle: false, updated: Date.now() }]));
      localStorage.setItem('cowdrey.md:doc:dshot', JSON.stringify(doc.content));
      localStorage.setItem('cowdrey.md:current', JSON.stringify('dshot'));
    }
    // The Mac App Store build's native bridge: the menu bar is native, so the page draws no menus of its own.
    Object.defineProperty(window, '__COWDREY_APP_STORE__', { value: true });
    window.__TAURI__ = {
      core: { invoke: async (c) => (c === 'take_opened_files' ? [] : null) },
      app: { getVersion: async () => '2.0.2' }, dialog: {}, event: { listen: async () => {} }, opener: { openUrl: async () => {} },
    };
  }, [TERMS_HASH, settings, doc]);
  await ctx.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (u.host !== 'app.test') return route.abort();
    const f = path.join(DIST, u.pathname === '/' ? 'index.html' : decodeURIComponent(u.pathname));
    if (!f.startsWith(DIST) || !fs.existsSync(f)) return route.abort();
    return route.fulfill({ body: fs.readFileSync(f), contentType: TYPES[path.extname(f)] || 'application/octet-stream' });
  });
  await p.goto('https://app.test/');
  await p.waitForFunction(() => document.querySelector('.CodeMirror') && document.querySelector('#ribbonBody .r-group'), null, { timeout: 20000 });
  await p.waitForTimeout(2500); // math, diagrams and fonts
  p.ctx = ctx;
  return p;
}

async function shot(p, name) {
  await p.mouse.move(1439, 899);
  await p.waitForTimeout(400);
  const file = path.join(OUT, name);
  await p.screenshot({ path: file });
  await p.ctx.close();
  console.log('wrote', file);
}

fs.mkdirSync(OUT, { recursive: true });

// 1. Write and see the page: the app's own sample document, split view, dark.
let p = await page({ settings: { view: 'split', appTheme: 'dark' } });
await shot(p, 'mac-1-split.png');

// 2. A plan with a table, tasks, a callout and a diagram, split view, dark.
p = await page({ settings: { view: 'split', appTheme: 'dark', split: 0.42 }, doc: { title: 'Harbor Street Garden', content: PLAN } });
await p.evaluate(() => { const cm = document.querySelector('.CodeMirror').CodeMirror; cm.scrollTo(0, 0); });
await shot(p, 'mac-2-plan.png');

// 3. Math, drawn on the page, dark.
p = await page({ settings: { view: 'split', appTheme: 'dark', split: 0.45 }, doc: { title: 'Orbits, in three equations', content: NOTES } });
await shot(p, 'mac-3-math.png');

// 4. The page on its own, as it prints, dark.
p = await page({ settings: { view: 'preview', appTheme: 'dark' }, doc: { title: 'Harbor Street Garden', content: PLAN } });
await shot(p, 'mac-4-page.png');

// 5. The Insert ribbon, light.
p = await page({ scheme: 'light', settings: { view: 'split', appTheme: 'light', ribbonTab: 'insert' }, doc: { title: 'Harbor Street Garden', content: PLAN } });
await shot(p, 'mac-5-insert-light.png');

await browser.close();
