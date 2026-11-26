import sys, json, math
import uharfbuzz as hb
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen

FONT='IS700.ttf'
tt=TTFont(FONT); gs=tt.getGlyphSet(); order=tt.getGlyphOrder()
hbf=hb.Font(hb.Face(open(FONT,'rb').read()))
CAP=720
# family C, in mark coordinates (identical to Cowdrey One)
CX,CY,R,SW=400,512,282,104
C_PATH='M 609.6 323.3 A 282 282 0 1 0 609.6 700.7'

def shape(text, track):
    buf=hb.Buffer(); buf.add_str(text); buf.guess_segment_properties(); hb.shape(hbf,buf,{'kern':True})
    out=[]; x=0
    for i,(g,p) in enumerate(zip(buf.glyph_infos,buf.glyph_positions)):
        out.append((order[g.codepoint], x+p.x_offset)); x+=p.x_advance+(track if i<len(buf.glyph_infos)-1 else 0)
    return out

def text_path(text, size, track, cx, cy=CY):
    """Outline `text` in Instrument Sans 700, cap-height centred on cy, ink centred on cx."""
    s=size/1000.0
    glyphs=shape(text, track)
    # ink bounds in font units
    xs=[];
    for name,x in glyphs:
        bp=BoundsPen(gs); gs[name].draw(bp); b=bp.bounds
        xs+=[x+b[0], x+b[2]]
    ink0,ink1=min(xs),max(xs)
    ox=cx-(ink0+ink1)/2*s; base=cy+CAP*s/2
    pen=SVGPathPen(gs, ntos=lambda v: ('%.2f'%v).rstrip('0').rstrip('.'))
    for name,x in glyphs:
        tp=TransformPen(pen,(s,0,0,-s,ox+x*s,base)); gs[name].draw(tp)
    box=(ox+ink0*s, cy-CAP*s/2, ox+ink1*s, cy+CAP*s/2)
    return pen.getCommands(), box

def check(box, label, sw=SW):
    x0,y0,x1,y1=box
    inner=R-sw/2
    # left corners: clearance to inner edge of ring
    dl=inner-math.hypot(x0-CX,y0-CY)
    # right corners: clearance to round end caps
    a=math.radians(42); ex,ey=CX+R*math.cos(a),CY-R*math.sin(a)
    # clearance from the end caps (circles at 609.6, 323.3 and 609.6, 700.7), whichever side of them the letters are
    dx=max(x0-609.6, 0, 609.6-x1)
    dc=min(math.hypot(dx,y0-323.3), math.hypot(dx,700.7-y1))-sw/2
    print(f'{label}: ink x {x0:.0f}-{x1:.0f} w {x1-x0:.0f} cap {y1-y0:.0f}  clear-ring {dl:.0f}  clear-cap {dc:.0f}  past-caps {x1-609.6-sw/2:.0f}', file=sys.stderr)

def svg(app, mode='ios', variant=None):
    """mode: ios (full-bleed), fg (android foreground, transparent), bg, mono, android (flattened source).
    variant: None (master), or a dict of overrides for a hand-tuned small size
    (keys: size, track, cx, bold, sw, scale, letters=False for a C-only drawing)."""
    a=dict(app); a.update(variant or {})
    g0,g1=a['grad']; sw=a.get('sw',SW); bold=a.get('bold',0)
    parts=f'<path d="{C_PATH}" fill="none" stroke="#fff" stroke-width="{sw}" stroke-linecap="round"/>'
    if a.get('letters',True):
        d,box=text_path(a['text'],a['size'],a['track'],a['cx'])
        e=bold/2; check((box[0]-e,box[1]-e,box[2]+e,box[3]+e), a['id']+(' '+a['label'] if 'label' in a else ''), sw)
        parts+=f'<path d="{d}" fill="#fff" stroke="#fff" stroke-width="{bold}" stroke-linejoin="miter" stroke-miterlimit="4"/>'
    # Optical anchor: Cowdrey One centres the C (352). With the letters set in the C's opening, centre the whole
    # mark instead: from the C's left edge to whichever is further right, the letters or the end caps.
    anchor=352
    if a.get('letters',True) and a.get('open'):
        e=bold/2; right=max(box[2]+e, 609.6+sw/2); left=CX-R-sw/2
        anchor=(left+right)/2
    base=a.get('scale',0.955)
    scale=base if mode in ('ios',) else base*0.66
    mark=(f'<g id="mark" transform="translate(512 512) scale({scale:g}) translate({-anchor:.1f} -511)">{parts}</g>')
    bg=(f'<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{g0}"/>'
        f'<stop offset="1" stop-color="{g1}"/></linearGradient></defs><rect width="1024" height="1024" fill="url(#g)"/>')
    body={'ios':bg+mark,'android':bg+mark,'fg':mark,'mono':mark,'bg':bg}[mode]
    what={None:'master artwork'}.get(None if not variant else 1, variant.get('label','') if variant else '')
    note=(f'<!-- {a["name"]} app icon, {what}: the Cowdrey family "C" (same arc and stroke as Cowdrey One) '
          f'with "{a["text"]}" set in its opening, like One\'s 1, in Instrument Sans Bold (SIL OFL), converted to outlines. Built by design/icon-tools/gen.py. Layer: {mode}. -->')
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">\n{note}\n{body}\n</svg>\n'

if __name__=='__main__':
    cfg=json.load(open(sys.argv[1])); outdir=sys.argv[2]
    for app in cfg:
        for mode,suf in [('ios',''),('android','-android'),('fg','-android-foreground'),('bg','-android-background'),('mono','-android-monochrome')]:
            open(f'{outdir}/{app["id"]}{suf}.svg','w').write(svg(app,mode))
        for k,v in app.get('variants',{}).items():
            open(f'{outdir}/{app["id"]}-{k}.svg','w').write(svg(app,'ios',dict(v,label=f'{k} px master')))
