(() => {
'use strict';

/* ================================================================
   Cowdrey.MD — Markdown editor by bradcowdrey.com
   ================================================================ */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
const TAURI = window.__TAURI__ || null; // set when running as the installed Mac app
const baseName = (p) => String(p).split(/[\\/]/).pop();
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const nf = new Intl.NumberFormat();

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
};
const KEY = 'cowdrey.md';

const DEFAULTS = {
  view: 'split', outline: true, sideTab: 'outline', sync: true, focus: false, typewriter: false,
  lineNumbers: false, wrap: true, ruler: true, guides: true, edTheme: 'auto', edSize: 14,
  pageStyle: 'cowdrey', pageSize: 'letter', margins: 'normal', zoom: 'fit',
  typographer: true, breaks: false, math: true, diagrams: true,
  ribbonTab: 'home', ribbonCollapsed: false, sideRail: false, sideWidth: 248, split: 0.45, appTheme: 'system', openTabs: [],
};
const S = Object.assign({}, DEFAULTS, store.get(KEY + ':settings', {}));
const saveSettings = debounce(() => store.set(KEY + ':settings', S), 200);

/* ---------------- documents ---------------- */
const uid = () => 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const makeDoc = (content = '', title = 'Untitled document', autoTitle = true) => ({ id: uid(), title, autoTitle, content, updated: Date.now() });
const WELCOME = $('#welcome-md').textContent.replace(/^\n/, '');

const DOC_KEY = (id) => KEY + ':doc:' + id;
const meta = ({ content, diskContent, ...m }) => m;
const DISK_KEY = (id) => KEY + ':disk:' + id;
function loadDocs() {
  const index = store.get(KEY + ':index', null);
  if (Array.isArray(index)) return index.map((m) => { const d = { ...m, content: store.get(DOC_KEY(m.id), '') }; if (m.path) { const dc = store.get(DISK_KEY(m.id), null); if (dc != null) d.diskContent = dc; } return d; });
  const legacy = store.get(KEY + ':docs', null); // format used before per-document keys
  if (!Array.isArray(legacy)) return null;
  let ok = true;
  for (const d of legacy) ok = store.set(DOC_KEY(d.id), d.content || '') && ok;
  if (ok && store.set(KEY + ':index', legacy.map(meta))) { try { localStorage.removeItem(KEY + ':docs'); } catch {} }
  return legacy;
}
let docs = loadDocs();
const firstRun = !Array.isArray(docs) || !docs.length;
if (firstRun) docs = [makeDoc(WELCOME, 'Welcome to Cowdrey.MD', false)];
// the app is now written Cowdrey.MD; update the stored welcome document to match
for (const d of docs) if (d.title === 'Welcome to Cowdrey' + '.md') { d.title = 'Welcome to Cowdrey.MD'; d.content = d.content.split('Cowdrey' + '.md').join('Cowdrey.MD'); }
let currentId = store.get(KEY + ':current', null);
if (!docs.some((d) => d.id === currentId)) currentId = docs[0].id;
S.openTabs = (S.openTabs || []).filter((id) => docs.some((d) => d.id === id));
// After closing every tab, the app opens with no documents, as most apps do.
if (!S.allClosed && !S.openTabs.includes(currentId)) S.openTabs.push(currentId);
const cur = () => docs.find((d) => d.id === currentId);
const cmDocs = new Map();

/* ---------------- elements ---------------- */
const app = $('#app'), titleInput = $('#docTitle'), saveStateEl = $('#saveState');
const preview = $('#preview'), page = $('#page'), pageWrap = $('#pageWrap'), canvas = $('#canvas');
const editorPane = $('#editorPane'), popover = $('#popover'), dialog = $('#dialog');

/* ---------------- icons ---------------- */
const ic = (name) => `<i data-lucide="${name}"></i>`;
const refreshIcons = () => { try { window.lucide && lucide.createIcons({ icons: lucide.icons }); } catch {} };

/* ---------------- toast ---------------- */
let toastT;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2600);
}

/* ================================================================
   Markdown renderer
   ================================================================ */
const slugify = (s) => s.toLowerCase().trim().replace(/<[^>]+>/g, '').replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s+/g, '-');

function mathPlugin(md) {
  md.inline.ruler.after('escape', 'math_inline', (state, silent) => {
    if (!S.math) return false;
    const s = state.src, p = state.pos;
    if (s[p] !== '$') return false;
    if (s[p + 1] === '$') {
      const end = s.indexOf('$$', p + 2);
      if (end < 0) return false;
      if (!silent) { const t = state.push('math_display_inline', '', 0); t.content = s.slice(p + 2, end); }
      state.pos = end + 2; return true;
    }
    const next = s[p + 1];
    if (!next || /\s/.test(next)) return false;
    let end = p + 1;
    while ((end = s.indexOf('$', end)) !== -1) {
      if (s[end - 1] !== '\\' && !/\s/.test(s[end - 1])) break;
      end++;
    }
    if (end === -1 || /\d/.test(s[end + 1] || '')) return false;
    if (!silent) { const t = state.push('math_inline', '', 0); t.content = s.slice(p + 1, end); }
    state.pos = end + 1; return true;
  });
  md.block.ruler.before('fence', 'math_block', (state, start, end, silent) => {
    if (!S.math) return false;
    let pos = state.bMarks[start] + state.tShift[start], max = state.eMarks[start];
    if (state.sCount[start] - state.blkIndent >= 4) return false;
    if (state.src.slice(pos, pos + 2) !== '$$') return false;
    const first = state.src.slice(pos + 2, max);
    let line = start, content = '', found = false;
    if (first.trim().endsWith('$$')) { content = first.trim().slice(0, -2); found = true; }
    else {
      content = first.trim() ? first + '\n' : '';
      while (++line < end) {
        const l = state.src.slice(state.bMarks[line] + state.tShift[line], state.eMarks[line]);
        if (l.trim().endsWith('$$')) { content += l.trim().slice(0, -2); found = true; break; }
        content += l + '\n';
      }
    }
    if (!found) return false;
    if (silent) return true;
    state.line = line + 1;
    const t = state.push('math_block', 'div', 0);
    t.block = true; t.content = content; t.map = [start, state.line];
    return true;
  }, { alt: ['paragraph', 'reference', 'blockquote', 'list'] });
  md.renderer.rules.math_inline = (ts, i) => `<span class="math-inline">\\(${esc(ts[i].content)}\\)</span>`;
  md.renderer.rules.math_display_inline = (ts, i) => `<span class="math-display">\\[${esc(ts[i].content)}\\]</span>`;
  md.renderer.rules.math_block = (ts, i) => `<div class="math-block" data-line="${ts[i].map[0]}">\\[${esc(ts[i].content)}\\]</div>\n`;
}

const CALLOUTS = { note: 'Note', tip: 'Tip', important: 'Important', warning: 'Warning', caution: 'Caution' };

function structurePlugin(md) {
  // source line numbers for sync scroll, heading ids, task lists, callouts
  md.core.ruler.push('cowdrey_structure', (state) => {
    const ts = state.tokens, env = state.env, used = {};
    env.headings = [];
    for (let i = 0; i < ts.length; i++) {
      const t = ts[i];
      if (t.map && t.block && t.nesting !== -1 && t.type !== 'inline') t.attrSet('data-line', String(t.map[0]));
      if (t.type === 'heading_open') {
        const inl = ts[i + 1];
        const text = inl.children.filter((c) => c.type === 'text' || c.type === 'code_inline' || c.type === 'emoji').map((c) => c.type === 'emoji' ? '' : c.content).join('').trim() || inl.content;
        let id = 'h-' + (slugify(text) || 'section'); const base = id; let n = 1;
        while (used[id]) id = base + '-' + n++;
        used[id] = 1; t.attrSet('id', id);
        env.headings.push({ level: +t.tag.slice(1), text, id, line: t.map[0] });
      }
      if (t.type === 'inline' && i >= 2 && ts[i - 1].type === 'paragraph_open' && ts[i - 2].type === 'list_item_open') {
        const m = /^\[([ xX])\]\s/.exec(t.content);
        const f = t.children[0];
        if (m && f && f.type === 'text' && /^\[[ xX]\]\s/.test(f.content)) {
          f.content = f.content.replace(/^\[[ xX]\]\s/, '');
          const cb = new state.Token('html_inline', '', 0);
          cb.content = `<input type="checkbox" class="task-check" data-task-line="${ts[i - 1].map ? ts[i - 1].map[0] : ''}"${m[1] !== ' ' ? ' checked' : ''}>`;
          t.children.unshift(cb);
          ts[i - 2].attrJoin('class', 'task-item');
          for (let j = i - 3; j >= 0; j--) {
            if ((ts[j].type === 'bullet_list_open' || ts[j].type === 'ordered_list_open') && ts[j].level === ts[i - 2].level - 1) { ts[j].attrJoin('class', 'task-list'); break; }
          }
        }
      }
      if (t.type === 'blockquote_open' && ts[i + 1] && ts[i + 1].type === 'paragraph_open' && ts[i + 2] && ts[i + 2].type === 'inline') {
        const inl = ts[i + 2];
        const m = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i.exec(inl.content);
        if (m) {
          const type = m[1].toLowerCase();
          t.attrJoin('class', 'callout callout-' + type);
          const f = inl.children[0];
          if (f && f.type === 'text') f.content = f.content.replace(/^\[!\w+\]\s*/, '');
          if (f && f.content === '' && inl.children[1] && inl.children[1].type === 'softbreak') inl.children.splice(1, 1);
          const title = new state.Token('html_inline', '', 0);
          title.content = `<span class="callout-title">${CALLOUTS[type]}</span>`;
          inl.children.unshift(title);
        }
      }
    }
  });
  const fence = (tokens, idx) => {
    const t = tokens[idx], lang = (t.info || '').trim().split(/\s+/)[0].toLowerCase();
    const line = t.map ? ` data-line="${t.map[0]}"` : '';
    if (lang === 'mermaid' && S.diagrams) return `<div class="mermaid-block"${line} data-src="${encodeURIComponent(t.content)}"></div>\n`;
    if ((lang === 'math' || lang === 'latex' || lang === 'tex') && S.math) return `<div class="math-block"${line}>\\[${esc(t.content)}\\]</div>\n`;
    let code = esc(t.content);
    if (window.hljs) {
      try {
        if (lang && hljs.getLanguage(lang)) code = hljs.highlight(t.content, { language: lang, ignoreIllegals: true }).value;
      } catch {}
    }
    return `<div class="code-block"${line}><div class="code-head"><span>${esc(lang || 'text')}</span><button class="copy-code" type="button">Copy</button></div><pre><code class="hljs${lang ? ' language-' + esc(lang) : ''}">${code}</code></pre></div>\n`;
  };
  md.renderer.rules.fence = fence;
}

let md = null;
function buildMd() {
  if (typeof window.markdownit !== 'function') { md = null; return; }
  md = window.markdownit({ html: true, linkify: true, typographer: S.typographer, breaks: S.breaks });
  md.linkify.set({ fuzzyLink: false });
  const use = (p) => { if (typeof p === 'function') md.use(p); };
  use(window.markdownitFootnote); use(window.markdownitMark); use(window.markdownitSub);
  use(window.markdownitSup); use(window.markdownitEmoji); use(window.markdownitDeflist);
  md.use(mathPlugin); md.use(structurePlugin);
}

function extractFrontMatter(src) {
  const m = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(src);
  if (!m) return { body: src, html: '', data: null };
  const lines = m[0].split('\n').length - (m[0].endsWith('\n') ? 1 : 0);
  const body = '\n'.repeat(lines) + src.slice(m[0].length);
  const rows = [], data = {};
  for (const l of m[1].split(/\r?\n/)) {
    const kv = /^([\w.-]+)\s*:\s*(.*)$/.exec(l);
    if (kv) { rows.push(`<b>${esc(kv[1])}</b><span>${esc(kv[2].replace(/^["']|["']$/g, ''))}</span>`); data[kv[1]] = kv[2]; }
  }
  return { body, data, html: rows.length ? `<div class="front-matter" data-line="0">${rows.join('')}</div>` : '' };
}

function tocHtml(hs) {
  if (!hs.length) return '<nav class="toc"><div class="toc-title">Contents</div><p>Add headings to build a table of contents.</p></nav>';
  const min = Math.min(...hs.map((h) => h.level));
  let html = '<nav class="toc"><div class="toc-title">Contents</div>', depth = 0;
  for (const h of hs) {
    const lvl = h.level - min + 1;
    while (depth < lvl) { html += '<ul>'; depth++; }
    while (depth > lvl) { html += '</ul>'; depth--; }
    html += `<li><a href="#${esc(h.id)}">${esc(h.text)}</a></li>`;
  }
  while (depth-- > 0) html += '</ul>';
  return html + '</nav>';
}

/* ================================================================
   Editor (CodeMirror 5)
   ================================================================ */
const MODE = { name: 'yaml-frontmatter', base: { name: 'gfm', highlightFormatting: true, fencedCodeBlockHighlighting: true, xml: true, tokenTypeOverrides: { emoji: 'builtin' } } };
let tabEscape = false; // Esc, then Tab or Shift+Tab, moves focus out of the editor
const cm = CodeMirror($('#editorHost'), {
  value: '', mode: MODE, theme: 'cowdrey', lineWrapping: S.wrap, lineNumbers: S.lineNumbers,
  indentUnit: 4, tabSize: 4, indentWithTabs: false, styleActiveLine: { nonEmpty: false }, autoCloseBrackets: '()[]{}""``',
  scrollPastEnd: true, placeholder: 'Start writing in Markdown…', spellcheck: true, inputStyle: 'contenteditable',
  viewportMargin: 30, cursorScrollMargin: 40,
  extraKeys: {
    Enter: 'newlineAndIndentContinueMarkdownList',
    Tab: (c) => tabEscape ? (tabEscape = false, CodeMirror.Pass) : (c.somethingSelected() || /^\s*([-*+]|\d+[.)])\s/.test(c.getLine(c.getCursor().line))) ? c.execCommand('indentMore') : c.execCommand('insertSoftTab'),
    'Shift-Tab': (c) => tabEscape ? (tabEscape = false, CodeMirror.Pass) : c.execCommand('indentLess'),
    Esc: () => { if (!$('#findbar').hidden) closeFind(); else { tabEscape = true; toast('Press Tab to move focus out of the editor'); } },
  },
});

/* ---------------- render pipeline ---------------- */
let headings = [], lineMap = [], fm = null;
const mermaidCache = new Map();
let mermaidSeq = 0, mathReady = !!(window.MathJax && MathJax.typesetPromise);

const PURIFY = { ADD_ATTR: ['target', 'data-line', 'data-src', 'data-task-line', 'checked'], FORBID_TAGS: ['style', 'form', 'base'] };

function render() {
  const src = cm.getValue();
  const env = {};
  const f = extractFrontMatter(src);
  fm = f.data;
  let html = '';
  if (!md) buildMd();
  if (!md) {
    preview.innerHTML = '<div class="render-error">The preview engine did not load, so the page cannot be shown yet. Check your internet connection and reload. Your writing is still being saved.</div>';
    headings = []; updateOutline(); return;
  }
  try { html = f.html + md.render(f.body, env); }
  catch (e) { html = `<div class="render-error">${esc(e.message)}</div>`; }
  headings = env.headings || [];
  html = html.replace(/<p data-line="\d+">\[(?:TOC|toc|\[toc\])\]\]?<\/p>/g, () => tocHtml(headings));
  preview.innerHTML = window.DOMPurify ? DOMPurify.sanitize(html, PURIFY) : html;
  // Ids from the document live in their own namespace so they can never collide with the app's own elements.
  for (const el of preview.querySelectorAll('[id]')) if (!el.id.startsWith('h-')) el.id = 'u-' + el.id;
  for (const el of preview.querySelectorAll('[name]')) el.removeAttribute('name');
  for (const a of preview.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href');
    if (/^(https?:)?\/\//i.test(href)) { a.target = '_blank'; a.rel = 'noopener'; }
    else if (href.length > 1 && href.startsWith('#')) {
      let t = href.slice(1); try { t = decodeURIComponent(t); } catch {}
      const hit = ['h-' + slugify(t), 'h-' + t, 'u-' + t].find((x) => preview.querySelector('#' + CSS.escape(x)));
      if (hit) a.setAttribute('href', '#' + hit);
    }
  }
  for (const step of [renderMermaid, typesetMath, updateOutline, updateStats, autoTitle, updateStyleGallery]) {
    try { step(); } catch (e) { console.error(e); }
  }
  requestAnimationFrame(() => { sizePage(); buildLineMap(); if (S.sync && S.view === 'split') syncFromEditor(); });
}
const scheduleRender = (() => {
  let t; return () => { clearTimeout(t); t = setTimeout(render, cm.getValue().length > 40000 ? 260 : 70); };
})();

function isDark() {
  const a = document.documentElement.getAttribute('data-theme');
  if (a === 'dark') return true;
  if (a === 'light') return false;
  return matchMedia('(prefers-color-scheme: dark)').matches;
}
let mermaidTheme = null;
function renderMermaid() {
  const blocks = $$('.mermaid-block', preview);
  if (!blocks.length) return;
  if (!window.mermaid || typeof window.mermaid.render !== 'function') { blocks.forEach((b) => { b.innerHTML = '<div class="render-error">Loading diagram renderer…</div>'; }); return; }
  const theme = isDark() ? 'dark' : 'default';
  if (mermaidTheme !== theme) { mermaid.initialize({ startOnLoad: false, theme, securityLevel: 'strict', fontFamily: 'Instrument Sans, system-ui, sans-serif' }); mermaidTheme = theme; }
  const badge = $('#renderBadge');
  let pending = 0;
  for (const b of blocks) {
    let src = ''; try { src = decodeURIComponent(b.getAttribute('data-src') || ''); } catch {}
    const key = theme + '\u0000' + src;
    if (mermaidCache.has(key)) { b.innerHTML = mermaidCache.get(key); continue; }
    pending++; badge.style.opacity = 1;
    const id = 'cowdrey-mmd-' + (++mermaidSeq);
    Promise.resolve().then(() => mermaid.render(id, src)).then(({ svg }) => {
      mermaidCache.set(key, svg);
      if (mermaidCache.size > 60) mermaidCache.delete(mermaidCache.keys().next().value);
      b.innerHTML = svg;
    }).catch((e) => {
      b.innerHTML = `<div class="render-error">Diagram error: ${esc((e && (e.message || e.str)) || e)}</div>`;
      document.getElementById('d' + id)?.remove(); document.getElementById(id)?.remove();
    }).finally(() => { if (--pending <= 0) { badge.style.opacity = 0; buildLineMap(); } });
  }
}
function typesetMath() {
  if (!S.math || !mathReady) return;
  const els = $$('.math-inline, .math-display, .math-block', preview);
  if (!els.length) return;
  try {
    MathJax.typesetClear && MathJax.typesetClear();
    MathJax.typesetPromise(els).then(() => { buildLineMap(); }).catch(() => {});
  } catch {}
}
window.__cowdreyMathReady = () => { mathReady = true; typesetMath(); };
window.addEventListener('load', () => { if (window.mermaid && $('.mermaid-block', preview)) renderMermaid(); if (window.MathJax && MathJax.typesetPromise) { mathReady = true; typesetMath(); } });

/* ================================================================
   Page layout: size, zoom, ruler
   ================================================================ */
const PAGES = { letter: { w: 816, h: 1056, unit: 'in', label: 'Letter' }, a4: { w: 794, h: 1123, unit: 'cm', label: 'A4' }, wide: { w: 1040, h: 0, unit: 'in', label: 'Wide' }, fluid: { w: 0, h: 0, unit: 'in', label: 'Fluid' } };
const MARGINS = { narrow: 48, normal: 96, wide: 144 };
let scale = 1, pageW = 816, pad = 96, compact = false;

function sizePage() {
  compact = canvas.clientWidth < 560;
  const cs = getComputedStyle(canvas);
  const avail = Math.max(240, canvas.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 2);
  let size = PAGES[S.pageSize];
  pad = MARGINS[S.margins];
  if (compact && S.zoom === 'fit') {
    size = PAGES.fluid; pad = 22;
  }
  if (size.w) {
    pageW = size.w;
    scale = S.zoom === 'fit' ? Math.min(1, avail / pageW) : S.zoom / 100;
  } else {
    scale = S.zoom === 'fit' ? 1 : S.zoom / 100;
    pageW = Math.max(300, avail / scale);
    if (!compact) pad = Math.min(pad, Math.round(pageW * 0.08));
  }
  scale = clamp(scale, 0.25, 3);
  page.style.width = pageW + 'px';
  page.style.setProperty('--pad', pad + 'px');
  page.style.setProperty('--page-h', (size.h || 0) + 'px');
  page.style.minHeight = size.h ? size.h + 'px' : '';
  page.classList.toggle('guides', !!(S.guides && size.h));
  page.style.transform = `scale(${scale})`;
  pageWrap.style.width = pageW * scale + 'px';
  pageWrap.style.height = page.offsetHeight * scale + 'px';
  updatePageCount(); drawRuler(); updateZoomUI();
}
function updatePageCount() {
  const size = compact && S.zoom === 'fit' ? PAGES.fluid : PAGES[S.pageSize];
  const el = $('#sbPage');
  if (!size.h) { el.textContent = compact || S.pageSize === 'fluid' ? 'Pageless' : 'Wide page'; return; }
  const total = Math.max(1, Math.ceil((page.offsetHeight - 2) / size.h));
  const y = canvas.scrollTop - pageWrap.offsetTop + canvas.clientHeight * 0.35;
  const curPage = clamp(Math.floor(y / (size.h * scale)) + 1, 1, total);
  el.textContent = `Page ${curPage} of ${total}`;
}

