// The Cowdrey family App Store compositor: one look for every app (see STANDARD.md beside this file).
// Generalised from Bearings' scripts/store-frames.js, the approved look: on the app's catalog sky, an uppercase
// eyebrow, a Fraunces headline and a one-line subhead set in Cowdrey One's type scale, above the real capture in a
// drawn iPhone (titanium rim, black bezel, Dynamic Island), iPad, or Mac window.
//
// Usage: node store-frames.js --config <app.json> [--captures <folder>] [--out <folder>] [--only iphone,ipad,mac]
//
// Config (JSON), paths relative to the config file:
//   { "app": "Bearings", "slug": "bearings", "sky": ["#3D74B0", "#14243B"],
//     "captures": "../captures/bearings", "out": "../bearings",
//     "iphone": [ { "id": "compass", "eyebrow": "Compass", "headline": ["Get your", "bearings."],
//                   "subhead": "A clear compass, true north or magnetic.", "capture": "iphone-xl.png",
//                   // optional effects:
//                   "lift": [[0.73, 0.79]],             // lift the tile(s) found from these seed points (black gaps)
//                   "liftRect": [x, y, w, h, radius],    // or lift an explicit rectangle (fractions of the capture)
//                   "zoom": { "x": 0.5, "y": 0.6, "scale": 1.5, "below": 0.1, "keep": [[x, y, w, h]] },  // zoom below y=below, keep rects unzoomed
//                   "widgets": [ { "file": "widget-large.png", "scale": 1.42 }, [ {...}, {...} ] ]  // no device
//                 } ],
//     "ipad": [ ... ], "mac": [ ... ],
//     // optional, for apps whose captures come from a web view without the iOS status bar (web-built apps):
//     "statusBar": { "iphone": "light", "ipad": "light" } }   // light (white) or dark (black) status bar content
// With statusBar, the drawn iOS status bar (9:41, signal, Wi-Fi, a full battery) takes the top safe area: 62 pt on
// the iPhone, 24 pt on the iPad, filled with the capture's own top bar colour. The app sits below it, as on a
// device, and what is anchored to the bottom of the screen stays put: list it per frame as
//   "pin": [[x, y, w, h, radius?], ...]   (fractions of the capture; those pixels stay where they are)
// A frame can turn it off with "statusBar": false. statusBar is not combined with zoom, lift or widgets.
// iPhone headlines are always two lines (an array of two strings); iPad and Mac headlines are one line (the two
// strings joined). Copy that does not fit at the standard size is an error, never shrunk: the sizes are the standard.
//
// Writes <out>/<kind>-<n>-<id>.png (opaque RGB, exact App Store sizes) and <out>/measure.json (the type as rendered),
// then checks the measurements against the standard (EXPECT below) and exits with an error if any differ.
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
let playwright;
try { playwright = require('playwright'); } catch { playwright = require(path.join(require('child_process').execSync('npm root -g').toString().trim(), 'playwright')); }

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 && i + 1 < args.length ? args[i + 1] : null; };
const CONFIG = opt('--config');
if (!CONFIG) { console.error('Usage: node store-frames.js --config <app.json> [--captures <folder>] [--out <folder>] [--only iphone,ipad,mac]'); process.exit(2); }
const cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
const base = path.dirname(path.resolve(CONFIG));
const CAPS = path.resolve(base, opt('--captures') || cfg.captures);
const OUT = path.resolve(base, opt('--out') || cfg.out);
const ONLY = (opt('--only') || 'iphone,ipad,mac').split(',');

