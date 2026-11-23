// App Store screenshots for iPhone (6.9", 1320x2868), iPad (13", 2064x2752) and Mac (2880x1800), dark mode.
// Each one is the real app (desktop/dist, the offline bundle the apps ship) with a fictional document, framed in a
// neutral device with a headline, on the template shared with Cowdrey.PDF.
// Run: (cd desktop && npm ci && node build.mjs) && node tests/app-store-screens.mjs [out-dir] [name-filter]
// Needs Playwright (npm install --no-save playwright) and Chromium. Writes opaque RGB PNGs to docs/app-store.
// The headline font is Fraunces (SIL OFL, design/app-store/fonts); the sub-line is Instrument Sans, the app's own UI font.
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
const OUT = path.resolve(process.argv[2] || path.join(root, 'docs/app-store'));
const ONLY = process.argv[3] ? new RegExp(process.argv[3]) : null;
const RAW = process.env.RAW_DIR; // set to keep the unframed app screens too
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const TERMS_HASH = /TERMS_BUILT = \{ hash: '([0-9a-f]{8})'/.exec(html)[1];
const TYPES = { '.js': 'application/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const b64 = (f) => fs.readFileSync(f).toString('base64');
const FRAUNCES = b64(path.join(root, 'design/app-store/fonts/fraunces.woff2'));
const INSTRUMENT = b64(path.join(root, 'fonts/instrument-sans-latin-wght-normal.woff2'));

/* ---------------- devices ---------------- */
// Screen sizes in points, the scale they are drawn at, and the safe areas the system keeps clear.
const DEVICES = {
  iphone: {
    canvas: [1320, 2868], screen: [440, 956], scale: 3, inset: { top: 62, bottom: 34, left: 0, right: 0 },
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
    platform: 'iPhone', touch: 5, mobile: true,
  },
  ipad: { // iPadOS web views identify as a Mac with a touch screen
    canvas: [2064, 2752], screen: [1032, 1376], scale: 2, inset: { top: 24, bottom: 20, left: 0, right: 0 },
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)',
    platform: 'MacIntel', touch: 5, mobile: true,
  },
  mac: { // a 1280x800 point window; the native title bar is drawn by the frame
    canvas: [2880, 1800], screen: [1280, 772], scale: 2, inset: null,
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)',
    platform: 'MacIntel', touch: 0, mobile: false,
  },
};

/* ---------------- documents (fictional) ---------------- */
const LISBON = `# Lisbon in four days

A long weekend in October, planned on the train home from work.

> [!TIP]
> Buy a **Viva Viagem** card at the airport. One tap pays for the metro, the trams and the ferry.

## The plan

| Day | Morning | Evening |
|:----|:--------|:--------|
| Thu | Alfama and the castle | Fado in Mouraria |
| Fri | Belém and the tower | Mercado da Ribeira |
| Sat | Day trip to Sintra | Sunset at the *miradouro* |
| Sun | LX Factory | Train home at 18:40 |

## Pack

- [x] Passports and rail tickets
- [x] Walking shoes, *really* comfortable ones
- [ ] A light rain jacket
- [ ] Phone charger and adapter

## Eat

1. Pastéis de nata at Manteigaria, still warm
2. Grilled sardines in a side street in Alfama
3. ==Bifana== at the market, with a cold drink

> "Lisbon is a city to walk slowly, uphill, with frequent stops."
`;

const GARDEN = `# Harbor Street Garden

A community garden on the empty lot at Harbor Street, planned with the neighbours over the winter.

## Goals

- Twenty raised beds, four of them at wheelchair height
- A tool shed, and a rain barrel for every four beds
- Open to everyone from **April to October**

> [!NOTE]
> The city lends us the lot for three years, free of charge.

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

## Who does what

| Team | Lead | When |
|:--|:--|:--|
| Timber and beds | Maya | February |
| Water | Theo | March |
| Seedlings | Priya | April |
`;

