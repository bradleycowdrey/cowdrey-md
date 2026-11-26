# Cowdrey family App Store screenshot standard

Every Cowdrey app (Cowdrey One, Cowdrey.PDF, Cowdrey.MD, Meridian, Two Degrees and Bearings) uses this one standard for its App Store screenshots. Each frame puts the real app on the app's own catalog sky, under an eyebrow, a Fraunces headline and a one-line subhead set in **Cowdrey One's type scale**. The look comes from Bearings' approved framed screenshots (`bearings/scripts/store-frames.js`, `ci-appstore` branch). Only the sky colour and the words change from app to app. Fonts, sizes, positions and device frames are the same for every app.

The compositor `store-frames/store-frames.js` implements this file exactly. It also measures every frame it writes (`<app>/measure.json`) and stops with an error if copy does not fit, so the type is never shrunk to fit.

## 1. Canvases

| Device | Canvas (px) | Store scale | Needed |
|---|---|---|---|
| iPhone 6.9" | **1320 x 2868** | x3 (the iPhone's own @3x) | every app |
| iPad 13" | **2064 x 2752** | x4 | every app with an iPad listing |
| Mac | **2880 x 1800** | x3 | only apps with a Mac App Store listing (a `macappstore` link in the catalog, or a Mac listing in the repo) |

Output: opaque RGB PNG with no alpha channel, as App Store Connect requires.

The *store scale* turns Cowdrey One's point sizes into canvas pixels. The iPhone uses x3, its native density. The iPad uses x4, so the headline takes about the same share of the thumbnail as it does on iPhone (x2 would make it tiny on a 2064-wide canvas). The Mac uses x3.

## 2. Type scale: Cowdrey One's points x store scale

The source is `cowdrey-one/web/app.css`.