function drawRuler() {
  if (!S.ruler || app.dataset.view === 'editor') return;
  const c = $('#rulerCanvas'), ruler = $('#ruler');
  const dpr = window.devicePixelRatio || 1;
  const w = pageW * scale, h = 24;
  c.width = Math.round(w * dpr); c.height = h * dpr; c.style.width = w + 'px';
  c.style.left = (pageWrap.offsetLeft - canvas.scrollLeft) + 'px';
  const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const cs = getComputedStyle(document.documentElement);
  const col = (n) => cs.getPropertyValue(n).trim();
  g.fillStyle = col('--surface'); g.fillRect(0, 3, w, h - 6);
  g.fillStyle = col('--hover'); const pm = pad * scale;
  g.fillRect(0, 3, pm, h - 6); g.fillRect(w - pm, 3, pm, h - 6);
  const unit = (compact && S.zoom === 'fit') ? 'in' : PAGES[S.pageSize].unit;
  const major = unit === 'in' ? 96 : 96 / 2.54, steps = unit === 'in' ? 8 : 2;
  g.strokeStyle = col('--ink-3'); g.fillStyle = col('--ink-2'); g.lineWidth = 1;
  g.font = `10px ${col('--font-ui') || 'sans-serif'}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  const x0 = pm;
  for (let dir of [1, -1]) {
    for (let i = dir === 1 ? 0 : 1; ; i++) {
      const x = x0 + dir * i * (major / steps) * scale;
      if (x < 0 || x > w) break;
      const k = i % steps;
      const n = i / steps;
      g.beginPath();
      if (k === 0) { if (n) g.fillText(String(n), Math.round(x) + .5, h / 2); }
      else {
        const len = (steps === 8 && k === 4) || steps === 2 ? 6 : (k % 2 === 0 ? 4 : 2.5);
        g.moveTo(Math.round(x) + .5, h / 2 - len / 2); g.lineTo(Math.round(x) + .5, h / 2 + len / 2); g.stroke();
      }
    }
  }
  g.fillStyle = col('--accent');
  for (const x of [pm, w - pm]) { g.beginPath(); g.moveTo(x - 4, 3); g.lineTo(x + 4, 3); g.lineTo(x, 8); g.closePath(); g.fill(); }
  ruler.title = unit === 'in' ? 'Ruler in inches' : 'Ruler in centimetres';
}
new ResizeObserver(() => { pageWrap.style.height = page.offsetHeight * scale + 'px'; updatePageCount(); }).observe(page);
new ResizeObserver(() => { sizePage(); buildLineMap(); }).observe(canvas);

function setZoom(z) {
  S.zoom = z === 'fit' ? 'fit' : clamp(Math.round(z / 10) * 10, 50, 200); saveSettings();
  sizePage(); buildLineMap();
}
function updateZoomUI() {
  const pct = Math.round(scale * 100);
  $('#zoomRange').value = clamp(pct, 50, 200);
  $('#zoomPct').textContent = S.zoom === 'fit' ? (window.innerWidth <= 760 ? 'Fit' : `Fit · ${pct}%`) : pct + '%';
}

/* ================================================================
   Scroll sync (editor ↔ preview) via source-line anchors
   ================================================================ */
function buildLineMap() {
  const base = canvas.getBoundingClientRect().top - canvas.scrollTop;
  const pts = [[0, 0]];
  let lastL = 0, lastY = 0;
  for (const el of preview.querySelectorAll('[data-line]')) {
    const l = +el.getAttribute('data-line');
    const y = el.getBoundingClientRect().top - base - 16;
    if (!(l > lastL) || y < lastY) continue;
    pts.push([l, y]); lastL = l; lastY = y;
  }
  lineMap = pts;
}
let syncLock = { src: null, until: 0 };
const lockSync = (src) => { syncLock = { src, until: performance.now() + 140 }; };
function interp(x, xs, ys) {
  if (xs.length < 2) return ys[0] || 0;
  let i = 1; while (i < xs.length - 1 && xs[i] < x) i++;
  const x0 = xs[i - 1], x1 = xs[i], y0 = ys[i - 1], y1 = ys[i];
  if (x1 === x0) return y0;
  return y0 + (y1 - y0) * clamp((x - x0) / (x1 - x0), 0, x >= x1 && i === xs.length - 1 ? 50 : 1);
}
function syncFromEditor() {
  if (!lineMap.length) return;
  const info = cm.getScrollInfo();
  const maxP = canvas.scrollHeight - canvas.clientHeight;
  let target;
  if (info.top <= 2) target = 0;
  else if (info.top >= info.height - info.clientHeight - 2) target = maxP;
  else {
    const ex = lineMap.map(([l]) => cm.heightAtLine(l, 'local') - 22);
    const py = lineMap.map(([, y]) => y);
    target = interp(info.top, ex, py);
  }
  lockSync('editor'); canvas.scrollTop = clamp(target, 0, maxP);
}
function syncFromPreview() {
  if (!lineMap.length) return;
  const info = cm.getScrollInfo();
  const maxE = info.height - info.clientHeight;
  const maxP = canvas.scrollHeight - canvas.clientHeight;
  let target;
  if (canvas.scrollTop <= 2) target = 0;
  else if (canvas.scrollTop >= maxP - 2) target = maxE;
  else {
    const ex = lineMap.map(([l]) => cm.heightAtLine(l, 'local') - 22);
    const py = lineMap.map(([, y]) => y);
    target = interp(canvas.scrollTop, py, ex);
  }
  lockSync('preview'); cm.scrollTo(null, clamp(target, 0, maxE));
}
cm.on('scroll', () => {
  if (syncLock.src === 'preview' && performance.now() < syncLock.until) return;
  if (S.sync && S.view === 'split') syncFromEditor();
});
canvas.addEventListener('scroll', () => {
  $('#rulerCanvas').style.left = (pageWrap.offsetLeft - canvas.scrollLeft) + 'px';
  updatePageCount();
  if (syncLock.src === 'editor' && performance.now() < syncLock.until) return;
  if (S.sync && S.view === 'split') syncFromPreview();
}, { passive: true });
preview.addEventListener('load', debounce(buildLineMap, 100), true);

/* ================================================================
   Editing commands
   ================================================================ */
const cmpPos = CodeMirror.cmpPos;
function wrapInline(b, a = b, ph = 'text') {
  cm.focus();
  cm.operation(() => {
    if (cm.listSelections().length === 1 && !cm.somethingSelected()) {
      const c = cm.getCursor(), line = cm.getLine(c.line);
      if (line.slice(c.ch - b.length, c.ch) === b && line.slice(c.ch, c.ch + a.length) === a) {
        cm.replaceRange('', { line: c.line, ch: c.ch - b.length }, { line: c.line, ch: c.ch + a.length }); return;
      }
      const w = cm.findWordAt(c), word = cm.getRange(w.anchor, w.head);
      if (/[\p{L}\p{N}]/u.test(word)) cm.setSelection(w.anchor, w.head);
      else {
        cm.replaceSelection(b + ph + a);
        const e = cm.getCursor();
        cm.setSelection({ line: e.line, ch: e.ch - a.length - ph.length }, { line: e.line, ch: e.ch - a.length });
        return;
      }
    }
    const ranges = cm.listSelections();
    // unwrap if the selection is surrounded by the markers
    if (ranges.length === 1) {
      const r = ranges[0];
      const from = cmpPos(r.anchor, r.head) < 0 ? r.anchor : r.head, to = from === r.anchor ? r.head : r.anchor;
      const before = cm.getRange({ line: from.line, ch: Math.max(0, from.ch - b.length - 2) }, from);
      const after = cm.getRange(to, { line: to.line, ch: to.ch + a.length + 1 });
      const single = b === '*' || b === '~';
      const ok = before.endsWith(b) && after.startsWith(a) &&
        !(single && before.endsWith(b + b) && !before.endsWith(b + b + b));
      if (ok) {
        cm.replaceRange('', to, { line: to.line, ch: to.ch + a.length });
        cm.replaceRange('', { line: from.line, ch: from.ch - b.length }, from);
        const nf = { line: from.line, ch: from.ch - b.length };
        const nt = to.line === from.line ? { line: to.line, ch: to.ch - b.length } : to;
        cm.setSelection(nf, nt); return;
      }
    }
    const texts = cm.getSelections();
    const isWrapped = (t) => {
      if (!(t.startsWith(b) && t.endsWith(a) && t.length >= b.length + a.length)) return false;
      const inner = t.slice(b.length, t.length - a.length);
      if (inner.includes(b) || inner.includes(a)) return false; // "*one* and *two*" is two spans, not one
      if ((b === '*' || b === '~') && t.startsWith(b + b) && !t.startsWith(b + b + b)) return false; // **bold** is not *italic*
      return true;
    };
    cm.replaceSelections(texts.map((t) => isWrapped(t) ? t.slice(b.length, t.length - a.length) : b + t + a), 'around');
    // shrink selection to inner text
    cm.setSelections(cm.listSelections().map((r) => {
      const from = cmpPos(r.anchor, r.head) < 0 ? r.anchor : r.head, to = from === r.anchor ? r.head : r.anchor;
      const t = cm.getRange(from, to);
      if (t.startsWith(b) && t.endsWith(a)) return { anchor: { line: from.line, ch: from.ch + b.length }, head: { line: to.line, ch: to.ch - a.length } };
      return r;
    }));
  });
}
function selLineRange() {
  const r = cm.listSelections()[0];
  let a = Math.min(r.anchor.line, r.head.line), b = Math.max(r.anchor.line, r.head.line);
  const end = cmpPos(r.anchor, r.head) < 0 ? r.head : r.anchor;
  if (b > a && end.ch === 0) b--;
  return [a, b];
}
function replaceLines(a, b, lines) {
  const hadSel = cm.somethingSelected();
  const c = cm.getCursor(), fromEnd = cm.getLine(c.line).length - c.ch;
  cm.replaceRange(lines.join('\n'), { line: a, ch: 0 }, { line: b, ch: cm.getLine(b).length });
  if (hadSel) cm.setSelection({ line: a, ch: 0 }, { line: b, ch: cm.getLine(b).length });
  else cm.setCursor({ line: c.line, ch: Math.max(0, cm.getLine(c.line).length - fromEnd) });
}
function setHeading(n) {
  cm.focus();
  const [a, b] = selLineRange();
  const firstLevel = (/^(#{1,6})\s/.exec(cm.getLine(a)) || [, ''])[1].length;
  const target = firstLevel === n ? 0 : n;
  if (a === b && !cm.getLine(a).trim() && n) {
    cm.replaceRange('#'.repeat(n) + ' ', { line: a, ch: 0 }, { line: a, ch: cm.getLine(a).length });
    return;
  }
  const out = [];
  for (let l = a; l <= b; l++) {
    const t = cm.getLine(l).replace(/^#{1,6}\s+/, '');
    out.push(target && t.trim() ? '#'.repeat(target) + ' ' + t : t);
  }
  cm.operation(() => replaceLines(a, b, out));
}
const LIST_PREFIX = /^(?:[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+)/;
function toggleBlock(kind) {
  cm.focus();
  const [a, b] = selLineRange();
  const lines = []; for (let l = a; l <= b; l++) lines.push(cm.getLine(l));
  const test = {
    ul: (t) => /^\s*[-*+]\s+(?!\[[ xX]\]\s)/.test(t), ol: (t) => /^\s*\d+[.)]\s+/.test(t),
    task: (t) => /^\s*[-*+]\s+\[[ xX]\]\s/.test(t), quote: (t) => /^\s*>/.test(t),
  }[kind];
  const filled = lines.filter((t) => t.trim());
  const all = filled.length > 0 && filled.every(test);
  let n = 1;
  const out = lines.map((t) => {
    if (!t.trim()) return t;
    if (kind === 'quote') return all ? t.replace(/^(\s*)>\s?/, '$1') : (test(t) ? t : '> ' + t);
    const ind = /^\s*/.exec(t)[0];
    const rest = t.slice(ind.length).replace(LIST_PREFIX, '');
    if (all) return ind + rest;
    const pre = kind === 'ul' ? '- ' : kind === 'task' ? '- [ ] ' : (n++) + '. ';
    return ind + pre + rest;
  });
  if (!filled.length) out[0] = kind === 'quote' ? '> ' : kind === 'ul' ? '- ' : kind === 'task' ? '- [ ] ' : '1. ';
  cm.operation(() => {
    replaceLines(a, b, out);
    if (!cm.somethingSelected() && a === b) cm.setCursor({ line: a, ch: cm.getLine(a).length });
  });
}
function clearFormatting() {
  cm.focus();
  if (!cm.somethingSelected()) {
    const [a, b] = selLineRange();
    const out = []; for (let l = a; l <= b; l++) out.push(cm.getLine(l).replace(/^\s*(#{1,6}\s+|>\s?|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+)/, ''));
    cm.operation(() => replaceLines(a, b, out)); return;
  }
  cm.replaceSelections(cm.getSelections().map((t) => t
    .replace(/<\/?(u|mark|sup|sub|b|i|em|strong)>/gi, '')
    .replace(/\*\*\*(.+?)\*\*\*/g, '$1')
    .replace(/(\*\*|~~|==)(.+?)\1/g, '$2').replace(/(\*|~|\^)(\S(?:.*?\S)?)\1/g, '$2')
    .replace(/(^|[^\p{L}\p{N}_])(__?)(\S(?:.*?\S)?)\2(?![\p{L}\p{N}_])/gu, '$1$3')
    .replace(/`([^`]+)`/g, '$1')), 'around');
}
function frontMatterEnd() {
  if (!/^---\s*$/.test(cm.getLine(0) || '')) return -1;
  for (let l = 1; l <= Math.min(cm.lastLine(), 200); l++) if (/^---\s*$/.test(cm.getLine(l))) return l;
  return -1;
}
function insertBlock(text, selStart, selEnd) {
  cm.focus();
  const fmEnd = frontMatterEnd();
  if (fmEnd >= 0 && cm.getCursor('to').line <= fmEnd) cm.setCursor({ line: fmEnd, ch: cm.getLine(fmEnd).length });
  const c = cm.getCursor('to'), line = cm.getLine(c.line);
  let at, pre = '';
  if (!line.trim()) { at = { line: c.line, ch: 0 }; cm.replaceRange('', at, { line: c.line, ch: line.length }); if (c.line > 0 && cm.getLine(c.line - 1).trim()) pre = '\n'; }
  else { at = { line: c.line, ch: line.length }; pre = '\n\n'; }
  const next = cm.getLine(at.line + 1);
  const post = next === undefined ? '\n' : (next.trim() ? '\n\n' : '');
  cm.replaceRange(pre + text + post, at);
  const base = cm.indexFromPos(at) + pre.length;
  if (selStart != null) cm.setSelection(cm.posFromIndex(base + selStart), cm.posFromIndex(base + (selEnd ?? selStart)));
  else cm.setCursor(cm.posFromIndex(base + text.length));
}
function insertInline(text, selStart, selEnd) {
  cm.focus();
  const from = cm.getCursor('from');
  cm.replaceSelection(text);
  if (selStart != null) {
    const base = cm.indexFromPos(from);
    cm.setSelection(cm.posFromIndex(base + selStart), cm.posFromIndex(base + (selEnd ?? selStart)));
  }
}
function insertLink() {
  const t = cm.getSelection();
  if (/^https?:\/\/\S+$/.test(t)) return insertInline(`[](${t})`, 1);
  if (t) return insertInline(`[${t}](https://)`, t.length + 3, t.length + 11);
  insertInline('[link text](https://)', 1, 10);
}
function insertFootnote() {
  const used = new Set([...cm.getValue().matchAll(/\[\^(\d+)\]/g)].map((m) => +m[1]));
  let n = 1; while (used.has(n)) n++;
  const end = cm.getCursor('to');
  cm.replaceRange(`[^${n}]`, end);
  const last = cm.lastLine();
  const lastText = cm.getLine(last);
  const isNote = (l) => /^\[\^[^\]]+\]:/.test(l);
  const block = (lastText.trim() ? (isNote(lastText) ? '\n' : '\n\n') : (last > 0 && cm.getLine(last - 1).trim() && !isNote(cm.getLine(last - 1)) ? '\n' : '')) + `[^${n}]: `;
  cm.replaceRange(block, { line: last, ch: lastText.length });
  cm.setCursor({ line: cm.lastLine(), ch: cm.getLine(cm.lastLine()).length });
  cm.focus();
}
function makeTable(rows, cols) {
  const head = Array.from({ length: cols }, (_, i) => `Column ${i + 1}`);
  const lines = ['| ' + head.join(' | ') + ' |', '| ' + head.map((h) => '-'.repeat(h.length)).join(' | ') + ' |'];
  for (let r = 0; r < rows - 1; r++) lines.push('| ' + head.map((h) => ' '.repeat(h.length)).join(' | ') + ' |');
  insertBlock(lines.join('\n'), 2, 10);
}
const cellWidth = (s) => { let w = 0; for (const ch of s) w += /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(ch) ? 2 : 1; return w; };
function splitRow(line) {
  let s = line.trim(); if (s.startsWith('|')) s = s.slice(1); if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells = []; let curCell = '', inCode = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\\' && s[i + 1] === '|') { curCell += '\\|'; i++; continue; }
    if (ch === '`' && (inCode || s.indexOf('`', i + 1) !== -1)) inCode = !inCode;
    if (ch === '|' && !inCode) { cells.push(curCell.trim()); curCell = ''; continue; }
    curCell += ch;
  }
  cells.push(curCell.trim()); return cells;
}
function formatTable() {
  const c = cm.getCursor().line;
  const isRow = (l) => l != null && l.includes('|') && l.trim() !== '';
  if (!isRow(cm.getLine(c))) { toast('Put the cursor inside a table to tidy it.'); return; }
  let a = c, b = c;
  while (a > 0 && isRow(cm.getLine(a - 1))) a--;
  while (b < cm.lastLine() && isRow(cm.getLine(b + 1))) b++;
  const rows = []; for (let l = a; l <= b; l++) rows.push(splitRow(cm.getLine(l)));
  const sepIdx = rows.findIndex((r) => r.every((x) => /^:?-+:?$/.test(x)));
  if (sepIdx !== 1) { toast('That does not look like a Markdown table.'); return; }
  const n = Math.max(...rows.map((r) => r.length));
  rows.forEach((r) => { while (r.length < n) r.push(''); });
  const align = rows[1].map((x) => x.startsWith(':') && x.endsWith(':') ? 'c' : x.endsWith(':') ? 'r' : x.startsWith(':') ? 'l' : '');
  const w = Array.from({ length: n }, (_, i) => Math.max(3, ...rows.filter((_, j) => j !== 1).map((r) => cellWidth(r[i]))));
  const padCell = (s, i) => {
    const d = w[i] - cellWidth(s);
    if (align[i] === 'r') return ' '.repeat(d) + s;
    if (align[i] === 'c') return ' '.repeat(Math.floor(d / 2)) + s + ' '.repeat(Math.ceil(d / 2));
    return s + ' '.repeat(d);
  };
  const out = rows.map((r, j) => j === 1
    ? '| ' + r.map((_, i) => { const al = align[i]; const dash = '-'.repeat(w[i] - (al === 'c' ? 2 : al ? 1 : 0)); return al === 'c' ? ':' + dash + ':' : al === 'r' ? dash + ':' : al === 'l' ? ':' + dash : dash; }).join(' | ') + ' |'
    : '| ' + r.map(padCell).join(' | ') + ' |');
  cm.operation(() => { const ch = cm.getCursor().ch; cm.replaceRange(out.join('\n'), { line: a, ch: 0 }, { line: b, ch: cm.getLine(b).length }); cm.setCursor({ line: c, ch: Math.min(ch, cm.getLine(c).length) }); });
  toast('Table tidied');
}
function insertFrontMatter() {
  if (/^---\s*\n/.test(cm.getValue())) { cm.setCursor({ line: 1, ch: 0 }); cm.focus(); toast('This document already has front matter.'); return; }
  const d = new Date().toISOString().slice(0, 10);
  const text = `---\ntitle: ${cur().title}\nauthor: \ndate: ${d}\ntags: []\n---\n\n`;
  cm.replaceRange(text, { line: 0, ch: 0 });
  cm.setCursor({ line: 2, ch: 8 }); cm.focus();
}

