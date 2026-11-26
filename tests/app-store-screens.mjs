// App Store screenshots for iPhone (6.9", 1320x2868), iPad (13", 2064x2752) and Mac (2880x1800), dark mode.
// Each one is the real app (desktop/dist, the offline bundle the apps ship) with a fictional document, framed in a
// neutral device with a headline, on the Cowdrey family template (tests/store-frame.mjs, a word-for-word copy of the
// family master in Cowdrey One, design/app-store/store-frame.mjs; Cowdrey.PDF has the same copy). On the Mac the app's
// window sits at its real point size on the family's MacBook desktop.
// Run: (cd desktop && npm ci && node build.mjs) && node tests/app-store-screens.mjs [out-dir] [name-filter]
// Needs Playwright (npm install --no-save playwright@1.56.1) and Chromium. Writes opaque RGB PNGs to docs/app-store.
// The app's clock is fixed at the family's MAC_CLOCK time (Wed Nov 25 2026, 9:41 AM), so the documents' "edited"
// times are the same on every run and agree with the Mac's menu bar.
// The headline font is Fraunces (SIL OFL, design/app-store/fonts); the sub-line is Instrument Sans, the app's own UI font.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { compose as frame, desktop, THEMES } from './store-frame.mjs';

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
const FONTS = { fraunces: b64(path.join(root, 'design/app-store/fonts/fraunces.woff2')), instrument: b64(path.join(root, 'fonts/instrument-sans-latin-wght-normal.woff2')) };

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
  // Google Play's phone pictures (docs/play/phone-N.png): the Android app at a Pixel 7's width (412 x 824 dp), saved
  // unframed at 1080 x 2160.
  android: {
    canvas: [1080, 2160], screen: [412, 824], scale: 1080 / 412, inset: null,
    ua: 'Mozilla/5.0 (Linux; Android 15; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
    platform: 'Linux armv8l', touch: 5, mobile: true,
  },
  // The Mac window: the app's default size (desktop/src-tauri/tauri.conf.json, 1360 x 880 points of content) under
  // the 28-point macOS title bar the template draws (the app's capture has no title bar of its own: Tauri's native one
  // is outside the page), 1360 x 908 in all. It sits on the MacBook's 1512 x 982 pt desktop at its real size, as
  // Cowdrey.PDF's does.
  mac: {
    canvas: [2880, 1800], screen: [1360, 880], scale: 2, inset: null, titlebar: 28,
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)',
    platform: 'MacIntel', touch: 0, mobile: false,
  },
};

/* ---------------- documents (fictional) ---------------- */
// Business documents of the kind people write in Markdown: a project plan, meeting notes, unit economics, a report,
// a client proposal, release notes. The company, the people and the figures are made up. Every date fits the Mac's menu-bar
// clock (MAC_CLOCK, Wed Nov 25 2026, 9:41 AM), which is also the app's clock while it is captured (NOW below):
// nothing was written after it, and what is still to come is planned for later.
const BRIEF = `# Checkout redesign

**Owner:** Maya Chen · **Status:** In progress · **Updated:** 25 November 2026

> [!NOTE]
> Goal: bring mobile checkout abandonment down from **38%** to under 30% by the end of March 2027.

## Milestones

| Milestone | Owner | Due |
|:----------|:------|:----|
| Design sign-off | Maya | 2 Dec |
| Payment API update | Theo | 11 Dec |
| Beta for 10% of users | Priya | 13 Jan |
| Full launch | Sam | 3 Feb |

## Scope

- [x] Guest checkout, no account needed
- [x] Apple Pay and Google Pay
- [ ] Address lookup by postcode
- [ ] Saved cards for returning customers

## Out of scope

1. Prices and shipping rates
2. The desktop cart page
3. ==Loyalty points==, planned for Q2

## Flow

\`\`\`mermaid
flowchart LR
  A[Cart] --> B[Details] --> C[Payment] --> D[Confirmation]
\`\`\`

## Risks

| Risk | Likelihood | Plan |
|:--|:--|:--|
| Payment provider delay | Medium | Keep the current form as a fallback |
| Holiday code freeze | High | Ship the API change by 11 Dec |
`;