| Role | Cowdrey One source | Font | Weight | Size (pt) | iPhone px | iPad px | Mac px | Line height | Tracking | Case | Max lines | Colour |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Eyebrow | `.eyebrow` (13px 600, uppercase, +.02em) | Inter SemiBold (Cowdrey One's system sans) | 600 | 13 | **39** | **52** | **39** | 1.0 | +0.02em (0.78 / 1.04 / 0.78 px) | UPPERCASE | 1 | `rgba(255,255,255,.78)` (`.feature-top .eyebrow`) |
| Headline | `.large-title` (Fraunces 560 36px/1.05, -.015em) | Fraunces (variable, opsz 72) | 560 | 36 | **108** | **144** | **108** | 1.05 (113.4 / 151.2 / 113.4 px) | -0.015em (-1.62 / -2.16 / -1.62 px) | Sentence case | iPhone **exactly 2**; iPad and Mac **1** | `#FFFFFF` |
| Subhead | body 17px, the weight of `.feature-bar b` | Inter SemiBold | 600 | 17 | **51** | **68** | **51** | 1.2 | -0.01em (-0.51 / -0.68 / -0.51 px) | Sentence case | 1 | `rgba(255,255,255,.92)` |

All text is centred. The sans is Inter (OFL, bundled), which stands in for Cowdrey One's `-apple-system / SF Pro` stack. SF Pro cannot be bundled, and a fixed font keeps renders the same on any machine.

## 3. Text block: margins and position

| | iPhone | iPad | Mac |
|---|---|---|---|
| Side margin (text block) | 70 px | 140 px | 200 px |
| Text block top (eyebrow line box) | 150 | 160 | 110 |
| Eyebrow to headline gap | 24 | 32 | 24 |
| Headline to subhead gap | 30 | 36 | 26 |
| **Measured** eyebrow baseline | **184** | **204** | **144** |
| **Measured** headline top (line box) | **213** | **244** | **173** |
| **Measured** subhead bottom | **531** | **513** | **374** |
| Device top | **640** | **600** | **470** |

On the iPhone the headline is always two lines, so every iPhone frame has the same block height and the device always starts at 640. On the iPad and the Mac the headline is one line.

## 4. Device frames

**iPhone 6.9"**
- Body: 1024 px wide (**77.6% of the canvas**), centred, top 640, height 2138 (bottom at 2778).
- Body colour: titanium, `linear-gradient(135deg, #8a8d93 0%, #43464b 14%, #26282c 45%, #2e3034 70%, #55585e 88%, #9a9da3 100%)`.
- Rim 11 px (1.1% of the body), then a black bezel (`#000`) with a faint 2 px inner line `rgba(255,255,255,.07)`.
- Screen inset 37 px (3.6% of the body). Screen 950 x 2064, which is the 1320:2868 shape. Each capture is fitted to this shape, so every iPhone is the same size.
- Screen corner radius 62 pt (133.9 px). Body corner radius 171 px.
- Dynamic Island: 126 x 37.33 pt (272 x 81 px at frame scale), 11 pt (24 px) below the screen top, fully round, black, with a lens dot.
- Buttons: Action, volume up and down on the left; side button and Camera Control on the right. Graphite gradient, drawn 0.65% outside the body.
- Shadow: `0 72px 133px rgba(3,9,22,.5), 0 12px 31px rgba(3,9,22,.32)`.

**iPad 13"**
- Body 1560 px wide (**75.6%**), centred, top 600, height 2049 (bottom at 2649).
- Same titanium body. Rim 10 px (0.65%), screen inset 47 px (3%), screen 1466 x 1955.
- Screen radius 18 pt (25.6 px). Front camera dot on the right bezel. Top button and volume buttons.

**Mac**
- A plain macOS window 1840 px wide (**63.9%**), centred, top 470.
- Title bar 56 px, `#24272E`, with traffic lights and the document title in Inter 600 22 px `#C9CED8`.
- Content 1840 x 1150 (16:10). Corner radius 22 px. Same family shadow.

## 5. Background: the app's catalog sky

- Colours: the app's `sky: [top, bottom]` from `cowdrey-one/web/catalog.js`. Cowdrey One itself is not in its own catalog, so it uses its icon's clay gradient.
- Direction: **170deg** (`linear-gradient(170deg, top 0%, bottom 100%)`), the same angle as Cowdrey One's app cards and app pages (`.feature`, `.hero`).
- Glow: `radial-gradient(110% 55% at 50% -6%, rgba(255,255,255,.20), transparent 62%)` at the top.
- Floor: `radial-gradient(90% 40% at 50% 106%, rgba(0,0,0,.18), transparent 70%)` at the bottom.

| App | Sky top | Sky bottom |
|---|---|---|
| Cowdrey One | `#C9835B` | `#93512F` |
| Cowdrey.PDF | `#B0234F` | `#5E0A28` |
| Cowdrey.MD | `#4B70E6` | `#1E3BA6` |
| Meridian | `#4A7DB8` | `#16243A` |
| Two Degrees | `#72AAE9` | `#204294` |
| Bearings | `#3D74B0` | `#14243B` |

## 6. Frame count and story

- **iPhone: 5 or 6 frames.** Frame 1 is the app's main screen, and its headline is the app's promise (the catalog `headline` where it fits).
- **iPad: 3 to 5 frames** for the listing. This review renders frame 1 only.
- **Mac: 3 to 5 frames**, where a Mac listing exists.
- Frames are real captures of the current app. Nothing is drawn that the app does not draw.

Optional effects, Bearings' own, available to every app:
- **Lift:** a tile is drawn about 1.2x over its place, and the rest of the screen is dimmed to 50%.
- **Zoom:** the content zooms around a point, and named regions such as buttons and credits stay unzoomed or move.
- **Widgets frame:** real widget renders float on the sky in the device's place.

## 7. Copy rules

- **Eyebrow:** the feature in 1 or 2 words ("Compass", "Fill & sign").
- **Headline:** 2 to 5 words, ending with a full stop, set in Fraunces. On the iPhone it is written as two lines, and the break must not leave a lone word when that can be avoided ("Fill it. / Sign it."). On the iPad and the Mac the two lines are joined into one.
- **Subhead:** one plain sentence, ending with a full stop. It must fit on one line: about 42 characters on the iPhone and 46 on the iPad.
- Plain words, British/US spelling as the app uses it, no exclamation marks, no prices or "best".
- Copy that does not fit is rewritten. It is never set smaller.

## 8. File naming

- Output: `<app-slug>/<device>-<n>-<id>.png`, for example `bearings/iphone-1-compass.png`, `cowdrey-md/ipad-1-split.png` or `cowdrey-md/mac-1-split.png`. `n` is the App Store order, starting at 1. `id` is a short lowercase slug.
- Config: `store-frames/apps/<app-slug>.json`. Raw captures: `captures/<app-slug>/`.
- App slugs: `cowdrey-one`, `cowdrey-pdf`, `cowdrey-md`, `meridian`, `two-degrees`, `bearings`.

## 9. Making the frames

```
cd store-frames
node store-frames.js --config apps/<app>.json        # writes ../<app>/*.png and measure.json
node family-sheets.js                                 # writes ../family-sheet.png and ../type-check.png
node capture-cowdrey-one.js --web <cowdrey-one/web> --out ../captures/cowdrey-one   # Cowdrey One's raw captures
```

Needs Node and Playwright (Chromium). The fonts are in `store-frames/fonts`: Fraunces and Inter, both under the SIL Open Font License, with their licence files.