/* images: stored as reference-style data URIs at the end of the doc */
async function fileToDataUrl(file) {
  const read = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
  if (file.size > 450 * 1024 && !/gif|svg/.test(file.type) && window.createImageBitmap) {
    try {
      const bmp = await createImageBitmap(file);
      const k = Math.min(1, 1800 / Math.max(bmp.width, bmp.height));
      const cv = document.createElement('canvas'); cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
      cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
      const out = cv.toDataURL('image/webp', 0.86);
      if (out.length < file.size * 1.37) return out;
    } catch {}
  }
  return read(file);
}
async function insertImages(files, at) {
  files = [...files].filter((f) => /^image\//.test(f.type));
  if (!files.length) return;
  const doc = cm.getDoc();
  if (at) doc.setCursor(at);
  const isRef = (l) => /^\[image-\d+\]:/.test(doc.getLine(l) || '');
  let cl = doc.getCursor().line;
  if (isRef(cl)) {
    while (cl > 0 && isRef(cl - 1)) cl--;
    doc.setCursor({ line: cl, ch: 0 }); doc.replaceSelection('\n\n'); doc.setCursor({ line: cl, ch: 0 });
  }
  let n = Math.max(0, ...[...doc.getValue().matchAll(/^\[image-(\d+)\]:/gm)].map((m) => +m[1]));
  const refs = [], inline = [];
  for (const f of files) {
    const url = await fileToDataUrl(f);
    n++;
    const alt = (f.name || 'image').replace(/\.[^.]+$/, '').replace(/[[\]]/g, '');
    inline.push(`![${alt}][image-${n}]`); refs.push(`[image-${n}]: ${url}`);
  }
  const apply = () => {
    doc.replaceSelection(inline.join('\n'));
    const keep = doc.getCursor();
    const last = doc.lastLine(), lt = doc.getLine(last);
    const sep = /^\[image-\d+\]:/.test(lt) ? '\n' : (lt.trim() ? '\n\n' : '\n');
    doc.replaceRange(sep + refs.join('\n'), { line: last, ch: lt.length });
    doc.setCursor(keep);
  };
  if (doc === cm.getDoc()) { cm.operation(apply); cm.focus(); } else apply();
  if (refs.join('').length > 2_500_000) toast('Large pictures may not fit in browser storage. Export the document to keep it safe.');
  toast(files.length > 1 ? `${files.length} pictures added` : 'Picture added');
}

/* ================================================================
   Find & replace
   ================================================================ */
const F = { marks: [], matches: [], idx: -1, cs: false, re: false, curMark: null };
function openFind(withReplace) {
  if (S.view === 'preview') setView('split');
  $('#findbar').hidden = false; $('#replaceRow').hidden = !withReplace;
  placeFindbar();
  const sel = cm.getSelection();
  const fi = $('#findInput');
  if (sel && !sel.includes('\n')) fi.value = sel;
  fi.focus(); fi.select(); runFind(true);
}
// The find bar opens to the right of the ribbon's Find and Replace buttons, as in Word.
// When those buttons aren't on screen (collapsed ribbon, another ribbon tab, phones) it sits at the top right of the editor.
let findPos = store.get(KEY + ':findPos', null); // where the person dragged it, if they did
function placeFindbar() {
  const bar = $('#findbar'); if (bar.hidden) return;
  if (findPos && window.innerWidth > 760) {
    bar.classList.add('moved'); bar.classList.remove('anchored'); bar.style.width = '';
    const w = bar.offsetWidth, h = bar.offsetHeight; // keep it fully on screen if the window shrank
    bar.style.left = clamp(findPos.x, 8, window.innerWidth - w - 8) + 'px';
    bar.style.top = clamp(findPos.y, 8, window.innerHeight - h - 8) + 'px';
    return;
  }
  bar.classList.remove('moved');
  const btn = $$('#ribbonBody [data-cmd="find"]').find((b) => b.offsetParent);
  if (!btn || window.innerWidth <= 760) { bar.classList.remove('anchored'); bar.style.left = bar.style.top = bar.style.width = ''; return; }
  bar.classList.add('anchored');
  const group = btn.closest('.r-group') || btn;
  const g = group.getBoundingClientRect(), b = btn.getBoundingClientRect();
  const room = window.innerWidth - 8 - (g.right + 8);
  let left = g.right + 8, top = b.top - 4;
  if (room >= 300) bar.style.width = Math.min(380, room) + 'px'; // beside Find, narrowing a little if needed
  else { bar.style.width = ''; left = Math.max(8, window.innerWidth - 8 - bar.offsetWidth); top = g.bottom + 6; } // no room beside it: just below
  bar.style.left = left + 'px'; bar.style.top = Math.max(8, top) + 'px';
}
window.addEventListener('resize', debounce(placeFindbar, 60));
// Drag the grip to move the bar anywhere; double-click it to put it back beside Find.
(() => {
  const grip = $('#findGrip'), bar = $('#findbar');
  let start = null;
  grip.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || window.innerWidth <= 760) return;
    const r = bar.getBoundingClientRect();
    start = { x: e.clientX - r.left, y: e.clientY - r.top };
    grip.setPointerCapture(e.pointerId); bar.classList.add('dragging'); e.preventDefault();
  });
  grip.addEventListener('pointermove', (e) => {
    if (!start) return;
    findPos = { x: e.clientX - start.x, y: e.clientY - start.y };
    placeFindbar();
  });
  const end = () => { if (!start) return; start = null; bar.classList.remove('dragging'); store.set(KEY + ':findPos', findPos); $('#findInput').focus(); };
  grip.addEventListener('pointerup', end); grip.addEventListener('pointercancel', end);
  grip.addEventListener('dblclick', () => { findPos = null; store.set(KEY + ':findPos', null); placeFindbar(); $('#findInput').focus(); });
})();
function closeFind() { $('#findbar').hidden = true; clearFindMarks(); F.matches = []; cm.focus(); }
function clearFindMarks() { F.marks.forEach((m) => m.clear()); F.marks = []; F.curMark && F.curMark.clear(); F.curMark = null; }
function findQuery() {
  const q = $('#findInput').value;
  if (!q) return null;
  if (F.re) { try { return new RegExp(q, F.cs ? 'g' : 'gi'); } catch { return undefined; } }
  return q;
}
function runFind(keepNearest, noScroll) {
  clearFindMarks(); F.matches = [];
  const q = findQuery(), count = $('#findCount');
  if (q === undefined) { count.textContent = 'Bad pattern'; return; }
  if (!q) { count.textContent = '0 of 0'; return; }
  const sc = cm.getSearchCursor(q, { line: 0, ch: 0 }, { caseFold: !F.cs });
  let last = null;
  let found;
  while ((found = sc.findNext())) {
    const from = sc.from(), to = sc.to();
    if (last && cmpPos(from, last) === 0 && cmpPos(from, to) === 0) break;
    if (cmpPos(from, to) === 0) { last = from; continue; }
    F.matches.push({ from, to, groups: Array.isArray(found) ? [...found] : null }); last = from;
    if (F.matches.length >= 5000) break;
  }
  cm.operation(() => { for (const m of F.matches) F.marks.push(cm.markText(m.from, m.to, { className: 'cm-match' })); });
  if (keepNearest) {
    const c = cm.getCursor('from');
    F.idx = F.matches.findIndex((m) => cmpPos(m.from, c) >= 0);
    if (F.idx < 0) F.idx = 0;
  } else F.idx = clamp(F.idx, 0, F.matches.length - 1);
  showMatch(false, noScroll);
}
function showMatch(select = true, noScroll = false) {
  const count = $('#findCount');
  F.curMark && F.curMark.clear(); F.curMark = null;
  if (!F.matches.length) { count.textContent = '0 of 0'; return; }
  const m = F.matches[F.idx];
  count.textContent = `${nf.format(F.idx + 1)} of ${nf.format(F.matches.length)}`;
  F.curMark = cm.markText(m.from, m.to, { className: 'cm-match-current' });
  if (!noScroll) cm.scrollIntoView({ from: m.from, to: m.to }, 80);
  if (select) cm.setSelection(m.from, m.to);
}
function stepFind(d) { if (!F.matches.length) return; F.idx = (F.idx + d + F.matches.length) % F.matches.length; showMatch(true); }
// $1…$99, $& and $$ expand from the groups captured when the match was found, so lookarounds and \b keep working
function replaceText(m) {
  const r = $('#replaceInput').value;
  if (!F.re || !m.groups) return r;
  return r.replace(/\$(\$|&|\d{1,2})/g, (_, g) => g === '$' ? '$' : g === '&' ? m.groups[0] : (m.groups[+g] ?? ''));
}
function replaceOne() {
  if (!F.matches.length) return;
  const m = F.matches[F.idx];
  const text = replaceText(m);
  cm.replaceRange(text, m.from, m.to);
  const end = cm.posFromIndex(cm.indexFromPos(m.from) + text.length);
  runFind(false, true);
  if (F.matches.length) { const i = F.matches.findIndex((x) => cmpPos(x.from, end) >= 0); F.idx = i < 0 ? 0 : i; showMatch(true); }
}
function replaceAll() {
  if (!F.matches.length) return;
  const n = F.matches.length;
  cm.operation(() => { for (const m of [...F.matches].reverse()) cm.replaceRange(replaceText(m), m.from, m.to); });
  runFind(false); toast(`Replaced ${nf.format(n)} ${n === 1 ? 'match' : 'matches'}`);
}
$('#findInput').addEventListener('input', () => runFind(true));
$('#findInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); stepFind(e.shiftKey ? -1 : 1); }
  if (e.key === 'Escape') { e.preventDefault(); closeFind(); }
});
$('#replaceInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); replaceOne(); }
  if (e.key === 'Escape') { e.preventDefault(); closeFind(); }
});
$('#findNext').onclick = () => stepFind(1);
$('#findPrev').onclick = () => stepFind(-1);
$('#findClose').onclick = closeFind;
$('#replaceOne').onclick = replaceOne;
$('#replaceAll').onclick = replaceAll;
$('#findCase').onclick = (e) => { F.cs = !F.cs; e.currentTarget.setAttribute('aria-pressed', F.cs); runFind(true); };
$('#findRegex').onclick = (e) => { F.re = !F.re; e.currentTarget.setAttribute('aria-pressed', F.re); runFind(true); };
cm.on('changes', debounce(() => { if (!$('#findbar').hidden) runFind(false, true); }, 150));

/* ================================================================
   Focus & typewriter modes
   ================================================================ */
let focusHandles = [];
function updateFocus() {
  cm.operation(() => {
    for (const h of focusHandles) cm.removeLineClass(h, 'wrap', 'cm-focus-line');
    focusHandles = [];
    if (!S.focus) return;
    const l = cm.getCursor().line;
    let a = l, b = l;
    while (a > 0 && l - a < 200 && cm.getLine(a - 1).trim() !== '') a--;
    while (b < cm.lastLine() && b - l < 200 && cm.getLine(b + 1).trim() !== '') b++;
    for (let i = a; i <= b; i++) focusHandles.push(cm.addLineClass(i, 'wrap', 'cm-focus-line'));
  });
}
function typewriterScroll() {
  if (!S.typewriter) return;
  const c = cm.cursorCoords(null, 'local');
  cm.scrollTo(null, c.top - cm.getScrollInfo().clientHeight / 2 + 12);
}

/* ================================================================
   Outline, stats, status bar
   ================================================================ */
function updateOutline() {
  const el = $('#outlinePanel');
  if (isEmpty()) { el.innerHTML = '<p class="empty-note">No document is open. Open one to see its outline here.</p>'; return; }
  if (!headings.length) { el.innerHTML = '<p class="empty-note">Headings you add to the document appear here. Start a line with <b>#</b> to make one.</p>'; return; }
  el.innerHTML = headings.map((h, i) =>
    `<button type="button" class="ol-item l${h.level}" data-i="${i}" style="padding-left:${8 + (h.level - 1) * 12}px" title="${esc(h.text)}">${esc(h.text || 'Untitled heading')}</button>`).join('');
  highlightOutline();
}
function highlightOutline() {
  const line = cm.getCursor().line;
  let idx = -1; headings.forEach((h, i) => { if (h.line <= line) idx = i; });
  $$('.ol-item', $('#outlinePanel')).forEach((b) => b.classList.toggle('current', +b.dataset.i === idx));
}
$('#outlinePanel').addEventListener('click', (e) => {
  const b = e.target.closest('.ol-item'); if (!b) return;
  const h = headings[+b.dataset.i]; if (!h) return;
  goToLine(h.line);
  if (window.innerWidth <= 1180) toggleOutline(false);
});
function goToLine(line) {
  cm.setCursor({ line, ch: 0 });
  lockSync('editor');
  cm.scrollTo(null, Math.max(0, cm.heightAtLine(line, 'local') - 30));
  const el = preview.querySelector(`[data-line="${line}"]`);
  if (el && S.view !== 'editor') {
    lockSync('editor');
    canvas.scrollTop += el.getBoundingClientRect().top - canvas.getBoundingClientRect().top - 24;
  }
  if (S.view !== 'preview') cm.focus();
}

let stats = {};
function countWords(text) {
  const cjk = (text.match(/[぀-ヿ㐀-䶿一-鿿가-힯]/g) || []).length;
  const words = (text.replace(/[぀-ヿ㐀-䶿一-鿿가-힯]/g, ' ').match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu) || []);
  return { count: words.length + cjk, words };
}
function syllables(w) {
  w = w.toLowerCase().replace(/[^a-z]/g, '');
  if (w.length <= 3) return 1;
  w = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '');
  const m = w.match(/[aeiouy]{1,2}/g); return m ? m.length : 1;
}
function updateStats() {
  const clone = preview.cloneNode(true);
  clone.querySelectorAll('.code-head, .front-matter, .footnotes, mjx-container, .mermaid-block, .toc').forEach((n) => n.remove());
  const text = clone.textContent;
  const { count, words } = countWords(text);
  const sentences = Math.max(1, (text.match(/[^.!?\n]+[.!?]+(\s|$)/g) || []).length);
  const syl = words.reduce((s, w) => s + syllables(w), 0);
  const flesch = count ? 206.835 - 1.015 * (count / sentences) - 84.6 * (syl / count) : 0;
  const src = cm.getValue();
  stats = {
    words: count, chars: text.length, charsNoSpace: text.replace(/\s/g, '').length, sentences: count ? sentences : 0,
    paragraphs: preview.querySelectorAll('p').length, headings: headings.length,
    links: preview.querySelectorAll('a[href]:not(.footnote-backref):not(.footnote-ref a)').length,
    images: preview.querySelectorAll('img').length, lines: cm.lineCount(), bytes: new Blob([src]).size,
    read: count / 238, speak: count / 140, flesch: clamp(flesch, 0, 100),
  };
  $('#sbWords').textContent = `${nf.format(count)} ${count === 1 ? 'word' : 'words'}`;
  $('#sbRead').textContent = count < 238 ? 'Under 1 min read' : `${Math.round(stats.read)} min read`;
}
const fmtMin = (m) => m < 1 ? 'Under 1 min' : m < 60 ? `${Math.round(m)} min` : `${Math.floor(m / 60)} h ${Math.round(m % 60)} min`;
function fleschLabel(f) {
  return f >= 90 ? 'Very easy' : f >= 70 ? 'Easy' : f >= 60 ? 'Plain English' : f >= 50 ? 'Fairly difficult' : f >= 30 ? 'Difficult' : 'Very difficult';
}
function showStats() {
  const s = stats;
  openDialog({
    title: 'Word count',
    body: `<table class="kv"><tbody>
      <tr><td>Words</td><td>${nf.format(s.words)}</td></tr>
      <tr><td>Characters (with spaces)</td><td>${nf.format(s.chars)}</td></tr>
      <tr><td>Characters (no spaces)</td><td>${nf.format(s.charsNoSpace)}</td></tr>
      <tr><td>Sentences</td><td>${nf.format(s.sentences)}</td></tr>
      <tr><td>Paragraphs</td><td>${nf.format(s.paragraphs)}</td></tr>
      <tr><td>Headings</td><td>${nf.format(s.headings)}</td></tr>
      <tr><td>Links</td><td>${nf.format(s.links)}</td></tr>
      <tr><td>Pictures</td><td>${nf.format(s.images)}</td></tr>
      <tr><td>Source lines</td><td>${nf.format(s.lines)}</td></tr>
      <tr><td>Reading time</td><td>${fmtMin(s.read)}</td></tr>
      <tr><td>Speaking time</td><td>${fmtMin(s.speak)}</td></tr>
      <tr><td>Flesch reading ease</td><td>${s.words ? `${Math.round(s.flesch)} · ${fleschLabel(s.flesch)}` : '—'}</td></tr>
    </tbody></table>
    <p style="margin-top:12px;font-size:12px">Counts skip code labels, front matter, footnotes, diagrams, and equations. Reading time assumes 238 words a minute.</p>`,
    actions: [{ label: 'Done', primary: true }],
  });
}
function updateCursorStatus() {
  const c = cm.getCursor();
  const sel = cm.getSelection();
  $('#sbPos').textContent = sel ? `${nf.format(countWords(sel).count)} of ${nf.format(stats.words || 0)} words selected` : `Ln ${c.line + 1}, Col ${c.ch + 1}`;
}

/* ================================================================
   Documents: save, switch, tabs, list
   ================================================================ */
const dirtyIds = new Set(firstRun ? docs.map((d) => d.id) : []);
const deletedIds = new Set();
let seenInStore = new Set((store.get(KEY + ':index', []) || []).map((m) => m.id));
let applyingRemote = false;
const markDirty = (id = currentId) => { dirtyIds.add(id); };
let setSaveState = function (kind) {
  const el = saveStateEl;
  el.classList.toggle('error', kind === 'error');
  el.innerHTML = kind === 'saving' ? `${ic('loader')}<span>Saving…</span>`
    : kind === 'error' ? `${ic('triangle-alert')}<span>Not saved. Browser storage is full or blocked, so export to keep your work.</span>`
    : `${ic('check')}<span>Saved to this browser</span>`;
  refreshIcons();
};
// Pull in documents created, edited or deleted in other browser tabs. Returns true when anything changed.
function syncFromStorage() {
  const stored = store.get(KEY + ':index', null);
  if (!Array.isArray(stored)) return false;
  let changed = false;
  const ids = new Set(stored.map((m) => m.id));
  for (const m of stored) {
    if (deletedIds.has(m.id)) continue;
    const d = docs.find((x) => x.id === m.id);
    if (!d) { docs.push({ ...m, content: store.get(DOC_KEY(m.id), '') }); changed = true; continue; }
    if (m.updated > d.updated && !dirtyIds.has(d.id)) {
      Object.assign(d, m, { content: store.get(DOC_KEY(m.id), d.content) });
      const cd = cmDocs.get(d.id);
      if (cd && cd.getValue() !== d.content) {
        applyingRemote = true;
        const c = cd.getCursor(); cd.setValue(d.content); cd.setCursor(c);
        applyingRemote = false;
      }
      changed = true;
    }
  }
  for (const d of [...docs]) {
    if (seenInStore.has(d.id) && !ids.has(d.id) && !dirtyIds.has(d.id)) {
      docs.splice(docs.indexOf(d), 1); cmDocs.delete(d.id);
      S.openTabs = S.openTabs.filter((x) => x !== d.id); changed = true;
    }
  }
  seenInStore = ids;
  return changed;
}
function persist() {
  syncFromStorage();
  let ok = true;
  for (const id of [...dirtyIds]) {
    const d = docs.find((x) => x.id === id);
    if (!d) { dirtyIds.delete(id); continue; }
    if (store.set(DOC_KEY(id), d.content) && (d.diskContent == null || store.set(DISK_KEY(id), d.diskContent))) dirtyIds.delete(id); else ok = false;
  }
  for (const id of deletedIds) { try { localStorage.removeItem(DOC_KEY(id)); localStorage.removeItem(DISK_KEY(id)); } catch {} }
  deletedIds.clear();
  const index = docs.map(meta);
  if (store.set(KEY + ':index', index)) seenInStore = new Set(index.map((m) => m.id)); else ok = false;
  store.set(KEY + ':current', currentId);
  setSaveState(ok ? 'saved' : 'error');
  if (!ok && !persist.warned) { persist.warned = true; toast('Not saved: browser storage is full or blocked. Export to keep your work.'); }
  if (ok) persist.warned = false;
  return ok;
}
window.addEventListener('storage', (e) => {
  if (e.key !== KEY + ':index') return;
  if (!syncFromStorage()) return;
  if (!cur()) { currentId = (docs[0] || newDocSilently()).id; openDoc(currentId); return; }
  titleInput.value = cur().title; renderTabs(); renderDocsList();
  if (!dirtyIds.has(currentId)) render();
});
const scheduleSave = debounce(persist, 600);
function flushSave() { if (dirtyIds.size) persist(); store.set(KEY + ':settings', S); }
window.addEventListener('pagehide', flushSave);
document.addEventListener('visibilitychange', () => { if (document.hidden) flushSave(); });