// The same brief while it is written: prose, the scope and a goal (no table syntax in view).
const BRIEF_WRITE = `# Checkout redesign

Mobile shoppers leave checkout more often than anyone else. This project rebuilds the **mobile checkout** as three short steps, with guest checkout and wallet payments from day one.

## Scope

- [x] Guest checkout, no account needed
- [x] Apple Pay and Google Pay
- [ ] Address lookup by postcode
- [ ] Saved cards for returning customers

## Out of scope

1. Prices and shipping rates
2. The desktop cart page
3. ==Loyalty points==, planned for Q2

## Success measure

Mobile abandonment below *30%* for four weeks running, from the weekly funnel report.
`;

const UNIT = `# Unit economics, Q4 2026

For the pricing review on 2 December. Figures are the twelve months to 31 October 2026.

## Gross margin

$$\\text{Gross margin} = \\frac{\\text{Revenue} - \\text{COGS}}{\\text{Revenue}}$$

On revenue of $4.8M and cost of goods of $1.3M, the gross margin is **73%**.

## CAC payback

The months it takes a new customer's gross profit to repay what it cost to win them:

$$\\text{Payback} = \\frac{\\text{CAC}}{\\text{ARPA} \\times \\text{Gross margin}}$$

At a CAC of $1,450 and $180 a month per account, payback is about **11 months**.

## Revenue growth

Compound monthly growth $g$ from today's run rate $R_0$, over $n$ months:

$$R_n = R_0 \\, (1 + g)^n$$

\`\`\`mermaid
flowchart LR
  A[Lead] --> B[Trial] --> C[Paid] --> D[Renewal]
\`\`\`

| Plan | Price / month | Gross margin | Payback |
|:--|--:|--:|--:|
| Starter | $49 | 68% | 14 mo |
| Team | $180 | 73% | 11 mo |
| Business | $490 | 79% | 8 mo |

**Recommendation:** lead with the Team plan, and raise Starter to $59 from 1 February 2027.

Next review: March 2027, with the first quarter's figures.
`;

const PROPOSAL = `# Proposal: support desk migration

**Prepared for:** Northwind Retail · **Date:** 20 November 2026

## Summary

Move 40 support agents to the new help desk in eight weeks, with no downtime.

## Fees

| Phase | Weeks | Fee |
|:--|--:|--:|
| Discovery | 2 | $12,000 |
| Migration | 4 | $36,000 |
| Training | 2 | $9,000 |
`;

const REPORT = `# Hybrid work pilot

## Final report, November 2026

From May to October, sixty people in two offices tried a hybrid schedule: three set days in the office and two at home. This report sets out what we measured, what we heard, and what we recommend.

The headline is simple. Output held steady, and people were happier. Tickets closed per person rose by 4 percent over the six months, against a flat trend in the teams that kept their old schedule. In the closing survey, 82 percent said they would choose the hybrid schedule again.

The shared office days mattered more than we expected. Teams that agreed on the same three days reported fewer meetings at awkward hours and quicker decisions. Teams that let everyone choose their own days saw little of the benefit, and several asked to change halfway through.

Not everything worked. New starters found the home days lonely in their first month, and two managers said regular one-to-ones were harder to keep. We recommend that new starters spend their first four weeks in the office, each with a named buddy.

We recommend offering the schedule to every office from 1 February 2027, with each team choosing its own fixed days, and reviewing it again after six months.
`;

const MEETING = `# Product sync, 24 November

**Attendees:** Maya, Theo, Priya, Sam

## Decisions

- The checkout beta starts on **13 January**
- Keep the free plan exactly as it is

## Actions

- [ ] Maya: final copy for the payment step, by Friday
- [ ] Theo: load test with the new payment API
- [x] Priya: invite the beta customers

## Next meeting

Tuesday 1 December, 10:00.
`;

const RELEASE = `# Release notes 4.2

Released on 19 November 2026.

## New

- Export invoices as CSV
- Two-factor sign-in with an authenticator app

## Fixed

- Search finds names with accents
- Reports load faster on large accounts
`;

