"""web/parts/* -> web/template.html (build.py then inlines analysis.js + chord vocab)"""
from pathlib import Path
d = Path(__file__).parent / 'parts'
P = lambda n: (d / n).read_text()
js = ''.join(P(n) for n in ['js_top.js', 'js_core.js', 'js_song.js', 'js_sheet.js', 'js_lyrics.js', 'js_export.js', 'js_edit.js', 'js_store.js', 'js_live.js', 'js_score.js', 'js_simple.js', 'js_controls.js'])
(Path(__file__).parent / 'template.html').write_text(P('head.html') + '<script>\n' + js + '</script>\n</body>\n</html>\n')