function autoTitle() {
  const d = cur(); if (!d || !d.autoTitle) return;
  let t = (fm && fm.title && fm.title.replace(/^["']|["']$/g, '')) || (headings[0] && headings[0].text) || '';
  if (!t) { const line = cm.getValue().split('\n').find((l) => l.trim()); t = line ? line.replace(/^[#>*\-+\s\d.[\]]+/, '').trim() : ''; }
  t = (t || 'Untitled document').slice(0, 80);
  if (t !== d.title) { d.title = t; markDirty(d.id); scheduleSave(); if (document.activeElement !== titleInput) titleInput.value = t; renderTabs(); renderDocsList(); }
}
titleInput.addEventListener('input', () => {
  const d = cur(); d.title = titleInput.value.trim() || 'Untitled document'; d.autoTitle = false; d.updated = Date.now();
  markDirty(d.id); scheduleSave(); renderTabs(); renderDocsList();
});
titleInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); cm.focus(); } });

function openDoc(id) {
  const d = docs.find((x) => x.id === id); if (!d) return;
  if (isEmpty()) setEmpty(false);
  flushSave();
  currentId = id;
  if (!S.openTabs.includes(id)) S.openTabs.push(id);
  saveSettings(); store.set(KEY + ':current', id);
  let cd = cmDocs.get(id);
  if (!cd) { cd = CodeMirror.Doc(d.content, MODE); cmDocs.set(id, cd); }
  cm.swapDoc(cd);
  titleInput.value = d.title;
  closeFind();
  render(); renderTabs(); renderDocsList();
  canvas.scrollTop = 0;
  if (!dirtyIds.size) setSaveState('saved');
}
function newDoc(content = '', title) {
  const d = makeDoc(content, title || 'Untitled document', !title);
  docs.unshift(d); markDirty(d.id); persist(); openDoc(d.id); cm.focus();
  return d;
}
// A file opened from disk whose edits haven't been saved back to it (the Mac app only; the web saves to the browser).
const isUnsaved = (d) => !!(TAURI && d && d.path && d.diskContent != null && d.content !== d.diskContent);
// In the Mac app, a document that was never saved to a file is offered a Save when its tab closes.
const neverSaved = (d) => !!(TAURI && d && !d.path && d.content.trim() && d.content !== WELCOME);
const closedTabs = []; // most recent last, for Reopen closed tab
// Ask before closing a file with unsaved changes. Resolves true when it's fine to close.
function confirmClose(id) {
  const d = docs.find((x) => x.id === id);
  if (!isUnsaved(d) && !neverSaved(d)) return Promise.resolve(true);
  const file = isUnsaved(d);
  return new Promise((resolve) => {
    let answered = false, saving = false;
    const done = (v) => { if (!answered) { answered = true; resolve(v); } };
    openDialog({
      title: file ? `Save changes to “${baseName(d.path)}”?` : `Save “${d.title}” as a file?`,
      body: file ? '<p>Your changes will be lost if you don’t save them.</p>'
        : '<p>It stays in the Documents list in the sidebar either way, so you can reopen it later.</p>',
      actions: [
        { label: 'Cancel', run: () => done(false) },
        { label: 'Don’t save', run: () => { if (file) revertToDisk(d); done(true); } },
        { label: file ? 'Save' : 'Save…', primary: true, run: () => { saving = true; saveDoc(d).then((ok) => done(ok), () => done(false)); } },
      ],
    });
    // The close event of an earlier dialog can arrive after this one opened (Close all); only react once this one closes.
    const onClose = () => { if (dialog.open) return; dialog.removeEventListener('close', onClose); setTimeout(() => { if (!saving) done(false); }, 0); };
    dialog.addEventListener('close', onClose);
  });
}
function revertToDisk(d) {
  d.content = d.diskContent; d.updated = Date.now();
  cmDocs.get(d.id)?.setValue(d.diskContent);
  markDirty(d.id); scheduleSave();
}
async function closeTab(id, { force = false } = {}) {
  if (!force && !(await confirmClose(id))) return false;
  const i = S.openTabs.indexOf(id); if (i < 0) return true;
  closedTabs.push(id); if (closedTabs.length > 20) closedTabs.shift();
  S.openTabs.splice(i, 1);
  if (!S.openTabs.length) { flushSave(); setEmpty(true); return true; }
  if (id === currentId) openDoc(S.openTabs[Math.min(i, S.openTabs.length - 1)]);
  saveSettings(); renderTabs();
  return true;
}
async function closeTabs(ids) {
  for (const id of ids) if (!(await closeTab(id))) return false;
  return true;
}
// No open documents: hide the editor and preview and offer New, Open and recent documents.
const isEmpty = () => app.dataset.empty === 'on';
function setEmpty(on) {
  app.dataset.empty = on ? 'on' : 'off';
  $('#noDocs').hidden = !on;
  S.allClosed = on; saveSettings();
  if (on) {
    closeFind();
    cm.swapDoc(CodeMirror.Doc('', MODE)); // keeps anything typed by accident away from real documents
    cm.setOption('readOnly', 'nocursor');
    titleInput.value = ''; titleInput.disabled = true;
    renderTabs(); renderDocsList(); renderNoDocs(); updateOutline();
    document.title = 'Cowdrey.MD';
    setTimeout(() => $('#noDocs .btn.primary')?.focus(), 0);
  } else {
    cm.setOption('readOnly', false); titleInput.disabled = false;
  }
}
function renderNoDocs() {
  const recent = [...docs].sort((a, b) => b.updated - a.updated).slice(0, 6);
  $('#noDocsRecent').innerHTML = recent.length ? `<div class="side-heading">Recent documents</div>` + recent.map((d) =>
    `<button type="button" class="doc-open" data-open="${d.id}">${ic('file-text')}<span><span class="t">${esc(d.title)}</span><span class="m">${rel(d.updated)}${d.path ? ' · ' + esc(baseName(d.path)) : ''}</span></span></button>`).join('') : '';
  refreshIcons();
}
$('#noDocs').addEventListener('click', (e) => {
  const o = e.target.closest('[data-open]'); if (o) { openDoc(o.dataset.open); return; }
  const c = e.target.closest('[data-cmd]'); if (c) runCmd(c.dataset.cmd, c);
});
function reopenClosedTab() {
  while (closedTabs.length) {
    const id = closedTabs.pop();
    if (docs.some((d) => d.id === id)) { openDoc(id); return; }
  }
  toast('No recently closed tabs');
}
function cycleTab(step) {
  const n = S.openTabs.length; if (n < 2) return;
  const i = S.openTabs.indexOf(currentId);
  openDoc(S.openTabs[(i + step + n) % n]);
}
function selectTab(n) { // 1-based; 9 means the last tab, as in most apps
  const id = n === 9 ? S.openTabs[S.openTabs.length - 1] : S.openTabs[n - 1];
  if (id && id !== currentId) openDoc(id);
}
function duplicateDoc(id) {
  const d = docs.find((x) => x.id === id); if (!d) return;
  newDoc(d.content, d.title + ' copy');
}
function newDocSilently() { const d = makeDoc(); docs.unshift(d); markDirty(d.id); persist(); return d; }
function deleteDoc(id) {
  const i = docs.findIndex((d) => d.id === id); if (i < 0) return;
  const [d] = docs.splice(i, 1);
  cmDocs.delete(id); dirtyIds.delete(id); deletedIds.add(id);
  S.openTabs = S.openTabs.filter((x) => x !== id);
  if (!docs.length) { const n = makeDoc(); docs.push(n); markDirty(n.id); }
  if (id === currentId) { currentId = (S.openTabs[0] && docs.find((x) => x.id === S.openTabs[0])) ? S.openTabs[0] : docs[0].id; persist(); openDoc(currentId); }
  else { persist(); renderTabs(); renderDocsList(); }
  toast(`Deleted “${d.title}”`);
}
function renderTabs() {
  const el = $('#docTabs');
  el.setAttribute('role', 'tablist'); el.setAttribute('aria-label', 'Open documents');
  const open = S.openTabs.map((id) => docs.find((x) => x.id === id)).filter(Boolean);
  const titleCount = {};
  for (const d of open) titleCount[d.title] = (titleCount[d.title] || 0) + 1;
  el.innerHTML = open.map((d) => {
    const id = d.id, curTab = id === currentId, unsaved = isUnsaved(d);
    // Two tabs with the same name show their folder, as most editors do.
    const folder = d.path && titleCount[d.title] > 1 ? baseName(dirName(d.path)) : '';
    const tip = (d.path || d.title) + (unsaved ? ' (unsaved changes)' : '');
    return `<div class="doc-tab${curTab ? ' current' : ''}${unsaved ? ' unsaved' : ''}" data-id="${id}" role="tab" aria-selected="${curTab}" draggable="true"><button type="button" class="open" title="${esc(tip)}"${curTab ? ' aria-current="page"' : ''}>${ic('file-text')}<span>${esc(d.title)}</span>${folder ? `<span class="tab-dir">${esc(folder)}</span>` : ''}</button><button type="button" class="x" data-close="${id}" aria-label="Close ${esc(d.title)}${unsaved ? ', unsaved changes' : ''}">${unsaved ? '<i class="dot" aria-hidden="true"></i>' : ''}${ic('x')}</button></div>`;
  }).join('') + `<button type="button" class="new-tab" data-cmd="newDoc" title="New document" aria-label="New document">${ic('plus')}</button>`;
  refreshIcons();
  const curEl = el.querySelector('.doc-tab.current');
  if (curEl) { const l = curEl.offsetLeft, r = l + curEl.offsetWidth; if (l < el.scrollLeft) el.scrollLeft = l - 8; else if (r > el.scrollLeft + el.clientWidth) el.scrollLeft = r - el.clientWidth + 8; }
}
$('#docTabs').addEventListener('click', (e) => {
  const x = e.target.closest('[data-close]'); if (x) { e.stopPropagation(); closeTab(x.dataset.close); return; }
  const t = e.target.closest('.doc-tab'); if (t && t.dataset.id !== currentId) openDoc(t.dataset.id);
});
$('#docTabs').addEventListener('auxclick', (e) => { const t = e.target.closest('.doc-tab'); if (t && e.button === 1) closeTab(t.dataset.id); });
// Right-click (or Shift+F10 / the context-menu key) on a tab: the usual tab actions.
function tabMenu(tab) {
  const id = tab.dataset.id, d = docs.find((x) => x.id === id); if (!d) return;
  const i = S.openTabs.indexOf(id);
  const item = (a, icon, label, off) => `<button type="button" class="mi" data-ta="${a}"${off ? ' disabled' : ''}>${ic(icon)}<span>${label}</span><span class="k"></span></button>`;
  const html = item('close', 'x', 'Close tab') + item('others', 'copy-x', 'Close other tabs', S.openTabs.length < 2)
    + item('right', 'arrow-right-to-line', 'Close tabs to the right', i === S.openTabs.length - 1) + item('all', 'circle-x', 'Close all tabs')
    + '<div class="msep"></div>' + item('rename', 'pencil-line', 'Rename') + item('dup', 'files', 'Duplicate')
    + (TAURI && d.path ? '<div class="msep"></div>' + item('reveal', 'folder-search', 'Show in Finder') + item('path', 'clipboard-copy', 'Copy file path') : '');
  openPopover(tab.querySelector('.open'), html, (e) => {
    const b = e.target.closest('[data-ta]'); if (!b || b.disabled) return;
    closePopover();
    const a = b.dataset.ta;
    if (a === 'close') closeTab(id);
    if (a === 'others') closeTabs(S.openTabs.filter((x) => x !== id));
    if (a === 'right') closeTabs(S.openTabs.slice(i + 1));
    if (a === 'all') closeTabs([...S.openTabs]);
    if (a === 'rename') { openDoc(id); runCmd('renameDoc'); }
    if (a === 'dup') duplicateDoc(id);
    if (a === 'reveal') TAURI.opener.revealItemInDir(d.path).catch((err) => toast(`Could not show the file: ${err}`));
    if (a === 'path') navigator.clipboard.writeText(d.path).then(() => toast('File path copied'), () => toast(d.path));
  }, { label: `${d.title} tab` });
}
$('#docTabs').addEventListener('contextmenu', (e) => { const t = e.target.closest('.doc-tab'); if (!t) return; e.preventDefault(); tabMenu(t); });
$('#docTabs').addEventListener('keydown', (e) => {
  const t = e.target.closest('.doc-tab'); if (!t) return;
  if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { e.preventDefault(); tabMenu(t); return; }
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    const tabs = $$('.doc-tab .open', $('#docTabs')); const k = tabs.indexOf(t.querySelector('.open'));
    const next = tabs[clamp(k + (e.key === 'ArrowRight' ? 1 : -1), 0, tabs.length - 1)];
    if (next) { e.preventDefault(); next.focus(); }
  }
});
// A vertical mouse wheel scrolls a crowded tab bar sideways.
$('#docTabs').addEventListener('wheel', (e) => {
  const el = $('#docTabs');
  if (el.scrollWidth <= el.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
  el.scrollLeft += e.deltaY; e.preventDefault();
}, { passive: false });
// Drag a tab to reorder.
let dragTab = null;
$('#docTabs').addEventListener('dragstart', (e) => {
  const t = e.target.closest && e.target.closest('.doc-tab'); if (!t) return;
  dragTab = t; t.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('application/x-cowdrey-tab', t.dataset.id);
});
$('#docTabs').addEventListener('dragover', (e) => {
  if (!dragTab) return;
  e.preventDefault(); e.dataTransfer.dropEffect = 'move';
  const t = e.target.closest('.doc-tab'); if (!t || t === dragTab) return;
  const r = t.getBoundingClientRect();
  t.parentNode.insertBefore(dragTab, e.clientX > r.left + r.width / 2 ? t.nextSibling : t); // move the tab itself while dragging
});
$('#docTabs').addEventListener('drop', (e) => { if (dragTab) { e.preventDefault(); e.stopPropagation(); } });
// The drag ends here whether it was dropped on the bar, elsewhere, or cancelled with Esc.
document.addEventListener('dragend', () => {
  if (!dragTab) return;
  dragTab = null;
  S.openTabs = $$('.doc-tab', $('#docTabs')).map((x) => x.dataset.id);
  saveSettings(); renderTabs();
});

const rel = (t) => {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'Just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};
let confirmDelete = null;
function renderDocsList() {
  const el = $('#docsPanel');
  const sorted = [...docs].sort((a, b) => b.updated - a.updated);
  el.innerHTML = `<div class="side-heading" id="docsHeading">Recent documents</div><div role="list" aria-labelledby="docsHeading">` + sorted.map((d) => `
    <div class="doc-item${d.id === currentId ? ' current' : ''}" data-id="${d.id}" role="listitem">
      <button type="button" class="doc-open"${d.id === currentId ? ' aria-current="page"' : ''}>${ic('file-text')}<span style="min-width:0"><span class="t">${esc(d.title)}</span><span class="m">${rel(d.updated)} · ${nf.format(countWords(d.content).count)} words</span></span></button>
      <button class="del" type="button" data-del="${d.id}" title="Delete document" aria-label="Delete ${esc(d.title)}">${ic('trash-2')}</button>
    </div>${confirmDelete === d.id ? `<div class="confirm-row">Delete for good?<button class="mini-btn danger" type="button" data-yes="${d.id}">Delete</button><button class="mini-btn" type="button" data-no>Keep</button></div>` : ''}`).join('')
    + '</div><p class="empty-note">Documents are saved in this browser. Export anything you want to keep elsewhere.</p>';
  refreshIcons();
}
$('#docsPanel').addEventListener('click', (e) => {
  const del = e.target.closest('[data-del]'); if (del) { e.stopPropagation(); confirmDelete = del.dataset.del; renderDocsList(); return; }
  const yes = e.target.closest('[data-yes]'); if (yes) { confirmDelete = null; deleteDoc(yes.dataset.yes); return; }
  if (e.target.closest('[data-no]')) { confirmDelete = null; renderDocsList(); return; }
  const it = e.target.closest('.doc-item'); if (it) { openDoc(it.dataset.id); if (window.innerWidth <= 1180) toggleOutline(false); }
});

function setSideTab(t) {
  S.sideTab = t; saveSettings();
  $$('.side-tabs button').forEach((b) => { const on = b.dataset.side === t; b.setAttribute('aria-selected', on); b.tabIndex = on ? 0 : -1; b.setAttribute('aria-controls', b.dataset.side === 'outline' ? 'outlinePanel' : 'docsPanel'); });
  $('#outlinePanel').hidden = t !== 'outline'; $('#docsPanel').hidden = t !== 'docs';
  if (t === 'docs') renderDocsList();
}
$$('.side-tabs button').forEach((b) => b.onclick = () => setSideTab(b.dataset.side));
$('.side-tabs').addEventListener('keydown', (e) => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
  e.preventDefault();
  const t = e.key === 'Home' ? 'outline' : e.key === 'End' ? 'docs' : (S.sideTab === 'outline' ? 'docs' : 'outline');
  setSideTab(t); $(`.side-tabs [data-side="${t}"]`).focus();
});

/* files */
function readTextFile(file) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsText(file); }); }
async function openFiles(files) {
  let last, opened = 0;
  for (const f of files) {
    if (!/\.(md|markdown|mdown|mkdn?|txt)$/i.test(f.name) && !/^text\//.test(f.type)) { toast(`${f.name} is not a Markdown or text file`); continue; }
    const text = await readTextFile(f);
    last = makeDoc(text, f.name.replace(/\.(md|markdown|mdown|mkdn?|txt)$/i, ''), false);
    docs.unshift(last); markDirty(last.id); opened++;
    if (!S.openTabs.includes(last.id)) S.openTabs.push(last.id); // each file gets its own tab
  }
  if (last) { persist(); openDoc(last.id); toast(opened > 1 ? `Opened ${opened} files` : `Opened ${last.title}`); }
}
$('#fileInput').addEventListener('change', (e) => { openFiles([...e.target.files]); e.target.value = ''; });
$('#imageInput').addEventListener('change', (e) => { insertImages(e.target.files); e.target.value = ''; });

/* paste & drop */
cm.on('paste', (_, e) => {
  const files = [...(e.clipboardData?.files || [])].filter((f) => /^image\//.test(f.type));
  if (files.length) { e.preventDefault(); insertImages(files); return; }
  const text = e.clipboardData?.getData('text/plain') || '';
  const sel = cm.getSelection();
  if (sel && !sel.includes('\n') && /^https?:\/\/\S+$/.test(text.trim()) && !/^https?:\/\//.test(sel)) {
    e.preventDefault(); cm.replaceSelection(`[${sel}](${text.trim()})`);
  }
});
cm.on('drop', (_, e) => {
  const files = [...(e.dataTransfer?.files || [])];
  if (!files.length) return;
  e.preventDefault();
  const imgs = files.filter((f) => /^image\//.test(f.type));
  const texts = files.filter((f) => !/^image\//.test(f.type));
  if (imgs.length) insertImages(imgs, cm.coordsChar({ left: e.clientX, top: e.clientY }));
  if (texts.length) openFiles(texts);
  hideDrop();
});
let dropEl = null;
const hideDrop = () => { dropEl && dropEl.remove(); dropEl = null; };
document.addEventListener('dragover', (e) => {
  if (![...(e.dataTransfer?.types || [])].includes('Files')) return;
  e.preventDefault();
  if (!dropEl) { dropEl = document.createElement('div'); dropEl.className = 'drop-hint'; dropEl.textContent = 'Drop Markdown files to open them, or pictures to add them'; $('#workspace').appendChild(dropEl); }
});
document.addEventListener('dragleave', (e) => { if (!e.relatedTarget) hideDrop(); });
document.addEventListener('drop', (e) => {
  hideDrop();
  if (e.defaultPrevented) return;
  const files = [...(e.dataTransfer?.files || [])]; if (!files.length) return;
  e.preventDefault();
  const imgs = files.filter((f) => /^image\//.test(f.type));
  const texts = files.filter((f) => !/^image\//.test(f.type));
  if (texts.length) openFiles(texts); else if (imgs.length) insertImages(imgs);
});

/* ================================================================
   Export
   ================================================================ */
const slugFile = (t) => (t || 'document').replace(/[\\/:*?"<>|]+/g, '').trim().slice(0, 80) || 'document';
async function saveFile(name, data, mime) {
  if (TAURI) {
    const ext = name.split('.').pop();
    try {
      const path = await TAURI.dialog.save({ defaultPath: name, filters: [{ name: ext === 'md' ? 'Markdown' : ext.toUpperCase(), extensions: [ext] }] });
      if (!path) return null;
      await TAURI.core.invoke('write_text_file', { path, contents: data });
      toast(`Saved ${baseName(path)}`);
      return path;
    } catch (e) { toast(`Could not save: ${e}`); return null; }
  }
  if (window.claude && typeof window.claude.use === 'function') {
    let dl = null;
    try { dl = await window.claude.use('downloads'); } catch {}
    if (dl) {
      try { await dl.save({ filename: name, data }); toast(`Saved ${name}`); }
      catch (e) { if (!e || e.code !== 'declined') toast('That file could not be saved here. Use Copy Markdown instead.'); }
      return;
    }
    toast('Downloads are not available in this view. Use Copy Markdown instead.');
    return;
  }
  const url = URL.createObjectURL(new Blob([data], { type: mime }));
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  toast(`Saved ${name}`);
}
function cleanPreview() {
  const c = preview.cloneNode(true);
  c.querySelectorAll('.copy-code').forEach((n) => n.remove());
  c.querySelectorAll('[data-line]').forEach((n) => n.removeAttribute('data-line'));
  c.querySelectorAll('.task-check').forEach((n) => { n.setAttribute('disabled', ''); n.removeAttribute('data-task-line'); });
  return c;
}
function exportHtml() {
  const cs = getComputedStyle(document.documentElement);
  const names = ['--paper', '--paper-ink', '--paper-muted', '--paper-line', '--paper-code', '--paper-accent', '--paper-mark', '--page-shadow', '--hl-kw', '--hl-str', '--hl-num', '--hl-com', '--hl-fn', '--hl-type', '--sol-bg', '--sol-ink', '--sol-head', '--sol-link', '--sol-code', '--sol-line', '--c-note', '--c-tip', '--c-important', '--c-warning', '--c-caution', '--font-ui', '--font-mono', '--font-serif', '--font-times', '--canvas'];
  const tokens = names.map((n) => `${n}: ${cs.getPropertyValue(n).trim()};`).join(' ');
  const title = cur().title;
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Cowdrey.MD by Bradley Cowdrey · bradcowdrey.com">
<title>${esc(title)}</title>
<style>${$('#font-css').textContent}</style>
<style>
:root { ${tokens} }
body { margin: 0; background: var(--canvas); padding: 40px 16px; }
.page { max-width: ${pageW}px; margin: 0 auto; box-sizing: border-box; }
@media (max-width: 700px) { body { padding: 0; } .page { --pad: 22px !important; box-shadow: none !important; } }
@media print { body { background: #fff; padding: 0; } .page { box-shadow: none !important; max-width: none; } }
${$('#page-css').textContent}
</style>
</head>
<body>
<article class="page style-${S.pageStyle}" style="--pad: ${pad}px">
<div class="preview">
${cleanPreview().innerHTML}
</div>
</article>
</body>
</html>
`;
  saveFile(slugFile(title) + '.html', html, 'text/html');
}
async function copyText(text, okMsg) {
  try { await navigator.clipboard.writeText(text); toast(okMsg); }
  catch {
    const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch {}
    ta.remove(); toast(ok ? okMsg : 'Copy was blocked here. Select the text and copy it yourself.');
  }
}
async function copyRich() {
  const c = cleanPreview();
  const html = c.innerHTML, text = c.innerText || c.textContent;
  try {
    if (!window.ClipboardItem) throw 0;
    await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) })]);
    toast('Copied with formatting. Paste into Docs or Word.');
  } catch {
    const r = document.createRange(); r.selectNodeContents(preview);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    let ok = false; try { ok = document.execCommand('copy'); } catch {}
    s.removeAllRanges();
    toast(ok ? 'Copied with formatting. Paste into Docs or Word.' : `Copy was blocked here. Select the page and press ${isMac ? '⌘C' : 'Ctrl+C'}.`);
  }
}

/* ================================================================
   Dialogs, popovers
   ================================================================ */
let dialogOpener = null;
function openDialog({ title, body, actions = [{ label: 'Close', primary: true }], onOpen }) {
  if (!dialog.open) dialogOpener = popAnchor || document.activeElement;
  dialog.setAttribute('aria-labelledby', 'dlgTitle');
  dialog.innerHTML = `<div class="dlg-head"><h2 id="dlgTitle">${esc(title)}</h2><button class="icon-btn" type="button" data-close aria-label="Close">${ic('x')}</button></div>
    <div class="dlg-body">${body}</div>
    <div class="dlg-actions">${actions.map((a, i) => `<button type="button" class="btn${a.primary ? ' primary' : ''}${a.danger ? ' danger' : ''}" data-a="${i}">${esc(a.label)}</button>`).join('')}</div>`;
  refreshIcons();
  dialog.onclick = (e) => {
    if (e.target === dialog || e.target.closest('[data-close]')) return closeDialog();
    const b = e.target.closest('[data-a]'); if (!b) return;
    const a = actions[+b.dataset.a];
    if (a.run && a.run(dialog) === false) return;
    closeDialog();
  };
  try { dialog.showModal(); } catch { dialog.setAttribute('open', ''); }
  onOpen && onOpen(dialog);
}
function closeDialog() { try { dialog.close(); } catch { dialog.removeAttribute('open'); } }
dialog.addEventListener('close', () => {
  const o = dialogOpener; dialogOpener = null;
  setTimeout(() => {
    if (dialog.open) return;
    const active = document.activeElement;
    if (active && active !== document.body && active.offsetParent) return; // something else already took focus
    if (o && o.isConnected && o.offsetParent && !o.closest('#popover')) o.focus({ preventScroll: true }); else cm.focus();
  }, 0);
});

let popAnchor = null;
function openPopover(anchor, html, onClick, opts = {}) {
  if (popAnchor === anchor && !popover.hidden) { closePopover(); return; }
  closePopover();
  popover.innerHTML = html; popover.hidden = false; refreshIcons();
  popAnchor = anchor; anchor.setAttribute('aria-expanded', 'true');
  const r = anchor.getBoundingClientRect();
  const pw = popover.offsetWidth, ph = popover.offsetHeight;
  let left = opts.alignRight ? r.right - pw : r.left;
  left = clamp(left, 8, window.innerWidth - pw - 8);
  let top = r.bottom + 4; if (top + ph > window.innerHeight - 8) top = Math.max(8, r.top - ph - 4);
  popover.style.left = left + 'px'; popover.style.top = top + 'px';
  popover.onclick = (e) => { const a = popAnchor; onClick(e); setTimeout(() => { const f = document.activeElement; if (popover.hidden && (!f || f === document.body || !f.offsetParent)) (a && a.offsetParent ? a : cm).focus({ preventScroll: true }); }, 0); };
  $$('button', popover).forEach((b) => { b.tabIndex = -1; if (b.classList.contains('mi') && !b.getAttribute('role')) b.setAttribute('role', 'menuitem'); });
  popover.setAttribute('aria-label', opts.label || anchor.getAttribute('aria-label') || anchor.textContent.trim());
  if (opts.describedBy) popover.setAttribute('aria-describedby', opts.describedBy); else popover.removeAttribute('aria-describedby');
  opts.onOpen && opts.onOpen(popover);
  const first = popover.querySelector('button'); first && !opts.noFocus && first.focus({ preventScroll: true });
}
function closePopover() {
  if (popover.hidden) return;
  if (popAnchor && popAnchor.closest('#menubar')) $('#menubar').scrollLeft = 0;
  popover.hidden = true; popover.onclick = null; popover.onmouseover = null;
  popAnchor && popAnchor.setAttribute('aria-expanded', 'false'); popAnchor = null;
}
document.addEventListener('pointerdown', (e) => { if (!popover.hidden && !popover.contains(e.target) && !(popAnchor && popAnchor.contains(e.target))) closePopover(); }, true);
popover.addEventListener('keydown', (e) => {
  const items = $$('button', popover); const i = items.indexOf(document.activeElement);
  if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length]?.focus(); }
  if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
  if (e.key === 'Home') { e.preventDefault(); items[0]?.focus(); }
  if (e.key === 'End') { e.preventDefault(); items[items.length - 1]?.focus(); }
  if (e.key === 'Tab') { e.preventDefault(); const a = popAnchor; closePopover(); a && a.focus(); }
  if (e.key === 'Escape') { e.preventDefault(); const a = popAnchor; closePopover(); a && a.focus(); }
  if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && popAnchor && popAnchor.dataset.menu != null) {
    e.preventDefault(); const btns = $$('#menubar > button'); const j = btns.indexOf(popAnchor);
    const nb = btns[(j + (e.key === 'ArrowRight' ? 1 : -1) + btns.length) % btns.length]; closePopover(); openMenu(nb);
  }
});

/* ================================================================
   Commands
   ================================================================ */
const C = {};
const cmd = (id, o) => { C[id] = Object.assign({ id }, o); };
const fmtKey = (k) => !k ? '' : k.split(/-(?=.)/).map((p) => isMac
  ? ({ Mod: '⌘', Alt: '⌥', Shift: '⇧', Ctrl: '⌃' }[p] || p.toUpperCase())
  : ({ Mod: 'Ctrl+', Alt: 'Alt+', Shift: 'Shift+' }[p] || p.toUpperCase())).join('');
const inArtifact = () => !!(window.claude && typeof window.claude.use === 'function');

cmd('newDoc', { label: 'New document', icon: 'file-plus', key: TAURI ? 'Mod-n' : 'Mod-Alt-n', global: true, run: () => newDoc() });
cmd('openFile', { label: 'Open…', icon: 'folder-open', key: 'Mod-o', global: true, run: () => TAURI ? openNative() : $('#fileInput').click() });
cmd('pasteDoc', { label: 'Paste as new document', icon: 'clipboard-paste', run: pasteAsNew });
cmd('openRecent', { label: 'Open recent…', icon: 'history', hidden: () => !TAURI, run: showRecent });
cmd('closeTab', { label: 'Close tab', icon: 'x', key: TAURI ? 'Mod-w' : undefined, global: true, run: () => closeTab(currentId) });
cmd('closeOtherTabs', { label: 'Close other tabs', icon: 'copy-x', run: () => closeTabs(S.openTabs.filter((x) => x !== currentId)) });
cmd('closeAllTabs', { label: 'Close all tabs', icon: 'circle-x', run: () => closeTabs([...S.openTabs]) });
cmd('reopenTab', { label: 'Reopen closed tab', icon: 'rotate-ccw', key: TAURI ? 'Mod-Shift-t' : 'Mod-Alt-Shift-t', global: true, run: reopenClosedTab });
cmd('nextTab', { label: 'Next tab', icon: 'chevron-right', key: TAURI ? 'Mod-Shift-]' : 'Mod-Alt-]', global: true, run: () => cycleTab(1) });
cmd('prevTab', { label: 'Previous tab', icon: 'chevron-left', key: TAURI ? 'Mod-Shift-[' : 'Mod-Alt-[', global: true, run: () => cycleTab(-1) });
cmd('saveAll', { label: 'Save all', icon: 'save-all', key: 'Mod-Alt-Shift-s', global: true, hidden: () => !TAURI, run: saveAll });
cmd('saveNow', { label: 'Save', icon: 'save', key: 'Mod-s', global: true, run: () => { markDirty(); if (TAURI) return saveToDisk(false); if (persist()) toast('Saved to this browser'); } });
cmd('saveAs', { label: 'Save as…', icon: 'save', key: 'Mod-Shift-s', global: true, hidden: () => !TAURI, run: () => saveToDisk(true) });
cmd('saveMd', { label: 'Download Markdown (.md)', icon: 'file-down', run: () => saveFile(slugFile(cur().title) + '.md', cm.getValue(), 'text/markdown') });
cmd('exportHtml', { label: 'Download web page (.html)', icon: 'file-code-2', run: exportHtml });
cmd('copyRich', { label: 'Copy for Docs or Word', icon: 'clipboard-copy', key: 'Mod-Alt-Shift-c', global: true, run: copyRich });
cmd('copyHtml', { label: 'Copy HTML source', icon: 'code', run: () => copyText(cleanPreview().innerHTML, 'HTML copied') });
cmd('copyMd', { label: 'Copy Markdown', icon: 'copy', run: () => copyText(cm.getValue(), 'Markdown copied') });
cmd('print', { label: 'Print or save as PDF', icon: 'printer', key: 'Mod-p', global: true, hidden: () => inArtifact() || !!TAURI, run: () => { if (!inArtifact()) window.print(); } });
cmd('renameDoc', { label: 'Rename', icon: 'pencil-line', run: () => { titleInput.focus(); titleInput.select(); } });
cmd('deleteDoc', { label: 'Delete document…', icon: 'trash-2', run: () => openDialog({ title: `Delete “${cur().title}”?`, body: '<p>This removes the document from this browser. It cannot be undone.</p>', actions: [{ label: 'Keep it' }, { label: 'Delete', danger: true, run: () => deleteDoc(currentId) }] }) });

cmd('undo', { label: 'Undo', icon: 'undo-2', hint: 'Mod-z', run: () => { cm.undo(); cm.focus(); } });
cmd('redo', { label: 'Redo', icon: 'redo-2', hint: 'Mod-Shift-z', run: () => { cm.redo(); cm.focus(); } });
cmd('find', { label: 'Find', icon: 'search', key: 'Mod-f', global: true, run: () => openFind(false) });
cmd('replace', { label: 'Replace', icon: 'replace', key: isMac ? 'Mod-Alt-f' : 'Mod-h', global: true, run: () => openFind(true) });
cmd('selectAll', { label: 'Select all', icon: 'text-select', hint: 'Mod-a', run: () => { cm.execCommand('selectAll'); cm.focus(); } });
cmd('formatTable', { label: 'Tidy table', icon: 'table-properties', key: 'Mod-Alt-t', run: formatTable });

cmd('bold', { label: 'Bold', icon: 'bold', key: 'Mod-b', run: () => wrapInline('**') });
cmd('italic', { label: 'Italic', icon: 'italic', key: 'Mod-i', run: () => wrapInline('*') });
cmd('underline', { label: 'Underline', icon: 'underline', key: 'Mod-u', run: () => wrapInline('<u>', '</u>') });
cmd('strike', { label: 'Strikethrough', icon: 'strikethrough', key: 'Mod-Shift-x', run: () => wrapInline('~~') });
cmd('highlight', { label: 'Highlight', icon: 'highlighter', run: () => wrapInline('==') });
cmd('code', { label: 'Inline code', icon: 'code', key: 'Mod-e', run: () => wrapInline('`', '`', 'code') });
cmd('sup', { label: 'Superscript', icon: 'superscript', key: 'Mod-.', run: () => wrapInline('^') });
cmd('sub', { label: 'Subscript', icon: 'subscript', key: 'Mod-,', run: () => wrapInline('~') });
cmd('clearFormat', { label: 'Clear formatting', icon: 'remove-formatting', key: 'Mod-\\', run: clearFormatting });
for (let n = 1; n <= 6; n++) cmd('h' + n, { label: 'Heading ' + n, icon: n <= 3 ? 'heading-' + n : 'heading', key: 'Mod-Alt-' + n, run: () => setHeading(n) });
cmd('normal', { label: 'Normal text', icon: 'pilcrow', key: 'Mod-Alt-0', run: () => setHeading(0) });
cmd('ul', { label: 'Bulleted list', icon: 'list', key: 'Mod-Shift-8', run: () => toggleBlock('ul') });
cmd('ol', { label: 'Numbered list', icon: 'list-ordered', key: 'Mod-Shift-7', run: () => toggleBlock('ol') });
cmd('task', { label: 'Checklist', icon: 'list-checks', key: 'Mod-Shift-9', run: () => toggleBlock('task') });
cmd('quote', { label: 'Quote', icon: 'quote', key: "Mod-'", run: () => toggleBlock('quote') });
cmd('indent', { label: 'Increase indent', icon: 'indent-increase', key: 'Mod-]', run: () => { cm.execCommand('indentMore'); cm.focus(); } });
cmd('outdent', { label: 'Decrease indent', icon: 'indent-decrease', key: 'Mod-[', run: () => { cm.execCommand('indentLess'); cm.focus(); } });

cmd('link', { label: 'Link', icon: 'link', key: 'Mod-k', run: insertLink });
cmd('image', { label: 'Picture…', icon: 'image', run: () => $('#imageInput').click() });
cmd('imageUrl', { label: 'Picture from web address', icon: 'image-plus', run: () => openDialog({
  title: 'Insert picture from the web',
  body: '<div class="field"><label for="imgUrl">Picture address</label><input id="imgUrl" type="url" placeholder="https://example.com/photo.jpg"></div><div class="field"><label for="imgAlt">Description (for screen readers)</label><input id="imgAlt" type="text" placeholder="A short description"></div>',
  actions: [{ label: 'Cancel' }, { label: 'Insert', primary: true, run: (d) => { const u = $('#imgUrl', d).value.trim(); if (!u) { $('#imgUrl', d).focus(); return false; } setTimeout(() => insertInline(`![${$('#imgAlt', d).value.trim()}](${u})`), 0); } }],
  onOpen: (d) => setTimeout(() => $('#imgUrl', d).focus(), 30),
}) });
cmd('footnote', { label: 'Footnote', icon: 'footprints', key: isMac ? 'Mod-Alt-g' : 'Mod-Alt-f', run: insertFootnote });
cmd('table', { label: 'Table', icon: 'table', run: (anchor) => openTablePicker(anchor) });
cmd('codeBlock', { label: 'Code block', icon: 'square-code', key: 'Mod-Alt-c', run: () => {
  const s = cm.getSelection();
  if (!s) return insertBlock('```\n\n```', 3);
  const from = cm.getCursor('from'), to = cm.getCursor('to');
  const pre = from.ch > 0 ? '\n' : '', post = to.ch < cm.getLine(to.line).length ? '\n' : '';
  cm.replaceSelection(pre + '```\n' + s + '\n```' + post);
  cm.setCursor({ line: from.line + (pre ? 1 : 0), ch: 3 }); cm.focus();
} });
cmd('math', { label: 'Equation', icon: 'sigma', run: () => insertBlock('$$\nE = mc^2\n$$', 3, 11) });
cmd('diagram', { label: 'Diagram', icon: 'workflow', run: () => insertBlock('```mermaid\nflowchart LR\n  A[Draft] --> B{Review}\n  B -- Approved --> C[Publish]\n  B -- Changes --> A\n```', 11) });
cmd('callout', { label: 'Callout', icon: 'message-square-warning', run: (anchor) => openCalloutPicker(anchor) });
cmd('details', { label: 'Collapsible section', icon: 'chevrons-up-down', run: () => insertBlock('<details>\n<summary>Summary</summary>\n\nHidden content goes here.\n\n</details>', 19, 26) });
cmd('deflist', { label: 'Definition', icon: 'book-open-text', run: () => insertBlock('Term\n: Definition of the term.', 0, 4) });
cmd('hr', { label: 'Divider', icon: 'minus', run: () => insertBlock('---') });
cmd('toc', { label: 'Table of contents', icon: 'list-tree', run: () => insertBlock('[TOC]') });
cmd('date', { label: 'Today’s date', icon: 'calendar', run: () => insertInline(new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })) });
cmd('frontMatter', { label: 'Front matter', icon: 'file-text', run: insertFrontMatter });

const viewCmd = (v, label, icon) => cmd('view_' + v, { label, icon, checked: () => S.view === v, run: () => setView(v) });
viewCmd('editor', 'Editor only', 'pencil-line'); viewCmd('split', 'Editor and preview', 'columns-2'); viewCmd('preview', 'Preview only', 'eye');
cmd('cycleView', { label: 'Switch view', icon: 'columns-2', key: 'Mod-Shift-\\', global: true, run: () => setView({ split: 'preview', preview: 'editor', editor: 'split' }[S.view]) });
cmd('toggleRail', { label: 'Compact sidebar', icon: 'panel-left-close', key: 'Mod-Alt-s', global: true, checked: () => app.dataset.rail === 'on', run: () => { if (isNarrow()) return toggleOutline(); if (!S.outline) toggleOutline(true); setSideRail(!S.sideRail); } });
cmd('toggleOutline', { label: 'Sidebar', icon: 'panel-left', key: 'Mod-Alt-o', global: true, checked: () => app.dataset.outline === 'on' && app.dataset.rail !== 'on', run: () => toggleOutline() });
cmd('toggleSync', { label: 'Sync scrolling', icon: 'arrow-down-up', checked: () => S.sync, run: () => { S.sync = !S.sync; saveSettings(); refreshState(); if (S.sync) syncFromEditor(); } });
cmd('toggleFocus', { label: 'Focus mode', icon: 'focus', key: 'Mod-Shift-f', global: true, checked: () => S.focus, run: () => { S.focus = !S.focus; applyEditorPrefs(); toast(S.focus ? 'Focus mode on: other paragraphs are dimmed' : 'Focus mode off'); } });
cmd('toggleTypewriter', { label: 'Typewriter mode', icon: 'keyboard', checked: () => S.typewriter, run: () => { S.typewriter = !S.typewriter; applyEditorPrefs(); toast(S.typewriter ? 'Typewriter mode on: your line stays centered' : 'Typewriter mode off'); } });
cmd('toggleLineNumbers', { label: 'Line numbers', icon: 'list-ordered', checked: () => S.lineNumbers, run: () => { S.lineNumbers = !S.lineNumbers; applyEditorPrefs(); } });
cmd('toggleWrap', { label: 'Word wrap', icon: 'wrap-text', checked: () => S.wrap, run: () => { S.wrap = !S.wrap; applyEditorPrefs(); } });
cmd('toggleRuler', { label: 'Ruler', icon: 'ruler', checked: () => S.ruler, run: () => { S.ruler = !S.ruler; applyPagePrefs(); } });
cmd('toggleGuides', { label: 'Page breaks', icon: 'scissors-line-dashed', checked: () => S.guides, run: () => { S.guides = !S.guides; applyPagePrefs(); } });
cmd('zoomIn', { label: 'Zoom in', icon: 'zoom-in', key: 'Mod-Alt-=', global: true, run: () => setZoom(Math.round(scale * 100) + 10) });
cmd('zoomOut', { label: 'Zoom out', icon: 'zoom-out', key: 'Mod-Alt--', global: true, run: () => setZoom(Math.round(scale * 100) - 10) });
cmd('zoomFit', { label: 'Fit page width', icon: 'move-horizontal', checked: () => S.zoom === 'fit', run: () => setZoom('fit') });
cmd('zoom100', { label: 'Actual size (100%)', icon: 'scan', run: () => setZoom(100) });
cmd('fullscreen', { label: 'Full screen', icon: 'maximize-2', run: () => {
  const el = document.documentElement;
  if (document.fullscreenElement) document.exitFullscreen?.();
  else (el.requestFullscreen ? el.requestFullscreen() : Promise.reject()).catch(() => toast('Full screen is not available here.'));
} });
cmd('typographer', { label: 'Smart quotes & dashes', icon: 'quote', checked: () => S.typographer, run: () => { S.typographer = !S.typographer; rebuild(); } });
cmd('breaks', { label: 'Keep line breaks', icon: 'corner-down-left', checked: () => S.breaks, run: () => { S.breaks = !S.breaks; rebuild(); } });
cmd('toggleMath', { label: 'Math (LaTeX)', icon: 'sigma', checked: () => S.math, run: () => { S.math = !S.math; rebuild(); } });
cmd('toggleDiagrams', { label: 'Diagrams (Mermaid)', icon: 'workflow', checked: () => S.diagrams, run: () => { S.diagrams = !S.diagrams; rebuild(); } });

cmd('shortcuts', { label: 'Keyboard shortcuts', icon: 'keyboard', key: 'Mod-/', global: true, run: showShortcuts });
cmd('guide', { label: 'Markdown guide', icon: 'book-open-text', run: () => newDoc(WELCOME, 'Markdown guide') });
cmd('legal', { label: 'Terms & Privacy', icon: 'scale', run: openLegal });
cmd('about', { label: 'About Cowdrey.MD', icon: 'info', run: showAbout });
cmd('checkUpdates', { label: 'Check for updates…', icon: 'refresh-cw', hidden: () => !TAURI, run: () => checkForUpdates(true) });
cmd('wordCount', { label: 'Word count', icon: 'file-digit', key: 'Mod-Alt-w', global: true, run: showStats });

function rebuild() { saveSettings(); buildMd(); render(); refreshState(); }
// read-only hook for the automated tests: list and run commands like a menu click would
window.__cowdreyTest = Object.freeze({ commands: () => Object.keys(C), label: (id) => C[id] && C[id].label, hidden: (id) => !!(C[id] && C[id].hidden && C[id].hidden()), run: (id) => runCmd(id), settings: () => JSON.parse(JSON.stringify(S)) });
// With no document open, only commands that don't act on a document run.
const WORKS_WITHOUT_DOC = new Set(['newDoc', 'openFile', 'openRecent', 'pasteDoc', 'reopenTab', 'saveAll', 'guide', 'shortcuts', 'legal', 'about', 'checkUpdates', 'toggleOutline', 'toggleRail', 'fullscreen']);
function runCmd(id, anchor) { const c = C[id]; if (!c) return; closePopover(); if (isEmpty() && !WORKS_WITHOUT_DOC.has(id)) return; c.run(anchor); refreshState(); }

/* key handling */
const KEYMAP = {};
for (const c of Object.values(C)) if (c.key) KEYMAP[c.key.toLowerCase()] = c.id;
const codeKey = (e) => {
  // Use the character the layout produces (Dvorak, AZERTY…); fall back to the physical key when Option/Alt changed it.
  if (!e.altKey && /^[a-z0-9]$/i.test(e.key || '')) return e.key.toLowerCase();
  const c = e.code || '';
  if (c.startsWith('Key')) return c.slice(3).toLowerCase();
  if (c.startsWith('Digit')) return c.slice(5);
  return ({ Backslash: '\\', BracketLeft: '[', BracketRight: ']', Quote: "'", Period: '.', Comma: ',', Slash: '/', Equal: '=', Minus: '-', Semicolon: ';' })[c] || (e.key || '').toLowerCase();
};
document.addEventListener('keydown', (e) => {
  const mod = isMac ? e.metaKey : e.ctrlKey;
  if (!isMac && e.getModifierState && e.getModifierState('AltGraph')) return; // AltGr types characters, it is not a shortcut
  // Ctrl+Tab / Ctrl+Shift+Tab cycle tabs, and in the Mac app Cmd+1…9 pick one (browsers keep these for their own tabs).
  if (e.ctrlKey && !e.metaKey && !e.altKey && e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); cycleTab(e.shiftKey ? -1 : 1); return; }
  if (TAURI && mod && !e.altKey && !e.shiftKey && /^Digit[1-9]$/.test(e.code || '')) { e.preventDefault(); e.stopPropagation(); selectTab(+e.code.slice(5)); return; }
  if (!mod) { if (e.key === 'Escape' && !popover.hidden) { const a = popAnchor; closePopover(); a && a.focus(); } return; }
  const combo = ['mod', e.altKey && 'alt', e.shiftKey && 'shift', codeKey(e)].filter(Boolean).join('-');
  const id = KEYMAP[combo]; if (!id) return;
  const c = C[id];
  const t = e.target;
  const inEditor = !!(t.closest && t.closest('.CodeMirror'));
  const inField = !inEditor && t.matches && t.matches('input, textarea, select');
  if (!c.global && !inEditor) { if (inField) return; if (!document.activeElement || document.activeElement === document.body) { /* allow from body */ } else if (!t.closest('.ribbon, .app')) return; }
  if (c.hidden && c.hidden()) return;
  e.preventDefault(); e.stopPropagation();
  runCmd(id);
}, true);

/* ================================================================
   Menubar (Docs)
   ================================================================ */
const MENUS = [
  ['File', ['newDoc', 'openFile', 'openRecent', 'pasteDoc', '-', 'saveNow', 'saveAs', 'saveAll', 'renameDoc', '-', 'closeTab', 'closeOtherTabs', 'closeAllTabs', 'reopenTab', '-', 'saveMd', 'exportHtml', 'copyRich', 'copyMd', 'copyHtml', 'print', '-', 'deleteDoc']],
  ['Edit', ['undo', 'redo', '-', 'selectAll', 'find', 'replace', '-', 'formatTable', 'clearFormat']],
  ['View', ['view_editor', 'view_split', 'view_preview', '-', 'toggleOutline', 'toggleRail', 'toggleRuler', 'toggleGuides', 'toggleLineNumbers', 'toggleWrap', '-', 'toggleFocus', 'toggleTypewriter', 'toggleSync', '-', 'zoomIn', 'zoomOut', 'zoomFit', 'zoom100', 'fullscreen', '-', 'nextTab', 'prevTab']],
  ['Insert', ['image', 'imageUrl', 'table', 'link', '-', 'codeBlock', 'math', 'diagram', 'callout', 'details', '-', 'footnote', 'deflist', 'hr', 'toc', 'date', 'frontMatter']],
  ['Format', ['bold', 'italic', 'underline', 'strike', 'highlight', 'code', 'sup', 'sub', '-', 'normal', 'h1', 'h2', 'h3', 'h4', '-', 'ul', 'ol', 'task', 'quote', 'indent', 'outdent', '-', 'clearFormat']],
  ['Tools', ['wordCount', 'formatTable', '-', 'typographer', 'breaks', 'toggleMath', 'toggleDiagrams']],
  ['Help', ['shortcuts', 'guide', 'legal', '-', 'checkUpdates', 'about']],
];
function menuHtml(ids) {
  return ids.filter((id) => id === '-' || !(C[id].hidden && C[id].hidden())).map((id) => {
    if (id === '-') return '<div class="msep"></div>';
    const c = C[id];
    const checked = c.checked ? c.checked() : null;
    return `<button type="button" class="mi" role="${checked === null ? 'menuitem' : 'menuitemcheckbox'}"${checked === null ? '' : ` aria-checked="${checked}"`} data-cmd="${id}">${checked === null ? ic(c.icon) : checked ? `<span class="chk">${ic('check')}</span>` : '<span></span>'}<span>${esc(c.label)}</span><span class="k">${fmtKey(c.key || c.hint)}</span></button>`;
  }).join('').replace(/^(<div class="msep"><\/div>)+|(<div class="msep"><\/div>)+$/g, '').replace(/(<div class="msep"><\/div>){2,}/g, '<div class="msep"></div>');
}
function openMenu(btn) {
  const ids = MENUS[+btn.dataset.menu][1];
  openPopover(btn, menuHtml(ids), (e) => { const b = e.target.closest('[data-cmd]'); if (b) runCmd(b.dataset.cmd, btn); });
  popover.onmouseover = null;
}
$('#menubar').innerHTML = MENUS.map(([name], i) => `<button type="button" data-menu="${i}" aria-haspopup="menu" aria-expanded="false">${name}</button>`).join('');
$('#menubar').addEventListener('click', (e) => { const b = e.target.closest('[data-menu]'); if (b) openMenu(b); });
$('#menubar').addEventListener('mouseover', (e) => {
  const b = e.target.closest('[data-menu]');
  if (b && !popover.hidden && popAnchor && popAnchor.dataset.menu != null && popAnchor !== b) { closePopover(); openMenu(b); }
});
/* Share the app itself */
const APP_URL = 'https://bradcowdrey.com/cowdrey-md';
const MAC_URL = 'https://github.com/bradleycowdrey/cowdrey-md/releases/latest';
const SHARE_TEXT = 'Cowdrey.MD is a free Markdown editor by Bradley Cowdrey. Free. Forever.';
$('#shareAppBtn').addEventListener('click', (e) => {
  const canShare = typeof navigator.share === 'function' && !inArtifact();
  openPopover(e.currentTarget, `<div class="mhead">Share Cowdrey.MD</div><p class="share-blurb" id="shareBlurb">${esc(SHARE_TEXT)} Pass it on to anyone who writes in Markdown.</p>
    ${canShare ? `<button type="button" class="mi" data-share="native">${ic('share')}<span>Share…</span><span></span></button>` : ''}
    <button type="button" class="mi" data-share="web">${ic('link')}<span>Copy link to the web app</span><span></span></button>
    <button type="button" class="mi" data-share="mac">${ic('laptop')}<span>Copy Mac download link</span><span></span></button>
    <button type="button" class="mi" data-share="message">${ic('message-square-text')}<span>Copy a message to send</span><span></span></button>`, (ev) => {
    const b = ev.target.closest('[data-share]'); if (!b) return;
    closePopover();
    const kind = b.dataset.share;
    if (kind === 'native') navigator.share({ title: 'Cowdrey.MD', text: SHARE_TEXT, url: APP_URL }).catch(() => {});
    if (kind === 'web') copyText(APP_URL, 'Link to Cowdrey.MD copied');
    if (kind === 'mac') copyText(MAC_URL, 'Mac download link copied');
    if (kind === 'message') copyText(`${SHARE_TEXT}\n\nUse it in your browser: ${APP_URL}\nGet it for Mac: ${MAC_URL}`, 'Message copied, ready to paste');
  }, { alignRight: true, label: 'Share Cowdrey.MD', describedBy: 'shareBlurb' });
});
$('#exportBtn').addEventListener('click', (e) => {
  const ids = ['copyRich', 'copyMd', 'copyHtml', '-', 'saveMd', 'exportHtml', 'print'];
  openPopover(e.currentTarget, '<div class="mhead">Copy or download</div>' + menuHtml(ids), (ev) => { const b = ev.target.closest('[data-cmd]'); if (b) runCmd(b.dataset.cmd); }, { alignRight: true });
});

/* table & callout pickers */
function openTablePicker(anchor) {
  anchor = anchor || $('[data-cmd="table"]') || $('#menubar');
  const cells = []; for (let r = 1; r <= 8; r++) for (let c = 1; c <= 10; c++) cells.push(`<button type="button" class="tp-cell" data-r="${r}" data-c="${c}" aria-label="${r} by ${c} table"></button>`);
  openPopover(anchor, `<div class="table-picker"><div class="mhead" style="padding-left:0">Insert table</div><div class="tp-grid">${cells.join('')}</div><div class="tp-label" id="tpLabel">Choose a size</div></div>`, (e) => {
    const b = e.target.closest('.tp-cell'); if (!b) return; closePopover(); makeTable(+b.dataset.r, +b.dataset.c);
  }, { noFocus: true });
  const hl = (b) => { if (!b) return; const r = +b.dataset.r, c = +b.dataset.c; $$('.tp-cell', popover).forEach((x) => x.classList.toggle('on', +x.dataset.r <= r && +x.dataset.c <= c)); $('#tpLabel').textContent = `${r} × ${c} table`; };
  popover.onmouseover = (e) => hl(e.target.closest('.tp-cell'));
  popover.addEventListener('focusin', (e) => hl(e.target.closest('.tp-cell')));
}
function openCalloutPicker(anchor) {
  anchor = anchor || $('#menubar');
  const icons = { note: 'info', tip: 'lightbulb', important: 'message-square-warning', warning: 'triangle-alert', caution: 'octagon-alert' };
  openPopover(anchor, '<div class="mhead">Callout type</div>' + Object.entries(CALLOUTS).map(([k, v]) => `<button type="button" class="mi" data-k="${k}">${ic(icons[k])}<span>${v}</span><span></span></button>`).join(''), (e) => {
    const b = e.target.closest('[data-k]'); if (!b) return; closePopover();
    const sel = cm.getSelection();
    const body = sel ? sel.split('\n').map((l) => '> ' + l).join('\n') : '> ';
    insertBlock(`> [!${b.dataset.k.toUpperCase()}]\n${body}`, sel ? undefined : 9 + b.dataset.k.length + 3);
  });
}

/* ================================================================
   Ribbon (Word)
   ================================================================ */
const rb = (id, kind = 'icon') => {
  const c = C[id];
  const tip = `${c.label}${c.key ? ` (${fmtKey(c.key)})` : ''}`;
  const pressed = c.checked ? ` aria-pressed="${!!c.checked()}"` : '';
  if (kind === 'big') return `<button type="button" class="rb big" data-cmd="${id}" title="${esc(tip)}"${pressed}>${ic(c.icon)}<span>${esc(c.short || c.label)}</span></button>`;
  if (kind === 'lbl') return `<button type="button" class="rb lbl" data-cmd="${id}" title="${esc(tip)}"${pressed}>${ic(c.icon)}<span>${esc(c.short || c.label)}</span></button>`;
  return `<button type="button" class="rb" data-cmd="${id}" title="${esc(tip)}" aria-label="${esc(c.label)}"${pressed}>${ic(c.icon)}</button>`;
};
const group = (label, inner) => `<div class="r-group"><div class="r-content">${inner}</div><div class="r-label">${label}</div></div>`;
const rows = (...rs) => `<div class="r-rows">${rs.map((r) => `<div class="r-row">${r}</div>`).join('')}</div>`;
const stack = (...xs) => `<div class="r-stack">${xs.join('')}</div>`;
C.image.short = 'Picture'; C.imageUrl.short = 'From web'; C.diagram.short = 'Diagram'; C.codeBlock.short = 'Code block';
C.math.short = 'Equation'; C.details.short = 'Collapsible'; C.toc.short = 'Contents'; C.date.short = 'Date';
C.frontMatter.short = 'Front matter'; C.view_editor.short = 'Editor'; C.view_split.short = 'Split'; C.view_preview.short = 'Preview';
C.toggleOutline.short = 'Sidebar'; C.toggleGuides.short = 'Page breaks'; C.toggleSync.short = 'Sync scroll';
C.typographer.short = 'Smart quotes'; C.breaks.short = 'Line breaks'; C.toggleMath.short = 'Math'; C.toggleDiagrams.short = 'Diagrams';
C.find.short = 'Find'; C.replace.short = 'Replace'; C.footnote.short = 'Footnote'; C.link.short = 'Link'; C.callout.short = 'Callout';
C.toggleFocus.short = 'Focus'; C.toggleTypewriter.short = 'Typewriter'; C.zoomFit.short = 'Page width'; C.zoom100.short = 'Actual size';
C.undo.short = 'Undo'; C.redo.short = 'Redo'; C.formatTable.short = 'Tidy table'; C.deflist.short = 'Definition'; C.wordCount.short = 'Word count';

const STYLE_CARDS = [
  ['normal', 'Normal', 'font-family:var(--font-serif);font-size:13px'],
  ['h1', 'Heading 1', 'font-weight:700;font-size:17px'],
  ['h2', 'Heading 2', 'font-weight:650;font-size:15px'],
  ['h3', 'Heading 3', 'font-weight:650;font-size:13.5px'],
  ['h4', 'Heading 4', 'font-weight:600;font-size:12.5px'],
  ['quote', 'Quote', 'font-family:var(--font-serif);font-style:italic;font-size:13px;color:var(--ink-2)'],
  ['codeBlock', 'Code', 'font-family:var(--font-mono);font-size:11.5px'],
];
const PAGE_STYLES = [
  ['cowdrey', 'Cowdrey', 'font-family:var(--font-serif)'],
  ['github', 'GitHub', 'font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-weight:600'],
  ['clearness', 'Clearness', 'font-family:Helvetica Neue,Helvetica,Arial,sans-serif;font-weight:300'],
  ['solarized', 'Solarized', 'font-family:var(--font-ui);color:#CB4B16'],
  ['manuscript', 'Manuscript', 'font-family:var(--font-times)'],
];
const RIBBON = {
  home: () =>
    group('Undo', stack(rb('undo', 'lbl'), rb('redo', 'lbl'))) +
    group('Font', rows(rb('bold') + rb('italic') + rb('underline') + rb('strike') + rb('highlight'), rb('code') + rb('sup') + rb('sub') + rb('clearFormat'))) +
    group('Paragraph', rows(rb('ul') + rb('ol') + rb('task') + rb('outdent') + rb('indent'), rb('quote') + rb('hr') + rb('link') + rb('formatTable'))) +
    group('Styles', `<div class="gallery" id="styleGallery">${STYLE_CARDS.map(([id, n, st]) => `<button type="button" class="g-card" data-style="${id}" title="${esc(C[id].label)}${C[id].key ? ' (' + fmtKey(C[id].key) + ')' : ''}"><span class="s" style="${st}">AaBbCc</span><span class="n">${n}</span></button>`).join('')}</div>`) +
    group('Editing', stack(rb('find', 'lbl'), rb('replace', 'lbl'))),
  insert: () =>
    group('Tables', `<button type="button" class="rb big" data-cmd="table" title="Insert a table">${ic('table')}<span>Table ▾</span></button>`) +
    group('Pictures', rb('image', 'big') + stack(rb('imageUrl', 'lbl'), rb('diagram', 'lbl'))) +
    group('Links', stack(rb('link', 'lbl'), rb('footnote', 'lbl'))) +
    group('Blocks', rows(rb('codeBlock', 'lbl') + rb('math', 'lbl'), rb('callout', 'lbl') + rb('details', 'lbl'))) +
    group('Text', rows(rb('toc', 'lbl') + rb('date', 'lbl'), rb('deflist', 'lbl') + rb('hr', 'lbl'))) +
    group('Document', stack(rb('frontMatter', 'lbl'), rb('wordCount', 'lbl'))),
  layout: () =>
    group('Page style', `<div class="gallery">${PAGE_STYLES.map(([id, n, st]) => `<button type="button" class="g-card page-style" data-pagestyle="${id}" aria-pressed="${S.pageStyle === id}"><span class="s" style="${st}">Aa</span><span class="n">${n}</span></button>`).join('')}</div>`) +
    group('Page setup', rows(
      `<span class="seg-label">Size</span><div class="seg" data-seg="pageSize">${Object.entries(PAGES).map(([k, v]) => `<button type="button" data-v="${k}" aria-pressed="${S.pageSize === k}">${v.label}</button>`).join('')}</div>`,
      `<span class="seg-label">Margins</span><div class="seg" data-seg="margins">${['narrow', 'normal', 'wide'].map((k) => `<button type="button" data-v="${k}" aria-pressed="${S.margins === k}">${k[0].toUpperCase() + k.slice(1)}</button>`).join('')}</div>`)) +
    group('Markdown', rows(rb('typographer', 'lbl') + rb('breaks', 'lbl'), rb('toggleMath', 'lbl') + rb('toggleDiagrams', 'lbl'))),
  view: () =>
    group('Views', rb('view_editor', 'big') + rb('view_split', 'big') + rb('view_preview', 'big')) +
    group('Show', rows(rb('toggleOutline', 'lbl') + rb('toggleRuler', 'lbl') + rb('toggleGuides', 'lbl'), rb('toggleLineNumbers', 'lbl') + rb('toggleWrap', 'lbl'))) +
    group('Writing', rows(rb('toggleFocus', 'lbl') + rb('toggleTypewriter', 'lbl'), rb('toggleSync', 'lbl') + rb('fullscreen', 'lbl'))) +
    group('Editor', rows(
      `<label class="seg-label" for="edTheme">Theme</label><select class="sel" id="edTheme">${[['auto', 'Match app'], ['night', 'MacDown Night'], ['day', 'Day'], ['sol-dark', 'Solarized Dark'], ['sol-light', 'Solarized Light']].map(([v, l]) => `<option value="${v}"${S.edTheme === v ? ' selected' : ''}>${l}</option>`).join('')}</select>`,
      `<span class="seg-label">Text size</span><button type="button" class="rb" data-edsize="-1" title="Smaller editor text" aria-label="Smaller editor text">${ic('a-arrow-down')}</button><span class="sb-item" id="edSizeLbl" style="min-width:34px;text-align:center">${S.edSize}px</span><button type="button" class="rb" data-edsize="1" title="Larger editor text" aria-label="Larger editor text">${ic('a-arrow-up')}</button>`)) +
    group('Zoom', stack(rb('zoomFit', 'lbl'), rb('zoom100', 'lbl')) + stack(rb('zoomIn'), rb('zoomOut'))),
};
const TABS = [['home', 'Home'], ['insert', 'Insert'], ['layout', 'Layout'], ['view', 'View']];
function renderRibbonTabs() {
  $('#ribbonTabs').innerHTML = TABS.map(([k, l]) => { const on = S.ribbonTab === k; return `<button type="button" role="tab" id="rtab-${k}" data-tab="${k}" aria-controls="ribbonBody" aria-selected="${on && !S.ribbonCollapsed}" tabindex="${on ? 0 : -1}">${l}</button>`; }).join('') +
    `<span class="spacer"></span><button type="button" class="collapse" id="ribbonToggle" title="${S.ribbonCollapsed ? 'Show the ribbon' : 'Collapse the ribbon'}" aria-label="${S.ribbonCollapsed ? 'Show the ribbon' : 'Collapse the ribbon'}">${ic(S.ribbonCollapsed ? 'chevron-down' : 'chevron-up')}</button>`;
}
function focusKey(el) {
  if (!el || !el.closest || !el.closest('#ribbon')) return null;
  for (const a of ['data-tab', 'data-pagestyle', 'data-style', 'data-cmd', 'data-edsize']) if (el.hasAttribute(a)) return `[${a}="${el.getAttribute(a)}"]`;
  if (el.closest('.seg')) return `.seg[data-seg="${el.parentElement.dataset.seg}"] [data-v="${el.dataset.v}"]`;
  if (el.id) return '#' + el.id;
  return null;
}
function renderRibbon() {
  const keep = focusKey(document.activeElement);
  renderRibbonTabs();
  $('#ribbon').classList.toggle('collapsed', S.ribbonCollapsed);
  $('#ribbonBody').innerHTML = `<div class="ribbon-panel" role="tabpanel" aria-labelledby="rtab-${S.ribbonTab}">${RIBBON[S.ribbonTab]()}</div>`;
  refreshIcons(); updateStyleGallery(); updateRibbonOverflow(); placeFindbar();
  if (keep) { const el = $('#ribbon').querySelector(keep); el && el.focus({ preventScroll: true }); }
}
function updateRibbonOverflow() {
  const b = $('#ribbonBody'); b.classList.toggle('overflow', b.scrollWidth > b.clientWidth + 2 && b.scrollLeft + b.clientWidth < b.scrollWidth - 2);
}
$('#ribbonBody').addEventListener('scroll', updateRibbonOverflow, { passive: true });
window.addEventListener('resize', debounce(updateRibbonOverflow, 100));
$('#ribbonTabs').addEventListener('keydown', (e) => {
  const t = e.target.closest('[data-tab]'); if (!t) return;
  const keys = TABS.map(([k]) => k), i = keys.indexOf(t.dataset.tab);
  const j = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: keys.length - 1 }[e.key];
  if (j === undefined) return;
  e.preventDefault();
  S.ribbonTab = keys[(j + keys.length) % keys.length]; S.ribbonCollapsed = false; saveSettings(); renderRibbon();
  $(`[data-tab="${S.ribbonTab}"]`).focus();
});
$('#ribbonTabs').addEventListener('click', (e) => {
  if (e.target.closest('#ribbonToggle')) { S.ribbonCollapsed = !S.ribbonCollapsed; saveSettings(); renderRibbon(); return; }
  const t = e.target.closest('[data-tab]'); if (!t) return;
  if (S.ribbonTab === t.dataset.tab && !S.ribbonCollapsed) return;
  S.ribbonTab = t.dataset.tab; S.ribbonCollapsed = false; saveSettings(); renderRibbon();
});
$('#ribbonTabs').addEventListener('dblclick', (e) => { if (e.target.closest('[data-tab]')) { S.ribbonCollapsed = !S.ribbonCollapsed; saveSettings(); renderRibbon(); } });
$('#ribbonBody').addEventListener('click', (e) => {
  const c = e.target.closest('[data-cmd]'); if (c) { runCmd(c.dataset.cmd, c); return; }
  const s = e.target.closest('[data-style]'); if (s) { runCmd(s.dataset.style); return; }
  const p = e.target.closest('[data-pagestyle]'); if (p) { S.pageStyle = p.dataset.pagestyle; applyPagePrefs(); renderRibbon(); return; }
  const sg = e.target.closest('.seg button'); if (sg) { S[sg.parentElement.dataset.seg] = sg.dataset.v; applyPagePrefs(); renderRibbon(); return; }
  const es = e.target.closest('[data-edsize]'); if (es) { S.edSize = clamp(S.edSize + +es.dataset.edsize, 11, 24); applyEditorPrefs(); $('#edSizeLbl').textContent = S.edSize + 'px'; }
});
$('#ribbonBody').addEventListener('change', (e) => { if (e.target.id === 'edTheme') { S.edTheme = e.target.value; applyEditorPrefs(); } });
$('#ribbonBody').addEventListener('mousedown', (e) => { if (e.target.closest('.rb, .g-card') && !e.target.closest('select')) e.preventDefault(); });

function currentStyle() {
  const l = cm.getLine(cm.getCursor().line) || '';
  const h = /^(#{1,6})\s/.exec(l); if (h) return 'h' + h[1].length;
  if (/^\s*>/.test(l)) return 'quote';
  const tok = cm.getTokenAt(cm.getCursor(), true);
  if (tok && tok.state && (tok.state.base?.fencedEndRE || tok.state.base?.localMode || tok.state.fencedEndRE)) return 'codeBlock';
  return 'normal';
}
function updateStyleGallery() {
  const g = $('#styleGallery'); if (!g) return;
  const s = currentStyle();
  $$('.g-card', g).forEach((b) => b.setAttribute('aria-pressed', b.dataset.style === s));
}
function refreshState() {
  $$('[data-cmd]').forEach((b) => { const c = C[b.dataset.cmd]; if (c && c.checked && b.classList.contains('rb')) b.setAttribute('aria-pressed', !!c.checked()); });
  $$('#sbViews button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.view === S.view));
  updateNativeMenu();
}

/* Mac menu bar: built from the same MENUS and commands as the in-app menus, so the two always match. */
const ACCEL_KEYS = { '\\': 'Backslash', "'": 'Quote', '.': 'Period', ',': 'Comma', '/': 'Slash', '[': 'BracketLeft', ']': 'BracketRight', '=': 'Equal', '-': 'Minus' };
function toAccelerator(k) {
  const m = k && /^(Mod-)?(Alt-)?(Shift-)?(.+)$/.exec(k);
  if (!m) return null;
  return [m[1] && 'CmdOrCtrl', m[2] && 'Alt', m[3] && 'Shift', ACCEL_KEYS[m[4]] || m[4].toUpperCase()].filter(Boolean).join('+');
}
function nativeMenuSpec() {
  const usedAccels = new Set();
  return MENUS.map(([title, ids]) => {
    const items = [];
    for (const id of ids) {
      if (id === '-') { if (items.length && items[items.length - 1].kind !== 'sep') items.push({ kind: 'sep' }); continue; }
      if (title === 'Help' && (id === 'about' || id === 'checkUpdates')) continue; // these live in the Cowdrey.MD app menu
      const c = C[id];
      if (!c || (c.hidden && c.hidden())) continue;
      if (id === 'undo' || id === 'redo' || id === 'selectAll') { items.push({ kind: 'native', role: id === 'selectAll' ? 'select_all' : id }); if (id === 'redo') items.push({ kind: 'sep' }, { kind: 'native', role: 'cut' }, { kind: 'native', role: 'copy' }, { kind: 'native', role: 'paste' }); continue; }
      let accel = toAccelerator(c.key || c.hint);
      if (accel && usedAccels.has(accel)) accel = null; // a shortcut belongs to one menu item
      if (accel) usedAccels.add(accel);
      items.push({ kind: 'item', id: 'cmd:' + id, label: c.label, accel, checked: c.checked ? !!c.checked() : null });
    }
    while (items.length && items[items.length - 1].kind === 'sep') items.pop();
    return { title, items };
  });
}
let lastMenuJson = '';
const updateNativeMenu = debounce(() => {
  if (!TAURI) return;
  const spec = nativeMenuSpec(), json = JSON.stringify(spec);
  if (json === lastMenuJson) return;
  lastMenuJson = json;
  TAURI.core.invoke('set_menu', { menus: spec }).catch(() => { lastMenuJson = ''; });
}, 80);

/* ================================================================
   Preferences → UI
   ================================================================ */
function setView(v) {
  S.view = v; app.dataset.view = v; saveSettings(); refreshState();
  requestAnimationFrame(() => { cm.refresh(); sizePage(); buildLineMap(); if (v === 'split' && S.sync) syncFromEditor(); });
  if (v !== 'preview') cm.focus();
}
/* Sidebar layout by window size:
   wide (over 1180px): docked, full or compact strip, as the user set it
   tablet (761-1180px): compact strip; expanding opens it over the page
   phone (760px and under): hidden; the title-bar button opens it over the page */
let overlayOpen = false;
const isNarrow = () => window.innerWidth <= 1180, isPhone = () => window.innerWidth <= 760;
function applySidebarMode() {
  let outline, rail, overlay = false;
  if (!isNarrow()) { outline = S.outline; rail = S.sideRail; overlayOpen = false; }
  else if (overlayOpen) { outline = true; rail = false; overlay = true; }
  else { outline = !isPhone(); rail = true; }
  app.dataset.outline = outline ? 'on' : 'off';
  app.dataset.rail = rail ? 'on' : 'off';
  app.dataset.overlay = overlay ? 'on' : 'off';
  $('#sideToggle')?.setAttribute('aria-expanded', overlay);
}
function toggleOutline(force) {
  if (isNarrow()) overlayOpen = force === undefined ? !overlayOpen : force;
  else { S.outline = force === undefined ? !S.outline : force; saveSettings(); }
  applySidebarMode(); refreshState();
  requestAnimationFrame(() => { cm.refresh(); sizePage(); });
}
document.addEventListener('pointerdown', (e) => {
  if (app.dataset.overlay === 'on' && !e.target.closest('#sidebar, #sideToggle, #popover, #dialog')) toggleOutline(false);
}, true);
for (const q of ['(max-width: 1180px)', '(max-width: 760px)']) {
  matchMedia(q).addEventListener?.('change', () => { overlayOpen = false; applySidebarMode(); requestAnimationFrame(() => { cm.refresh(); sizePage(); buildLineMap(); updateRibbonOverflow(); }); });
}
function applyEditorPrefs() {
  cm.setOption('lineNumbers', S.lineNumbers);
  cm.setOption('lineWrapping', S.wrap);
  editorPane.dataset.ed = S.edTheme;
  editorPane.style.setProperty('--ed-size', S.edSize + 'px');
  editorPane.classList.toggle('focus-mode', S.focus);
  editorPane.classList.toggle('typewriter', S.typewriter);
  updateFocus(); saveSettings(); refreshState();
  requestAnimationFrame(() => { cm.refresh(); typewriterScroll(); buildLineMap(); });
}
function applyPagePrefs() {
  page.className = 'page style-' + S.pageStyle;
  app.dataset.ruler = S.ruler ? 'on' : 'off';
  saveSettings(); refreshState();
  requestAnimationFrame(() => { sizePage(); buildLineMap(); });
}

/* app theme */
const initialTheme = document.documentElement.getAttribute('data-theme');
function applyTheme() {
  const root = document.documentElement;
  if (S.appTheme === 'system') { if (initialTheme) root.setAttribute('data-theme', initialTheme); else root.removeAttribute('data-theme'); }
  else root.setAttribute('data-theme', S.appTheme);
  const meta = { system: ['sun-moon', 'Theme: match system'], light: ['sun', 'Theme: light'], dark: ['moon', 'Theme: dark'] }[S.appTheme];
  $('#themeBtn').innerHTML = ic(meta[0]); $('#themeBtn').title = meta[1]; $('#themeBtn').setAttribute('aria-label', meta[1] + '. Change theme'); refreshIcons();
  mermaidTheme = null; requestAnimationFrame(() => { renderMermaid(); drawRuler(); });
}
$('#themeBtn').onclick = () => { S.appTheme = { system: 'light', light: 'dark', dark: 'system' }[S.appTheme]; saveSettings(); applyTheme(); toast($('#themeBtn').title); };
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => { mermaidTheme = null; renderMermaid(); drawRuler(); });

/* divider */
(() => {
  const d = $('#divider'), panes = $('#panes');
  const apply = () => {
    editorPane.style.flexBasis = (S.split * 100).toFixed(2) + '%';
    d.setAttribute('aria-valuemin', '20'); d.setAttribute('aria-valuemax', '80'); d.setAttribute('aria-valuenow', Math.round(S.split * 100)); d.setAttribute('aria-controls', 'editorPane');
  };
  apply();
  d.addEventListener('pointerdown', (e) => {
    d.setPointerCapture(e.pointerId); d.classList.add('drag');
    const r = panes.getBoundingClientRect();
    const move = (ev) => { S.split = clamp((ev.clientX - r.left) / r.width, 0.2, 0.8); apply(); };
    const up = () => { d.classList.remove('drag'); d.removeEventListener('pointermove', move); saveSettings(); cm.refresh(); buildLineMap(); };
    d.addEventListener('pointermove', move); d.addEventListener('pointerup', up, { once: true });
  });
  d.addEventListener('dblclick', () => { S.split = 0.5; apply(); saveSettings(); cm.refresh(); });
  d.addEventListener('keydown', (e) => {
    const v = { ArrowLeft: S.split - 0.03, ArrowRight: S.split + 0.03, Home: 0.2, End: 0.8, Enter: 0.5 }[e.key];
    if (v === undefined) return;
    e.preventDefault(); S.split = clamp(v, 0.2, 0.8); apply(); saveSettings(); cm.refresh();
  });
})();

/* status bar */
$('#sbViews').addEventListener('click', (e) => { const b = e.target.closest('[data-view]'); if (b) setView(b.dataset.view); });
$('#sbWords').onclick = showStats;
$('#zoomRange').addEventListener('input', (e) => setZoom(+e.target.value));
$('#zoomInBtn').onclick = () => setZoom(Math.round(scale * 100) + 10);
$('#zoomOutBtn').onclick = () => setZoom(Math.round(scale * 100) - 10);
$('#zoomPct').onclick = () => setZoom('fit');
canvas.addEventListener('wheel', (e) => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); setZoom(Math.round(scale * 100) + (e.deltaY < 0 ? 10 : -10)); } }, { passive: false });

/* sidebar & generic data-cmd buttons */
$('#sidebar').addEventListener('click', (e) => {
  const r = e.target.closest('.rail-btn[data-rail]');
  if (r) { setSideRail(false); if (r.dataset.rail !== 'expand') setSideTab(r.dataset.rail); return; }
  const b = e.target.closest('[data-cmd]'); if (b) runCmd(b.dataset.cmd, b);
});
$('#sideCollapse').addEventListener('click', () => setSideRail(true));
$('#sideToggle').addEventListener('click', () => toggleOutline());
function applySidebar() {
  applySidebarMode();
  $('#sidebar').style.setProperty('--side-w', clamp(S.sideWidth, 180, 440) + 'px');
  $('#sideResize').setAttribute('aria-valuenow', clamp(S.sideWidth, 180, 440));
  $('#sideCollapse').setAttribute('aria-expanded', 'true'); $('[data-rail="expand"]').setAttribute('aria-expanded', 'false');
}
function setSideRail(on) {
  if (isNarrow()) overlayOpen = !on; else { S.sideRail = on; saveSettings(); }
  applySidebar(); refreshState();
  requestAnimationFrame(() => { cm.refresh(); sizePage(); buildLineMap(); });
  (on ? $('[data-rail="expand"]') : $('#sideCollapse'))?.focus({ preventScroll: true });
}
(() => {
  const h = $('#sideResize');
  const set = (w) => { S.sideWidth = clamp(Math.round(w), 180, 440); applySidebar(); };
  h.setAttribute('aria-valuemin', '180'); h.setAttribute('aria-valuemax', '440'); h.setAttribute('aria-controls', 'sidebar');
  const done = () => { saveSettings(); cm.refresh(); sizePage(); buildLineMap(); };
  h.addEventListener('pointerdown', (e) => {
    e.preventDefault(); h.setPointerCapture(e.pointerId); h.classList.add('drag');
    const left = $('#sidebar').getBoundingClientRect().left;
    const move = (ev) => set(ev.clientX - left);
    h.addEventListener('pointermove', move);
    h.addEventListener('pointerup', () => { h.classList.remove('drag'); h.removeEventListener('pointermove', move); done(); }, { once: true });
  });
  h.addEventListener('dblclick', () => { set(248); done(); });
  h.addEventListener('keydown', (e) => {
    const v = { ArrowLeft: S.sideWidth - 16, ArrowRight: S.sideWidth + 16, Home: 180, End: 440, Enter: 248 }[e.key];
    if (v === undefined) return;
    e.preventDefault(); set(v); done();
  });
})();
$('#docTabs').addEventListener('click', (e) => { const b = e.target.closest('.new-tab'); if (b) runCmd('newDoc'); });

/* preview interactions */
preview.addEventListener('click', (e) => {
  const cb = e.target.closest('.task-check');
  if (cb) {
    const line = +cb.getAttribute('data-task-line');
    const text = cm.getLine(line);
    if (text != null) {
      const m = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\])/.exec(text);
      if (m) cm.replaceRange(m[2] === ' ' ? 'x' : ' ', { line, ch: m[1].length }, { line, ch: m[1].length + 1 });
    }
    return;
  }
  const copy = e.target.closest('.copy-code');
  if (copy) { const code = copy.closest('.code-block').querySelector('code').textContent; copyText(code, 'Code copied'); return; }
  const link = e.target.closest('a[href]');
  if (link && !TAURI) {
    const href = link.getAttribute('href');
    if (!href.startsWith('#') && !/^(https?:|mailto:|tel:)/i.test(href)) { e.preventDefault(); toast('Links to other files open in the Mac app. Here, only web links and links within this page work.'); return; }
  }
  const a = e.target.closest('a[href^="#"]');
  if (a) {
    e.preventDefault();
    const id = decodeURIComponent(a.getAttribute('href').slice(1));
    const t = id && (preview.querySelector('#' + CSS.escape(id)) || preview.querySelector('#u-' + CSS.escape(id)) || preview.querySelector('#h-' + CSS.escape(id)));
    if (t) { canvas.scrollTop += t.getBoundingClientRect().top - canvas.getBoundingClientRect().top - 20; }
  }
});
preview.addEventListener('dblclick', (e) => {
  if (S.view === 'preview') return;
  const el = e.target.closest('[data-line]'); if (!el) return;
  const line = +el.getAttribute('data-line');
  cm.focus(); cm.setCursor({ line, ch: 0 }); lockSync('preview');
  cm.scrollIntoView({ line, ch: 0 }, cm.getScrollInfo().clientHeight / 3);
});

/* ================================================================
   Dialog content
   ================================================================ */
function showShortcuts() {
  const groups = [
    ['Text', ['bold', 'italic', 'underline', 'strike', 'highlight', 'code', 'sup', 'sub', 'clearFormat', 'link']],
    ['Paragraph', ['normal', 'h1', 'h2', 'h3', 'ul', 'ol', 'task', 'quote', 'indent', 'outdent', 'codeBlock', 'footnote', 'formatTable']],
    ['Document', ['newDoc', 'openFile', 'saveNow', 'copyRich', 'find', 'replace', 'wordCount', 'print']],
    ['View', ['cycleView', 'toggleOutline', 'toggleFocus', 'zoomIn', 'zoomOut', 'shortcuts']],
  ];
  openDialog({
    title: 'Keyboard shortcuts',
    body: `<div class="keys">${groups.map(([g, ids]) => `<h3>${g}</h3>` + ids.filter((id) => C[id].key && !(C[id].hidden && C[id].hidden())).map((id) => `<div>${esc(C[id].label)}</div><div><kbd class="k">${fmtKey(C[id].key)}</kbd></div>`).join('')).join('')}
      <h3>Editor</h3><div>Continue a list</div><div><kbd class="k">Enter</kbd></div><div>Indent a list item</div><div><kbd class="k">Tab</kbd></div>
      <div>Jump from preview to source</div><div><kbd class="k">Double-click</kbd></div></div>`,
    actions: [{ label: 'Done', primary: true }],
  });
}
const LEGAL_URL = 'https://bradcowdrey.com/legal';
const TERMS_VERSION = '2026-10-21'; // bump when the terms change materially, so everyone is asked again
function openLegal() {
  if (TAURI) TAURI.opener.openUrl(LEGAL_URL).catch(() => {});
  else window.open(LEGAL_URL, '_blank', 'noopener');
}
// Asked once (and again after a material change). Closing without agreeing asks again next time.
function askTermsOnce() {
  if (store.get(KEY + ':terms', null) === TERMS_VERSION) return;
  openDialog({
    title: 'Terms of Use and Privacy',
    body: `<p>Cowdrey.MD is free and provided as is, without warranty. You use it at your own risk, and you are responsible for keeping copies of your work.</p>
      <p>Your documents stay on your device. By choosing <b>I agree</b> and using Cowdrey.MD, you agree to the <a href="${LEGAL_URL}" target="_blank" rel="noopener">Terms of Use and Privacy</a>.</p>`,
    actions: [{ label: 'Read the terms', run: () => { openLegal(); return false; } }, { label: 'I agree', primary: true, run: () => { store.set(KEY + ':terms', TERMS_VERSION); } }],
  });
}
async function showAbout() {
  let version = '';
  if (TAURI) { try { version = ' ' + await TAURI.app.getVersion(); } catch {} }
  openDialog({
    title: 'About Cowdrey.MD',
    body: `<div class="about-mark"><a class="logo" href="https://bradcowdrey.com" target="_blank" rel="noopener" aria-label="bradcowdrey.com">${$('.titlebar .logo').innerHTML}</a><div><b>Cowdrey.MD${esc(version)}</b>by Bradley Cowdrey · <a href="https://bradcowdrey.com" target="_blank" rel="noopener">bradcowdrey.com</a></div></div>
      <p>A Markdown editor with MacDown’s side-by-side writing, a Docs-style page and menus, and a Word-style ribbon, ruler and status bar.</p>
      <p>Supports GitHub Flavored Markdown, tables, task lists, footnotes, callouts, LaTeX math, Mermaid diagrams, emoji, front matter and highlighted code.</p>
      <p>Free and provided as is. <a href="${LEGAL_URL}" target="_blank" rel="noopener">Terms of Use and Privacy</a></p>
      <p style="font-size:12px">Built with CodeMirror, markdown-it, highlight.js, MathJax, Mermaid, DOMPurify and Lucide. Feature ideas drawn from MacDown, MarkText, Zettlr, StackEdit, Dillinger and ghostwriter.</p>`,
    actions: [{ label: 'Close', primary: true }],
  });
}
function pasteAsNew() {
  openDialog({
    title: 'Paste as a new document',
    body: `<p>Paste Markdown below with ${isMac ? '⌘V' : 'Ctrl+V'}. It opens as a new document.</p><textarea class="paste-area" id="pasteArea" spellcheck="false" placeholder="# Paste Markdown here"></textarea>`,
    actions: [{ label: 'Cancel' }, { label: 'Create document', primary: true, run: (d) => { const v = $('#pasteArea', d).value; if (!v.trim()) { $('#pasteArea', d).focus(); return false; } setTimeout(() => newDoc(v), 0); } }],
    onOpen: (d) => setTimeout(() => $('#pasteArea', d).focus(), 30),
  });
}

/* ================================================================
   Editor events
   ================================================================ */
cm.on('change', () => {
  const d = cur(); if (!d) return;
  if (applyingRemote) { d.content = cm.getValue(); scheduleRender(); return; }
  d.content = cm.getValue(); d.updated = Date.now();
  markDirty(d.id); setSaveState('saving'); scheduleSave(); scheduleRender();
  // show or clear the tab's unsaved-changes dot as soon as it changes
  const tab = document.querySelector(`.doc-tab[data-id="${d.id}"]`);
  if (tab && tab.classList.contains('unsaved') !== isUnsaved(d)) renderTabs();
});
cm.on('blur', () => { tabEscape = false; });
cm.on('cursorActivity', () => {
  updateCursorStatus(); highlightOutline(); updateStyleGallery();
  if (S.focus) updateFocus();
  if (S.typewriter && cm.hasFocus()) typewriterScroll();
});

/* ================================================================
   Mac app (Tauri): files on disk, Finder "Open With", external links
   ================================================================ */
/* ---- updates: compare with the latest GitHub release and offer the new DMG ---- */
const RELEASES_API = 'https://api.github.com/repos/bradleycowdrey/cowdrey-md/releases/latest';
const RELEASES_PAGE = 'https://github.com/bradleycowdrey/cowdrey-md/releases/latest';
function isNewer(a, b) {
  const pa = String(a).split('.').map((x) => parseInt(x, 10) || 0), pb = String(b).split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
}
const updateNotes = (text) => (text && md ? DOMPurify.sanitize(md.render(String(text).slice(0, 4000)), PURIFY) : '');
const notesBlock = (html) => (html ? `<div class="preview" style="font-size:13.5px;max-height:220px;overflow:auto;border-top:1px solid var(--line);padding-top:8px">${html}</div>` : '');
// In-place update: download, verify the signature, replace the app, save, and reopen on the new version.
async function installUpdate(update) {
  openDialog({
    title: `Updating to Cowdrey.MD ${update.version}`,
    body: `<p id="updStatus">Downloading…</p><progress id="updBar" max="1" value="0" style="width:100%;accent-color:var(--accent)"></progress>`,
    actions: [],
  });
  let total = 0, got = 0;
  try {
    flushSave();
    await update.downloadAndInstall((ev) => {
      if (ev.event === 'Started') total = ev.data?.contentLength || 0;
      if (ev.event === 'Progress') {
        got += ev.data?.chunkLength || 0;
        const bar = $('#updBar'); if (bar && total) bar.value = got / total;
        const st = $('#updStatus'); if (st && total) st.textContent = `Downloading… ${Math.round((got / total) * 100)}%`;
      }
      if (ev.event === 'Finished') { const st = $('#updStatus'); if (st) st.textContent = 'Installing…'; const bar = $('#updBar'); if (bar) bar.removeAttribute('value'); }
    });
    const st = $('#updStatus'); if (st) st.textContent = 'Restarting…';
    flushSave();
    await TAURI.core.invoke('allow_exit').catch(() => {});
    await TAURI.process.relaunch();
  } catch (e) {
    openDialog({
      title: 'The update could not be installed',
      body: `<p>${esc(e?.message || String(e))}</p><p>Your work is saved. You can download the new version and install it by hand.</p>`,
      actions: [{ label: 'Close' }, { label: 'Open downloads page', primary: true, run: () => { TAURI.opener.openUrl(RELEASES_PAGE).catch(() => {}); } }],
    });
  }
}
async function checkForUpdates(manual) {
  if (!TAURI) return;
  let current = '0';
  try { current = await TAURI.app.getVersion(); } catch {}
  if (manual) toast('Checking for updates…');
  // Signed in-place updates, when the release has them
  if (TAURI.updater && typeof TAURI.updater.check === 'function') {
    let update = null, ok = false;
    try { update = await TAURI.updater.check(); ok = true; } catch {}
    if (ok) {
      store.set(KEY + ':updateChecked', Date.now());
      if (!update) { if (manual) toast(`You have the latest version (${current}).`); return; }
      if (!manual && store.get(KEY + ':skipVersion', '') === update.version) return;
      openDialog({
        title: `Cowdrey.MD ${update.version} is available`,
        body: `<p>You have version ${esc(current)}. Cowdrey.MD will save your work, install the update and reopen.</p>${notesBlock(updateNotes(update.body))}`,
        actions: [
          { label: 'Skip this version', run: () => { store.set(KEY + ':skipVersion', update.version); } },
          { label: 'Later' },
          { label: 'Install and restart', primary: true, run: () => { setTimeout(() => installUpdate(update), 0); } },
        ],
      });
      return;
    }
  }
  let rel;
  try {
    const r = await fetch(RELEASES_API, { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store' });
    if (!r.ok) throw new Error(`GitHub answered ${r.status}`);
    rel = await r.json();
  } catch (e) {
    if (manual) openDialog({ title: 'Could not check for updates', body: `<p>${esc(e.message || String(e))}. Check your internet connection, or see the downloads page.</p>`, actions: [{ label: 'Close' }, { label: 'Open downloads page', primary: true, run: () => { TAURI.opener.openUrl(RELEASES_PAGE).catch(() => {}); } }] });
    return;
  }
  store.set(KEY + ':updateChecked', Date.now());
  const latest = String(rel.tag_name || '').replace(/^v/i, '');
  if (!latest || !isNewer(latest, current)) { if (manual) toast(`You have the latest version (${current}).`); return; }
  if (!manual && store.get(KEY + ':skipVersion', '') === latest) return;
  const dmg = (rel.assets || []).find((a) => /\.dmg$/i.test(a.name));
  const notes = updateNotes(rel.body);
  openDialog({
    title: `Cowdrey.MD ${latest} is available`,
    body: `<p>You have version ${esc(current)}. Download the new version, open it, and drag Cowdrey.MD into Applications to replace this one. Your documents are kept.</p>${notesBlock(notes)}`,
    actions: [
      { label: 'Skip this version', run: () => { store.set(KEY + ':skipVersion', latest); } },
      { label: 'Later' },
      { label: 'Download', primary: true, run: () => { TAURI.opener.openUrl(dmg ? dmg.browser_download_url : (rel.html_url || RELEASES_PAGE)).catch(() => {}); toast('Downloading in your browser'); } },
    ],
  });
}
const stripExt = (n) => n.replace(/\.(md|markdown|mdown|mkdn?|txt)$/i, '');
// Recently opened or saved files (Mac app), newest first.
function rememberRecent(path) {
  const list = (store.get(KEY + ':recent', []) || []).filter((p) => p !== path);
  list.unshift(path); store.set(KEY + ':recent', list.slice(0, 12));
}
function showRecent(anchor) {
  const list = store.get(KEY + ':recent', []) || [];
  if (!list.length) { toast('No recent files yet'); return; }
  openDialog({
    title: 'Open recent',
    body: `<div class="recent-list">${list.map((p, i) => `<button type="button" class="recent" data-r="${i}">${ic('file-text')}<span><b>${esc(stripExt(baseName(p)))}</b><small>${esc(dirName(p))}</small></span></button>`).join('')}</div>`,
    actions: [{ label: 'Clear list', run: () => { store.set(KEY + ':recent', []); } }, { label: 'Close', primary: true }],
    onOpen: (dlg) => {
      $('.recent-list', dlg).addEventListener('click', (e) => {
        const b = e.target.closest('[data-r]'); if (!b) return;
        closeDialog();
        const path = list[+b.dataset.r];
        TAURI.core.invoke('read_text_file', { path }).then((f) => openPathsAsDocs([f])).catch(() => {
          store.set(KEY + ':recent', list.filter((p) => p !== path));
          toast(`${baseName(path)} isn't there any more`);
        });
      });
      $('.recent', dlg)?.focus();
    },
  });
}
// Save one document back to its file, or ask where to save it. Resolves true when saved.
async function saveDoc(d) {
  if (d.id !== currentId) openDoc(d.id);
  await saveToDisk(false);
  return !isUnsaved(d) && !!d.path;
}
async function saveAll() {
  const unsaved = docs.filter(isUnsaved);
  if (!unsaved.length) { toast('All files are saved'); return true; }
  let ok = true;
  for (const d of unsaved) {
    try { await writeToPath(d, d.path, d.content); } catch (e) { ok = false; toast(`Could not save ${baseName(d.path)}: ${e}`); }
  }
  renderTabs();
  if (ok) toast(unsaved.length === 1 ? `Saved ${baseName(unsaved[0].path)}` : `Saved ${unsaved.length} files`);
  return ok;
}
function openPathsAsDocs(files) {
  let last;
  for (const f of files) {
    const existing = docs.find((d) => d.path === f.path);
    if (existing) {
      last = existing; rememberRecent(f.path);
      if (f.content !== existing.diskContent) {
        if (existing.content === existing.diskContent) {
          // no unsaved edits here, so take the newer copy from disk
          existing.content = existing.diskContent = f.content; existing.updated = Date.now();
          cmDocs.get(existing.id)?.setValue(f.content);
          markDirty(existing.id);
        } else {
          toast(`${f.name} changed on disk. Your unsaved version is kept; use Save as to keep both.`);
        }
      }
      continue;
    }
    last = makeDoc(f.content, stripExt(f.name), false);
    last.path = f.path; last.diskContent = f.content;
    rememberRecent(f.path);
    docs.unshift(last); markDirty(last.id);
  }
  if (last) {
    // Every file opened gets a tab, not just the last one; the last is shown.
    for (const f of files) { const d = docs.find((x) => x.path === f.path); if (d && !S.openTabs.includes(d.id)) S.openTabs.push(d.id); }
    persist(); openDoc(last.id);
  }
}
async function openNative() {
  try {
    let paths = await TAURI.dialog.open({ multiple: true, filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd', 'mkdn', 'txt'] }] });
    if (!paths) return;
    if (!Array.isArray(paths)) paths = [paths];
    const files = [];
    for (const p of paths) files.push(await TAURI.core.invoke('read_text_file', { path: typeof p === 'string' ? p : p.path }));
    openPathsAsDocs(files);
  } catch (e) { toast(`Could not open: ${e}`); }
}
async function writeToPath(d, path, contents) {
  await TAURI.core.invoke('write_text_file', { path, contents });
  d.path = path; d.diskContent = contents; markDirty(d.id); persist();
  rememberRecent(path); renderTabs();
  toast(`Saved ${baseName(path)}`);
}
async function saveToDisk(saveAs) {
  const d = cur();
  if (d.autoTitle) render();
  persist();
  const contents = cm.getValue();
  if (d.path && !saveAs) {
    try {
      let onDisk = null;
      try { onDisk = (await TAURI.core.invoke('read_text_file', { path: d.path })).content; } catch {}
      if (onDisk !== null && d.diskContent !== undefined && onDisk !== d.diskContent && onDisk !== contents) {
        openDialog({
          title: `${baseName(d.path)} changed on disk`,
          body: '<p>Another app changed this file after you opened it. Saving now replaces those changes with your version.</p>',
          actions: [{ label: 'Cancel' }, { label: 'Save as…', run: () => { setTimeout(() => saveToDisk(true), 0); } }, { label: 'Replace', danger: true, run: () => { writeToPath(d, d.path, contents).catch((e) => toast(`Could not save: ${e}`)); } }],
        });
        return;
      }
      await writeToPath(d, d.path, contents);
    } catch (e) { toast(`Could not save: ${e}`); }
    return;
  }
  try {
    const path = await TAURI.dialog.save({ defaultPath: slugFile(d.title) + '.md', filters: [{ name: 'Markdown', extensions: ['md'] }] });
    if (!path) return;
    await writeToPath(d, path, contents);
    d.title = stripExt(baseName(path)); d.autoTitle = false; titleInput.value = d.title;
    markDirty(d.id); persist(); renderTabs(); renderDocsList();
  } catch (e) { toast(`Could not save: ${e}`); }
}
function dirName(p) { const i = p.lastIndexOf('/'); return i > 0 ? p.slice(0, i) : '/'; }
function resolvePath(base, rel) {
  const parts = (rel.startsWith('/') ? rel : dirName(base) + '/' + rel).split('/');
  const out = [];
  for (const x of parts) { if (x === '..') out.pop(); else if (x && x !== '.') out.push(x); }
  return '/' + out.join('/');
}
if (TAURI) {
  const takeOpened = () => TAURI.core.invoke('take_opened_files').then((files) => { if (files && files.length) openPathsAsDocs(files); }).catch(() => {});
  TAURI.event.listen('open-files', takeOpened);
  setTimeout(takeOpened, 0);
  // quiet daily check at launch
  if (Date.now() - (store.get(KEY + ':updateChecked', 0) || 0) > 864e5) setTimeout(() => checkForUpdates(false), 5000);
  TAURI.event.listen('menu-command', (e) => {
    const c = C[e.payload]; if (!c) return;
    lastMenuJson = ''; // macOS flips check marks itself; always resend the true state
    const f = document.activeElement;
    const inField = f && f.matches && f.matches('input, textarea, select') && !f.closest('.CodeMirror');
    if (inField && !c.global) { updateNativeMenu(); return; } // a shortcut typed in a text field must not edit the document
    runCmd(e.payload); updateNativeMenu();
  });
  let quitAsked = false;
  TAURI.event.listen('flush-and-quit', () => {
    const quit = () => { try { flushSave(); } finally { TAURI.core.invoke('quit_app').catch(() => {}); } };
    const unsaved = docs.filter(isUnsaved);
    if (!unsaved.length) return quit();
    TAURI.core.invoke('hold_quit', { hold: true }).catch(() => {}); // keep the app open while we ask
    flushSave();
    if (quitAsked) return; quitAsked = true;
    const one = unsaved.length === 1;
    openDialog({
      title: one ? `Save changes to “${baseName(unsaved[0].path)}” before quitting?` : `You have unsaved changes in ${unsaved.length} files`,
      body: (one ? '' : `<ul class="unsaved-list">${unsaved.map((d) => `<li>${esc(baseName(d.path))}</li>`).join('')}</ul>`) + '<p>Your changes will be lost if you don’t save them.</p>',
      actions: [
        { label: 'Cancel' },
        { label: 'Don’t save', run: () => { unsaved.forEach(revertToDisk); quit(); } },
        { label: one ? 'Save' : 'Save all', primary: true, run: () => { saveAll().then((ok) => { if (ok) quit(); }); } },
      ],
    });
    // However the prompt closes, quitting is allowed again; a choice above that quits does so itself.
    const onClose = () => { if (dialog.open) return; dialog.removeEventListener('close', onClose); quitAsked = false; TAURI.core.invoke('hold_quit', { hold: false }).catch(() => {}); };
    dialog.addEventListener('close', onClose);
  });
  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a[href]');
    if (!a) return;
    const href = a.getAttribute('href');
    if (/^(https?:|mailto:)/i.test(href)) { e.preventDefault(); TAURI.opener.openUrl(a.href).catch(() => {}); return; }
    if (href.startsWith('#') || !preview.contains(a)) return;
    e.preventDefault();
    let target;
    try { target = href.startsWith('file:') ? decodeURIComponent(new URL(href).pathname) : decodeURI(href.split('#')[0]); }
    catch { toast('That link could not be read.'); return; }
    const d = cur();
    if (!/\.(md|markdown|mdown|mkdn?|txt)$/i.test(target)) { toast('Only links to Markdown files and web pages open from here.'); return; }
    if (!d.path && !target.startsWith('/')) { toast('Save this document first so links to nearby files can be found.'); return; }
    TAURI.core.invoke('read_text_file', { path: resolvePath(d.path || '/', target) }).then((f) => openPathsAsDocs([f])).catch((err) => toast(String(err)));
  }, true);
  C.saveMd.label = 'Export Markdown (.md)…';
  C.exportHtml.label = 'Export web page (.html)…';
  setSaveState = ((orig) => (kind) => { orig(kind); if (kind === 'saved') saveStateEl.querySelector('span').textContent = cur() && cur().path ? `Autosaved · ⌘S saves ${baseName(cur().path)}` : 'Autosaved · ⌘S saves to a file'; })(setSaveState);
}

/* ================================================================
   Boot
   ================================================================ */
buildMd();
app.dataset.outline = S.outline ? 'on' : 'off';
applySidebar();
applySidebarMode();
if (window.innerWidth <= 760 && !store.get(KEY + ':settings', null)) { S.view = 'editor'; S.ribbonCollapsed = true; }
app.dataset.view = S.view;
renderRibbon();
applyTheme(); applyEditorPrefs(); applyPagePrefs();
setSideTab(S.sideTab);
if (S.allClosed && !S.openTabs.length) setEmpty(true); else openDoc(currentId);
refreshState(); refreshIcons();
if (window.innerWidth > 760) cm.focus();
if (firstRun) persist(); else setSaveState('saved');
askTermsOnce();
window.addEventListener('resize', debounce(() => { cm.refresh(); sizePage(); buildLineMap(); }, 120));
document.fonts && document.fonts.ready.then(() => { cm.refresh(); sizePage(); buildLineMap(); });
})();
