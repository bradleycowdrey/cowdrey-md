#!/usr/bin/env python3
"""Assemble the single-file app: src/template.html + src/codemirror.css + src/app.js -> index.html"""
from pathlib import Path
root = Path(__file__).parent
html = (root / 'src/template.html').read_text()
html = html.replace('/*CODEMIRROR_CSS*/', (root / 'src/codemirror.css').read_text())
html = html.replace('/*APP_JS*/', (root / 'src/app.js').read_text())
(root / 'index.html').write_text(html)
print(f'index.html written ({len(html)/1024:.0f} KB)')
