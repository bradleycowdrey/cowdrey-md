// End-to-end tests for Cowdrey.MD.
// Run: (cd desktop && npm ci) && node tests/e2e.mjs
// Libraries are served from desktop/node_modules, mapped from the exact jsDelivr URLs in index.html,
// so a URL that points at a file the npm package does not contain fails the suite.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch { playwright = require('/opt/node22/lib/node_modules/playwright'); }
const { chromium } = playwright;
const exe = fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;
const NM = path.join(root, 'desktop/node_modules');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const DOC = html; // index.html is a complete document

function localFor(url) {
  const m = url.match(/^https:\/\/cdn\.jsdelivr\.net\/npm\/((?:@[^/]+\/)?[^@/]+)@[^/]+\/(.+)$/);
  return m ? path.join(NM, m[1], m[2]) : null;
}

const browser = await chromium.launch({ executablePath: exe });
const results = [];
const missing = new Set();

async function newPage({ width = 1440, height = 900, scheme = 'light', block = [], init, fresh = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  // Tests start with the terms already agreed, unless they ask for a first visit.
  if (!fresh) await page.addInitScript(() => { if (!localStorage.getItem('cowdrey.md:terms')) localStorage.setItem('cowdrey.md:terms', JSON.stringify('2026-10-21')); });
  if (init) await page.addInitScript(init);
  await ctx.route('**/*', async (route) => {
    const u = route.request().url();
    if (u === 'https://app.test/') return route.fulfill({ body: DOC, contentType: 'text/html' });
    if (block.some((b) => u.includes(b))) return route.abort();
    const f = localFor(u);
    if (f) {
      if (!fs.existsSync(f)) { missing.add(u); return route.abort(); }
      return route.fulfill({ body: fs.readFileSync(f), contentType: 'application/javascript' });
    }
    return route.abort(); // fonts and anything else: offline
  });
  await page.goto('https://app.test/');
  await page.waitForFunction(() => document.querySelector('.CodeMirror') && document.querySelector('#ribbonBody .r-group'), null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(400);
  page.ctx = ctx;
  return page;
}
const cmv = (p) => p.evaluate(() => document.querySelector('.CodeMirror').CodeMirror.getValue());
const setDoc = (p, text) => p.evaluate((t) => { const cm = document.querySelector('.CodeMirror').CodeMirror; cm.setValue(t); cm.focus(); }, text);
const sel = (p, a, b) => p.evaluate(([a, b]) => { const cm = document.querySelector('.CodeMirror').CodeMirror; cm.setSelection(a, b || a); cm.focus(); }, [a, b]);
const settle = (p, ms = 250) => p.waitForTimeout(ms);
const isMacTest = process.platform === 'darwin'; // the app uses Cmd on a Mac and Ctrl elsewhere
const menu = async (p, id) => {
  for (let i = 0; i < 7; i++) {
    await p.click(`[data-menu="${i}"]`);
    if (await p.$(`#popover [data-cmd="${id}"]`)) { await p.click(`#popover [data-cmd="${id}"]`); await settle(p, 120); return; }
    await p.keyboard.press('Escape');
  }
  throw new Error('no menu item ' + id);
};
const cmd = async (p, id) => { await p.evaluate((id) => { const b = document.querySelector(`[data-cmd="${id}"]`); if (b) b.click(); else throw new Error('no button ' + id); }, id); await settle(p, 120); };

async function test(name, fn) {
  const t0 = Date.now();
  try { await fn(); results.push({ name, ok: true, ms: Date.now() - t0 }); }
  catch (e) { results.push({ name, ok: false, err: e.message.split('\n')[0] }); }
}
function eq(a, b, msg) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg || 'expected'}: ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
function ok(c, msg) { if (!c) throw new Error(msg); }

const P = await newPage();

await test('boots without errors and renders the welcome document', async () => {
  const info = await P.evaluate(() => ({
    mermaid: !!document.querySelector('.mermaid-block svg'), math: document.querySelectorAll('mjx-container').length,
    callouts: document.querySelectorAll('.callout').length, tasks: document.querySelectorAll('.task-check').length,
    toc: !!document.querySelector('.toc'), fm: !!document.querySelector('.front-matter'), hl: !!document.querySelector('.hljs-keyword'),
    footnotes: !!document.querySelector('.footnotes'), dl: !!document.querySelector('dl'), emoji: document.querySelector('.preview').textContent.includes('✨'),
    tabs: document.querySelectorAll('.doc-tab').length, outline: document.querySelectorAll('.ol-item').length,
  }));
  await settle(P, 2500);
  const mm = await P.evaluate(() => !!document.querySelector('.mermaid-block svg'));
  eq({ ...info, mermaid: mm }, { mermaid: true, math: 2, callouts: 3, tasks: 3, toc: true, fm: true, hl: true, footnotes: true, dl: true, emoji: true, tabs: 1, outline: 8 }, 'feature render');
  eq(P.errors, [], 'page errors');
});

await test('bold toggles on and off; italic inside bold keeps the bold', async () => {
  await setDoc(P, 'hello world');
  await sel(P, { line: 0, ch: 6 }, { line: 0, ch: 11 });
  await P.keyboard.press('Control+b'); eq(await cmv(P), 'hello **world**');
  await P.keyboard.press('Control+b'); eq(await cmv(P), 'hello world', 'toggle off');
  await sel(P, { line: 0, ch: 6 }, { line: 0, ch: 11 });
  await P.keyboard.press('Control+b'); await P.keyboard.press('Control+i');
  eq(await cmv(P), 'hello ***world***', 'italic inside bold');
});

await test('bold with no selection wraps the word under the cursor', async () => {
  await setDoc(P, 'alpha beta'); await sel(P, { line: 0, ch: 8 });
  await P.keyboard.press('Control+b'); eq(await cmv(P), 'alpha **beta**');
});

await test('headings: Ctrl+Alt+2 sets, repeats to clear, Ctrl+Alt+0 resets', async () => {
  await setDoc(P, 'Title'); await sel(P, { line: 0, ch: 2 });
  await P.keyboard.press('Control+Alt+2'); eq(await cmv(P), '## Title');
  await P.keyboard.press('Control+Alt+3'); eq(await cmv(P), '### Title');
  await P.keyboard.press('Control+Alt+3'); eq(await cmv(P), 'Title');
});

await test('lists: bullets, numbering, checklist and quote toggle over a selection', async () => {
  await setDoc(P, 'a\nb\n\nc'); await sel(P, { line: 0, ch: 0 }, { line: 3, ch: 1 });
  await P.keyboard.press('Control+Shift+7'); eq(await cmv(P), '1. a\n2. b\n\n3. c', 'numbered');
  await P.keyboard.press('Control+Shift+8'); eq(await cmv(P), '- a\n- b\n\n- c', 'bullets replace numbers');
  await P.keyboard.press('Control+Shift+8'); eq(await cmv(P), 'a\nb\n\nc', 'bullets off');
  await P.keyboard.press('Control+Shift+9'); eq(await cmv(P), '- [ ] a\n- [ ] b\n\n- [ ] c', 'checklist');
  await setDoc(P, 'q'); await P.keyboard.press("Control+'"); eq(await cmv(P), '> q', 'quote');
});

await test('Enter continues a numbered list and Tab indents it', async () => {
  await setDoc(P, '1. one'); await sel(P, { line: 0, ch: 6 });
  await P.keyboard.press('Enter'); await P.keyboard.type('two');
  eq(await cmv(P), '1. one\n2. two');
  await P.keyboard.press('Enter'); await P.keyboard.press('Tab');
  ok(/^\s+3\. $|^\s+1\. $/m.test((await cmv(P)).split('\n')[2]), 'indented item: ' + JSON.stringify((await cmv(P)).split('\n')[2]));
});

await test('link: selection becomes [text](https://) with the URL selected', async () => {
  await setDoc(P, 'see docs'); await sel(P, { line: 0, ch: 4 }, { line: 0, ch: 8 });
  await P.keyboard.press('Control+k'); await P.keyboard.type('https://a.b');
  eq(await cmv(P), 'see [docs](https://a.b)');
});

await test('pasting a URL over selected text makes a link', async () => {
  await setDoc(P, 'click here'); await sel(P, { line: 0, ch: 6 }, { line: 0, ch: 10 });
  await P.evaluate(() => { const dt = new DataTransfer(); dt.setData('text/plain', 'https://example.com'); const e = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }); document.querySelector('.CodeMirror textarea, .CodeMirror [contenteditable]').dispatchEvent(e); });
  await settle(P); eq(await cmv(P), 'click [here](https://example.com)');
});