const ORBITS = `# Orbits, in three equations

Notes for a short talk on why the planets move the way they do.

## Kepler's third law

The square of a planet's period grows with the cube of its distance from the Sun:

$$T^2 = \\frac{4\\pi^2}{G M} \\, a^3$$

## Escape velocity

To leave a planet of mass $M$ and radius $r$ for good, a rocket needs at least

$$v_e = \\sqrt{\\frac{2 G M}{r}}$$

## Energy of an orbit

$$E = -\\frac{G M m}{2a}$$

The energy depends only on the orbit's size $a$, never on its shape.

\`\`\`mermaid
flowchart LR
  A[Gravity pulls in] --> C((Orbit))
  B[Speed carries on] --> C
\`\`\`

| Planet | $a$ (AU) | $T$ (years) |
|:--|--:|--:|
| Mercury | 0.39 | 0.24 |
| Earth | 1.00 | 1.00 |
| Jupiter | 5.20 | 11.86 |
`;

const CHAPTER = `# The Lighthouse Keeper

## Chapter three

The storm came in sideways, the way the old keeper had said it would. Ada climbed the ninety-one steps with the lamp oil in both hands, counting them under her breath so she wouldn't count the waves.

At the top, the glass was already weeping. She trimmed the wick, struck the match, and watched the light swing out over the water, *once, twice*, the way it had every night for a hundred years.

Somewhere past the point, a ship answered. Three short blasts, then a long one, the old signal for *I see you*. Ada pressed her palm flat against the cold brass rail and let out a breath she had been holding since noon.

She thought of her brother, who had laughed when she took the post. *Nobody keeps lighthouses any more,* he had said. *The ships have satellites.* But satellites did not climb ninety-one steps in the rain, and they did not wait up.

By two in the morning the wind had dropped to a mutter. She wrote in the log, in the same careful hand as the keepers before her: *Gale from the south-west. Light kept. One vessel, safe.*
`;

const MEETING = `# Design review, 14 November

**Present:** Maya, Theo, Priya, Sam

## Decisions

- Ship the new onboarding on **2 December**
- Keep the free plan exactly as it is

## Actions

- [ ] Maya: final copy for the welcome screen
- [ ] Theo: test on the smallest phone we support
- [x] Priya: book the room for the launch call
`;

const THESIS = `# Thesis outline

## 1. Introduction

Why coastal towns lose their young people, and what brings some of them back.

## 2. Method

Thirty interviews in four towns, and the census from 2001 to 2021.
`;

const DAL = `# Weeknight dal

Serves four, in thirty minutes.

- 250 g red lentils, rinsed
- 1 onion, 3 cloves garlic, a thumb of ginger
- 1 tsp each of cumin, turmeric and chilli

Simmer the lentils in a litre of water until soft. Fry the rest in butter, stir it through, and finish with lime.
`;

const READING = `# Reading list

- [x] *The Overstory*, Richard Powers
- [x] *Piranesi*, Susanna Clarke
- [ ] *The Remains of the Day*, Kazuo Ishiguro
- [ ] *Braiding Sweetgrass*, Robin Wall Kimmerer
`;

const min = 60e3, hour = 60 * min, day = 24 * hour;
// The library shown in the Documents views: folders, pins and recent edits.
const LIBRARY = [
  { id: 'lisbon', title: 'Lisbon in four days', content: LISBON, folder: 'Personal', pinned: true, ago: 2 * min },
  { id: 'garden', title: 'Harbor Street Garden', content: GARDEN, folder: 'Work', pinned: true, ago: 40 * min },
  { id: 'orbits', title: 'Orbits, in three equations', content: ORBITS, folder: 'School', ago: 3 * hour },
  { id: 'meeting', title: 'Design review, 14 November', content: MEETING, folder: 'Work', ago: 5 * hour },
  { id: 'chapter', title: 'The Lighthouse Keeper', content: CHAPTER, folder: 'Writing', ago: 1 * day },
  { id: 'thesis', title: 'Thesis outline', content: THESIS, folder: 'School', ago: 2 * day },
  { id: 'dal', title: 'Weeknight dal', content: DAL, folder: 'Personal', ago: 4 * day },
  { id: 'reading', title: 'Reading list', content: READING, folder: 'Personal', ago: 9 * day },
];

