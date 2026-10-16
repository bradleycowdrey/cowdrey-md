# Cowdrey.md

A Markdown editor by **Bradley Cowdrey** · [bradcowdrey.com](https://bradcowdrey.com)

It combines MacDown's side-by-side writing, a Google Docs-style title bar, menus and paper page, and a Microsoft Word-style ribbon, ruler and status bar. It is one self-contained web page with no build server and no backend.

## Features

**Writing**
- Syntax-highlighted Markdown source (CodeMirror) with spell check, auto-closing brackets, and lists that continue and renumber on Enter
- Word-style ribbon (Home, Insert, Layout, View) with a Styles gallery (Normal, Heading 1–4, Quote, Code)
- Docs-style menus (File, Edit, View, Insert, Format, Tools, Help) and keyboard shortcuts that match Google Docs where possible
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
- Open `.md` files, paste as a new document, download `.md` or a standalone `.html`, copy Markdown or HTML, or **Copy for Google Docs or Word** (rich text)
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

## Hosting on bradcowdrey.com

`index.html` is static. Serve it from any web host, or turn on GitHub Pages for this repository (Settings → Pages → deploy from the `main` branch, root folder), then point a subdomain such as `md.bradcowdrey.com` at it. The app runs at `https://bc101101.github.io/cowdrey-md/` once Pages is on.

## Credits

Built with CodeMirror 5, markdown-it, highlight.js, MathJax 3, Mermaid, DOMPurify and Lucide icons. Feature ideas came from studying the open-source editors MacDown, MarkText, Zettlr, StackEdit, Dillinger and ghostwriter, along with Markdot.

## License

MIT © Bradley Cowdrey. See [LICENSE](LICENSE).