// ---- The standard (STANDARD.md). Cowdrey One's type in points x the canvas's store scale. -------------------
const TYPE_PT = {
  eyebrow: { size: 13, weight: 600, tracking: '.02em', lh: 1 },        // Cowdrey One .eyebrow
  headline: { size: 36, weight: 560, tracking: '-.015em', lh: 1.05 },  // Cowdrey One .large-title (Fraunces)
  subhead: { size: 17, weight: 600, tracking: '-.01em', lh: 1.2 },     // Cowdrey One body / .feature-bar b
};
const CANVAS = {
  //        canvas        scale  text block (side margin, top)  gaps (eyebrow->headline, headline->subhead)  lines
  iphone: { W: 1320, H: 2868, scale: 3, side: 70, top: 150, gapEH: 24, gapHS: 30, lines: 2,
    // device: width as share of canvas, top, screen inset and rim as share of body, screen corner radius in pt
    device: { kind: 'phone', bodyW: 1024, top: 640, inset: 0.036, rim: 0.011, radiusPt: 62, pt: 3, screen: [1320, 2868] } },
  ipad: { W: 2064, H: 2752, scale: 4, side: 140, top: 160, gapEH: 32, gapHS: 36, lines: 1,
    device: { kind: 'tablet', bodyW: 1560, top: 600, inset: 0.03, rim: 0.0065, radiusPt: 18, pt: 2, screen: [2064, 2752] } },
  mac: { W: 2880, H: 1800, scale: 3, side: 200, top: 110, gapEH: 24, gapHS: 26, lines: 1,
    device: { kind: 'window', bodyW: 1840, top: 470, titlebar: 56, radius: 22, screen: [2880, 1800] } },
};
// What every frame must measure (STANDARD.md, section 3): type sizes, eyebrow baseline, headline top, device top.
const EXPECT = {
  iphone: { eyebrow: 39, headline: 108, subhead: 51, eyebrowBaseline: 184, headlineTop: 213, deviceTop: 640, lines: 2 },
  ipad: { eyebrow: 52, headline: 144, subhead: 68, eyebrowBaseline: 204, headlineTop: 244, deviceTop: 600, lines: 1 },
  mac: { eyebrow: 39, headline: 108, subhead: 51, eyebrowBaseline: 144, headlineTop: 173, deviceTop: 470, lines: 1 },
};
function check(m) {
  const e = EXPECT[m.kind], got = { eyebrow: m.eyebrow.fontSize, headline: m.headline.fontSize, subhead: m.subhead.fontSize,
    eyebrowBaseline: m.eyebrowBaseline, headlineTop: m.headline.top, deviceTop: m.deviceTop, lines: m.headline.lines };
  return Object.keys(e).filter((k) => got[k] !== e[k]).map((k) => `${m.file}: ${k} is ${got[k]}, the standard is ${e[k]}`);
}

// The iOS status bar's icons (points), drawn in currentColor.
const sector = (cx, cy, r0, r1, a0, a1) => {
  const p = (r, a) => `${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`;
  return r0 > 0 ? `M${p(r1, a0)} A${r1} ${r1} 0 0 1 ${p(r1, a1)} L${p(r0, a1)} A${r0} ${r0} 0 0 0 ${p(r0, a0)} Z`
    : `M${cx} ${cy} L${p(r1, a0)} A${r1} ${r1} 0 0 1 ${p(r1, a1)} Z`;
};
const A0 = -Math.PI * 3 / 4, A1 = -Math.PI / 4;
const ICONS = {
  signal: { w: 18, h: 12, svg: [[0, 4], [5, 6.5], [10, 9], [15, 11.5]].map(([x, h]) => `<rect x="${x}" y="${12 - h}" width="3" height="${h}" rx="1"/>`).join('') },
  wifi: { w: 16.5, h: 12, svg: `<path d="${sector(8.25, 11.6, 0, 3.4, A0, A1)} ${sector(8.25, 11.6, 5, 7.3, A0, A1)} ${sector(8.25, 11.6, 8.9, 11.2, A0, A1)}"/>` },
  battery: { w: 27, h: 13, svg: `<rect x=".5" y=".5" width="23.5" height="12" rx="3.8" fill="none" stroke="currentColor" stroke-opacity=".4"/>`
    + `<rect x="2.2" y="2.2" width="20.1" height="8.6" rx="2.4"/><rect x="25" y="4.3" width="1.6" height="4.4" rx=".8" fill-opacity=".4"/>` },
};

const COLOURS = { eyebrow: 'rgba(255,255,255,.78)', headline: '#FFFFFF', subhead: 'rgba(255,255,255,.92)' };