/* ---------------- the stories ---------------- */
// head: the headline (Fraunces); sub: one line of plain words. Each opens one document, in one state of the app.
const STORIES = [
  // iPhone
  { dev: 'iphone', file: 'iphone-1-page.png', head: 'Write Markdown.\nRead a page.', sub: 'Plain text becomes a clean, printable page.', doc: 'lisbon' },
  { dev: 'iphone', file: 'iphone-2-write.png', head: 'A formatting bar,\nlike Pages', sub: 'Styles, bold, lists and links in one tap.', doc: 'lisbon', act: phoneEdit(10) },
  { dev: 'iphone', file: 'iphone-3-math.png', head: 'Math and diagrams,\ndrawn for you', sub: 'LaTeX and Mermaid, right on the page.', doc: 'orbits', act: scrollPage('#preview h2:nth-of-type(2)') },
  { dev: 'iphone', file: 'iphone-4-format.png', head: 'Styles in a tap', sub: 'Headings, quotes and code, like Word.', doc: 'garden', act: phoneSheet('format', 3) },
  { dev: 'iphone', file: 'iphone-5-files.png', head: 'All your writing,\nin one place', sub: 'Folders, pins and search across everything.', doc: 'lisbon', act: phoneDocs },
  { dev: 'iphone', file: 'iphone-6-export.png', head: 'Share it as PDF\nor Word', sub: 'Export, print or copy with formatting.', doc: 'garden', act: phoneSheet('share') },
  // iPad
  { dev: 'ipad', file: 'ipad-1-split.png', head: 'Write on the left.\nSee the page on the right.', sub: 'Markdown and the printed page, side by side.', doc: 'garden', settings: { view: 'split', split: 0.46 } },
  { dev: 'ipad', file: 'ipad-2-math.png', head: 'Math and diagrams,\ndrawn for you', sub: 'LaTeX and Mermaid, right on the page.', doc: 'orbits', settings: { view: 'split', split: 0.46 } },
  { dev: 'ipad', file: 'ipad-3-page.png', head: 'A page you can print', sub: 'Letter or A4, five page styles, ready to share.', doc: 'lisbon', settings: { view: 'preview' } },
  { dev: 'ipad', file: 'ipad-4-files.png', head: 'All your writing,\nin one place', sub: 'Folders, pins and search across everything.', doc: 'garden', settings: { view: 'split', split: 0.46 }, act: sideDocs },
  { dev: 'ipad', file: 'ipad-5-styles.png', head: 'Make it look\nlike a book', sub: 'Five page styles, from clean to manuscript.', doc: 'chapter', settings: { view: 'split', split: 0.46, ribbonTab: 'layout', pageStyle: 'manuscript' } },
  { dev: 'ipad', file: 'ipad-6-export.png', head: 'Share it as PDF\nor Word', sub: 'Export, print or copy with formatting.', doc: 'garden', settings: { view: 'split', split: 0.46 }, act: exportMenu },
  // Mac
  { dev: 'mac', file: 'mac-1-split.png', head: 'Write Markdown. See the page.', sub: 'Plain text on the left, a clean, printable page on the right.', doc: 'garden', settings: { view: 'split', split: 0.44 } },
  { dev: 'mac', file: 'mac-2-math.png', head: 'Math and diagrams, drawn for you', sub: 'LaTeX equations and Mermaid charts, right on the page.', doc: 'orbits', settings: { view: 'split', split: 0.44 } },
  { dev: 'mac', file: 'mac-3-files.png', head: 'All your writing, in one place', sub: 'Folders, pins and search across every document.', doc: 'lisbon', settings: { view: 'split', split: 0.5, outline: true, sideTab: 'docs' } },
  { dev: 'mac', file: 'mac-4-page.png', head: 'A page you can print', sub: 'Letter or A4, five page styles, an outline to jump around.', doc: 'garden', settings: { view: 'preview', outline: true, sideTab: 'outline' } },
  { dev: 'mac', file: 'mac-5-styles.png', head: 'Make it look like a book', sub: 'Five page styles, from clean to manuscript, on Letter or A4.', doc: 'chapter', settings: { view: 'split', split: 0.44, ribbonTab: 'layout', pageStyle: 'manuscript' } },
  { dev: 'mac', file: 'mac-6-export.png', head: 'Share it as PDF or Word', sub: 'Export, print, or copy with formatting into Docs or Mail.', doc: 'garden', settings: { view: 'split', split: 0.44 }, act: exportMenu },
];

