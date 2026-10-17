# Cowdrey.MD

A Markdown editor by **Bradley Cowdrey** · [bradcowdrey.com](https://bradcowdrey.com)

It combines MacDown's side-by-side writing, a Docs-style title bar, menus and paper page, and a Word-style ribbon, ruler and status bar. It is one self-contained web page with no build server and no backend.

### [⬇ Download for Mac](https://github.com/bradleycowdrey/cowdrey-md/releases/latest/download/Cowdrey.MD.dmg) · [Open in your browser](https://bradleycowdrey.github.io/cowdrey-md/)

**Free. Forever.** The Mac download is a `.dmg` for Apple silicon and Intel Macs: open it and drag Cowdrey.MD into Applications. The first time, macOS asks for confirmation; open **System Settings → Privacy & Security** and click **Open Anyway**. After that, the app keeps itself up to date.

[![Latest release](https://img.shields.io/github/v/release/bradleycowdrey/cowdrey-md?label=latest%20version)](https://github.com/bradleycowdrey/cowdrey-md/releases/latest)

## Features

**Writing**
- Syntax-highlighted Markdown source (CodeMirror) with spell check, auto-closing brackets, and lists that continue and renumber on Enter
- Word-style ribbon (Home, Insert, Layout, View) with a Styles gallery (Normal, Heading 1–4, Quote, Code)
- Docs-style menus (File, Edit, View, Insert, Format, Tools, Help) and keyboard shortcuts that match Docs where possible
- Find and replace with match case and regular expressions
- Table picker grid, plus **Tidy table** to realign pipes
- Paste or drop pictures (large ones are downscaled automatically); paste a URL over selected text to make a link
- Focus mode, typewriter mode, line numbers, word wrap, four editor themes (including a MacDown-style Night theme)

**Preview**
- Paper page on a canvas with Letter / A4 / Wide / Fluid sizes, margins, page-break guides, a ruler in inches or cm, and zoom
- Page styles: Cowdrey, GitHub, Clearness, Solarized, Manuscript
- GitHub Flavored Markdown: tables, task lists (tick them in the preview), strikethrough, autolinks
- Callouts (`> [!NOTE]`, `TIP`, `IMPORTANT`, `WARNING`, `CAUTION`), footnotes, definition lists, ==highlight==, sub/superscript, emoji shortcodes, front matter, `[TOC]`
- LaTeX math (MathJax), Mermaid diagrams, and highlighted code with copy buttons
- Scroll sync between source and preview based on source-line anchors; double-click the preview to jump to the source

**Documents**
- Multiple documents with tabs, a Recent documents list, and an outline of headings
- Autosaves to the browser's local storage
- Open `.md` files, paste as a new document, download `.md` or a standalone `.html`, copy Markdown or HTML, or **Copy for Docs or Word** (rich text)
- Word count dialog with reading and speaking time and a Flesch reading-ease score

## Project layout

```
src/template.html   page markup, styles, welcome document, library tags
src/app.js          the application
src/codemirror.css  CodeMirror 5 base styles (inlined at build time)
build.py            assembles index.html
index.html          the built, single-file app (open it or host it anywhere)
```

Build:

```sh
python3 build.py
```

## Tests

`tests/e2e.mjs` drives the real app in Chromium through 48 scenarios: editing commands, lists, find and replace, tables, pictures, attempted script injection, math and diagrams, documents across browser tabs, persistence, export, clipboard, sync scroll, zoom, themes, phone layout, accessibility names and large-document speed. GitHub Actions runs it on every push (`.github/workflows/tests.yml`).

```sh
(cd desktop && npm ci) && npm install --no-save playwright && npx playwright install chromium
node tests/e2e.mjs
```

## Hosting on bradcowdrey.com

`index.html` is static. Serve it from any web host, or turn on GitHub Pages for this repository (Settings → Pages → deploy from the `main` branch, root folder), then point a subdomain such as `md.bradcowdrey.com` at it. The app runs at `https://bradleycowdrey.github.io/cowdrey-md/` once Pages is on.

## Mac app

Download the latest `.dmg` from [Releases](https://github.com/bradleycowdrey/cowdrey-md/releases/latest). It runs on Apple silicon and Intel Macs and works offline.

The Mac app checks for a newer release once a day (and from **Help → Check for updates…**). With update signing set up, **Install and restart** downloads the signed update, saves your work, replaces the app and reopens it; otherwise it offers the new DMG. Without that secret, `node desktop/sign-update.mjs <private-key> "<notes>"` signs the released bundle and writes `updates/latest.json`; pushing it publishes the update. Automatic signing needs one repository secret, `TAURI_SIGNING_PRIVATE_KEY`, holding the private key that matches the public key in `desktop/src-tauri/tauri.conf.json`. The DMG is built by GitHub Actions (`.github/workflows/mac-app.yml`) whenever the version in `desktop/src-tauri/tauri.conf.json` changes on `main`, a tag such as `v1.0.1` is pushed, or the workflow is run by hand. The `desktop/` folder wraps `index.html` with [Tauri](https://tauri.app) and copies every library in, so nothing loads from the internet. Until the build is signed and notarized with an Apple Developer ID, macOS asks for confirmation the first time: right-click the app and choose **Open**.

## Fonts

Instrument Sans, JetBrains Mono, Source Serif 4 and Tinos are bundled in `fonts/` and embedded into `index.html` at build time, so the app never loads fonts from an outside service and works fully offline. Each font is under the SIL Open Font License; its license file sits next to it.

## Credits

Built with CodeMirror 5, markdown-it, highlight.js, MathJax 3, Mermaid, DOMPurify and Lucide icons. Feature ideas came from studying the open-source editors MacDown, MarkText, Zettlr, StackEdit, Dillinger and ghostwriter, along with Markdot.

## License

MIT © Bradley Cowdrey. See [LICENSE](LICENSE).