await test('footnotes number themselves and add the note at the end', async () => {
  await setDoc(P, 'One.[^1]\n\n[^1]: first'); await sel(P, { line: 0, ch: 3 });
  await menu(P, 'footnote'); await P.keyboard.type('second');
  eq(await cmv(P), 'One[^2].[^1]\n\n[^1]: first\n[^2]: second');
});

await test('table picker inserts a 3 × 4 table that renders', async () => {
  await setDoc(P, 'Intro'); await sel(P, { line: 0, ch: 5 });
  await P.click('[data-tab="insert"]'); await P.click('[data-cmd="table"]');
  await P.click('.tp-cell[data-r="3"][data-c="4"]'); await settle(P, 300);
  const v = await cmv(P); ok(v.startsWith('Intro\n\n| Column 1 | Column 2 | Column 3 | Column 4 |'), v.slice(0, 80));
  eq(await P.evaluate(() => document.querySelectorAll('.preview table tr').length), 3, 'rows');
  await P.click('[data-tab="home"]');
});

await test('Tidy table aligns columns, keeps alignment, pads ragged rows, respects escaped pipes', async () => {
  await setDoc(P, '|a|bb|\n|:-|-:|\n|ccc|d|\n|x\\|y|');
  await sel(P, { line: 0, ch: 1 }); await P.keyboard.press('Control+Alt+t');
  eq(await cmv(P), '| a    |  bb |\n| :--- | --: |\n| ccc  |   d |\n| x\\|y |     |');
});

await test('find counts matches, honours case and regex; replace all with $1', async () => {
  await setDoc(P, 'Cat cat CAT\ndog-1 dog-22');
  await P.keyboard.press('Control+f'); await P.fill('#findInput', 'cat'); await settle(P);
  eq(await P.textContent('#findCount'), '1 of 3');
  await P.click('#findCase'); await settle(P); eq(await P.textContent('#findCount'), '1 of 1', 'case sensitive');
  await P.click('#findCase'); await P.click('#findRegex');
  await P.fill('#findInput', 'dog-(\\d+)'); await settle(P);
  await P.keyboard.press('Escape'); await P.keyboard.press('Control+h');
  await P.fill('#findInput', 'dog-(\\d+)'); await P.fill('#replaceInput', 'n$1'); await P.click('#replaceAll'); await settle(P);
  eq(await cmv(P), 'Cat cat CAT\nn1 n22');
  await P.click('#findRegex'); await P.click('#findClose');
});

await test('ticking a checkbox in the preview updates the source', async () => {
  await setDoc(P, '- [ ] task one\n- [x] task two'); await settle(P, 300);
  await P.click('.task-check >> nth=0'); await settle(P);
  await P.click('.task-check >> nth=1'); await settle(P);
  eq(await cmv(P), '- [x] task one\n- [ ] task two');
});

await test('security: raw HTML cannot run script', async () => {
  await P.evaluate(() => { window.__xss = 0; });
  await setDoc(P, [
    '<img src=x onerror="window.__xss=1">', '<script>window.__xss=2</script>', '[a](javascript:window.__xss=3)',
    '<svg><script>window.__xss=4</script></svg>', '<iframe src="javascript:parent.__xss=5"></iframe>',
    '<a href="#" onclick="window.__xss=6">x</a>', '<style>body{display:none}</style>', '<form action="https://evil"><button>go</button></form>',
    '<details open ontoggle="window.__xss=7">d</details>', '<math><mtext><table><mglyph><style><img src=x onerror="window.__xss=8">',
  ].join('\n\n'));
  await settle(P, 600);
  await P.evaluate(() => { document.querySelectorAll('.preview a').forEach((a) => { try { a.click(); } catch {} }); });
  await settle(P, 300);
  eq(await P.evaluate(() => window.__xss), 0, 'xss flag');
  eq(await P.evaluate(() => document.querySelectorAll('.preview script, .preview iframe, .preview style, .preview form, .preview [onerror], .preview [onclick]').length), 0, 'dangerous nodes');
  ok(await P.evaluate(() => getComputedStyle(document.body).display !== 'none'), 'style injection');
});

await test('math: prices are not math, real math is', async () => {
  await setDoc(P, 'It costs $5 and $10 today.\n\nArea is $x^2$ here.'); await settle(P, 1200);
  const r = await P.evaluate(() => ({ p1: document.querySelectorAll('.preview p')[0].textContent, n: document.querySelectorAll('.preview .math-inline').length }));
  eq(r, { p1: 'It costs $5 and $10 today.', n: 1 });
});

await test('a broken diagram shows an error and leaves no debris', async () => {
  await setDoc(P, '```mermaid\nflowchart LR\n  A -->\n```'); await settle(P, 2500);
  ok(await P.evaluate(() => !!document.querySelector('.mermaid-block .render-error')), 'error box');
  eq(await P.evaluate(() => [...document.body.children].filter((e) => /^d?cowdrey-mmd/.test(e.id)).length), 0, 'orphan nodes');
});

await test('front matter renders and keeps source lines aligned', async () => {
  await setDoc(P, '---\ntitle: T\n---\n\n# Head\n\ntext'); await settle(P, 300);
  const r = await P.evaluate(() => ({ fm: !!document.querySelector('.front-matter'), line: document.querySelector('.preview h1').getAttribute('data-line') }));
  eq(r, { fm: true, line: '4' });
});

await test('documents: new, auto-title, switch tabs keeps text and undo, close, delete', async () => {
  await setDoc(P, 'first doc text');
  const firstTitle = await P.inputValue('#docTitle');
  await cmd(P, 'newDoc'); await P.keyboard.type('# Second\n\nbody'); await settle(P, 400);
  eq(await P.inputValue('#docTitle'), 'Second', 'auto title');
  eq(await P.evaluate(() => document.querySelectorAll('.doc-tab').length), 2, 'two tabs');
  await P.click('.doc-tab >> nth=0'); await settle(P);
  eq(await cmv(P), 'first doc text', 'switch back');
  await P.click('.doc-tab >> nth=1'); await settle(P);
  await P.keyboard.press('Control+z'); ok((await cmv(P)) !== '# Second\n\nbody', 'undo works in switched doc');
  await P.keyboard.press('Control+Shift+z');
  await P.click('.doc-tab.current .x'); await settle(P);
  eq(await P.evaluate(() => document.querySelectorAll('.doc-tab').length), 1, 'tab closed');
  await P.click('[data-side="docs"]'); await settle(P);
  const n0 = await P.evaluate(() => document.querySelectorAll('.doc-item').length);
  await P.click('.doc-item:not(.current) .del'); await P.click('[data-yes]'); await settle(P);
  eq(await P.evaluate(() => document.querySelectorAll('.doc-item').length), n0 - 1, 'deleted');
  await P.click('[data-side="outline"]');
  ok(firstTitle, 'had a title');
});

await test('renaming sticks and auto-title stops overwriting it', async () => {
  await setDoc(P, '# Auto'); await settle(P, 300);
  await P.fill('#docTitle', 'My name'); await P.keyboard.press('Enter');
  await P.keyboard.type('\n\n# Other'); await settle(P, 400);
  eq(await P.inputValue('#docTitle'), 'My name');
});

await test('work and settings survive a reload', async () => {
  await setDoc(P, 'persist me ' + Date.now()); const v = await cmv(P);
  await P.click('[data-tab="layout"]'); await P.click('[data-pagestyle="github"]');
  await P.click('#sbViews [data-view="editor"]'); await settle(P, 900);
  await P.reload(); await P.waitForFunction(() => document.querySelector('.CodeMirror')); await settle(P, 600);
  eq(await cmv(P), v, 'text'); eq(await P.evaluate(() => [document.querySelector('#app').dataset.view, document.querySelector('#page').className.includes('style-github')]), ['editor', true], 'settings');
  await P.click('#sbViews [data-view="split"]'); await P.click('[data-tab="layout"]'); await P.click('[data-pagestyle="cowdrey"]'); await P.click('[data-tab="home"]');
});

await test('sync scroll follows the editor', async () => {
  await setDoc(P, Array.from({ length: 120 }, (_, i) => `## Section ${i}\n\nParagraph ${i} with some text.`).join('\n\n')); await settle(P, 600);
  await P.evaluate(() => { const cm = document.querySelector('.CodeMirror').CodeMirror; cm.scrollTo(null, cm.heightAtLine(200, 'local')); }); await settle(P, 400);
  const r = await P.evaluate(() => { const c = document.querySelector('#canvas'); const h = [...document.querySelectorAll('.preview h2')].find((e) => e.getBoundingClientRect().top >= c.getBoundingClientRect().top - 5); return h && h.textContent; });
  ok(r && Math.abs(parseInt(r.replace(/\D/g, '')) - 50) <= 2, 'preview at section ~50 (line 200), got ' + r);
});

