// End-to-end tests for Cowdrey.md.
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
const DOC = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>${html}</body></html>`;

function localFor(url) {
  const m = url.match(/^https:\/\/cdn\.jsdelivr\.net\/npm\/((?:@[^/]+\/)?[^@/]+)@[^/]+\/(.+)$/);
  return m ? path.join(NM, m[1], m[2]) : null;
}

const browser = await chromium.launch({ executablePath: exe });
const results = [];
const missing = new Set();

async function newPage({ width = 1440, height = 900, scheme = 'light', block = [], init } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
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

await test('phone width: no sideways scrolling, editor and page both visible', async () => {
  const Q = await newPage({ width: 390, height: 844 });
  const r = await Q.evaluate(() => ({ h: document.documentElement.scrollWidth <= innerWidth, ed: document.querySelector('.editor-pane').getBoundingClientRect().height > 150, pv: document.querySelector('.preview-pane').getBoundingClientRect().height > 150 }));
  eq(r, { h: true, ed: true, pv: true }); eq(Q.errors, [], 'page errors'); await Q.ctx.close();
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
  await Q.click('[data-cmd="newDoc"]'); await Q.keyboard.type('# Made in B'); await settle(Q, 1000);
  // tab A keeps editing its own document afterwards
  await P.bringToFront(); await P.click('.CodeMirror'); await P.keyboard.press('Control+End'); await P.keyboard.type(' and more'); await settle(P, 1000);
  const stored = await P.evaluate(() => JSON.parse(localStorage.getItem('cowdrey.md:index')).map((m) => m.title));
  ok(stored.includes('Made in B'), 'B\'s document survived A\'s save: ' + JSON.stringify(stored));
  const aText = await P.evaluate((id) => JSON.parse(localStorage.getItem('cowdrey.md:doc:' + id)), idA);
  eq(aText, 'from tab A and more', 'A text');
  await Q.close();
});

await test('no library URL points at a file that does not exist', async () => { eq([...missing], []); });
await test('no uncaught page errors during the whole run', async () => { eq(P.errors, []); });

await browser.close();
const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : '\n      ' + r.err}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