/* ---------------- actions ---------------- */
function phoneEdit(line) {
  return async (p) => {
    await p.locator('#mEdit').click();
    await p.evaluate((line) => { const cm = document.querySelector('.CodeMirror').CodeMirror; cm.scrollTo(0, 0); cm.setCursor({ line, ch: cm.getLine(line).length }); }, line);
    await p.waitForTimeout(300);
  };
}
function phoneSheet(kind, line) {
  return async (p) => {
    if (kind === 'format') {
      await p.locator('#mEdit').click();
      await p.evaluate((line) => { const cm = document.querySelector('.CodeMirror').CodeMirror; cm.scrollTo(0, 0); cm.setCursor({ line, ch: 3 }); }, line);
      await p.waitForTimeout(200);
      await p.locator('#mBar [data-m="format"]').click();
    } else {
      await p.locator('#mBar [data-m="share"]').click();
    }
    await p.waitForTimeout(500);
  };
}
function scrollPage(sel) {
  return async (p) => { await p.evaluate((sel) => { const el = document.querySelector(sel); const c = document.querySelector('#canvas'); if (el && c) c.scrollTop = el.getBoundingClientRect().top - c.getBoundingClientRect().top - 12; }, sel); await p.waitForTimeout(300); };
}
async function phoneDocs(p) { await p.locator('#mBar [data-m="docs"]').click(); await p.waitForTimeout(500); }
async function sideDocs(p) { await p.locator('.rail-btn[data-rail="docs"]').click(); await p.waitForTimeout(500); }
async function exportMenu(p) { await p.locator('#exportBtn').click(); await p.waitForTimeout(500); }

/* ---------------- capture ---------------- */
const browser = await playwright.chromium.launch({ executablePath: exe });

async function capture(story) {
  const D = DEVICES[story.dev];
  const ctx = await browser.newContext({
    viewport: { width: D.screen[0], height: D.screen[1] }, deviceScaleFactor: D.scale, colorScheme: 'dark',
    userAgent: D.ua, isMobile: story.dev === 'iphone', hasTouch: D.touch > 0, reducedMotion: 'reduce',
  });
  const p = await ctx.newPage();
  const cdp = await ctx.newCDPSession(p);
  if (D.inset) await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: D.inset });
  // Reduce Transparency (an iOS and macOS accessibility setting): sheets dim the page instead of blurring it,
  // so the page behind stays readable in a small picture.
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }, { name: 'prefers-color-scheme', value: 'dark' }] });
  const now = Date.now();
  const library = LIBRARY.map(({ ago, ...d }) => ({ ...d, updated: now - ago }));
  await p.addInitScript(([hash, settings, library, current, D, mac]) => {
    Object.defineProperty(Navigator.prototype, 'platform', { get: () => D.platform });
    Object.defineProperty(Navigator.prototype, 'maxTouchPoints', { get: () => D.touch });
    localStorage.setItem('cowdrey.md:terms', JSON.stringify(hash));
    localStorage.setItem('cowdrey.md:updateChecked', String(Date.now()));
    localStorage.setItem('cowdrey.md:settings', JSON.stringify(settings));
    localStorage.setItem('cowdrey.md:index', JSON.stringify(library.map(({ content, ...m }) => ({ ...m, autoTitle: false }))));
    for (const d of library) localStorage.setItem('cowdrey.md:doc:' + d.id, JSON.stringify(d.content));
    localStorage.setItem('cowdrey.md:current', JSON.stringify(current));
    // The apps' native bridge. On the Mac it is the App Store build, whose menu bar is native.
    if (mac) Object.defineProperty(window, '__COWDREY_APP_STORE__', { value: true });
    window.__TAURI__ = {
      core: { invoke: async (c) => (c === 'take_opened_files' ? [] : null) },
      app: { getVersion: async () => '2.0.2' }, dialog: {}, event: { listen: async () => {} }, opener: { openUrl: async () => {} },
    };
  }, [TERMS_HASH, { appTheme: 'dark', openTabs: [story.doc], ...story.settings }, library, story.doc, D, story.dev === 'mac']);
  await ctx.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (u.host !== 'app.test') return route.abort();
    const f = path.join(DIST, u.pathname === '/' ? 'index.html' : decodeURIComponent(u.pathname));
    if (!f.startsWith(DIST) || !fs.existsSync(f)) return route.abort();
    return route.fulfill({ body: fs.readFileSync(f), contentType: TYPES[path.extname(f)] || 'application/octet-stream' });
  });
  // The app's own look for Reduce Transparency (an iOS and macOS accessibility setting): sheets and panels dim
  // the page instead of blurring it, so what is behind them stays readable in a small picture.
  await p.addInitScript(() => document.addEventListener('DOMContentLoaded', () => {
    const st = document.createElement('style');
    st.textContent = 'dialog.dlg::backdrop, .m-scrim, .app[data-overlay="on"] .workspace::after { -webkit-backdrop-filter: none !important; backdrop-filter: none !important; background: rgba(10, 16, 30, .55) !important; }';
    document.head.appendChild(st);
  }));
  await p.goto('https://app.test/');
  await p.waitForFunction(() => document.querySelector('.CodeMirror') && document.querySelector('#page'), null, { timeout: 20000 });
  await p.waitForTimeout(2500); // math, diagrams and fonts
  if (story.act) await story.act(p);
  if (!D.mobile) await p.mouse.move(D.screen[0] - 1, D.screen[1] - 1);
  await p.waitForTimeout(400);
  const png = await p.screenshot();
  await ctx.close();
  if (RAW) { fs.mkdirSync(RAW, { recursive: true }); fs.writeFileSync(path.join(RAW, story.file), png); }
  return png;
}