await test('zoom controls and fit', async () => {
  await menu(P, 'zoom100'); eq(await P.textContent('#zoomPct'), '100%');
  await P.click('#zoomInBtn'); eq(await P.textContent('#zoomPct'), '110%');
  await P.click('#zoomPct'); ok((await P.textContent('#zoomPct')).startsWith('Fit'), 'fit');
});

await test('theme button cycles light, dark, system', async () => {
  const seq = [];
  for (let i = 0; i < 3; i++) { await P.click('#themeBtn'); seq.push(await P.evaluate(() => document.documentElement.getAttribute('data-theme'))); }
  eq(seq, ['light', 'dark', null]);
});

await test('word count dialog and shortcuts dialog open and close', async () => {
  await setDoc(P, 'One two three. Four five.'); await settle(P, 300);
  eq(await P.textContent('#sbWords'), '5 words');
  await P.click('#sbWords'); ok(await P.evaluate(() => document.querySelector('#dialog').open), 'stats open');
  ok((await P.textContent('#dialog')).includes('Sentences'), 'stats content'); await P.keyboard.press('Escape');
  await P.keyboard.press('Control+/'); ok((await P.textContent('#dialog')).includes('Keyboard shortcuts'), 'shortcuts'); await P.keyboard.press('Escape');
  ok(!(await P.evaluate(() => document.querySelector('#dialog').open)), 'closed');
});

await test('outline click moves the cursor to the heading', async () => {
  await setDoc(P, '# A\n\ntext\n\n## B\n\nmore'); await settle(P, 300);
  await P.click('.ol-item >> nth=1'); await settle(P);
  eq(await P.evaluate(() => document.querySelector('.CodeMirror').CodeMirror.getCursor().line), 4);
});

await test('export Markdown and HTML download real files', async () => {
  await cmd(P, 'newDoc'); await setDoc(P, '# Export test\n\n<img src=x onerror=alert(1)> ok'); await settle(P, 400);
  let d = P.waitForEvent('download'); await P.evaluate(() => document.querySelector('[data-cmd="saveMd"]') || 0); await P.click('#exportBtn'); await P.click('#popover [data-cmd="saveMd"]');
  let dl = await d; eq(dl.suggestedFilename(), 'Export test.md');
  eq(fs.readFileSync(await dl.path(), 'utf8'), '# Export test\n\n<img src=x onerror=alert(1)> ok');
  d = P.waitForEvent('download'); await P.click('#exportBtn'); await P.click('#popover [data-cmd="exportHtml"]');
  dl = await d; const h = fs.readFileSync(await dl.path(), 'utf8');
  ok(h.startsWith('<!doctype html>') && h.includes('<h1 id="h-export-test">Export test</h1>') && !h.includes('onerror') && !h.includes('data-line'), 'html export');
});

await test('copy Markdown puts the source on the clipboard', async () => {
  await setDoc(P, 'clip **me**'); await P.click('#exportBtn'); await P.click('#popover [data-cmd="copyMd"]'); await settle(P);
  eq(await P.evaluate(() => navigator.clipboard.readText()), 'clip **me**');
});

await test('pasting an image adds a picture reference', async () => {
  await setDoc(P, 'pic: '); await sel(P, { line: 0, ch: 5 });
  await P.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 4; c.height = 4; const b = await new Promise((r) => c.toBlob(r, 'image/png'));
    const dt = new DataTransfer(); dt.items.add(new File([b], 'dot.png', { type: 'image/png' }));
    document.querySelector('.CodeMirror [contenteditable]').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await settle(P, 600);
  const v = await cmv(P); ok(/^pic: !\[dot\]\[image-1\]\n\n\[image-1\]: data:image\/png;base64,/.test(v), v.slice(0, 60));
  ok(await P.evaluate(() => !!document.querySelector('.preview img[src^="data:image/png"]')), 'renders');
});

await test('shortcuts do not edit the document while typing the title', async () => {
  await setDoc(P, 'keep'); await P.click('#docTitle'); await P.keyboard.press('Control+b');
  eq(await cmv(P), 'keep'); await P.keyboard.press('Escape');
});

await test('every button has an accessible name', async () => {
  const unnamed = await P.evaluate(() => [...document.querySelectorAll('button')].filter((b) => b.offsetParent && !(b.textContent.trim() || b.getAttribute('aria-label') || b.getAttribute('title'))).map((b) => b.outerHTML.slice(0, 80)));
  eq(unnamed, []);
});

await test('large document stays responsive', async () => {
  const big = Array.from({ length: 1500 }, (_, i) => `## H${i}\n\nLine ${i} with **bold**, *italic*, \`code\` and a [link](https://x.y).\n\n- item\n- item`).join('\n\n');
  await setDoc(P, big); await settle(P, 1500);
  const t = await P.evaluate(async () => { const cm = document.querySelector('.CodeMirror').CodeMirror; cm.setCursor(cm.lastLine(), 0); const t0 = performance.now(); cm.replaceSelection('x'); await new Promise((r) => setTimeout(r, 400)); return performance.now() - t0; });
  const render = await P.evaluate(() => { const t0 = performance.now(); document.querySelector('.CodeMirror').CodeMirror.replaceSelection('y'); return performance.now() - t0; });
  ok(render < 50, `keystroke took ${render.toFixed(0)}ms`);
  ok(t < 2000, `render cycle ${t.toFixed(0)}ms`);
  await setDoc(P, 'small');
});

await test('missing preview engine keeps the editor usable', async () => {
  const Q = await newPage({ block: ['markdown-it@'] });
  const r = await Q.evaluate(() => ({ ribbon: !!document.querySelector('#ribbonBody .r-group'), tabs: document.querySelectorAll('.doc-tab').length, msg: document.querySelector('.preview').textContent }));
  ok(r.ribbon && r.tabs === 1 && /preview engine did not load/.test(r.msg), JSON.stringify(r));
  await Q.click('.CodeMirror'); await Q.keyboard.type('still typing'); await settle(Q, 300);
  eq(Q.errors, [], 'page errors'); await Q.ctx.close();
});

await test('full storage shows a clear warning instead of failing silently', async () => {
  const Q = await newPage({ init: () => { const orig = Storage.prototype.setItem; Storage.prototype.setItem = function (k, v) { if (String(k).includes(':doc:')) throw new DOMException('full', 'QuotaExceededError'); return orig.call(this, k, v); }; } });
  await Q.click('.CodeMirror'); await Q.keyboard.type('x'); await settle(Q, 900);
  ok(/Not saved/.test(await Q.textContent('#saveState')), await Q.textContent('#saveState'));
  await Q.ctx.close();
});

await test('phone width: no sideways scrolling, writing gets the screen, preview one tap away', async () => {
  const Q = await newPage({ width: 390, height: 844 });
  const r = await Q.evaluate(() => ({ h: document.documentElement.scrollWidth <= innerWidth, ed: document.querySelector('.editor-pane').getBoundingClientRect().height > 450, ribbon: document.querySelector('#ribbon').classList.contains('collapsed') }));
  eq(r, { h: true, ed: true, ribbon: true });
  await Q.click('#sbViews [data-view="preview"]'); await settle(Q, 300);
  ok(await Q.evaluate(() => document.querySelector('.preview-pane').getBoundingClientRect().height > 450), 'preview fills the screen');
  eq(Q.errors, [], 'page errors'); await Q.ctx.close();
});

await test('keyboard: ribbon tabs keep focus and move with arrow keys; tab close is a real button', async () => {
  await P.focus('[data-tab="home"]'); await P.keyboard.press('ArrowRight'); await settle(P, 150);
  eq(await P.evaluate(() => [document.activeElement.dataset.tab, document.querySelector('#ribbonBody [aria-labelledby]').getAttribute('aria-labelledby')]), ['insert', 'rtab-insert']);
  await P.click('[data-tab="layout"]'); await P.focus('[data-pagestyle="github"]'); await P.keyboard.press('Enter'); await settle(P, 150);
  eq(await P.evaluate(() => document.activeElement.dataset.pagestyle), 'github', 'focus stays on the card');
  await P.keyboard.press('Shift+Tab'); await P.keyboard.press('Tab'); await P.focus('[data-pagestyle="cowdrey"]'); await P.keyboard.press('Enter');
  await P.click('[data-tab="home"]');
  eq(await P.evaluate(() => { const x = document.querySelector('.doc-tab .x'); const r = x.getBoundingClientRect(); return [x.tagName, r.width >= 24 && r.height >= 24, !x.closest('button.doc-tab')]; }), ['BUTTON', true, true]);
});

