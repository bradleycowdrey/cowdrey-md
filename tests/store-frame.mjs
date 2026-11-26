// The Cowdrey family's App Store screenshot template: every app's App Store pictures are made with this one file, so
// every set has the same type, sizes and device placement. The master copy is design/app-store/store-frame.mjs in
// bradleycowdrey/cowdrey-one; each app keeps a word-for-word copy (change it here, then copy it to every app, so the
// sets never drift). The fonts are Cowdrey One's: Fraunces (web/fonts/fraunces.woff2 here) and Instrument Sans
// (design/app-store/instrument-sans.woff2); see design/app-store/README.md for the standard.
//
// One look on every device: a dark ground in the app's own hue, a Fraunces headline (the cut Cowdrey One uses
// for its titles: weight 560, optical size 48, -0.012em), one sub-line in Instrument Sans 500 tinted with that hue,
// and the real app in a neutral frame: an iPhone or iPad with a graphite band, and on the Mac a silver MacBook
// showing the app on a desktop (or, by default, a plain Mac window with a shadow).
// The copy starts at the same height on every picture of a device and the device sits at the same place, so the
// sets of every app line up when they are seen side by side. On the iPhone the copy hangs from the device instead:
// the sub-line's baseline sits a fixed 96 px above the phone, and the phone sits higher for a set whose headlines
// are one line (story.lines, the same for every picture of a set), so a one-line set has no empty band above the
// phone. Only the colours below differ between the apps.
//
//   frameHtml(kind, { head, sub, png, title }, theme, fonts) -> the HTML of one picture at its exact App Store size
//   compose(browser, kind, story, theme, fonts)             -> that picture as an opaque RGB PNG (no alpha channel)
//   desktop(browser, { theme, app, windows, ... })          -> a MacBook's whole screen (3024 x 1964 RGB PNG) for
//                                                              story.png with story.device = 'macbook' (see below)
// On the Mac, story.device = 'macbook' shows story.png (the desktop) on a MacBook instead of a bare window.
import zlib from 'node:zlib';

export const THEMES = {
  md: { // Cowdrey.MD blue
    ground: ['#101C45', '#0A1230', '#050917'], glow: 'rgba(74, 116, 242, .24)', floor: 'rgba(28, 61, 174, .28)',
    ink: '#F6F7FB', sub: '#C4CEEA', base: '#070C1D',
    desk: ['#1E2C78', '#3A55C4', '#8EA2EE'],
  },
  pdf: { // Cowdrey.PDF raspberry
    ground: ['#3E0C20', '#220812', '#12060B'], glow: 'rgba(198, 31, 82, .26)', floor: 'rgba(150, 18, 60, .30)',
    ink: '#FFF7F8', sub: '#EBC3D0', base: '#12060B',
    desk: ['#561331', '#9C2758', '#E07A98'],
  },
  meridian: { // Meridian steel blue
    ground: ['#0F2136', '#0A1626', '#050B14'], glow: 'rgba(74, 125, 184, .26)', floor: 'rgba(30, 64, 110, .32)',
    ink: '#F5F8FC', sub: '#C3D3E7', base: '#050B14',
    desk: ['#0C2B31', '#1E5560', '#5E9297'],
  },
  twodegrees: { // Two Degrees sky blue
    ground: ['#0C2A4E', '#081C37', '#040E1E'], glow: 'rgba(114, 170, 233, .26)', floor: 'rgba(32, 66, 148, .34)',
    ink: '#F5F9FF', sub: '#C6DBF5', base: '#040E1E',
    desk: ['#2C5EAE', '#72AAE9', '#F6B48E'],
  },
  bearings: { // Bearings compass blue
    ground: ['#0D2442', '#08182E', '#040B17'], glow: 'rgba(61, 116, 176, .28)', floor: 'rgba(20, 52, 96, .34)',
    ink: '#F5F8FC', sub: '#C2D4EA', base: '#040B17',
    desk: ['#0E3A63', '#2378B8', '#A4CDE6'],
  },
  goldenhour: { // Golden Hour dusk
    ground: ['#261C47', '#170F2E', '#0B0717'], glow: 'rgba(255, 170, 96, .22)', floor: 'rgba(194, 112, 90, .30)',
    ink: '#FFF8F1', sub: '#F0CFB8', base: '#0B0717',
    desk: ['#6A3510', '#C27420', '#F4C55A'],
  },
  one: { // Cowdrey One clay
    ground: ['#3A2015', '#24140C', '#130A06'], glow: 'rgba(201, 131, 91, .26)', floor: 'rgba(147, 81, 47, .32)',
    ink: '#FFF8F3', sub: '#EED3C2', base: '#130A06',
    desk: ['#5C2818', '#A4502F', '#E3987A'],
  },
};