const ONBOARDING = `# New starter checklist

## Before day one

- [x] Laptop ordered and set up
- [x] Accounts: email, chat, the wiki

## First week

- [ ] Meet the team and your buddy
- [ ] Read the product handbook
- [ ] Ship one small change
`;

const OKRS = `# 2027 planning: draft OKRs

## Objective: a faster checkout

- **KR1:** mobile abandonment under 30%
- **KR2:** median checkout time under 60 seconds

## Objective: fewer support tickets

- **KR1:** 20% fewer "where is my order" tickets
`;

const min = 60e3, hour = 60 * min, day = 24 * hour;
// The library shown in the Documents views: folders, pins and recent edits, timed back from NOW.
const LIBRARY = [
  { id: 'brief', title: 'Checkout redesign', content: BRIEF, folder: 'Projects', pinned: true, ago: 4 * min },
  { id: 'meeting', title: 'Product sync, 24 November', content: MEETING, folder: 'Meetings', pinned: true, ago: 18 * hour },
  { id: 'unit', title: 'Unit economics, Q4 2026', content: UNIT, folder: 'Finance', ago: 2 * hour },
  { id: 'proposal', title: 'Proposal: support desk migration', content: PROPOSAL, folder: 'Clients', ago: 5 * day },
  { id: 'report', title: 'Hybrid work pilot', content: REPORT, folder: 'Reports', ago: 1 * day },
  { id: 'release', title: 'Release notes 4.2', content: RELEASE, folder: 'Engineering', ago: 6 * day },
  { id: 'okrs', title: '2027 planning: draft OKRs', content: OKRS, folder: 'Projects', ago: 8 * day },
  { id: 'onboarding', title: 'New starter checklist', content: ONBOARDING, folder: 'Team', ago: 15 * day },
];