await test('dark theme renders without errors', async () => {
  const Q = await newPage({ scheme: 'dark' }); await settle(Q, 1500);
  const bg = await Q.evaluate(() => getComputedStyle(document.body).backgroundColor);
  ok(bg !== 'rgb(245, 247, 251)', 'dark body ' + bg); eq(Q.errors, [], 'page errors'); await Q.ctx.close();
});


// ---- regression tests for bugs found in QA review ----
await test('regex replace keeps lookarounds and expands $1', async () => {
  await setDoc(P, 'foobar foobaz');
  await P.keyboard.press('Control+h'); await P.click('#findRegex');
  await P.fill('#findInput', 'foo(?=bar)'); await P.fill('#replaceInput', 'X'); await P.click('#replaceAll'); await settle(P);
  eq(await cmv(P), 'Xbar foobaz', 'lookahead');
  await P.fill('#findInput', '(o+)baz'); await P.fill('#replaceInput', '[$1|$&|$$]'); await P.click('#replaceAll'); await settle(P);
  eq(await cmv(P), 'Xbar f[oo|oobaz|$]', 'groups');
  await P.click('#findRegex'); await P.click('#findClose');
});

await test('replace that contains the search text moves on instead of looping', async () => {
  await setDoc(P, 'a b a');
  await P.keyboard.press('Control+h'); await P.fill('#findInput', 'a'); await P.fill('#replaceInput', 'aa');
  await P.click('#replaceOne'); await P.click('#replaceOne'); await settle(P);
  eq(await cmv(P), 'aa b aa'); await P.click('#findClose');
});

await test('typing with find open does not yank the view back', async () => {
  await setDoc(P, 'needle\n' + 'x\n'.repeat(400) + 'end');
  await P.keyboard.press('Control+f'); await P.fill('#findInput', 'needle'); await settle(P);
  await P.evaluate(() => { const cm = document.querySelector('.CodeMirror').CodeMirror; cm.focus(); cm.setCursor(cm.lastLine(), 3); cm.scrollIntoView(null); });
  await P.keyboard.type('zz'); await settle(P, 500);
  const top = await P.evaluate(() => document.querySelector('.CodeMirror').CodeMirror.getScrollInfo().top);
  ok(top > 1000, 'scroll top ' + top); await P.click('#findClose');
});

await test('italic over "*one* and *two*" wraps instead of mangling', async () => {
  await setDoc(P, '*one* and *two*'); await sel(P, { line: 0, ch: 0 }, { line: 0, ch: 15 });
  await P.keyboard.press('Control+i'); eq(await cmv(P), '**one* and *two**');
  await setDoc(P, '**w**'); await sel(P, { line: 0, ch: 0 }, { line: 0, ch: 5 });
  await P.keyboard.press('Control+i'); eq(await cmv(P), '***w***', 'italic on selected bold');
  await setDoc(P, '***w***'); await sel(P, { line: 0, ch: 3 }, { line: 0, ch: 4 });
  await P.keyboard.press('Control+i'); eq(await cmv(P), '**w**', 'remove italic from bold-italic');
});

await test('clear formatting handles *** and leaves snake_case alone', async () => {
  await setDoc(P, '***x*** my_var_name __u__ ~~s~~'); await sel(P, { line: 0, ch: 0 }, { line: 0, ch: 31 });
  await P.keyboard.press('Control+\\'); eq(await cmv(P), 'x my_var_name u s');
});

await test('tidy table survives a lone backtick', async () => {
  await setDoc(P, '| a | b | c |\n|---|---|---|\n| don`t | x | y |'); await sel(P, { line: 0, ch: 1 });
  await P.keyboard.press('Control+Alt+t');
  eq((await cmv(P)).split('\n')[2], '| don`t | x   | y   |');
});

await test('heading on an empty line, quote on mixed lines, code block mid-line', async () => {
  await setDoc(P, ''); await P.keyboard.press('Control+Alt+1'); await P.keyboard.type('Hi'); eq(await cmv(P), '# Hi');
  await setDoc(P, '> a\nb'); await sel(P, { line: 0, ch: 0 }, { line: 1, ch: 1 }); await P.keyboard.press("Control+'"); eq(await cmv(P), '> a\n> b');
  await setDoc(P, 'foo bar'); await sel(P, { line: 0, ch: 4 }, { line: 0, ch: 7 }); await P.keyboard.press('Control+Alt+c'); eq(await cmv(P), 'foo \n```\nbar\n```');
});

await test('a second picture never lands inside the first picture reference', async () => {
  await setDoc(P, 'Text\n\n[image-1]: data:image/png;base64,AAAA'); await sel(P, { line: 2, ch: 38 });
  await P.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 2; c.height = 2; const b = await new Promise((r) => c.toBlob(r, 'image/png'));
    const dt = new DataTransfer(); dt.items.add(new File([b], 'two.png', { type: 'image/png' }));
    document.querySelector('.CodeMirror [contenteditable]').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await settle(P, 500);
  const lines = (await cmv(P)).split('\n');
  ok(lines.includes('[image-1]: data:image/png;base64,AAAA') && lines.includes('![two][image-2]') && lines.some((l) => l.startsWith('[image-2]: data:')), JSON.stringify(lines.map((l) => l.slice(0, 30))));
});

await test('document HTML cannot clobber the page or collide with app ids', async () => {
  await setDoc(P, '<img name="querySelector" src="x">\n<a id="mermaid">m</a>\n\n# Toast\n\n<div id="sbPage">fake</div>\n\n[jump](#toast)'); await settle(P, 400);
  ok(await P.evaluate(() => typeof document.querySelector === 'function'), 'querySelector intact');
  ok(await P.evaluate(() => document.querySelector('#toast').classList.contains('toast')), 'app toast is the real one');
  ok(await P.evaluate(() => /^Page|page$/.test(document.querySelector('#sbPage').textContent)), 'status bar intact');
  eq(await P.evaluate(() => document.querySelector('.preview a[href^="#"]').getAttribute('href')), '#h-toast', 'heading link resolved');
  await P.keyboard.type('x'); await settle(P, 300); eq(P.errors, [], 'page errors');
});

await test('links to other files do not navigate away from the editor', async () => {
  await setDoc(P, '[other](notes.md)'); await settle(P, 300);
  await P.click('.preview a'); await settle(P, 300);
  ok((await P.url()).startsWith('https://app.test/'), 'url ' + (await P.url()));
  ok(await P.evaluate(() => !!document.querySelector('.CodeMirror')), 'editor still here');
});

await test('two browser tabs share documents without erasing each other', async () => {
  await setDoc(P, 'from tab A'); await settle(P, 900);
  const idA = await P.evaluate(() => JSON.parse(localStorage.getItem('cowdrey.md:current')));
  const Q = await P.ctx.newPage(); Q.errors = [];
  await Q.goto('https://app.test/'); await Q.waitForFunction(() => document.querySelector('.CodeMirror')); await settle(Q, 600);
  // tab B makes a new document
  await Q.click('.side-act[data-cmd="newDoc"]'); await Q.keyboard.type('# Made in B'); await settle(Q, 1000);
  // tab A keeps editing its own document afterwards
  await P.bringToFront(); await P.click('.CodeMirror'); await P.keyboard.press('Control+End'); await P.keyboard.type(' and more'); await settle(P, 1000);
  const stored = await P.evaluate(() => JSON.parse(localStorage.getItem('cowdrey.md:index')).map((m) => m.title));
  ok(stored.includes('Made in B'), 'B\'s document survived A\'s save: ' + JSON.stringify(stored));
  const aText = await P.evaluate((id) => JSON.parse(localStorage.getItem('cowdrey.md:doc:' + id)), idA);
  eq(aText, 'from tab A and more', 'A text');
  await Q.close();
});


