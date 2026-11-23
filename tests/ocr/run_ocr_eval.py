"""OCR accuracy on the test chord sheets (PaddleOCR PP-OCRv5 ONNX in backend/app/ocr.py).
PYTHONPATH=backend OCR_MODEL_DIR=/opt/models/ppocr python3 tests/ocr/run_ocr_eval.py"""
import sys, time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
import ocr_score as S
from app import ocr
HERE = Path(__file__).parent
for n in ('th1', 'th2', 'en1'):
    t = time.time(); L = ocr.read_lines((HERE / f'sheet_{n}.png').read_bytes())
    txt = '\n'.join(' '.join(w['text'] for w in l['words']) for l in L)
    print(n, f'{time.time() - t:.1f}s', S.score(txt, (HERE / f'sheet_{n}.txt').read_text()))
