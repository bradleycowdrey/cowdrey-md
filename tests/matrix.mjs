// Function matrix: runs every command at several window sizes in light and dark,
// checking for errors, broken layout and that each command visibly did something.
// Run: (cd desktop && npm ci) && node tests/matrix.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let playwright; try { playwright = require('playwright'); } catch { playwright = require('/opt/node22/lib/node_modules/playwright'); }
const exe = fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;
const NM = path.join(root, 'desktop/node_modules');
const DOC = fs.readFileSync(path.join(root, 'index.html'), 'utf8'); // a complete document
const SIZES = (process.env.SIZES || '1440x900,1280x800,1024x768,768x1024,390x844').split(',').map((s) => s.split('x').map(Number));
const THEMES = (process.env.THEMES || 'light,dark').split(',');
const SAMPLE = '# Title\n\nSome text with a word here.\n\n- one\n- two\n\n| a | b |\n|---|---|\n| 1 | 2 |\n';

const browser = await playwright.chromium.launch({ executablePath: exe });
const failures = [], noEffect = new Map(), summary = [];

async function open(w, h, scheme) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme, acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'] });
  await ctx.route('**/*', (r) => {
    const u = r.request().url();
    if (u === 'https://app.test/') return r.fulfill({ body: DOC, contentType: 'text/html' });
    const m = u.match(/^https:\/\/cdn\.jsdelivr\.net\/npm\/((?:@[^/]+\/)?[^@/]+)@[^/]+\/(.+)$/);
    if (m && fs.existsSync(path.join(NM, m[1], m[2]))) return r.fulfill({ body: fs.readFileSync(path.join(NM, m[1], m[2])), contentType: 'application/javascript' });
    return r.abort();
  });
  const p = await ctx.newPage();
  p.errors = []; p.downloads = 0; p.choosers = 0;
  p.on('pageerror', (e) => p.errors.push(e.message));
  p.on('download', () => p.downloads++);
  p.on('filechooser', () => p.choosers++);
  await p.goto('https://app.test/');
  await p.waitForFunction(() => window.__cowdreyTest && document.querySelector('.CodeMirror'), null, { timeout: 15000 });
  await p.waitForTimeout(600);
  return { p, ctx };
}
const snap = (p) => p.evaluate(() => ({
  text: document.querySelector('.CodeMirror').CodeMirror.getValue(),
  settings: JSON.stringify(window.__cowdreyTest.settings()),
  dialog: !!document.querySelector('#dialog').open,
  popover: !document.querySelector('#popover').hidden,
  toast: document.querySelector('#toast').classList.contains('show') ? document.querySelector('#toast').textContent : '',
  find: !document.querySelector('#findbar').hidden,
  docs: document.querySelectorAll('.doc-tab').length,
  title: document.querySelector('#docTitle').value,
  focus: document.activeElement && (document.activeElement.id || document.activeElement.className),
  sel: document.querySelector('.CodeMirror').CodeMirror.getSelection(),
}));
const layout = (p) => p.evaluate(() => {
  const vw = innerWidth, vh = innerHeight, issues = [];
  if (document.documentElement.scrollWidth > vw + 1) issues.push(`page scrolls sideways (${document.documentElement.scrollWidth}px > ${vw}px)`);
  const sb = document.querySelector('.statusbar').getBoundingClientRect();
  if (sb.bottom > vh + 1) issues.push(`status bar below the window (${Math.round(sb.bottom)} > ${vh})`);
  const pop = document.querySelector('#popover');
  if (!pop.hidden) { const r = pop.getBoundingClientRect(); if (r.right > vw + 1 || r.left < -1 || r.bottom > vh + 1) issues.push('menu runs off screen'); }
  const dlg = document.querySelector('#dialog');
  if (dlg.open) { const r = dlg.getBoundingClientRect(); if (r.right > vw + 1 || r.left < -1 || r.bottom > vh + 1) issues.push('dialog runs off screen'); }
  if (!document.querySelector('.CodeMirror')) issues.push('editor missing');
  return issues;
});
async function closeOverlays(p) {
  await p.evaluate(() => { const d = document.querySelector('#dialog'); if (d.open) d.close(); const pop = document.querySelector('#popover'); if (!pop.hidden) pop.hidden = true; document.querySelector('#findbar').hidden = true; });
  if (await p.evaluate(() => !!document.fullscreenElement)) await p.evaluate(() => document.exitFullscreen());
}

for (const [w, h] of SIZES) for (const theme of THEMES) {
  const tag = `${w}x${h} ${theme}`;
  const { p, ctx } = await open(w, h, theme);
  const ids = await p.evaluate(() => window.__cowdreyTest.commands());
  let ran = 0;
  for (const id of ids) {
    if (await p.evaluate((id) => window.__cowdreyTest.hidden(id), id)) continue;
    // fresh, known document state for every command
    await p.evaluate((t) => { const cm = document.querySelector('.CodeMirror').CodeMirror; cm.setValue(t); cm.focus(); cm.setSelection({ line: 2, ch: 22 }, { line: 2, ch: 26 }); }, SAMPLE);
    await closeOverlays(p);
    const before = await snap(p), d0 = p.downloads, c0 = p.choosers, e0 = p.errors.length;
    try { await p.evaluate((id) => window.__cowdreyTest.run(id), id); } catch (e) { failures.push(`${tag} · ${id}: threw ${e.message.split('\n')[0]}`); }
    await p.waitForTimeout(id.startsWith('zoom') || id.startsWith('view_') ? 350 : 220);
    const after = await snap(p);
    const lay = await layout(p);
    if (p.errors.length > e0) failures.push(`${tag} · ${id}: page error "${p.errors.slice(e0).join(' | ')}"`);
    for (const i of lay) failures.push(`${tag} · ${id}: ${i}`);
    const changed = Object.keys(before).filter((k) => k !== 'focus' && before[k] !== after[k]);
    const effect = changed.length || p.downloads > d0 || p.choosers > c0;
    if (!effect) noEffect.set(id, (noEffect.get(id) || []).concat(tag));
    ran++;
    await closeOverlays(p);
    // undo state-changing view commands so later commands run in the normal layout
    await p.evaluate((s) => { const cur = window.__cowdreyTest.settings(); const want = JSON.parse(s); if (cur.view !== want.view) window.__cowdreyTest.run('view_' + want.view); }, before.settings);
  }
  summary.push(`${tag}: ran ${ran} commands`);
  await ctx.close();
}
await browser.close();

console.log(summary.join('\n'));
console.log(`\nCommands with no visible effect (check these by hand):`);
for (const [id, tags] of noEffect) console.log(`  ${id}: ${tags.length === SIZES.length * THEMES.length ? 'all sizes' : tags.join(', ')}`);
console.log(`\n${failures.length} failure(s)`);
for (const f of failures) console.log('  ' + f);
process.exit(failures.length ? 1 : 0);