await test('Mac app: Check for updates finds a newer release and offers the DMG', async () => {
  const tauriMock = () => {
    window.__calls = [];
    window.__TAURI__ = {
      core: { invoke: async (cmd) => (cmd === 'take_opened_files' ? [] : null) },
      app: { getVersion: async () => '1.0.1' },
      dialog: { save: async () => null, open: async () => null },
      event: { listen: async () => {} },
      opener: { openUrl: async (u) => { window.__calls.push(u); } },
    };
    localStorage.setItem('cowdrey.md:updateChecked', String(Date.now())); // no automatic check during the test
  };
  const Q = await newPage({ init: tauriMock });
  let release = { tag_name: 'v1.2.0', html_url: 'https://github.com/x/releases/tag/v1.2.0', body: '## What is new\n\n- Faster saving', assets: [{ name: 'Cowdrey.MD_1.2.0_universal.dmg', browser_download_url: 'https://github.com/x/releases/download/v1.2.0/Cowdrey.MD_1.2.0_universal.dmg' }] };
  let status = 200;
  await Q.route('https://api.github.com/**', (r) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(release) }));
  await menu(Q, 'checkUpdates'); await settle(Q, 400);
  ok((await Q.textContent('#dialog h2')) === 'Cowdrey.MD 1.2.0 is available', await Q.textContent('#dialog'));
  ok((await Q.textContent('#dialog')).includes('Faster saving'), 'release notes shown');
  await Q.click('#dialog .btn.primary'); await settle(Q, 200);
  eq(await Q.evaluate(() => window.__calls), ['https://github.com/x/releases/download/v1.2.0/Cowdrey.MD_1.2.0_universal.dmg'], 'opens the DMG');
  release = { tag_name: 'v1.0.1', assets: [] };
  await menu(Q, 'checkUpdates'); await settle(Q, 400);
  ok((await Q.textContent('#toast')).includes('latest version (1.0.1)'), await Q.textContent('#toast'));
  status = 500;
  await menu(Q, 'checkUpdates'); await settle(Q, 400);
  ok((await Q.textContent('#dialog h2')) === 'Could not check for updates', 'error dialog'); await Q.keyboard.press('Escape');
  eq(Q.errors, [], 'page errors'); await Q.ctx.close();
});

await test('Mac app: the daily check stays quiet when up to date and respects Skip', async () => {
  const Q = await newPage({ init: () => {
    window.__TAURI__ = { core: { invoke: async () => [] }, app: { getVersion: async () => '1.0.1' }, dialog: {}, event: { listen: async () => {} }, opener: { openUrl: async () => {} } };
    localStorage.setItem('cowdrey.md:skipVersion', JSON.stringify('1.1.0'));
  } });
  await Q.route('https://api.github.com/**', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ tag_name: 'v1.1.0', assets: [] }) }));
  await settle(Q, 6000);
  ok(!(await Q.evaluate(() => document.querySelector('#dialog').open)), 'no dialog for a skipped version');
  ok(await Q.evaluate(() => Number(localStorage.getItem('cowdrey.md:updateChecked')) > 0), 'check recorded');
  await Q.ctx.close();
});

await test('web version has no update menu item', async () => {
  await P.click('[data-menu="6"]');
  ok(!(await P.$('#popover [data-cmd="checkUpdates"]')), 'hidden on the web'); await P.keyboard.press('Escape');
});


await test('existing users see the new name on their stored welcome document', async () => {
  const Q = await newPage({ init: () => {
    if (localStorage.getItem('cowdrey.md:index')) return;
    localStorage.setItem('cowdrey.md:index', JSON.stringify([{ id: 'dold', title: 'Welcome to Cowdrey' + '.md', autoTitle: false, updated: 1 }]));
    localStorage.setItem('cowdrey.md:doc:dold', JSON.stringify('# Welcome to Cowdrey' + '.md\n\nI am **Cowdrey' + '.md**.'));
    localStorage.setItem('cowdrey.md:current', JSON.stringify('dold'));
  } });
  eq(await Q.inputValue('#docTitle'), 'Welcome to Cowdrey.MD');
  eq(await Q.evaluate(() => document.querySelector('.CodeMirror').CodeMirror.getValue()), '# Welcome to Cowdrey.MD\n\nI am **Cowdrey.MD**.');
  await Q.ctx.close();
});


await test('Mac app: signed updates install in place, save first, and restart', async () => {
  const Q = await newPage({ init: () => {
    window.__calls = [];
    localStorage.setItem('cowdrey.md:updateChecked', String(Date.now()));
    window.__TAURI__ = {
      core: { invoke: async (cmd) => { window.__calls.push('invoke:' + cmd); return cmd === 'take_opened_files' ? [] : null; } },
      app: { getVersion: async () => '1.0.6' },
      dialog: {}, event: { listen: async () => {} }, opener: { openUrl: async (u) => window.__calls.push('open:' + u) },
      updater: { check: async () => window.__update || null },
      process: { relaunch: async () => { window.__calls.push('relaunch:' + localStorage.getItem('cowdrey.md:doc:' + JSON.parse(localStorage.getItem('cowdrey.md:current')))); } },
    };
  } });
  await menu(Q, 'checkUpdates'); await settle(Q, 300);
  ok((await Q.textContent('#toast')).includes('latest version (1.0.6)'), 'no update: ' + await Q.textContent('#toast'));
  await Q.evaluate(() => {
    window.__update = { version: '1.0.7', body: '- Smoother saving', downloadAndInstall: async (cb) => {
      cb({ event: 'Started', data: { contentLength: 100 } });
      cb({ event: 'Progress', data: { chunkLength: 40 } }); window.__mid = document.querySelector('#updStatus').textContent;
      cb({ event: 'Progress', data: { chunkLength: 60 } }); cb({ event: 'Finished' }); } };
  });
  await Q.click('.CodeMirror'); await Q.keyboard.press('Control+End'); await Q.keyboard.type(' unsaved edit');
  await menu(Q, 'checkUpdates'); await settle(Q, 300);
  eq(await Q.textContent('#dialog h2'), 'Cowdrey.MD 1.0.7 is available');
  ok((await Q.textContent('#dialog')).includes('Smoother saving'), 'notes');
  await Q.click('#dialog .btn.primary'); await settle(Q, 500);
  eq(await Q.evaluate(() => window.__mid), 'Downloading… 40%', 'progress shown');
  const calls = await Q.evaluate(() => window.__calls);
  ok(calls.includes('invoke:allow_exit'), 'quit guard released');
  const rl = calls.find((c) => c.startsWith('relaunch:'));
  ok(rl && rl.includes('unsaved edit'), 'work saved before restart: ' + rl);
  eq(Q.errors, [], 'page errors'); await Q.ctx.close();
});


await test('Share app button copies the app link, the Mac link and a ready message', async () => {
  await P.click('#shareAppBtn'); await settle(P, 150);
  ok((await P.textContent('#popover')).includes('Share Cowdrey.MD'), 'menu');
  await P.click('#popover [data-share="web"]'); await settle(P, 200);
  eq(await P.evaluate(() => navigator.clipboard.readText()), 'https://bradcowdrey.com/cowdrey-md');
  await P.click('#shareAppBtn'); await P.click('#popover [data-share="message"]'); await settle(P, 200);
  const msg = await P.evaluate(() => navigator.clipboard.readText());
  ok(msg.includes('Free. Forever.') && msg.includes('releases/latest'), msg);
});