const fontsDir = path.join(__dirname, 'fonts');
const b64 = (f) => fs.readFileSync(f).toString('base64');
const FONTS_CSS = `
@font-face { font-family: Fraunces; src: url(data:font/woff2;base64,${b64(path.join(fontsDir, 'fraunces.woff2'))}) format("woff2"); font-weight: 100 900; }
@font-face { font-family: "Inter Store"; src: url(data:font/ttf;base64,${b64(path.join(fontsDir, 'Inter-SemiBold.ttf'))}) format("truetype"); font-weight: 600; }
@font-face { font-family: "Inter Store"; src: url(data:font/ttf;base64,${b64(path.join(fontsDir, 'Inter-Medium.ttf'))}) format("truetype"); font-weight: 500; }`;
const dataURL = (file) => `data:image/png;base64,${b64(file)}`;

// Runs in the page: draws one frame, then returns the measured type.
async function build(p) {
  const { C, T, colours, frame, images, sky, kind, statusBar, icons } = p;
  const load = (src) => new Promise((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = fail; i.src = src; });
  const el = (tag, css, parent, html) => { const e = document.createElement(tag); e.style.cssText = css; if (html != null) e.innerHTML = html; if (parent) parent.appendChild(e); return e; };
  const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const W = C.W, H = C.H, root = document.body, D = C.device;
  root.style.cssText = `margin:0;width:${W}px;height:${H}px;position:relative;overflow:hidden;background:${sky[1]}`;

  // The sky: the app's catalog gradient at Cowdrey One's 170deg, a soft glow at the top, a little depth at the foot.
  el('div', `position:absolute;inset:0;background:
    radial-gradient(110% 55% at 50% -6%, rgba(255,255,255,.20), rgba(255,255,255,0) 62%),
    radial-gradient(90% 40% at 50% 106%, rgba(0,0,0,.18), rgba(0,0,0,0) 70%),
    linear-gradient(170deg, ${sky[0]} 0%, ${sky[1]} 100%)`, root);

  // The words, at the standard sizes.
  const px = (t) => t.size * C.scale;
  const head = el('div', `position:absolute;left:${C.side}px;right:${C.side}px;top:${C.top}px;text-align:center`, root);
  const eb = el('div', `font:${T.eyebrow.weight} ${px(T.eyebrow)}px/${T.eyebrow.lh} "Inter Store",sans-serif;letter-spacing:${T.eyebrow.tracking};text-transform:uppercase;color:${colours.eyebrow};white-space:nowrap`, head,
    esc(frame.eyebrow) + '<i class="bl" style="display:inline-block;width:0;height:0;vertical-align:baseline"></i>');
  const lines = C.lines === 2 ? frame.headline : [frame.headline.join(' ')];
  const hl = el('div', `font-family:Fraunces,serif;font-size:${px(T.headline)}px;font-weight:${T.headline.weight};font-variation-settings:"opsz" 72;line-height:${T.headline.lh};letter-spacing:${T.headline.tracking};color:${colours.headline};margin-top:${C.gapEH}px`, head,
    lines.map((l) => `<div style="white-space:nowrap;width:max-content;margin:0 auto">${esc(l)}</div>`).join(''));
  const sb = el('div', `font:${T.subhead.weight} ${px(T.subhead)}px/${T.subhead.lh} "Inter Store",sans-serif;letter-spacing:${T.subhead.tracking};color:${colours.subhead};margin-top:${C.gapHS}px`, head,
    `<div style="white-space:nowrap;width:max-content;margin:0 auto">${esc(frame.subhead)}</div>`);

  // ---- The device -------------------------------------------------------------------------------------------
  const B = D.bodyW, left = (W - B) / 2;
  let dev = null;
  function hardware(capW, capH) {
    const phone = D.kind === 'phone';
    const inset = Math.round(B * D.inset), rim = Math.round(B * D.rim);
    const sw = B - 2 * inset, k = sw / capW, sh = Math.round(capH * k), bh = sh + 2 * inset;
    const sr = D.radiusPt * D.pt * k, br = sr + inset;
    const box = el('div', `position:absolute;left:${left}px;top:${D.top}px;width:${B}px;height:${bh}px`, root);
    const button = (css) => el('div', `position:absolute;background:linear-gradient(90deg,#2b2d31,#74777d 50%,#2b2d31);border-radius:${B * 0.006}px;${css}`, box);
    if (phone) {
      const bw = Math.round(B * 0.011), out = -Math.round(B * 0.0065);
      button(`left:${out}px;top:${bh * 0.17}px;width:${bw}px;height:${bh * 0.04}px`);
      button(`left:${out}px;top:${bh * 0.235}px;width:${bw}px;height:${bh * 0.068}px`);
      button(`left:${out}px;top:${bh * 0.318}px;width:${bw}px;height:${bh * 0.068}px`);
      button(`right:${out}px;top:${bh * 0.265}px;width:${bw}px;height:${bh * 0.105}px`);
      button(`right:${out}px;top:${bh * 0.56}px;width:${bw}px;height:${bh * 0.055}px;border-radius:${bw}px`);
    } else {
      const bw = Math.round(B * 0.008), out = -Math.round(B * 0.005);
      button(`top:${out}px;left:${B * 0.74}px;height:${bw}px;width:${B * 0.08}px;background:linear-gradient(180deg,#2b2d31,#74777d 50%,#2b2d31)`);
      button(`right:${out}px;top:${bh * 0.07}px;width:${bw}px;height:${bh * 0.045}px`);
      button(`right:${out}px;top:${bh * 0.125}px;width:${bw}px;height:${bh * 0.045}px`);
    }
    el('div', `position:absolute;inset:0;border-radius:${br}px;background:linear-gradient(135deg,#8a8d93 0%,#43464b 14%,#26282c 45%,#2e3034 70%,#55585e 88%,#9a9da3 100%);
      box-shadow:0 ${B * 0.07}px ${B * 0.13}px rgba(3,9,22,.5),0 ${B * 0.012}px ${B * 0.03}px rgba(3,9,22,.32)`, box);
    el('div', `position:absolute;inset:${rim}px;border-radius:${br - rim}px;background:#000;box-shadow:inset 0 0 0 ${Math.max(2, B * 0.0022)}px rgba(255,255,255,.07)`, box);
    const screen = el('div', `position:absolute;left:${inset}px;top:${inset}px;width:${sw}px;height:${sh}px;border-radius:${sr}px;overflow:hidden;background:#000;isolation:isolate`, box);
    const content = el('div', `position:absolute;left:0;top:0;width:${capW}px;height:${capH}px;transform:scale(${k});transform-origin:0 0`, screen);
    const over = el('div', `position:absolute;left:${inset}px;top:${inset}px;width:${capW}px;height:${capH}px;transform:scale(${k});transform-origin:0 0;pointer-events:none`, box);
    const u = capW / D.screen[0];   // capture px per standard screen px
    if (phone) {
      const pt = D.pt * u, iw = 126 * pt, ih = 37.33 * pt, it = 11 * pt;
      const isl = el('div', `position:absolute;left:${(capW - iw) / 2}px;top:${it}px;width:${iw}px;height:${ih}px;border-radius:${ih}px;background:#000;
        box-shadow:inset 0 0 0 ${1.2 * pt}px rgba(255,255,255,.09), 0 0 0 ${0.6 * pt}px rgba(0,0,0,.9)`, over);
      el('div', `position:absolute;right:${ih * 0.3}px;top:${ih * 0.3}px;width:${ih * 0.4}px;height:${ih * 0.4}px;border-radius:50%;
        background:radial-gradient(circle at 35% 35%, #2a3550 0%, #0b0f1a 55%, #05070c 100%)`, isl);
    } else {
      el('div', `position:absolute;right:${-(inset - rim) / 2 / k - 7 / k}px;top:${capH / 2 - 7 / k}px;width:${14 / k}px;height:${14 / k}px;border-radius:50%;background:radial-gradient(circle at 35% 35%,#2a3550,#06080d 70%)`, over);
    }
    return { box, screen, content, over, k, top: D.top };
  }
  function windowFrame(capW, capH, title) {
    const k = B / capW, sh = Math.round(capH * k), bar = D.titlebar;
    const box = el('div', `position:absolute;left:${left}px;top:${D.top}px;width:${B}px;height:${sh + bar}px;border-radius:${D.radius}px;overflow:hidden;background:#1D2027;
      box-shadow:0 0 0 1.5px rgba(0,0,0,.45), inset 0 0 0 1px rgba(255,255,255,.12), 0 60px 130px rgba(3,9,22,.5), 0 18px 44px rgba(3,9,22,.32)`, root);
    const tb = el('div', `position:relative;height:${bar}px;background:#24272E;border-bottom:1.5px solid #0B0D11;display:flex;align-items:center;justify-content:center;font:600 22px "Inter Store",sans-serif;color:#C9CED8`, box, esc(title || ''));
    ['#FF5F57', '#FEBC2E', '#28C840'].forEach((c, i) => el('i', `position:absolute;top:50%;left:${22 + 30 * i}px;width:20px;height:20px;margin-top:-10px;border-radius:50%;background:${c}`, tb));
    const screen = el('div', `position:relative;width:${B}px;height:${sh}px;overflow:hidden`, box);
    const content = el('div', `position:absolute;left:0;top:0;width:${capW}px;height:${capH}px;transform:scale(${k});transform-origin:0 0`, screen);
    const over = el('div', `position:absolute;left:0;top:${bar}px;width:${capW}px;height:${capH}px;transform:scale(${k});transform-origin:0 0;pointer-events:none`, box);
    return { box, screen, content, over, k, top: D.top };
  }

  // Pixels that aren't the screen's black background, and the element around a seed point (Bearings' flood fill).
  function pixels(img) { const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; const x = c.getContext('2d'); x.drawImage(img, 0, 0); return x.getImageData(0, 0, c.width, c.height); }
  function find(px, seed) {
    const { width: w, height: h, data } = px;
    const on = (x, y) => { const i = (y * w + x) * 4; return Math.max(data[i], data[i + 1], data[i + 2]) > 12; };
    let sx = Math.round(seed[0] * w), sy = Math.round(seed[1] * h);
    if (!on(sx, sy)) return null;
    const seen = new Uint8Array(w * h), stack = [sy * w + sx];
    let x0 = sx, x1 = sx, y0 = sy, y1 = sy; seen[sy * w + sx] = 1;
    while (stack.length) {
      const q0 = stack.pop(), x = q0 % w, y = (q0 - x) / w;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (const q of [q0 - 1, q0 + 1, q0 - w, q0 + w]) {
        const qx = q % w;
        if (q < 0 || q >= w * h || Math.abs(qx - x) > 1 || seen[q] || !on(qx, (q - qx) / w)) continue;
        seen[q] = 1; stack.push(q);
      }
    }
    const t = 4; let i = 0; while (x0 + i < x1 && !on(x0 + i, y0 + t)) i++;
    if ((x1 - x0) * (y1 - y0) > w * h * 0.2) return null;
    return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1, radius: Math.max(6, i + t + Math.sqrt(2 * i * t)) };
  }

  if (frame.widgets) {
    // Real widget renders floating on the sky in the device's place (no device): one item per row, a row may be a list.
    const rows = frame.widgets.map((r) => (Array.isArray(r) ? r : [r]));
    let y = D.top;
    for (const row of rows) {
      const imgs = await Promise.all(row.map((w) => load(images[w.file])));
      const ws = imgs.map((im, i) => im.naturalWidth * (row[i].scale || 1)), hs = imgs.map((im, i) => im.naturalHeight * (row[i].scale || 1));
      const gap = 56, total = ws.reduce((a, b) => a + b, 0) + gap * (row.length - 1);
      let x = (W - total) / 2;
      row.forEach((w, i) => {
        el('img', `position:absolute;left:${x}px;top:${y}px;width:${ws[i]}px;height:${hs[i]}px;filter:drop-shadow(0 40px 60px rgba(3,9,22,.45)) drop-shadow(0 0 1.5px rgba(255,255,255,.18))`, root).src = images[w.file];
        x += ws[i] + gap;
      });
      y += Math.max(...hs) + 72;
    }
    dev = { top: D.top };
  } else {
    const shot = await load(images.shot);
    // Every capture fills the standard screen shape (cover), so every device of a kind is the same size.
    const [SW, SH] = D.screen, capW = shot.naturalWidth, capH = Math.round(capW * SH / SW);
    dev = D.kind === 'window' ? windowFrame(capW, capH, frame.title) : hardware(capW, capH);
    const fitH = shot.naturalHeight;
    // A drawn iOS status bar for captures that have none: the app moves down below it, pinned parts stay.
    const bar = D.kind !== 'window' && frame.statusBar !== false ? statusBar : null;
    if (bar && (frame.zoom || frame.lift || frame.liftRect)) throw new Error(`${kind} ${frame.id}: statusBar is not combined with zoom or lift`);
    const pt = capW / (D.kind === 'phone' ? 440 : 1032);   // capture px per point (iPhone 6.9" 440 pt, iPad 13" 1032 pt wide)
    const shift = bar ? Math.round((D.kind === 'phone' ? 62 : 24) * pt) : 0;
    el('img', `position:absolute;left:0;top:${shift}px;width:${capW}px;height:${fitH}px`, dev.content).src = images.shot;
    if (bar) {
      const c = document.createElement('canvas'); c.width = c.height = 1; const x = c.getContext('2d');
      const colour = (px, py) => { x.clearRect(0, 0, 1, 1); x.drawImage(shot, Math.round(px), Math.round(py), 1, 1, 0, 0, 1, 1); const [r, g, b] = x.getImageData(0, 0, 1, 1).data; return `rgb(${r},${g},${b})`; };
      for (const [px, py, w, h, r = 0] of frame.pin || []) {
        // Where a pinned part's moved copy would show, the background beside it (so it is not seen twice).
        if (h < 0.5) el('div', `position:absolute;left:${px * capW}px;top:${py * capH + shift}px;width:${w * capW}px;height:${h * capH}px;background:${colour(px * capW - 6, py * capH)}`, dev.content);
      }
      for (const [x, y, w, h, r = 0] of frame.pin || []) {
        const k = el('div', `position:absolute;left:${x * capW}px;top:${y * capH}px;width:${w * capW}px;height:${h * capH}px;overflow:hidden;border-radius:${r * capW}px`, dev.content);
        el('img', `position:absolute;left:${-x * capW}px;top:${-y * capH}px;width:${capW}px;height:${fitH}px`, k).src = images.shot;
      }
      const ink = bar === 'dark' ? '#000' : '#fff';
      const band = el('div', `position:absolute;left:0;top:0;width:${capW}px;height:${shift + 3}px;background:${colour(4, 2)};color:${ink};font-family:"Inter Store",sans-serif;font-weight:600`, dev.content);
      const icon = (n) => `<svg width="${icons[n].w * pt}" height="${icons[n].h * pt}" viewBox="0 0 ${icons[n].w} ${icons[n].h}" fill="currentColor" style="display:block">${icons[n].svg}</svg>`;
      if (D.kind === 'phone') {
        // Either side of the Dynamic Island (126 pt wide, 11 pt down, 37.33 pt tall), centred on it.
        const side = (440 - 126) / 2, cy = 11 + 37.33 / 2, row = `position:absolute;top:${(cy - 15) * pt}px;height:${30 * pt}px;width:${side * pt}px;display:flex;align-items:center;justify-content:center`;
        el('div', `${row};left:0;padding-left:${14 * pt}px;font-size:${17 * pt}px;letter-spacing:${-0.4 * pt}px`, band, '9:41');
        el('div', `${row};right:0;padding-right:${14 * pt}px;gap:${6 * pt}px`, band, icon('signal') + icon('wifi') + icon('battery'));
      } else {
        const row = `position:absolute;top:0;height:${24 * pt}px;display:flex;align-items:center;gap:${6 * pt}px;font-size:${14 * pt}px`;
        el('div', `${row};left:${20 * pt}px;gap:${8 * pt}px`, band, '<span>9:41</span><span style="font-weight:500">Mon Jun 9</span>');
        el('div', `${row};right:${20 * pt}px`, band, icon('wifi') + '<span style="font-weight:500">100%</span>' + icon('battery'));
      }
    }

    if (frame.zoom) {
      const z = frame.zoom, below = Math.round((z.below || 0) * capH);
      const box = el('div', `position:absolute;left:0;top:${below}px;width:${capW}px;height:${capH - below}px;overflow:hidden`, dev.content);
      el('img', `position:absolute;left:0;top:${-below}px;width:${capW}px;height:${fitH}px;transform-origin:${z.x * capW}px ${z.y * capH}px;transform:scale(${z.scale})`, box).src = images.shot;
      // Parts that stay as they are (buttons, credits): the capture's own pixels, unzoomed, on top.
      // [x, y, w, h] keeps a rect where it is; [x, y, w, h, toX, toY] moves it (e.g. a credit out of a rounded corner).
      for (const [x, y, w, h, tx = x, ty = y] of z.keep || []) {
        const k = el('div', `position:absolute;left:${tx * capW}px;top:${ty * capH}px;width:${w * capW}px;height:${h * capH}px;overflow:hidden`, dev.content);
        el('img', `position:absolute;left:${-x * capW}px;top:${-y * capH}px;width:${capW}px;height:${fitH}px`, k).src = images.shot;
      }
    }
    const parts = [];
    if (frame.lift) { const px = pixels(shot); for (const s of frame.lift) { const r = find(px, s); if (!r) throw new Error(`${kind} ${frame.id}: nothing to lift at seed ${s}`); parts.push(r); } }
    if (frame.liftRect) { const [x, y, w, h, r] = frame.liftRect; parts.push({ x: x * capW, y: y * capH, w: w * capW, h: h * capH, radius: (r || 0.03) * capW }); }
    if (parts.length) {
      const ux0 = Math.min(...parts.map((r) => r.x)), uy0 = Math.min(...parts.map((r) => r.y));
      const uw = Math.max(...parts.map((r) => r.x + r.w)) - ux0, uh = Math.max(...parts.map((r) => r.y + r.h)) - uy0;
      let s = Math.min(D.kind === 'phone' ? 1.22 : 1.32, (W - 88) / (uw * dev.k));
      if (uw > capW * 0.7) s = Math.min(s, 1.07);
      el('div', `position:absolute;inset:0;background:rgba(0,0,0,.5)`, dev.content);
      const g = el('div', `position:absolute;left:${ux0}px;top:${uy0}px;width:${uw}px;height:${uh}px;transform:scale(${s});transform-origin:50% 50%`, dev.over);
      for (const r of parts) {
        const t = el('div', `position:absolute;left:${r.x - ux0}px;top:${r.y - uy0}px;width:${r.w}px;height:${r.h}px;border-radius:${r.radius}px;overflow:hidden;
          box-shadow:0 ${30 / dev.k}px ${60 / dev.k}px rgba(2,6,16,.6),0 0 0 ${2 / dev.k}px rgba(255,255,255,.16)`, g);
        el('img', `position:absolute;left:${-r.x}px;top:${-r.y}px;width:${capW}px;height:${fitH}px`, t).src = images.shot;
      }
    }
  }

  await document.fonts.ready;
  // Measure what was drawn: the standard is checked, not assumed.
  const cs = (e) => getComputedStyle(e);
  const rect = (e) => e.getBoundingClientRect();
  const over = [hl, sb, eb].flatMap((e) => [...e.querySelectorAll('div'), e]).filter((e) => rect(e).width > head.clientWidth + 1);
  if (over.length) throw new Error(`${kind} ${frame.id}: copy wider than the text block (${Math.round(Math.max(...over.map((e) => rect(e).width)))} > ${head.clientWidth}); shorten it`);
  const m = (e) => ({ fontFamily: cs(e).fontFamily.split(',')[0].replace(/"/g, ''), fontSize: parseFloat(cs(e).fontSize), fontWeight: cs(e).fontWeight,
    letterSpacing: cs(e).letterSpacing, lineHeight: cs(e).lineHeight, color: cs(e).color, top: Math.round(rect(e).top), bottom: Math.round(rect(e).bottom) });
  const out = { eyebrow: m(eb), headline: { ...m(hl), lines: hl.children.length }, subhead: m(sb),
    eyebrowBaseline: Math.round(document.querySelector('.bl').getBoundingClientRect().bottom), deviceTop: Math.round(dev.top) };
  if (out.subhead.bottom > out.deviceTop - 24) throw new Error(`${kind} ${frame.id}: copy runs into the device`);
  return out;
}