/* ---------------- frame ---------------- */
// One template for every device: a deep blue backdrop, the headline and sub-line, and a neutral device.
function frameHtml(story, png) {
  const D = DEVICES[story.dev];
  const [W, H] = D.canvas;
  const img = `data:image/png;base64,${png.toString('base64')}`;
  const head = story.head.split('\n').map((l) => l.replace(/&/g, '&amp;').replace(/</g, '&lt;')).join('<br>');
  let device = '', type;
  if (story.dev === 'iphone') {
    type = { top: 150, head: 118, sub: 50, gap: 34 };
    const s = 2.28, sw = D.screen[0] * s, sh = D.screen[1] * s, bez = 16, band = 9, r = 55 * s;
    const ow = sw + 2 * (bez + band), oh = sh + 2 * (bez + band), x = (W - ow) / 2, y = H - oh - 96;
    device = `<div class="dev phone" style="left:${x}px;top:${y}px;width:${ow}px;height:${oh}px;border-radius:${r + bez + band}px;padding:${band}px">
      <i class="btn" style="left:-5px;top:${0.2 * oh}px;height:${0.035 * oh}px"></i><i class="btn" style="left:-5px;top:${0.27 * oh}px;height:${0.07 * oh}px"></i>
      <i class="btn" style="left:-5px;top:${0.355 * oh}px;height:${0.07 * oh}px"></i><i class="btn" style="right:-5px;top:${0.3 * oh}px;height:${0.1 * oh}px"></i>
      <div class="bezel" style="border-radius:${r + bez}px;padding:${bez}px"><div class="scr" style="width:${sw}px;height:${sh}px;border-radius:${r}px">
        <img src="${img}"><i class="island" style="top:${11 * s}px;width:${125 * s}px;height:${37 * s}px;margin-left:${-62.5 * s}px"></i></div></div></div>`;
  } else if (story.dev === 'ipad') {
    type = { top: 150, head: 128, sub: 54, gap: 36 };
    const s = 1.42, sw = D.screen[0] * s, sh = D.screen[1] * s, bez = 30, band = 8, r = 18 * s;
    const ow = sw + 2 * (bez + band), oh = sh + 2 * (bez + band), x = (W - ow) / 2, y = H - oh - 100;
    device = `<div class="dev tablet" style="left:${x}px;top:${y}px;width:${ow}px;height:${oh}px;border-radius:${r + bez + band}px;padding:${band}px">
      <i class="btn" style="right:-5px;top:${0.1 * oh}px;height:${0.05 * oh}px"></i><i class="btn" style="right:-5px;top:${0.17 * oh}px;height:${0.05 * oh}px"></i>
      <div class="bezel" style="border-radius:${r + bez}px;padding:${bez}px"><div class="scr" style="width:${sw}px;height:${sh}px;border-radius:${r}px"><img src="${img}"></div></div></div>`;
  } else {
    type = { top: 112, head: 104, sub: 46, gap: 26 };
    const s = 1.66, sw = D.screen[0] * s, sh = D.screen[1] * s, bar = 28 * s, r = 12 * s;
    const ow = sw, oh = sh + bar, x = (W - ow) / 2, y = H - oh - 90;
    const lights = ['#FF5F57', '#FEBC2E', '#28C840'].map((c, i) => `<i style="left:${(20 + 20 * i) * s}px;background:${c}"></i>`).join('');
    device = `<div class="dev win" style="left:${x}px;top:${y}px;width:${ow}px;height:${oh}px;border-radius:${r}px">
      <div class="titlebar" style="height:${bar}px">${lights}<span>Cowdrey.MD</span></div><img src="${img}" style="width:${sw}px;height:${sh}px"></div>`;
  }
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: 'Fraunces'; src: url(data:font/woff2;base64,${FRAUNCES}) format('woff2'); font-weight: 100 900; }
@font-face { font-family: 'Instrument Sans'; src: url(data:font/woff2;base64,${INSTRUMENT}) format('woff2'); font-weight: 400 700; }
* { margin: 0; box-sizing: border-box; }
html, body { width: ${W}px; height: ${H}px; overflow: hidden; background: #070C1D; }
body { position: relative; font-family: 'Instrument Sans', sans-serif; -webkit-font-smoothing: antialiased;
  background:
    radial-gradient(ellipse ${W * 0.9}px ${H * 0.42}px at 50% ${H * 0.16}px, rgba(74, 116, 242, .24), transparent 70%),
    radial-gradient(ellipse ${W * 0.7}px ${H * 0.35}px at 50% ${H * 0.98}px, rgba(28, 61, 174, .28), transparent 70%),
    linear-gradient(180deg, #101C45 0%, #0A1230 45%, #050917 100%); }
.copy { position: absolute; left: 0; right: 0; top: ${type.top}px; text-align: center; padding: 0 60px; }
h1 { font: 560 ${type.head}px/1.04 'Fraunces', serif; font-variation-settings: 'opsz' 48; letter-spacing: -.012em; color: #F6F7FB; }
p { margin-top: ${type.gap}px; font: 500 ${type.sub}px/1.25 'Instrument Sans', sans-serif; letter-spacing: -.005em; color: #AEBBDD; }
.dev { position: absolute; }
.dev img { display: block; width: 100%; height: 100%; }
.phone, .tablet { background: linear-gradient(135deg, #5B606B 0%, #2A2D33 18%, #3A3E46 50%, #24272C 82%, #4E535D 100%);
  box-shadow: 0 0 0 1.5px rgba(255,255,255,.10), 0 70px 140px rgba(0,0,0,.55), 0 20px 50px rgba(0,0,0,.35); }
.bezel { width: 100%; height: 100%; background: #050506; box-shadow: inset 0 0 0 1.5px rgba(255,255,255,.06); }
.scr { position: relative; overflow: hidden; background: #000; }
.island { position: absolute; left: 50%; background: #000; border-radius: 999px; }
.btn { position: absolute; width: 6px; border-radius: 3px; background: linear-gradient(90deg, #2A2D33, #565B65, #2A2D33); }
.win { overflow: hidden; background: #1D2027; box-shadow: 0 0 0 1.5px rgba(0,0,0,.6), inset 0 0 0 1px rgba(255,255,255,.12), 0 60px 130px rgba(0,0,0,.6), 0 18px 44px rgba(0,0,0,.4); }
.titlebar { position: relative; background: #24272E; border-bottom: 1.5px solid #0B0D11; display: flex; align-items: center; justify-content: center; }
.titlebar i { position: absolute; top: 50%; width: 20px; height: 20px; margin-top: -10px; border-radius: 50%; box-shadow: inset 0 0 0 1px rgba(0,0,0,.18); }
.titlebar span { font: 600 22px 'Instrument Sans', sans-serif; color: #C9CED8; letter-spacing: .005em; }
</style></head><body>
<div class="copy"><h1>${head}</h1><p>${story.sub}</p></div>
${device}
</body></html>`;
}

async function compose(story, png) {
  const [W, H] = DEVICES[story.dev].canvas;
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  await p.setContent(frameHtml(story, png), { waitUntil: 'load' });
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(200);
  const out = await p.screenshot({ type: 'png' });
  await ctx.close();
  // App Store Connect refuses screenshots with an alpha channel: check the PNG is plain RGB (colour type 2).
  if (out.readUInt32BE(16) !== W || out.readUInt32BE(20) !== H || out[25] !== 2) throw new Error(`${story.file}: not a ${W}x${H} RGB PNG`);
  return out;
}

fs.mkdirSync(OUT, { recursive: true });
for (const story of STORIES) {
  if (ONLY && !ONLY.test(story.file)) continue;
  const png = await capture(story);
  fs.writeFileSync(path.join(OUT, story.file), await compose(story, png));
  console.log('wrote', path.join(OUT, story.file));
}
await browser.close();