await test('Mac menu bar mirrors the in-app menus, shortcuts and check marks', async () => {
  const Q = await newPage({ init: () => {
    window.__menus = []; window.__handlers = {};
    localStorage.setItem('cowdrey.md:updateChecked', String(Date.now()));
    window.__TAURI__ = {
      core: { invoke: async (cmd, args) => { if (cmd === 'set_menu') window.__menus.push(args.menus); return cmd === 'take_opened_files' ? [] : null; } },
      app: { getVersion: async () => '1.0.7' }, dialog: {}, opener: { openUrl: async () => {} },
      event: { listen: async (name, fn) => { window.__handlers[name] = fn; } },
    };
  } });
  await settle(Q, 400);
  const spec = await Q.evaluate(() => window.__menus[window.__menus.length - 1]);
  eq(spec.map((m) => m.title), ['File', 'Edit', 'View', 'Insert', 'Format', 'Tools', 'Help'], 'same menus');
  // every in-app menu item appears with the same label
  for (let i = 0; i < 7; i++) {
    await Q.click(`[data-menu="${i}"]`);
    const inApp = await Q.evaluate(() => [...document.querySelectorAll('#popover .mi span:nth-child(2)')].map((x) => x.textContent));
    await Q.keyboard.press('Escape');
    const native = spec[i].items.filter((x) => x.kind === 'item').map((x) => x.label);
    const expected = inApp.filter((l) => !(spec[i].title === 'Help' && /About|Check for updates/.test(l)) && !['Undo', 'Redo', 'Select all'].includes(l));
    eq(native, expected, spec[i].title + ' labels');
  }
  const find = (label) => spec.flatMap((m) => m.items).find((x) => x.label === label);
  eq(find('Bold').accel, 'CmdOrCtrl+B'); eq(find('Clear formatting').accel, 'CmdOrCtrl+Backslash'); eq(find('Heading 2').accel, 'CmdOrCtrl+Alt+2');
  eq(find('Zoom out').accel, 'CmdOrCtrl+Alt+Minus'); eq(find('Ruler').checked, true);
  eq(spec[1].items.filter((x) => x.kind === 'native').map((x) => x.role), ['undo', 'redo', 'cut', 'copy', 'paste', 'select_all'], 'native edit items');
  const accels = spec.flatMap((m) => m.items).map((x) => x.accel).filter(Boolean);
  eq(accels.length, new Set(accels).size, 'no duplicate shortcuts');
  // choosing a Mac menu item runs the command, and check marks follow
  await Q.evaluate(() => window.__handlers['menu-command']({ payload: 'toggleRuler' })); await settle(Q, 300);
  eq(await Q.evaluate(() => document.querySelector('#app').dataset.ruler), 'off', 'ruler hidden');
  const spec2 = await Q.evaluate(() => window.__menus[window.__menus.length - 1]);
  eq(spec2.flatMap((m) => m.items).find((x) => x.label === 'Ruler').checked, false, 'check mark updated');
  await Q.evaluate(() => window.__handlers['menu-command']({ payload: 'toggleRuler' }));
  eq(Q.errors, [], 'page errors'); await Q.ctx.close();
});


await test('Mac app: files as tabs, unsaved dot, save prompts on close and quit, Save all, Open recent', async () => {
  const Q = await newPage({ init: () => {
    window.__menus = []; window.__handlers = {}; window.__calls = [];
    window.__fs = { '/docs/a.md': '# A\n\nfrom disk', '/docs/b.md': '# B\n\nfrom disk', '/other/a.md': '# Other A' };
    window.__pending = [];
    localStorage.setItem('cowdrey.md:updateChecked', String(Date.now()));
    const file = (path) => ({ path, name: path.split('/').pop(), content: window.__fs[path] });
    window.__TAURI__ = {
      core: { invoke: async (cmd, args) => {
        window.__calls.push([cmd, args]);
        if (cmd === 'set_menu') { window.__menus.push(args.menus); return null; }
        if (cmd === 'take_opened_files') { const f = window.__pending.map(file); window.__pending = []; return f; }
        if (cmd === 'read_text_file') { if (!(args.path in window.__fs)) throw new Error('missing'); return file(args.path); }
        if (cmd === 'write_text_file') { window.__fs[args.path] = args.contents; return null; }
        return null;
      } },
      app: { getVersion: async () => '1.0.11' },
      dialog: { open: async () => null, save: async () => '/docs/new.md' },
      opener: { openUrl: async () => {}, revealItemInDir: async (p) => { window.__calls.push(['reveal', p]); } },
      event: { listen: async (name, fn) => { window.__handlers[name] = fn; } },
    };
  } });
  await settle(Q, 400);
  const openFiles = async (...paths) => { await Q.evaluate((p) => { window.__pending.push(...p); window.__handlers['open-files'](); }, paths); await settle(Q, 400); };
  const tabs = () => Q.$$eval('.doc-tab', (els) => els.map((e) => e.querySelector('.open span').textContent + (e.classList.contains('unsaved') ? '*' : '') + (e.querySelector('.tab-dir') ? '@' + e.querySelector('.tab-dir').textContent : '')));
  const calls = (name) => Q.evaluate((n) => window.__calls.filter((c) => c[0] === n), name);
  await openFiles('/docs/a.md', '/docs/b.md', '/other/a.md');
  const t1 = await tabs();
  ok(t1.includes('a@docs') && t1.includes('a@other') && t1.includes('b'), 'three files as tabs, same names show their folder: ' + t1.join(', '));
  // the Mac menu has the tab items with the usual shortcuts, and no shortcut is used twice
  const spec = await Q.evaluate(() => window.__menus[window.__menus.length - 1]);
  const find = (label) => spec.flatMap((m) => m.items).find((x) => x.label === label);
  eq(find('Close tab').accel, 'CmdOrCtrl+W'); eq(find('Reopen closed tab').accel, 'CmdOrCtrl+Shift+T');
  eq(find('Next tab').accel, 'CmdOrCtrl+Shift+BracketRight'); eq(find('Save all').accel, 'CmdOrCtrl+Alt+Shift+S');
  ok(find('Open recent…'), 'Open recent in File');
  const accels = spec.flatMap((m) => m.items).map((x) => x.accel).filter(Boolean);
  eq(accels.length, new Set(accels).size, 'no duplicate shortcuts');
  // edit b.md: its tab shows the unsaved dot
  await Q.click('.doc-tab:has(.open span:text-is("b"))'); await settle(Q, 200);
  await setDoc(Q, '# B\n\nedited'); await settle(Q, 300);
  ok((await tabs()).includes('b*'), 'unsaved dot on b');
  // closing it asks; Cancel keeps it open
  await Q.click('.doc-tab.unsaved .x'); await settle(Q, 200);
  ok((await Q.textContent('#dialog')).includes('Save changes to “b.md”?'), 'asked to save');
  await Q.click('#dialog [data-a="0"]'); await settle(Q, 200);
  ok((await tabs()).includes('b*'), 'Cancel keeps the tab');
  // Save writes the file and closes the tab
  await Q.click('.doc-tab.unsaved .x'); await settle(Q, 200);
  await Q.click('#dialog [data-a="2"]'); await settle(Q, 500);
  eq(await Q.evaluate(() => window.__fs['/docs/b.md']), '# B\n\nedited');
  ok(!(await tabs()).some((x) => x.startsWith('b')), 'saved and closed');
  // Don't save throws the edit away
  await Q.click('.doc-tab:has(.tab-dir:text-is("other"))'); await settle(Q, 200);
  await setDoc(Q, '# Other A\n\nthrow away'); await settle(Q, 300);
  await Q.keyboard.press('Control+w'); await settle(Q, 200);
  ok((await Q.textContent('#dialog')).includes('Save changes'), 'Ctrl/Cmd+W asks too');
  await Q.click('#dialog [data-a="1"]'); await settle(Q, 300);
  eq(await Q.evaluate(() => window.__fs['/other/a.md']), '# Other A', 'file untouched');
  const kept = await Q.evaluate(() => JSON.parse(localStorage.getItem('cowdrey.md:index')).find((m) => m.path === '/other/a.md'));
  eq(await Q.evaluate((id) => JSON.parse(localStorage.getItem('cowdrey.md:doc:' + id)), kept.id), '# Other A', 'edit discarded');
  // a never-saved document asks whether to save it as a file
  await Q.evaluate(() => window.__handlers['menu-command']({ payload: 'newDoc' })); await settle(Q, 300);
  await setDoc(Q, '# Fresh idea'); await settle(Q, 400);
  await Q.click('.doc-tab.current .x'); await settle(Q, 200);
  ok((await Q.textContent('#dialog')).includes('as a file?'), 'asked to save the new document');
  await Q.click('#dialog [data-a="2"]'); await settle(Q, 500);
  eq(await Q.evaluate(() => window.__fs['/docs/new.md']), '# Fresh idea', 'Save… wrote it via Save as');
  // Save all saves every edited file
  await openFiles('/docs/a.md', '/docs/b.md');
  await Q.click('.doc-tab:has(.open span:text-is("a"))'); await settle(Q, 200);
  await setDoc(Q, '# A\n\nall 1'); await settle(Q, 300);
  await Q.click('.doc-tab:has(.open span:text-is("b"))'); await settle(Q, 200);
  await setDoc(Q, '# B\n\nall 2'); await settle(Q, 300);
  await Q.evaluate(() => window.__handlers['menu-command']({ payload: 'saveAll' })); await settle(Q, 500);
  eq(await Q.evaluate(() => [window.__fs['/docs/a.md'], window.__fs['/docs/b.md']]), ['# A\n\nall 1', '# B\n\nall 2']);
  ok(!(await tabs()).some((x) => x.includes('*')), 'no unsaved dots after Save all');
  // quitting with an unsaved file holds the quit and asks; Save saves, then quits
  await setDoc(Q, '# B\n\nat quit'); await settle(Q, 300);
  await Q.evaluate(() => window.__handlers['flush-and-quit']()); await settle(Q, 300);
  eq((await calls('hold_quit')).at(-1)[1], { hold: true }, 'quit held');
  ok((await Q.textContent('#dialog')).includes('before quitting'), 'asked before quitting');
  await Q.click('#dialog [data-a="2"]'); await settle(Q, 500);
  eq(await Q.evaluate(() => window.__fs['/docs/b.md']), '# B\n\nat quit');
  ok((await calls('quit_app')).length === 1, 'quit after saving');
  // quitting with nothing unsaved just quits
  await Q.evaluate(() => window.__handlers['flush-and-quit']()); await settle(Q, 200);
  eq((await calls('quit_app')).length, 2);
  // Escape on the quit prompt cancels and lets the app quit later
  await setDoc(Q, '# B\n\nagain'); await settle(Q, 300);
  await Q.evaluate(() => window.__handlers['flush-and-quit']()); await settle(Q, 300);
  await Q.keyboard.press('Escape'); await settle(Q, 200);
  eq((await calls('hold_quit')).at(-1)[1], { hold: false }, 'hold released');
  eq((await calls('quit_app')).length, 2, 'did not quit');
  // Close all with two unsaved files asks about each in turn
  await openFiles('/docs/a.md');
  await Q.click('.doc-tab:has(.open span:text-is("a"))'); await settle(Q, 200); await setDoc(Q, '# A\n\nca1'); await settle(Q, 300);
  await Q.click('.doc-tab:has(.open span:text-is("b"))'); await settle(Q, 200); await setDoc(Q, '# B\n\ncb1'); await settle(Q, 300);
  await Q.evaluate(() => window.__handlers['menu-command']({ payload: 'closeAllTabs' })); await settle(Q, 300);
  for (let k = 0; k < 6 && await Q.$('#dialog[open]'); k++) { await Q.click('#dialog [data-a="1"]'); await settle(Q, 300); }
  eq(await Q.$$eval('.doc-tab', (els) => els.length), 0, 'all tabs closed after answering each prompt');
  ok(await Q.$eval('#noDocs', (e) => !e.hidden), 'empty state');
  await Q.evaluate(() => window.__handlers['menu-command']({ payload: 'reopenTab' })); await settle(Q, 300);
  // Open recent lists the files, newest first
  await Q.evaluate(() => window.__handlers['menu-command']({ payload: 'openRecent' })); await settle(Q, 200);
  const recent = await Q.$$eval('#dialog .recent b', (els) => els.map((e) => e.textContent));
  ok(recent.includes('a') && recent.includes('b') && recent.includes('new'), 'recent files: ' + recent.join(', '));
  await Q.keyboard.press('Escape');
  // Show in Finder from the tab menu
  await Q.click('.doc-tab.current', { button: 'right' }); await settle(Q, 150);
  await Q.click('#popover [data-ta="reveal"]'); await settle(Q, 200);
  ok((await calls('reveal')).length === 1, 'revealed in Finder');
  eq(Q.errors, [], 'page errors'); await Q.ctx.close();
});