// theme.desk: the MacBook desktop's wallpaper (desktop() below), [top, middle, bottom], in the app's own colours and
// lighter than the page's ground, so the screen reads as a screen and every app's desktop is its own at thumbnail
// size. A theme without desk gets a wallpaper worked out from the hue of its ground.

// Sizes in output pixels. The copy keeps room for two headline lines, or one headline line and a sub-line that
// wraps once; the device's top edge is fixed.
export const LAYOUT = {
  iphone: { canvas: [1320, 2868], screen: [440, 956], top: 150, head: 118, sub: 54, gap: 30, side: 70, devTop: 560, devTopOneLine: 460, baseline: 96, s: 2.28, bezel: 16, band: 9, radius: 55 },
  ipad: { canvas: [2064, 2752], screen: [1032, 1376], top: 150, head: 128, sub: 59, gap: 32, side: 150, devTop: 620, s: 1.42, bezel: 30, band: 8, radius: 18 },
  // The Mac window runs from x 300 to 2580: a 1180 x 700 point app at 1.93x, so the UI reads at thumbnail size.
  mac: { canvas: [2880, 1800], screen: [1180, 700], top: 112, head: 104, sub: 48, gap: 24, side: 300, devTop: 340, s: 2280 / 1180, titlebar: 28, radius: 12 },
};

// The Mac pictures' MacBook (story.device = 'macbook'): a 14" MacBook Pro in silver, drawn here, centred, the lid's
// top at the Mac devTop and the base's front edge exactly between the side margins (x 300 to 2580). Its screen shows
// story.png: the whole desktop as desktop() below draws it, 1512 x 982 pt at 2x (3024 x 1964 px), menu bar included,
// shown at 2000 x 1299 px from (440, 371). The notch sits in the middle of the menu bar.
export const MACBOOK = {
  desktop: [1512, 982], scale: 2, menuBar: 32, notch: [190, 30], // points
  screen: { x: 440, y: 371, w: 2000, h: 1299 },                  // on the 2880 x 1800 canvas
  lid: { x: 413, y: 340, w: 2054, h: 1369, radius: 33, edge: 6, side: 21, top: 25, chin: 33 },
  hinge: { inset: 36, h: 10 }, deck: { x: 300, y: 1717, w: 2280, h: 30 },
};

const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

