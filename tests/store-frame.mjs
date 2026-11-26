// The Cowdrey family's App Store screenshot template: every app's App Store pictures are made with this one file, so
// every set has the same type, sizes and device placement. The master copy is design/app-store/store-frame.mjs in
// bradleycowdrey/cowdrey-one; each app keeps a word-for-word copy (change it here, then copy it to every app, so the
// sets never drift). The fonts are Cowdrey One's: Fraunces (web/fonts/fraunces.woff2 here) and Instrument Sans
// (design/app-store/instrument-sans.woff2); see design/app-store/README.md for the standard.
//
// One look on every device: a dark ground in the app's own hue, a Fraunces headline (the cut Cowdrey One uses
// for its titles: weight 560, optical size 48, -0.012em), one sub-line in Instrument Sans 500 tinted with that hue,
// and the real app in a neutral frame: an iPhone or iPad with a graphite band, or a plain Mac window with a shadow.
// The copy starts at the same height on every picture of a device and the device sits at the same place, so the
// sets of every app line up when they are seen side by side. On the iPhone the copy hangs from the device instead:
// the sub-line's baseline sits a fixed 96 px above the phone, and the phone sits higher for a set whose headlines
// are one line (story.lines, the same for every picture of a set), so a one-line set has no empty band above the
// phone. Only the colours below differ between the apps.
//
//   frameHtml(kind, { head, sub, png, title }, theme, fonts) -> the HTML of one picture at its exact App Store size
//   compose(browser, kind, story, theme, fonts)             -> that picture as an opaque RGB PNG (no alpha channel)
import zlib from 'node:zlib';

export const THEMES = {
  md: { // Cowdrey.MD blue
    ground: ['#101C45', '#0A1230', '#050917'], glow: 'rgba(74, 116, 242, .24)', floor: 'rgba(28, 61, 174, .28)',
    ink: '#F6F7FB', sub: '#C4CEEA', base: '#070C1D',
  },
  pdf: { // Cowdrey.PDF raspberry
    ground: ['#3E0C20', '#220812', '#12060B'], glow: 'rgba(198, 31, 82, .26)', floor: 'rgba(150, 18, 60, .30)',
    ink: '#FFF7F8', sub: '#EBC3D0', base: '#12060B',
  },
  meridian: { // Meridian steel blue
    ground: ['#0F2136', '#0A1626', '#050B14'], glow: 'rgba(74, 125, 184, .26)', floor: 'rgba(30, 64, 110, .32)',
    ink: '#F5F8FC', sub: '#C3D3E7', base: '#050B14',
  },
  twodegrees: { // Two Degrees sky blue
    ground: ['#0C2A4E', '#081C37', '#040E1E'], glow: 'rgba(114, 170, 233, .26)', floor: 'rgba(32, 66, 148, .34)',
    ink: '#F5F9FF', sub: '#C6DBF5', base: '#040E1E',
  },
  bearings: { // Bearings compass blue
    ground: ['#0D2442', '#08182E', '#040B17'], glow: 'rgba(61, 116, 176, .28)', floor: 'rgba(20, 52, 96, .34)',
    ink: '#F5F8FC', sub: '#C2D4EA', base: '#040B17',
  },
  goldenhour: { // Golden Hour dusk
    ground: ['#261C47', '#170F2E', '#0B0717'], glow: 'rgba(255, 170, 96, .22)', floor: 'rgba(194, 112, 90, .30)',
    ink: '#FFF8F1', sub: '#F0CFB8', base: '#0B0717',
  },
  one: { // Cowdrey One clay
    ground: ['#3A2015', '#24140C', '#130A06'], glow: 'rgba(201, 131, 91, .26)', floor: 'rgba(147, 81, 47, .32)',
    ink: '#FFF8F3', sub: '#EED3C2', base: '#130A06',
  },
};

// Sizes in output pixels. The copy keeps room for two headline lines, or one headline line and a sub-line that
// wraps once; the device's top edge is fixed.
export const LAYOUT = {
  iphone: { canvas: [1320, 2868], screen: [440, 956], top: 150, head: 118, sub: 54, gap: 30, side: 70, devTop: 560, devTopOneLine: 460, baseline: 96, s: 2.28, bezel: 16, band: 9, radius: 55 },
  ipad: { canvas: [2064, 2752], screen: [1032, 1376], top: 150, head: 128, sub: 59, gap: 32, side: 150, devTop: 620, s: 1.42, bezel: 30, band: 8, radius: 18 },
  // The Mac window runs from x 300 to 2580: a 1180 x 700 point app at 1.93x, so the UI reads at thumbnail size.
  mac: { canvas: [2880, 1800], screen: [1180, 700], top: 112, head: 104, sub: 48, gap: 24, side: 300, devTop: 340, s: 2280 / 1180, titlebar: 28, radius: 12 },
};

const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
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
  let device;
  if (kind === 'mac') {
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
.titlebar span { font: 600 22px 'Instrument Sans', sans-serif; color: #C9CED8; letter-spacing: .005em; }
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