await test('sidebar collapses to an icon strip, expands, resizes and remembers', async () => {
  const w = () => P.evaluate(() => Math.round(document.querySelector('#sidebar').getBoundingClientRect().width));
  eq(await w(), 248, 'default width');
  await P.click('#sideCollapse'); await settle(P, 200);
  eq(await w(), 52, 'collapsed strip');
  ok(await P.evaluate(() => getComputedStyle(document.querySelector('.side-rail')).display === 'flex'), 'icons shown');
  await P.click('[data-rail="docs"]'); await settle(P, 200);
  eq([await w(), await P.evaluate(() => document.querySelector('[data-side="docs"]').getAttribute('aria-selected'))], [248, 'true'], 'expanded to Documents');
  await P.click('[data-side="outline"]');
  const h = await P.$('#sideResize'); const b = await h.boundingBox();
  await P.mouse.move(b.x + 4, b.y + 200); await P.mouse.down(); await P.mouse.move(b.x + 104, b.y + 200, { steps: 5 }); await P.mouse.up(); await settle(P, 400);
  ok(Math.abs((await w()) - 348) <= 3, 'resized to ' + (await w()));
  await P.click('#sideCollapse'); await settle(P, 900);
  await P.reload(); await P.waitForFunction(() => document.querySelector('.CodeMirror')); await settle(P, 600);
  eq(await w(), 52, 'collapsed state remembered');
  await P.click('[data-rail="expand"]'); await settle(P, 200);
  ok(Math.abs((await w()) - 348) <= 3, 'width remembered: ' + (await w()));
  await P.dblclick('#sideResize'); await settle(P, 300); eq(await w(), 248, 'double-click resets');
});


await test('tablet: compact strip by default, expands over the page, tap outside closes', async () => {
  const Q = await newPage({ width: 1024, height: 768 });
  const w = () => Q.evaluate(() => Math.round(document.querySelector('#sidebar').getBoundingClientRect().width));
  eq(await w(), 52, 'strip visible');
  await Q.click('[data-rail="expand"]'); await settle(Q, 200);
  eq([await w(), await Q.evaluate(() => document.querySelector('#app').dataset.overlay)], [248, 'on'], 'overlay open');
  await Q.mouse.click(800, 500); await settle(Q, 200);
  eq([await w(), await Q.evaluate(() => document.querySelector('#app').dataset.overlay)], [52, 'off'], 'tap outside closes');
  eq(Q.errors, [], 'page errors'); await Q.ctx.close();
});

await test('phone: title-bar button opens the sidebar, split view shares the height, zoom stays reachable', async () => {
  const Q = await newPage({ width: 390, height: 844 });
  ok(await Q.evaluate(() => getComputedStyle(document.querySelector('#sidebar')).display === 'none'), 'sidebar hidden');
  await Q.click('#sideToggle'); await settle(Q, 200);
  ok(await Q.evaluate(() => document.querySelector('#sidebar').getBoundingClientRect().width >= 240), 'sidebar opened');
  await Q.mouse.click(370, 600); await settle(Q, 200);
  ok(await Q.evaluate(() => getComputedStyle(document.querySelector('#sidebar')).display === 'none'), 'closed again');
  await Q.click('#sbViews [data-view="split"]'); await settle(Q, 300);
  const [e, p] = await Q.evaluate(() => ['.editor-pane', '.preview-pane'].map((x) => document.querySelector(x).getBoundingClientRect().height));
  ok(Math.abs(e - p) < 40, `equal halves: ${e} vs ${p}`);
  ok(await Q.evaluate(() => document.querySelector('#zoomPct').offsetWidth > 0), 'zoom label visible');
  eq(Q.errors, [], 'page errors'); await Q.ctx.close();
});

await test('resizing from desktop to phone and back recovers the layout', async () => {
  const Q = await newPage({ width: 1440, height: 900 });
  await Q.setViewportSize({ width: 390, height: 844 }); await settle(Q, 400);
  ok(await Q.evaluate(() => document.documentElement.scrollWidth <= innerWidth && getComputedStyle(document.querySelector('#sidebar')).display === 'none'), 'phone layout after shrinking');
  await Q.setViewportSize({ width: 1440, height: 900 }); await settle(Q, 400);
  eq(await Q.evaluate(() => Math.round(document.querySelector('#sidebar').getBoundingClientRect().width)), 248, 'desktop sidebar back');
  await Q.click('[data-menu="2"]');
  ok((await Q.textContent('#popover')).includes(process.platform === 'darwin' ? '⌘⌥-' : 'Ctrl+Alt+-'), 'zoom out shortcut shows its key');
  await Q.keyboard.press('Escape'); eq(Q.errors, [], 'page errors'); await Q.ctx.close();
});