/* ---------------- the stories ---------------- */
// The Mac's first three: the outline folded away and the page given most of the window, so the page and the Markdown read in a small picture.
const MAC_BIG = { view: 'split', split: 0.36, outline: false, zoom: 'fit', edSize: 15 };
// head: the headline (Fraunces), two lines on iPhone and iPad (one on the Mac, where the two run as one line);
// sub: one line of plain words. Each opens one document, in one state of the app.
const STORIES = [
  // iPhone
  { dev: 'iphone', file: 'iphone-1-page.png', head: 'Write Markdown.\nSee the page.', sub: 'Plain text becomes a clean, printable page.', doc: 'brief' },
  { dev: 'iphone', file: 'iphone-2-write.png', head: 'Format in\none tap', sub: 'Styles, bold, lists and links from the bar.', doc: 'brief', content: BRIEF_WRITE, act: phoneSelect(2, 'mobile checkout') },
  { dev: 'iphone', file: 'iphone-3-math.png', head: 'Math and diagrams,\ndrawn for you', sub: 'LaTeX and Mermaid, right on the page.', doc: 'unit', act: scrollPage('#preview p:has(+ h2:nth-of-type(3))') },
  { dev: 'iphone', file: 'iphone-4-styles.png', head: 'Style the page\nyour way', sub: 'Five page styles, from clean to manuscript.', doc: 'report', settings: { pageStyle: 'manuscript' } },
  { dev: 'iphone', file: 'iphone-5-files.png', head: 'All your writing,\nin one place', sub: 'Folders, pins and search across everything.', doc: 'brief', act: phoneDocs },
  { dev: 'iphone', file: 'iphone-6-export.png', head: 'Share it as PDF\nor Word', sub: 'Export, print or copy with formatting.', doc: 'brief', act: phoneSheet('share') },
  // iPad
  // (the first three with larger text: the ribbon folded away and the editor at 16 px, as you might set it on a tablet)
  { dev: 'ipad', file: 'ipad-1-split.png', head: 'Write Markdown.\nSee the page.', sub: 'Markdown and the printed page, side by side.', doc: 'brief', settings: { view: 'split', split: 0.46, outline: false, ribbonCollapsed: true, edSize: 16 } },
  { dev: 'ipad', file: 'ipad-2-styles.png', head: 'Style the page\nyour way', sub: 'Five page styles, from clean to manuscript.', doc: 'report', settings: { view: 'split', split: 0.46, outline: false, ribbonTab: 'layout', pageStyle: 'manuscript', edSize: 16 } },
  { dev: 'ipad', file: 'ipad-3-math.png', head: 'Math and diagrams,\ndrawn for you', sub: 'LaTeX and Mermaid, right on the page.', doc: 'unit', settings: { view: 'split', split: 0.46, outline: false, ribbonCollapsed: true, edSize: 16 } },
  { dev: 'ipad', file: 'ipad-4-files.png', head: 'All your writing,\nin one place', sub: 'Folders, pins and search across everything.', doc: 'brief', settings: { view: 'split', split: 0.2 }, act: sideDocs },
  { dev: 'ipad', file: 'ipad-5-page.png', head: 'A clean page,\nready to print', sub: 'Letter or A4, printed or saved as PDF.', doc: 'brief', settings: { view: 'preview' } },
  { dev: 'ipad', file: 'ipad-6-export.png', head: 'Share it as PDF\nor Word', sub: 'Export, print or copy with formatting.', doc: 'brief', settings: { view: 'split', split: 0.46 }, act: exportMenu },
  // Mac
  { dev: 'mac', file: 'mac-1-split.png', head: 'Write Markdown. See the page.', sub: 'Plain text on the left, a clean, printable page on the right.', doc: 'brief', settings: { ...MAC_BIG } },
  { dev: 'mac', file: 'mac-2-styles.png', head: 'Style the page your way', sub: 'Five page styles, from clean to manuscript, on Letter or A4.', doc: 'report', settings: { ...MAC_BIG, ribbonTab: 'layout', pageStyle: 'manuscript' } },
  { dev: 'mac', file: 'mac-3-math.png', head: 'Math and diagrams, drawn for you', sub: 'LaTeX equations and Mermaid charts, right on the page.', doc: 'unit', settings: { ...MAC_BIG } },
  { dev: 'mac', file: 'mac-4-files.png', head: 'All your writing, in one place', sub: 'Folders, pins and search across every document.', doc: 'brief', settings: { view: 'split', split: 0.5, outline: true, sideTab: 'docs' } },
  { dev: 'mac', file: 'mac-5-page.png', head: 'A clean page, ready to print', sub: 'Letter or A4, printed or saved as PDF.', doc: 'brief', settings: { view: 'preview', outline: true, sideTab: 'outline' } },
  { dev: 'mac', file: 'mac-6-export.png', head: 'Share it as PDF or Word', sub: 'Export, print, or copy with formatting into Docs or Mail.', doc: 'brief', settings: { view: 'split', split: 0.44 }, act: exportMenu },
  // Google Play (Android phone, unframed): the same stories as the iPhone's.
  { dev: 'android', out: 'play', file: 'phone-1.png', doc: 'brief' },
  { dev: 'android', out: 'play', file: 'phone-2.png', doc: 'brief', content: BRIEF_WRITE, act: phoneSelect(2, 'mobile checkout') },
  { dev: 'android', out: 'play', file: 'phone-3.png', doc: 'unit', act: scrollPage('#preview p:has(+ h2:nth-of-type(3))') },
  { dev: 'android', out: 'play', file: 'phone-4.png', doc: 'report', settings: { pageStyle: 'manuscript' } },
  { dev: 'android', out: 'play', file: 'phone-5.png', doc: 'brief', act: phoneDocs },
  { dev: 'android', out: 'play', file: 'phone-6.png', doc: 'brief', act: phoneSheet('share') },
];

