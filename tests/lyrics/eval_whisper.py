"""Whisper small vs Thonburian medium on vocal stems (raw / de-reverbed), temperature 0, LCS lyric recall.
Also records the transcript's own confidence (mean word probability) to test picking raw vs dry by confidence."""
import sys, json, time, librosa, numpy as np
sys.path.insert(0, __import__('os').path.dirname(__file__))
from lcs import lcs_recall
from faster_whisper import WhisperModel
name, path = sys.argv[1], sys.argv[2]
model = WhisperModel(path, device='cpu', compute_type='int8')
out = {}
for job in sys.argv[3:]:
    song, meth, kind = job.split('/')
    ref = open(f'/tmp/mel/{song}_ref.txt').read().replace(' ', '').replace('\n', '')
    y, _ = librosa.load(f'/tmp/mel/sep2/{song}/{meth}/{"vocals.wav" if kind == "raw" else "vocals_dry.wav"}', sr=16000, mono=True)
    t = time.time()
    __import__('ctranslate2').set_random_seed(0); segs, info = model.transcribe(y, language='th', vad_filter=True, condition_on_previous_text=False, temperature=[0.0, 0.2, 0.4], no_speech_threshold=0.6,
                                  word_timestamps=True, hallucination_silence_threshold=2.0)
    segs = list(segs)
    txt = ''.join(s.text for s in segs)
    words = [w for s in segs for w in (s.words or [])]
    r = {'lyrics': lcs_recall(ref, txt.replace(' ', '')), 'sec': round(time.time() - t), 'words': len(words),
         'conf': round(float(np.mean([w.probability for w in words])), 3) if words else 0,
         'logprob': round(float(np.mean([s.avg_logprob for s in segs])), 3) if segs else -9}
    out[job] = r
    print(name, job, json.dumps(r), flush=True)
    json.dump({'text': txt}, open(f'/tmp/mel/tx_{name}_{song}_{meth}_{kind}.json', 'w'), ensure_ascii=False)