// The MacBook's HTML and CSS around the desktop picture img (a data URL); the shadow is tinted with the page's base.
function macbookHtml(img, theme) {
  const M = MACBOOK, Ld = M.lid, k = M.screen.w / M.desktop[0];
  const [r, g, b] = hexRgb(theme.base);
  const nw = M.notch[0] * k, nh = M.notch[1] * k;
  const html = `<div class="mb" style="left:${M.deck.x}px;top:${Ld.y}px;width:${M.deck.w}px;height:${M.deck.y + M.deck.h - Ld.y}px">
  <i class="mb-hinge" style="left:${Ld.x - M.deck.x + M.hinge.inset}px;width:${Ld.w - 2 * M.hinge.inset}px;top:${Ld.h - 4}px;height:${M.hinge.h + 4}px"></i>
  <i class="mb-deck" style="left:0;width:${M.deck.w}px;top:${M.deck.y - Ld.y}px;height:${M.deck.h}px"></i>
  <div class="mb-lid" style="left:${Ld.x - M.deck.x}px;top:0;width:${Ld.w}px;height:${Ld.h}px;border-radius:${Ld.radius}px">
    <div class="mb-glass" style="inset:${Ld.edge}px;border-radius:${Ld.radius - Ld.edge}px">
      <div class="mb-scr" style="left:${Ld.side}px;top:${Ld.top}px;width:${M.screen.w}px;height:${M.screen.h}px"><img src="${img}">
        <i class="mb-notch" style="width:${nw}px;height:${nh}px;margin-left:${-nw / 2}px;border-radius:0 0 ${8 * k}px ${8 * k}px"><b style="width:${10 * k}px;height:${10 * k}px;top:${nh * 0.45 - 5 * k}px;margin-left:${-5 * k}px"></b></i>
      </div></div></div></div>`;
  const css = `
.mb { position: absolute; filter: drop-shadow(0 30px 60px rgba(${r},${g},${b},.55)) drop-shadow(0 10px 18px rgba(${r},${g},${b},.4)) drop-shadow(0 2px 4px rgba(0,0,0,.3)); }
.mb i, .mb div { position: absolute; display: block; }
.mb-hinge { background: linear-gradient(180deg, #232326, #3A3A3F 60%, #48484D); }
.mb-deck { border-radius: 6px 6px 24px 24px / 6px 6px 20px 20px;
  background: radial-gradient(ellipse 190px 11px at 50% 0, rgba(40,40,46,.42), rgba(40,40,46,0) 100%),
    linear-gradient(90deg, rgba(255,255,255,.18), rgba(255,255,255,0) 30%, rgba(0,0,0,0) 70%, rgba(0,0,0,.08)),
    linear-gradient(180deg, #DADBDF 0%, #F2F3F5 9%, #D2D3D7 30%, #A9AAAE 75%, #8C8D91 100%);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.7), inset 0 -1px 0 rgba(0,0,0,.25); }
.mb-lid { background: linear-gradient(90deg, rgba(255,255,255,.55) 0, rgba(255,255,255,0) 1%, rgba(255,255,255,0) 99%, rgba(255,255,255,.3) 100%),
    linear-gradient(180deg, #E2E3E6 0%, #C9CACE 100%);
  box-shadow: inset 0 0 0 2.4px rgba(255,255,255,.78), inset 1.5px 1.5px 0 2.4px rgba(255,255,255,.35), 0 0 0 1px rgba(0,0,0,.22); }
.mb-glass { background: #08080A; box-shadow: inset 0 0 0 1.4px #343438; }
.mb-scr { overflow: hidden; border-radius: 16px 16px 0 0; background: #000; }
.mb-scr img { display: block; width: 100%; height: 100%; }
.mb-notch { top: 0; left: 50%; background: #08080A; }
.mb-notch b { position: absolute; left: 50%; border-radius: 50%; background: radial-gradient(circle at 38% 34%, rgba(90,110,170,.85) 0 14%, #10162E 26% 46%, #16181E 50% 100%); }`;
  return { html, css };
}
// Where the device's top edge sits for this picture: on the iPhone it depends on the set's headline lines.
const devTop = (kind, story) => {
  const L = LAYOUT[kind];
  if (!L.devTopOneLine) return L.devTop;
  const lines = story.lines || String(story.head).split('\n').length;
  return lines === 1 ? L.devTopOneLine : L.devTop;
};

export function frameHtml(kind, story, theme, fonts) {
  const L = LAYOUT[kind], [W, H] = L.canvas;
  const img = `data:image/png;base64,${story.png.toString('base64')}`;
  const head = String(story.head).split('\n').map(esc).join('<br>');
  const top = devTop(kind, story);
  let device, mbCss = '';
  if (kind === 'mac' && story.device === 'macbook') {
    const mb = macbookHtml(img, theme);
    device = mb.html; mbCss = mb.css;
  } else if (kind === 'mac') {
    // An app may draw its window at more points (story.screen), so a wider ribbon fits; the window stays 2280 px wide.
    const scr = story.screen || L.screen, s = (W - 2 * L.side) / scr[0];
    const sw = scr[0] * s, sh = scr[1] * s, bar = L.titlebar * s, r = L.radius * s;
    const x = (W - sw) / 2;
    const lights = ['#FF5F57', '#FEBC2E', '#28C840'].map((c, i) => `<i style="left:${(20 + 20 * i) * s}px;background:${c}"></i>`).join('');
    device = `<div class="dev win" style="left:${x}px;top:${L.devTop}px;width:${sw}px;height:${sh + bar}px;border-radius:${r}px">
      <div class="titlebar" style="height:${bar}px">${lights}<span>${esc(story.title)}</span></div><img src="${img}" style="width:${sw}px;height:${sh}px"></div>`;
  } else {
    const { s, bezel: bez, band } = L, sw = L.screen[0] * s, sh = L.screen[1] * s, r = L.radius * s;
    const ow = sw + 2 * (bez + band), oh = sh + 2 * (bez + band), x = (W - ow) / 2, y = top;
    const buttons = kind === 'iphone'
      ? `<i class="btn" style="left:-5px;top:${0.2 * oh}px;height:${0.035 * oh}px"></i><i class="btn" style="left:-5px;top:${0.27 * oh}px;height:${0.07 * oh}px"></i>
         <i class="btn" style="left:-5px;top:${0.355 * oh}px;height:${0.07 * oh}px"></i><i class="btn" style="right:-5px;top:${0.3 * oh}px;height:${0.1 * oh}px"></i>`
      : `<i class="btn" style="right:-5px;top:${0.1 * oh}px;height:${0.05 * oh}px"></i><i class="btn" style="right:-5px;top:${0.17 * oh}px;height:${0.05 * oh}px"></i>`;
    const island = kind === 'iphone' ? `<i class="island" style="top:${11 * s}px;width:${125 * s}px;height:${37 * s}px;margin-left:${-62.5 * s}px"></i>` : '';
    device = `<div class="dev hw" style="left:${x}px;top:${y}px;width:${ow}px;height:${oh}px;border-radius:${r + bez + band}px;padding:${band}px">${buttons}
      <div class="bezel" style="border-radius:${r + bez}px;padding:${bez}px"><div class="scr" style="width:${sw}px;height:${sh}px;border-radius:${r}px"><img src="${img}">${island}</div></div></div>`;
  }
  const T = theme;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: 'Fraunces'; src: url(data:font/woff2;base64,${fonts.fraunces}) format('woff2'); font-weight: 100 900; }