/* ---------------- actions ---------------- */
function phoneEdit(line) {
  return async (p) => {
    await p.locator('#mEdit').click();
    await p.evaluate((line) => { const cm = document.querySelector('.CodeMirror').CodeMirror; cm.scrollTo(0, 0); cm.setCursor({ line, ch: cm.getLine(line).length }); }, line);
    await p.waitForTimeout(300);
  };
}
// Edit mode with a word selected, so the formatting bar shows the style it has (Bold, here).
function phoneSelect(line, word) {
  return async (p) => {
    await p.locator('#mEdit').click();
    await p.evaluate(([line, word]) => { const cm = document.querySelector('.CodeMirror').CodeMirror; cm.scrollTo(0, 0); const ch = cm.getLine(line).indexOf(word); cm.setSelection({ line, ch }, { line, ch: ch + word.length }); cm.focus(); }, [line, word]);
    await p.waitForTimeout(400);
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
// The app's clock: the family's MAC_CLOCK time ('Wed Nov 25  9:41 AM', 2026), so "edited 4 minutes ago" and every
// other time the app shows are the same on each run, and the Mac's menu bar agrees with them.
const NOW = { time: '2026-11-25T09:41:00-08:00', zone: 'America/Los_Angeles', locale: 'en-US' };
const VERSION = JSON.parse(fs.readFileSync(path.join(root, 'desktop/src-tauri/tauri.conf.json'), 'utf8')).version;
const browser = await playwright.chromium.launch({ executablePath: exe });

async function capture(story) {
  const D = DEVICES[story.dev];
  const ctx = await browser.newContext({
    viewport: { width: D.screen[0], height: D.screen[1] }, deviceScaleFactor: D.scale, colorScheme: 'dark', locale: NOW.locale, timezoneId: NOW.zone,
    userAgent: D.ua, isMobile: story.dev === 'iphone' || story.dev === 'android', hasTouch: D.touch > 0, reducedMotion: 'reduce',
  });
  const p = await ctx.newPage();
  const cdp = await ctx.newCDPSession(p);
  if (D.inset) await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: D.inset });
  // Reduce Transparency (an iOS and macOS accessibility setting): sheets dim the page instead of blurring it,
  // so the page behind stays readable in a small picture.
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }, { name: 'prefers-color-scheme', value: 'dark' }] });
  await ctx.clock.setSystemTime(new Date(NOW.time));
  const now = new Date(NOW.time).getTime();
  const library = LIBRARY.map(({ ago, ...d }) => ({ ...d, ...(d.id === story.doc && story.content ? { content: story.content } : {}), updated: now - ago }));
  await p.addInitScript(([hash, settings, library, current, D, mac, VERSION]) => {
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
      app: { getVersion: async () => VERSION }, dialog: {}, event: { listen: async () => {} }, opener: { openUrl: async () => {} },
    };
  }, [TERMS_HASH, { appTheme: 'dark', openTabs: [story.doc], ...story.settings }, library, story.doc, D, story.dev === 'mac', VERSION]);
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
    st.textContent = 'dialog.dlg::backdrop, .m-scrim { -webkit-backdrop-filter: none !important; backdrop-filter: none !important; background: rgba(10, 16, 30, .55) !important; }';
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
// The family template (tests/store-frame.mjs, the same file in Cowdrey.PDF) in Cowdrey.MD's blue.
// iPhone and iPad: every headline in the set is two lines (lines: 2, so the iPhone sits at the two-line height).
// The Mac: one headline line; the window at its real point size on the family desktop (the menu bar with the app's
// name and MAC_CLOCK, the Dock hidden) with the template's title bar, and that desktop on the MacBook.
async function compose(story, png) {
  if (story.dev === 'android') return png; // Google Play's pictures are the bare screen
  if (story.dev !== 'mac') return frame(browser, story.dev, { ...story, png, title: 'Cowdrey.MD', lines: 2 }, THEMES.md, FONTS);
  const D = DEVICES.mac;
  const screen = await desktop(browser, { theme: THEMES.md, app: 'Cowdrey.MD', fonts: FONTS,
    windows: [{ png, w: D.screen[0], h: D.screen[1] + D.titlebar, chrome: 'window' }] });
  return frame(browser, 'mac', { head: story.head.replace(/\n/g, ' '), sub: story.sub, device: 'macbook', png: screen, file: story.file }, THEMES.md, FONTS);
}

fs.mkdirSync(OUT, { recursive: true });
for (const story of STORIES) {
  if (ONLY && !ONLY.test(story.file)) continue;
  const png = await capture(story);
  const out = story.out === 'play' ? (process.argv[2] ? OUT : path.join(root, 'docs/play')) : OUT;
  fs.writeFileSync(path.join(out, story.file), await compose(story, png));
  console.log('wrote', path.join(out, story.file));
}
await browser.close();
