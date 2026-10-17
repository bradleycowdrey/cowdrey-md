#!/usr/bin/env python3
"""Assemble the single-file app: src/template.html + src/codemirror.css + fonts/ + src/app.js -> index.html"""
from pathlib import Path
root = Path(__file__).parent
html = (root / 'src/template.html').read_text()
html = html.replace('/*CODEMIRROR_CSS*/', (root / 'src/codemirror.css').read_text())

# Fonts are embedded so the page and the Mac app never fetch them from a font service.
import base64
FACES = [  # family, file, weight, style
    ('Instrument Sans', 'instrument-sans-latin-wght-normal.woff2', '400 700', 'normal'),
    ('JetBrains Mono', 'jetbrains-mono-latin-wght-normal.woff2', '100 800', 'normal'),
    ('JetBrains Mono', 'jetbrains-mono-latin-wght-italic.woff2', '100 800', 'italic'),
    ('Source Serif 4', 'source-serif-4-latin-opsz-normal.woff2', '200 900', 'normal'),
    ('Source Serif 4', 'source-serif-4-latin-opsz-italic.woff2', '200 900', 'italic'),
    ('Tinos', 'tinos-latin-400-normal.woff2', '400', 'normal'),
    ('Tinos', 'tinos-latin-700-normal.woff2', '700', 'normal'),
    ('Tinos', 'tinos-latin-400-italic.woff2', '400', 'italic'),
]
fonts_css = '\n'.join(
    "@font-face { font-family: '%s'; src: url(data:font/woff2;base64,%s) format('woff2'); font-weight: %s; font-style: %s; font-display: swap; }"
    % (fam, base64.b64encode((root / 'fonts' / f).read_bytes()).decode(), w, st)
    for fam, f, w, st in FACES)
html = html.replace('/*FONTS_CSS*/', fonts_css)
html = html.replace('/*APP_JS*/', (root / 'src/app.js').read_text())
# artifact.html: the page body only (for hosts that add their own document wrapper)
(root / 'artifact.html').write_text(html)
# index.html: a complete standards-mode document (GitHub Pages, the Mac app, any web host)
doc = ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
       '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
       '<link rel="icon" href="data:,">\n</head>\n<body>\n' + html + '\n</body>\n</html>\n')
(root / 'index.html').write_text(doc)
print(f'index.html written ({len(doc)/1024:.0f} KB), artifact.html written')