// App Store Connect refuses screenshots with an alpha channel: write any RGBA PNG again as RGB (colour type 2).
// (The same approach as the family template in cowdrey-pdf/tests/store-frame.mjs.)
function rgbPng(buf) {
  const sig = buf.subarray(0, 8); let o = 8, ihdr; const idat = [];
  while (o < buf.length) { const n = buf.readUInt32BE(o), t = buf.toString('latin1', o + 4, o + 8), d = buf.subarray(o + 8, o + 8 + n); if (t === 'IHDR') ihdr = d; if (t === 'IDAT') idat.push(d); o += 12 + n; }
  const w = ihdr.readUInt32BE(0), h = ihdr.readUInt32BE(4), depth = ihdr[8], type = ihdr[9];
  if (type === 2 && depth === 8) return buf;
  if (depth !== 8 || type !== 6 || ihdr[12]) throw new Error('unexpected PNG ' + type + '/' + depth);
  const raw = zlib.inflateSync(Buffer.concat(idat)), bpp = 4, stride = w * bpp, out = Buffer.alloc(h * (w * 3 + 1));
  let prev = Buffer.alloc(stride), cur = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
      cur[i] = (line[i] + [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][f]) & 255;
    }
    const q = y * (w * 3 + 1); out[q] = 0;
    for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) out[q + 1 + x * 3 + c] = cur[x * 4 + c];
    [prev, cur] = [cur, prev];
  }
  const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t, 'latin1'), d]); const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0); return Buffer.concat([len, td, crc]); };
  const hd = Buffer.alloc(13); hd.writeUInt32BE(w, 0); hd.writeUInt32BE(h, 4); hd[8] = 8; hd[9] = 2;
  return Buffer.concat([sig, chunk('IHDR', hd), chunk('IDAT', zlib.deflateSync(out, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const exe = fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;
  const browser = await playwright.chromium.launch({ executablePath: exe });
  const measures = [];
  for (const kind of ['iphone', 'ipad', 'mac']) {
    const frames = cfg[kind];
    if (!frames || !frames.length || !ONLY.includes(kind)) continue;
    const C = CANVAS[kind];
    const page = await browser.newPage({ viewport: { width: C.W, height: C.H }, deviceScaleFactor: 1 });
    let n = 1;
    for (const frame of frames) {
      if (kind === 'iphone' && (!Array.isArray(frame.headline) || frame.headline.length !== 2)) throw new Error(`iphone ${frame.id}: the headline must be two lines`);
      const images = {};
      if (frame.widgets) for (const w of frame.widgets.flat()) images[w.file] = dataURL(path.join(CAPS, w.file));
      else images.shot = dataURL(path.join(CAPS, frame.capture));
      await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${FONTS_CSS}
        * { box-sizing: border-box; } body { -webkit-font-smoothing: antialiased; } img { display: block; }</style></head><body></body></html>`);
      await page.evaluate(() => document.fonts.load('560 100px Fraunces').then(() => document.fonts.load('600 40px "Inter Store"')));
      const m = await page.evaluate(build, { C, T: TYPE_PT, colours: COLOURS, frame, images, sky: cfg.sky, kind,
        statusBar: (cfg.statusBar || {})[kind] || null, icons: ICONS });
      await page.waitForTimeout(150);
      const out = path.join(OUT, `${kind}-${n}-${frame.id}.png`);
      fs.writeFileSync(out, rgbPng(await page.screenshot({ type: 'png' })));
      measures.push({ app: cfg.app, kind, file: path.basename(out), ...m });
      console.log('wrote', out);
      n++;
    }
    await page.close();
  }
  fs.writeFileSync(path.join(OUT, 'measure.json'), JSON.stringify(measures, null, 1));
  await browser.close();
  const wrong = measures.flatMap(check);
  if (wrong.length) throw new Error('Not the standard:\n' + wrong.join('\n'));
  console.log(`${measures.length} frames measured: sizes and positions match the standard`);
})().catch((e) => { console.error(e.message || e); process.exit(1); });