@font-face { font-family: 'Instrument Sans'; src: url(data:font/woff2;base64,${fonts.instrument}) format('woff2'); font-weight: 400 700; }
* { margin: 0; box-sizing: border-box; }
html, body { width: ${W}px; height: ${H}px; overflow: hidden; background: ${T.base}; }
body { position: relative; -webkit-font-smoothing: antialiased;
  background:
    radial-gradient(ellipse ${W * 0.9}px ${H * 0.42}px at 50% ${H * 0.16}px, ${T.glow}, transparent 70%),
    radial-gradient(ellipse ${W * 0.7}px ${H * 0.35}px at 50% ${H * 0.98}px, ${T.floor}, transparent 70%),
    linear-gradient(180deg, ${T.ground[0]} 0%, ${T.ground[1]} 45%, ${T.ground[2]} 100%); }
.copy { position: absolute; left: ${L.side}px; right: ${L.side}px; top: ${L.top}px; text-align: center; }
h1 { font: 560 ${L.head}px/1.04 'Fraunces', Georgia, serif; font-variation-settings: 'opsz' 48; letter-spacing: -.012em; color: ${T.ink}; text-wrap: balance; }
p { margin-top: ${L.gap}px; font: 500 ${L.sub}px/1.25 'Instrument Sans', sans-serif; letter-spacing: -.005em; color: ${T.sub}; text-wrap: balance; }
.base { display: inline-block; width: 0; height: 0; vertical-align: baseline; }
.dev { position: absolute; }
.dev img { display: block; width: 100%; height: 100%; }
.hw { background: linear-gradient(135deg, #5B606B 0%, #2A2D33 18%, #3A3E46 50%, #24272C 82%, #4E535D 100%);
  box-shadow: 0 0 0 1.5px rgba(255,255,255,.10), 0 70px 140px rgba(0,0,0,.55), 0 20px 50px rgba(0,0,0,.35); }
.bezel { width: 100%; height: 100%; background: #050506; box-shadow: inset 0 0 0 1.5px rgba(255,255,255,.06); }
.scr { position: relative; overflow: hidden; background: #000; }
.island { position: absolute; left: 50%; background: #000; border-radius: 999px; }
.btn { position: absolute; width: 6px; border-radius: 3px; background: linear-gradient(90deg, #2A2D33, #565B65, #2A2D33); }
.win { overflow: hidden; background: #1D2027; box-shadow: 0 0 0 1.5px rgba(0,0,0,.6), inset 0 0 0 1px rgba(255,255,255,.12), 0 60px 130px rgba(0,0,0,.6), 0 18px 44px rgba(0,0,0,.4); }
.titlebar { position: relative; background: #24272E; border-bottom: 1.5px solid #0B0D11; display: flex; align-items: center; justify-content: center; }
.titlebar i { position: absolute; top: 50%; width: 20px; height: 20px; margin-top: -10px; border-radius: 50%; box-shadow: inset 0 0 0 1px rgba(0,0,0,.18); }
.titlebar span { font: 600 22px 'Instrument Sans', sans-serif; color: #C9CED8; letter-spacing: .005em; }${mbCss}
</style></head><body>
<div class="copy"><h1>${head}</h1><p>${esc(story.sub)}<i class="base"></i></p></div>${L.baseline ? `
<script>document.fonts.ready.then(() => { // hang the copy from the device: the sub-line's baseline ${L.baseline} px above it
  const c = document.querySelector('.copy'), b = document.querySelector('.base').getBoundingClientRect().bottom;
  c.style.top = (${L.top} + ${top - L.baseline} - b) + 'px'; document.body.dataset.ready = '1'; });</script>` : ''}
${device}
</body></html>`;
}

export async function compose(browser, kind, story, theme, fonts) {
  const L = LAYOUT[kind], [W, H] = L.canvas;
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  await p.setContent(frameHtml(kind, story, theme, fonts), { waitUntil: 'load' });
  await p.evaluate(() => document.fonts.ready);
  if (L.baseline) await p.waitForFunction(() => document.body.dataset.ready === '1');
  await p.waitForTimeout(200);
  // The copy must stay clear of the device and of the top edge: at most two headline lines, or one and a
  // sub-line that wraps once.
  const top = devTop(kind, story);
  const box = await p.evaluate(() => { const r = document.querySelector('.copy').getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; });
  if (box.bottom > top - 20) throw new Error(`${story.file || story.head}: the copy runs into the device (${Math.round(box.bottom)} > ${top - 20})`);
  if (box.top < 90) throw new Error(`${story.file || story.head}: the copy runs off the top (${Math.round(box.top)} < 90)`);
  const out = rgbPng(await p.screenshot({ type: 'png' }), theme.base);
  await ctx.close();
  if (out.readUInt32BE(16) !== W || out.readUInt32BE(20) !== H || out[25] !== 2) throw new Error(`${story.file}: not a ${W}x${H} RGB PNG`);
  return out;
}

// ---------------- the Mac desktop the MacBook shows ----------------
// desktop(browser, { theme, app, windows, extras, menuExtra, clock, dock, fonts }) -> a 3024 x 1964 RGB PNG: the
// whole screen of a 14" MacBook Pro (1512 x 982 pt at 2x), the same on every app: a wallpaper in the app's hue
// (lighter than the page's ground, so the screen reads as a screen), the macOS menu bar (32 pt, dark-mode white
// type: the Apple menu, the app's name in bold, File Edit View Window Help; on the right the app's menu-bar extra if
// it has one, Wi-Fi, a full battery, Control Center and the clock) and the app's real windows on it. Everything is
// in points; pass it as story.png with story.device = 'macbook'.
//   windows: [{ png, x, y, w, h, title, chrome, lights, scale }] the window's outer box in points (x or y left out:
//     centred below the menu bar; x, y place the enlarged box when scale > 1). chrome 'window' (default) gives a
//     28 pt macOS title bar (traffic lights and the title) with png under it; 'none' shows png as the whole window
//     (an app that draws its own title bar; lights: true adds the traffic lights at its top left). Both have 10 pt
//     corners, a fine rim and macOS's shadow.
//     scale (default 1): windows are shown at their real point size (capture at 2x); a window narrower than 600 pt
//     may be enlarged up to 1.5x (scale 1 to 1.5) so it reads; any other scale is refused.
//   extras: [{ png, x, y, w, h, radius }] widgets on the desktop under the windows (radius in points, default 22).
//   menuExtra: { text, icon } the app's menu-bar item, e.g. { text: '55° · 13°', icon: 'sun' }; icon is 'sun',
//     an <svg> string drawn in white (currentColor) or a PNG Buffer.
//   clock: MAC_CLOCK by default, the same on every app; apps do not pass their own.
//   dock: false (default; the Dock hidden) or { icon: png } for a Dock holding the app's icon with its running dot.
//   fonts: { instrument } (base64 of instrument-sans.woff2); left out, it is read from beside this file if there.
const APPLE = `<svg viewBox="0 0 100 100"><defs><mask id="bite"><rect width="100" height="100" fill="#fff"/>
  <circle cx="91" cy="60" r="17"/><circle cx="48" cy="95.5" r="8"/><circle cx="48" cy="27" r="8"/></mask></defs>
  <g fill="#fff"><g mask="url(#bite)"><ellipse cx="32" cy="62.5" rx="24" ry="35.5"/><ellipse cx="64" cy="62.5" rx="24" ry="35.5"/>
  <ellipse cx="48" cy="69" rx="34" ry="27"/></g><ellipse cx="56" cy="14" rx="10" ry="12" transform="rotate(35 56 14)"/></g></svg>`;
const ICONS = {
  sun: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="10" cy="10" r="3.6" fill="currentColor" stroke="none"/>
    ${[0, 45, 90, 135, 180, 225, 270, 315].map((a) => `<line x1="10" y1="2.2" x2="10" y2="4.2" transform="rotate(${a} 10 10)"/>`).join('')}</svg>`,
  wifi: `<svg viewBox="0 0 20 16" fill="currentColor"><path d="M10 15.2 6.9 11.6a4.6 4.6 0 0 1 6.2 0z"/>
    <path d="M10 9.2a7.2 7.2 0 0 1 4.8 1.8l1.4-1.6A9.4 9.4 0 0 0 10 7a9.4 9.4 0 0 0-6.2 2.4l1.4 1.6A7.2 7.2 0 0 1 10 9.2z"/>
    <path d="M10 4.6a11.8 11.8 0 0 1 7.8 2.9l1.4-1.6A14 14 0 0 0 10 2.4 14 14 0 0 0 .8 5.9l1.4 1.6A11.8 11.8 0 0 1 10 4.6z"/></svg>`,
  battery: `<svg viewBox="0 0 30 14"><rect x=".75" y=".75" width="25" height="12.5" rx="3.6" fill="none" stroke="currentColor" stroke-opacity=".5" stroke-width="1.2"/>
    <rect x="2.6" y="2.6" width="21.3" height="8.8" rx="2" fill="currentColor"/><path d="M27.6 4.8a2.3 2.3 0 0 1 0 4.4z" fill="currentColor" fill-opacity=".5"/></svg>`,
  control: `<svg viewBox="0 0 18 16" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="1" y="1.5" width="16" height="5.4" rx="2.7"/>
    <rect x="1" y="9.1" width="16" height="5.4" rx="2.7"/><circle cx="5.2" cy="4.2" r="1.7" fill="currentColor" stroke="none"/><circle cx="12.8" cy="11.8" r="1.7" fill="currentColor" stroke="none"/></svg>`,
};

// The one menu-bar clock of the family: every app's desktop shows this time.
export const MAC_CLOCK = 'Wed Nov 25  9:41 AM';

// The wallpaper: theme.desk [top, middle, bottom] with a soft light at the top right and the bottom colour glowing
// low on the left; without desk, the colours come from the hue of the theme's ground: a deep tone at the top through
// a lighter middle to a soft, slightly warmer light low down.
function wallpaperCss(theme) {
  if (theme.desk) {
    const [t, m, b] = theme.desk, [br, bg, bb] = hexRgb(b);
    return `radial-gradient(ellipse 70% 55% at 78% 28%, rgba(255,255,255,.14), transparent 70%),
    radial-gradient(ellipse 75% 45% at 18% 96%, rgba(${br},${bg},${bb},.55), transparent 70%),
    linear-gradient(180deg, ${t} 0%, ${m} 55%, ${b} 100%)`;
  }
  const [r, g, b] = hexRgb(theme.ground[0]).map((v) => v / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  // The light low down leans towards rose (blue -> violet, clay -> rose), as a dusk sky does.
  const toRose = ((345 - h + 540) % 360) - 180, w = Math.sign(toRose) * Math.min(Math.abs(toRose), 30);
  const hsl = (dh, s, l, a = 1) => `hsl(${((h + dh) % 360).toFixed(1)} ${s}% ${l}% / ${a})`;
  return `radial-gradient(ellipse 70% 55% at 78% 28%, ${hsl(-8, 60, 56, 0.4)}, transparent 70%),
    radial-gradient(ellipse 75% 45% at 18% 96%, ${hsl(w * 0.8, 70, 74, 0.5)}, transparent 70%),
    linear-gradient(180deg, ${hsl(0, 52, 22)} 0%, ${hsl(0, 46, 36)} 42%, ${hsl(w * 0.5, 38, 52)} 78%, ${hsl(w, 52, 68)} 100%)`;
}

export function desktopHtml(o) {
  const [W, H] = MACBOOK.desktop, MB = MACBOOK.menuBar, TB = LAYOUT.mac.titlebar;
  const url = (buf) => `data:image/png;base64,${buf.toString('base64')}`;
  const place = (it) => ({
    x: it.x ?? (W - it.w) / 2,
    y: it.y ?? MB + (H - MB - it.h - (o.dock ? 70 : 0)) / 2,
  });
  const lights = `<span class="lights"><i style="background:#FF5F57"></i><i style="background:#FEBC2E"></i><i style="background:#28C840"></i></span>`;
  const extras = (o.extras || []).map((e) => { const p = place(e);
    return `<div class="wid" style="left:${p.x}px;top:${p.y}px;width:${e.w}px;height:${e.h}px;border-radius:${e.radius ?? 22}px"><img src="${url(e.png)}"></div>`; }).join('');
  const windows = (o.windows || []).map((w) => { const k = w.scale ?? 1, bare = w.chrome === 'none';
    if (!(k === 1 || (k > 1 && k <= 1.5 && w.w < 600))) throw new Error(`desktop: window scale ${k} (${w.w} pt wide): windows are shown at scale 1; only one narrower than 600 pt may be enlarged, up to 1.5`);
    const p = place({ ...w, w: w.w * k, h: w.h * k });
    const top = bare ? (w.lights ? lights : '') : `<div class="tb">${lights}<span>${esc(w.title ?? o.app)}</span></div>`;
    return `<div class="win" style="left:${p.x}px;top:${p.y}px;width:${w.w}px;height:${w.h}px${k === 1 ? '' : `;transform:scale(${k});transform-origin:0 0`}">${top}
      <img src="${url(w.png)}" style="top:${bare ? 0 : TB}px;height:${bare ? w.h : w.h - TB}px"></div>`; }).join('');
  let extra = '';
  if (o.menuExtra) {
    const ic = o.menuExtra.icon, icon = !ic ? '' : Buffer.isBuffer(ic) ? `<img class="ic" src="${url(ic)}">` : `<span class="ic">${ICONS[ic] || ic}</span>`;
    extra = `<span class="st">${icon}${esc(o.menuExtra.text)}</span>`;
  }
  const dock = o.dock && o.dock.icon ? `<div class="dock"><img src="${url(o.dock.icon)}"><i></i></div>` : '';
  const font = o.fonts && o.fonts.instrument ? `@font-face { font-family: 'Instrument Sans'; src: url(data:font/woff2;base64,${o.fonts.instrument}) format('woff2'); font-weight: 400 700; }` : '';
  return `<!doctype html><html><head><meta charset="utf-8"><style>
${font}
* { margin: 0; box-sizing: border-box; }
html, body { width: ${W}px; height: ${H}px; overflow: hidden; }
body { position: relative; -webkit-font-smoothing: antialiased; background: ${wallpaperCss(o.theme)}; font-family: 'Instrument Sans', sans-serif; }
.bar { position: absolute; left: 0; right: 0; top: 0; height: ${MB}px; background: rgba(255,255,255,.16); display: flex; align-items: center;
  color: #fff; font-size: 13.5px; font-weight: 500; letter-spacing: .005em; white-space: nowrap; }
.bar .apple { width: 16px; height: 16px; margin: -2px 22px 0 20px; display: block; }
.bar .apple svg, .st svg { display: block; width: 100%; height: 100%; }
.menus span { margin-right: 21px; } .menus b { font-weight: 700; margin-right: 22px; }
.right { margin-left: auto; display: flex; align-items: center; padding-right: 18px; }
.st { display: flex; align-items: center; margin-left: 20px; }
.st .ic { display: block; width: 16px; height: 16px; margin-right: 6px; }
.wifi { width: 17px; height: 14px; } .batt { width: 25px; height: 12px; } .cc { width: 15px; height: 13.5px; }
.wid, .win { position: absolute; overflow: hidden; }
.wid { box-shadow: 0 14px 34px rgba(0,0,0,.32), 0 3px 8px rgba(0,0,0,.22); }
.wid img { display: block; width: 100%; height: 100%; }
.win { border-radius: 10px; background: #1E1F23;
  box-shadow: 0 0 0 .5px rgba(0,0,0,.75), 0 26px 64px rgba(0,0,0,.48), 0 8px 20px rgba(0,0,0,.28); }
.win::after { content: ''; position: absolute; inset: 0; border-radius: 10px; box-shadow: inset 0 0 0 .5px rgba(255,255,255,.2); pointer-events: none; z-index: 3; }
.win img { position: absolute; left: 0; width: 100%; display: block; }
.tb { position: absolute; left: 0; right: 0; top: 0; height: ${TB}px; background: #2B2C31; border-bottom: .5px solid #0B0B0D;
  display: flex; align-items: center; justify-content: center; }
.tb span:last-child { font-size: 13px; font-weight: 600; color: #D4D6DC; }
.lights { position: absolute; left: 0; top: 0; height: ${TB}px; z-index: 2; }
.lights i { position: absolute; top: 8px; width: 12px; height: 12px; border-radius: 50%; box-shadow: inset 0 0 0 .5px rgba(0,0,0,.25); }
.lights i:nth-child(1) { left: 12px; } .lights i:nth-child(2) { left: 32px; } .lights i:nth-child(3) { left: 52px; }
.dock { position: absolute; bottom: 6px; left: 50%; width: 78px; height: 72px; margin-left: -39px; border-radius: 20px;
  background: rgba(255,255,255,.22); box-shadow: inset 0 0 0 .5px rgba(255,255,255,.45), 0 6px 20px rgba(0,0,0,.25); }
.dock img { position: absolute; left: 9px; top: 6px; width: 60px; height: 60px; }
.dock i { position: absolute; left: 37px; bottom: 2px; width: 4px; height: 4px; border-radius: 50%; background: rgba(255,255,255,.9); }
</style></head><body>
${extras}${windows}${dock}
<div class="bar"><span class="apple">${APPLE}</span><span class="menus"><b>${esc(o.app)}</b>${['File', 'Edit', 'View', 'Window', 'Help'].map((m) => `<span>${m}</span>`).join('')}</span>
  <span class="right">${extra}<span class="st wifi">${ICONS.wifi}</span><span class="st batt">${ICONS.battery}</span><span class="st cc">${ICONS.control}</span>
  <span class="st" style="white-space:pre">${esc(o.clock ?? MAC_CLOCK)}</span></span></div>
</body></html>`;
}

export async function desktop(browser, opts) {
  const o = { ...opts };
  if (!o.fonts) {
    try { o.fonts = { instrument: (await import('node:fs')).readFileSync(new URL('./instrument-sans.woff2', import.meta.url)).toString('base64') }; } catch { o.fonts = null; }
  }
  const [W, H] = MACBOOK.desktop, S = MACBOOK.scale;
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: S });
  const p = await ctx.newPage();
  await p.setContent(desktopHtml(o), { waitUntil: 'load' });
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(100);
  const out = rgbPng(await p.screenshot({ type: 'png' }), '#000000');
  await ctx.close();
  if (out.readUInt32BE(16) !== W * S || out.readUInt32BE(20) !== H * S || out[25] !== 2) throw new Error(`desktop: not a ${W * S}x${H * S} RGB PNG`);
  return out;
}

// App Store Connect refuses screenshots with an alpha channel. Chromium's PNG is opaque; if it comes as RGBA it is
// written again as colour type 2 (RGB), so no alpha channel is left at all.
export function rgbPng(buf, base = '#000000') {
  const sig = buf.subarray(0, 8); let o = 8, ihdr; const idat = [];
  while (o < buf.length) { const n = buf.readUInt32BE(o), t = buf.toString('latin1', o + 4, o + 8), d = buf.subarray(o + 8, o + 8 + n); if (t === 'IHDR') ihdr = d; if (t === 'IDAT') idat.push(d); o += 12 + n; }
  const w = ihdr.readUInt32BE(0), h = ihdr.readUInt32BE(4), depth = ihdr[8], type = ihdr[9];
  if (type === 2 && depth === 8) return buf;
  if (depth !== 8 || type !== 6 || ihdr[12]) throw new Error('unexpected PNG ' + type + '/' + depth);
  const bg = [1, 3, 5].map((i) => parseInt(base.slice(i, i + 2), 16));
  const raw = zlib.inflateSync(Buffer.concat(idat)), bpp = 4, stride = w * bpp, out = Buffer.alloc(h * (w * 3 + 1));
  let prev = Buffer.alloc(stride), cur = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
      const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      cur[i] = (line[i] + [0, a, b, (a + b) >> 1, pr][f]) & 255;
    }
    const q = y * (w * 3 + 1); out[q] = 0;
    for (let x = 0; x < w; x++) { const al = cur[x * 4 + 3] / 255; for (let c = 0; c < 3; c++) out[q + 1 + x * 3 + c] = Math.round(cur[x * 4 + c] * al + bg[c] * (1 - al)); }
    [prev, cur] = [cur, prev];
  }
  const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t, 'latin1'), d]); const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0); return Buffer.concat([len, td, crc]); };
  const hd = Buffer.alloc(13); hd.writeUInt32BE(w, 0); hd.writeUInt32BE(h, 4); hd[8] = 8; hd[9] = 2;
  return Buffer.concat([sig, chunk('IHDR', hd), chunk('IDAT', zlib.deflateSync(out, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
