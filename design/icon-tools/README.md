# Cowdrey.MD app icon

The icon is built the same way as Cowdrey One's: the family "C" (same arc, stroke 104 with round caps), on a 135° diagonal gradient, with the letters in Instrument Sans Bold (SIL Open Font License) set in the C's opening, like One's "1", and centred on its middle line. The letters are converted to outlines, so the SVGs need no font.

`"open": true` in `cfg.json` selects this placement: instead of One's optical anchor (352, which centres the C alone), `gen.py` centres the whole mark, from the C's left edge to whichever is further right, the letters or the end caps, and `"scale"` (0.86 here, 0.97 for the 32 px master; One uses 0.955) sizes it to fit. The 16 px master has no letters, so it keeps One's anchor.

Sources (all 1024 × 1024):

- `design/icon.svg` (same as `desktop/src-tauri/icons/icon.svg`): the master artwork, used from 64 px up.
- `design/icon-32.svg`: hand-tuned for 32 px and the 16 pt @2x slot (heavier letters and stroke, mark a little larger).
- `design/icon-16.svg`: hand-tuned for 16 px, the C only (as Cowdrey One shows at that size).
- `design/android/`: the flattened Android source (mark at 0.66× inside the adaptive-icon safe zone) and the foreground, background and monochrome layers.

Rebuild the SVGs with `cd design/icon-tools && mkdir -p /tmp/icon && python3 gen.py cfg.json /tmp/icon` and copy `cowdrey-md.svg`, `cowdrey-md-32.svg` and `cowdrey-md-16.svg` to `design/icon.svg`, `icon-32.svg` and `icon-16.svg`, and `cowdrey-md-android.svg`, `-android-foreground`, `-background` and `-monochrome` to `design/android/icon-source.svg`, `icon-foreground.svg`, `icon-background.svg` and `icon-monochrome.svg` (needs `pip install uharfbuzz fonttools`; `IS700.ttf` is Instrument Sans fixed at weight 700). It prints the clearance of the letters from the ring and the end caps; keep both at 50 units or more, except the end-cap clearance of the 32 px master, where about 43 is accepted.

The PNGs in `desktop/src-tauri/icons` are rendered from these SVGs:

- `icon.png`, `32x32.png`, `64x64.png`, `128x128.png`, `128x128@2x.png`, `icon.icns` (all ten slots) and `icon.ico` (16–256): the macOS grid, which is the artwork at 824 px placed at (100, 100) with corner radius 185 and a soft shadow (y +8, blur 12, 35 %) in the transparent margin. 16 and 32 px slots use the small masters.
- `ios-source.png`: 1024 opaque RGB, full-bleed (iOS rounds the corners).
- `android-source.png`: 1024 opaque RGB with the mark in the safe zone; `android-monochrome.png`: the themed-icon layer the Android workflow adds.
- `about-icon.png`: 144 px full-bleed, embedded by `build.py` for the About box, title bar and share sheet, and as the web app's home-screen icon. The favicon is `64x64.png`.