await test('first visit asks to agree to the terms once; Help links to them', async () => {
  const T = await newPage({ fresh: true });
  ok(await T.$('#dialog[open]'), 'dialog shown on first visit');
  ok((await T.textContent('#dialog')).includes('Terms of Use and Privacy'), 'titled');
  eq(await T.$eval('#dialog .dlg-body a', (a) => a.href), 'https://bradcowdrey.com/legal');
  await T.click('#dialog [data-a="1"]'); await settle(T, 150);
  eq(await T.evaluate(() => JSON.parse(localStorage.getItem('cowdrey.md:terms'))), '2026-10-21');
  await T.reload(); await settle(T, 800);
  ok(!(await T.$('#dialog[open]')), 'not asked again after agreeing');
  await T.click('[data-menu="6"]');
  ok(await T.$('#popover [data-cmd="legal"]'), 'Help → Terms & Privacy'); await T.keyboard.press('Escape');
  await T.ctx.close();
});
await test('tabs sit above both panes, not inside the editor', async () => {
  const T = await newPage();
  ok(await T.$eval('#docTabs', (el) => el.parentElement.id === 'docArea'), 'tab bar is in the document area');
  const tb = await T.$eval('#docTabs', (el) => el.getBoundingClientRect().toJSON());
  const ed = await T.$eval('#editorPane', (el) => el.getBoundingClientRect().toJSON());
  const pv = await T.$eval('#previewPane', (el) => el.getBoundingClientRect().toJSON());
  ok(tb.bottom <= ed.top + 1 && tb.bottom <= pv.top + 1, 'above editor and preview');
  ok(tb.left <= ed.left + 1 && tb.right >= pv.right - 1, 'spans both panes');
  await T.ctx.close();
});
await test('several documents open as tabs; next, previous and reopen work', async () => {
  const T = await newPage();
  for (const n of ['Alpha', 'Beta', 'Gamma']) { await T.evaluate(() => document.querySelector('.new-tab').click()); await settle(T, 150); await setDoc(T, `# ${n}\n\ntext`); await settle(T, 500); }
  const titles = async () => T.$$eval('.doc-tab .open span:first-of-type', (els) => els.map((e) => e.textContent));
  const t0 = await titles();
  ok(['Alpha', 'Beta', 'Gamma'].every((n) => t0.includes(n)), 'three tabs: ' + t0.join(', '));
  const curTitle = () => T.$eval('.doc-tab.current .open span', (e) => e.textContent);
  eq(await curTitle(), 'Gamma');
  await T.keyboard.press(isMacTest ? 'Meta+Alt+BracketLeft' : 'Control+Alt+BracketLeft'); await settle(T, 200);
  eq(await curTitle(), 'Beta');
  await T.keyboard.press(isMacTest ? 'Meta+Alt+BracketRight' : 'Control+Alt+BracketRight'); await settle(T, 200);
  eq(await curTitle(), 'Gamma');
  await T.keyboard.press('Control+Tab'); await settle(T, 200);
  ok((await curTitle()) !== 'Gamma', 'Ctrl+Tab moves on');
  // close Beta with its ×, then reopen it
  await T.click('.doc-tab:has(.open span:text-is("Beta")) .x'); await settle(T, 200);
  ok(!(await titles()).includes('Beta'), 'Beta closed');
  await T.keyboard.press(isMacTest ? 'Meta+Alt+Shift+KeyT' : 'Control+Alt+Shift+KeyT'); await settle(T, 300);
  eq(await curTitle(), 'Beta');
  await T.ctx.close();
});
await test('choosing several files in Open opens each one in its own tab', async () => {
  const T = await newPage();
  const before = await T.$$eval('.doc-tab', (els) => els.length);
  await T.setInputFiles('#fileInput', [1, 2, 3].map((n) => ({ name: `note${n}.md`, mimeType: 'text/markdown', buffer: Buffer.from(`# Note ${n}\n`) })));
  await settle(T, 600);
  const titles = await T.$$eval('.doc-tab .open span:first-of-type', (els) => els.map((e) => e.textContent));
  eq(titles.length, before + 3, 'three new tabs: ' + titles.join(', '));
  ok(['note1', 'note2', 'note3'].every((n) => titles.includes(n)), 'each file has a tab');
  eq(await T.$eval('.doc-tab.current .open span', (e) => e.textContent), 'note3');
  await T.ctx.close();
});
await test('right-click a tab: close others, close to the right, duplicate', async () => {
  const T = await newPage();
  for (const n of ['One', 'Two', 'Three']) { await T.evaluate(() => document.querySelector('.new-tab').click()); await settle(T, 150); await setDoc(T, `# ${n}`); await settle(T, 500); }
  const titles = async () => T.$$eval('.doc-tab .open span:first-of-type', (els) => els.map((e) => e.textContent));
  await T.click('.doc-tab:has(.open span:text-is("Two"))', { button: 'right' }); await settle(T, 150);
  ok(await T.$('#popover [data-ta="others"]'), 'menu opened');
  await T.click('#popover [data-ta="dup"]'); await settle(T, 300);
  ok((await titles()).includes('Two copy'), 'duplicated');
  await T.click('.doc-tab:has(.open span:text-is("Two"))', { button: 'right' }); await settle(T, 150);
  await T.click('#popover [data-ta="others"]'); await settle(T, 300);
  eq(await titles(), ['Two']);
  ok(await T.$('.doc-tab.current'), 'one tab left and selected');
  await T.ctx.close();
});
await test('drag a tab to reorder it, and the order is kept after reload', async () => {
  const T = await newPage();
  for (const n of ['Left', 'Right']) { await T.evaluate(() => document.querySelector('.new-tab').click()); await settle(T, 150); await setDoc(T, `# ${n}`); await settle(T, 500); }
  const titles = async () => T.$$eval('.doc-tab .open span:first-of-type', (els) => els.map((e) => e.textContent));
  const before = await titles();
  const from = before.indexOf('Right');
  const src = `.doc-tab:nth-child(${from + 1})`, dst = '.doc-tab:nth-child(1)';
  await T.dragAndDrop(src, dst, { targetPosition: { x: 4, y: 10 } }); await settle(T, 300);
  eq((await titles())[0], 'Right');
  await T.reload(); await settle(T, 800);
  eq((await titles())[0], 'Right');
  await T.ctx.close();
});
await test('closing every tab shows "No documents open", and it stays that way after reload', async () => {
  const T = await newPage();
  await T.evaluate(() => document.querySelector('.new-tab').click()); await settle(T, 150); await setDoc(T, '# Keep me'); await settle(T, 500);
  while (await T.$('.doc-tab .x')) { await T.click('.doc-tab .x'); await settle(T, 150); }
  ok(await T.$eval('#noDocs', (e) => !e.hidden), 'empty state shown');
  ok(await T.$eval('#panes', (e) => getComputedStyle(e).display === 'none'), 'editor and preview hidden');
  eq(await T.$$eval('.doc-tab', (els) => els.length), 0);
  ok((await T.textContent('#noDocsRecent')).includes('Keep me'), 'recent documents listed');
  ok((await T.textContent('#outlinePanel')).includes('No document is open'), 'outline cleared');
  ok(await T.$eval('#sbWords', (e) => getComputedStyle(e).visibility === 'hidden'), 'document stats hidden');
  await T.keyboard.press('Control+b'); await T.keyboard.type('stray'); await settle(T, 300);
  const stored = await T.evaluate(() => JSON.parse(localStorage.getItem('cowdrey.md:index')).map((m) => JSON.parse(localStorage.getItem('cowdrey.md:doc:' + m.id))));
  ok(stored.every((c) => !c.includes('stray')), 'typing with nothing open changes no document');
  await T.reload(); await settle(T, 800);
  ok(await T.$eval('#noDocs', (e) => !e.hidden), 'still empty after reload');
  await T.click('#noDocsRecent [data-open]'); await settle(T, 400);
  ok(await T.$eval('#noDocs', (e) => e.hidden), 'opening a recent document leaves the empty state');
  eq(await T.$$eval('.doc-tab', (els) => els.length), 1);
  ok((await cmv(T)).length > 0, 'its text is in the editor');
  await T.click('.doc-tab .x'); await settle(T, 150);
  await T.click('#noDocs .btn.primary'); await settle(T, 400);
  eq(await T.$$eval('.doc-tab', (els) => els.length), 1);
  ok(await T.$eval('#noDocs', (e) => e.hidden), 'New document leaves the empty state');
  eq(T.errors, []);
  await T.ctx.close();
});
await test('File and View menus list the tab commands', async () => {
  await P.click('[data-menu="0"]');
  for (const id of ['closeTab', 'closeOtherTabs', 'closeAllTabs', 'reopenTab']) ok(await P.$(`#popover [data-cmd="${id}"]`), id);
  ok(!(await P.$('#popover [data-cmd="saveAll"]')) && !(await P.$('#popover [data-cmd="openRecent"]')), 'Mac-only items hidden on the web');
  await P.keyboard.press('Escape');
  await P.click('[data-menu="2"]');
  ok(await P.$('#popover [data-cmd="nextTab"]') && await P.$('#popover [data-cmd="prevTab"]'), 'next and previous tab');
  await P.keyboard.press('Escape');
});
await test('no library URL points at a file that does not exist', async () => { eq([...missing], []); });
await test('no uncaught page errors during the whole run', async () => { eq(P.errors, []); });

await browser.close();
const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : '\n      ' + r.err}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
