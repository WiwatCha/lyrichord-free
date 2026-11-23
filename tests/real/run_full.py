"""Full backend analysis of the real songs with the current engine settings, scored against the bass-checked
references. USE_BTC / USE_BEAT_THIS env vars switch the models. PYTHONPATH=backend[:torch site-packages]"""
import json, os, sys, tempfile, time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
import eval_real as ER
from app import pipeline as PL
WIN = {'fl': ('fl_ref2.json', 17, 100, 'first_love_sheet.txt'), 'fm': ('fm_ref.json', 31, 175, 'fly_me_chordtabs.txt')}
tag = sys.argv[1] if len(sys.argv) > 1 else 'run'
for n in ('fl', 'fm'):
    t = time.time(); r = PL.analyze_file(Path(f'/tmp/real/{n}.mp3'), Path(tempfile.mkdtemp()), lambda s, p: None)
    json.dump(r, open(f'/tmp/real/out/{n}_{tag}.json', 'w'))
    f, a, b, sheet = WIN[n]; R = json.load(open('/tmp/real/out/' + f))
    acc = ER.ref_accuracy_time(r, R, a, b); hits = ER.bar_hits_time(r, R, a, b); e = ER.evaluate(r, ER.sheet_chords(Path(__file__).parent / sheet), 0)
    print(f"{tag:10} {n}: engine {r.get('chord_engine')} beats {r['meter']['source']} bpm {r['bpm']} | REF {acc['ref_fam']:.2f} root {acc['ref_root']:.2f} | ref changes by beat-in-bar {hits} | pal {e['palette']:.2f} rec {e['seq_recall']:.2f} chg {e['changes']} | {time.time()-t:.0f}s", flush=True)
