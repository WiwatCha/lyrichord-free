# Lean image: no system ffmpeg (PyAV decodes audio), CPU-only torch, models baked in, runs fully offline.
FROM python:3.11-slim
ENV PYTHONDONTWRITEBYTECODE=1 PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app
COPY requirements*.txt ./
RUN pip install -r requirements.txt \
 && pip install --no-deps basic-pitch==0.4.0 \
 && python -c "import basic_pitch, pathlib, shutil; d=pathlib.Path(basic_pitch.__file__).parent/'saved_models'/'icassp_2022'; [shutil.rmtree(p) if p.is_dir() else p.unlink() for p in d.iterdir() if p.name!='nmp.onnx']" \
 && find /usr/local/lib/python3.11/site-packages -type d \( -name tests -o -name test \) -path "*/scipy/*" -prune -exec rm -rf {} + \
 && find /usr/local/lib/python3.11/site-packages -name "*.pyc" -delete

# Lyrics timing with Whisper (--build-arg WITH_WHISPER=0 to skip).
# small is enough: the app only needs Whisper's TIMING to place lyrics you import from the web.
ARG WITH_WHISPER=1
ARG WHISPER_MODEL=small
RUN if [ "$WITH_WHISPER" = "1" ]; then \
      pip install -r requirements-whisper.txt \
   && python -c "from faster_whisper import WhisperModel; WhisperModel('${WHISPER_MODEL}', device='cpu', compute_type='int8')"; \
    fi

# Vocal separation with Demucs (--build-arg WITH_DEMUCS=0 to skip, saves ~900 MB)
ARG WITH_DEMUCS=1
RUN if [ "$WITH_DEMUCS" = "1" ]; then \
      pip install torch==2.5.1 torchaudio==2.5.1 --index-url https://download.pytorch.org/whl/cpu \
   && pip install -r requirements-demucs.txt \
   && python -c "from demucs.pretrained import get_model; get_model('htdemucs')"; \
    fi

# Beats + downbeats with Beat This! (ISMIR 2024, MIT licence; --build-arg WITH_BEATS=0 to skip, ~80 MB + torch).
# Never fatal: if the model cannot be downloaded or fails its self-test, the app uses its built-in beat tracker.
ARG WITH_BEATS=1
RUN if [ "$WITH_BEATS" = "1" ]; then \
      (python -c "import torch, torchaudio" 2>/dev/null || pip install torch==2.5.1 torchaudio==2.5.1 --index-url https://download.pytorch.org/whl/cpu) \
   && pip install --no-deps beat-this==1.1.0 \
   && pip install einops rotary-embedding-torch soxr \
   && mkdir -p /opt/models \
   && (python -c "from beat_this.inference import load_model; load_model('final0')" \
       && cp /root/.cache/torch/hub/checkpoints/beat_this-final0.ckpt /opt/models/ \
       && python -c "import numpy as np; from beat_this.inference import Audio2Beats; m = Audio2Beats('/opt/models/beat_this-final0.ckpt', 'cpu'); b, d = m(np.random.default_rng(0).standard_normal(22050 * 8) * 0.1, 22050); print('beat_this ok', len(b), len(d))" \
       || (rm -f /opt/models/beat_this-final0.ckpt; echo "WARNING: Beat This! not installed, using the built-in beat tracker")) \
   && rm -rf /root/.cache/torch; \
    fi

# Chords with BTC, a learned chord model (ISMIR 2019, MIT licence; --build-arg WITH_BTC=0 to skip, ~24 MB + torch).
# Weights are fetched at build time; if that fails the app keeps its template chord decoder.
ARG WITH_BTC=1
RUN if [ "$WITH_BTC" = "1" ]; then \
      (python -c "import torch" 2>/dev/null || pip install torch==2.5.1 --index-url https://download.pytorch.org/whl/cpu) \
   && mkdir -p /opt/models/btc \
   && (python -c "import urllib.request as u; H='https://huggingface.co/puar-playground/btc-chord/resolve/main/'; \
[u.urlretrieve(H+f, '/opt/models/btc/'+f) for f in ('btc_model.pt', 'btc_model_large_voca.pt')]" \
       || (rm -rf /opt/models/btc; echo "WARNING: BTC chord model not installed, using the template decoder")); \
    fi

# Sung melody: RMVPE vocal pitch (MIT, 181 MB, needs torch); without it the app uses Basic Pitch for the melody.
RUN if python -c "import torch" 2>/dev/null; then \
      mkdir -p /opt/models && python -c "import hashlib, urllib.request as u; f='/opt/models/rmvpe.pt'; u.urlretrieve('https://huggingface.co/lj1995/VoiceConversionWebUI/resolve/main/rmvpe.pt', f); \
assert hashlib.sha256(open(f,'rb').read()).hexdigest() == '6d62215f4306e3ca278246188607209f09af3dc77ed4232efdd069798c4ec193'" \
      || (rm -f /opt/models/rmvpe.pt; echo "WARNING: RMVPE not installed, Basic Pitch melody"); \
    fi

# OCR for lyric / chord-sheet pictures: PaddleOCR PP-OCRv5 (mobile detector + Thai recogniser, which also reads
# English and chord symbols best in our tests) as ONNX, run on onnxruntime. ~13 MB, no PaddlePaddle needed.
ARG WITH_OCR=1
RUN if [ "$WITH_OCR" = "1" ]; then \
      pip install pyyaml && mkdir -p /opt/models/ppocr && cd /opt/models/ppocr \
   && python -c "import urllib.request as u, yaml; H='https://huggingface.co/PaddlePaddle/'; \
u.urlretrieve(H+'PP-OCRv5_mobile_det_onnx/resolve/main/inference.onnx', 'PP-OCRv5_mobile_det.onnx'); \
u.urlretrieve(H+'th_PP-OCRv5_mobile_rec_onnx/resolve/main/inference.onnx', 'th_PP-OCRv5_mobile_rec.onnx'); \
y = yaml.safe_load(u.urlopen(H+'th_PP-OCRv5_mobile_rec_onnx/resolve/main/inference.yml')); \
open('th_dict.txt', 'w', encoding='utf-8').write(chr(10).join(y['PostProcess']['character_dict']))" \
   || (rm -rf /opt/models/ppocr; echo "WARNING: OCR models not installed"); \
    fi

# De-echo / de-reverb of the vocal stem before Whisper (UVR model by FoxJoy via audio-separator; ~220 MB).
# --build-arg WITH_DEREVERB=0 to skip. Needs torch (installed with Demucs / BTC above).
ARG WITH_DEREVERB=0
RUN if [ "$WITH_DEREVERB" = "1" ] && python -c "import torch" 2>/dev/null; then \
      pip install --no-deps audio-separator==0.48.0 && pip install audioread pydub pyyaml requests tqdm samplerate \
   && mkdir -p /opt/models/uvr \
   && (python -c "from audio_separator.separator import Separator as S; S.check_ffmpeg_installed = lambda self: None; S(model_file_dir='/opt/models/uvr', output_dir='/tmp', log_level=40).load_model('UVR-DeEcho-DeReverb.pth')" \
       || (rm -rf /opt/models/uvr; echo "WARNING: de-reverb model not installed")); \
    fi
# Thai lyrics: Thonburian Whisper medium (~1.5 GB) is fetched into /data/models the first time a Thai song needs it.
# --build-arg WITH_TH_WHISPER=1 puts it in the image instead (works offline from the start).
ARG WITH_TH_WHISPER=0
RUN if [ "$WITH_TH_WHISPER" = "1" ]; then \
      mkdir -p /opt/models/whisper-th-medium && cd /opt/models/whisper-th-medium \
   && python -c "import urllib.request as u; [u.urlretrieve(f'https://huggingface.co/{r}/resolve/main/{f}', f) for r, fs in (('Thaweewat/whisper-th-medium-ct2', ('config.json', 'vocabulary.json', 'model.bin')), ('Systran/faster-whisper-medium', ('tokenizer.json', 'preprocessor_config.json'))) for f in fs]"; \
    fi

COPY app ./app
COPY web ./web
COPY VERSION ./VERSION
# self-test of the chord model on noise, against the app's own code; drop the weights if it fails
RUN if [ -d /opt/models/btc ]; then \
      python -c "import numpy as np; from app import chordnet as C; assert C.available(); y = np.random.default_rng(0).standard_normal(22050 * 12).astype('float32') * 0.1; s, l = C.beat_log_probs(y, 22050, np.arange(0.5, 11, 0.5), 12.0); print('btc ok', s.shape, l.shape)" \
      || (rm -rf /opt/models/btc; echo "WARNING: BTC self-test failed, using the template decoder"); \
    fi
# models are inside the image now: never reach out to the internet for them
ENV LYRICORD_EDITION=free DATA_DIR=/data USE_DEMUCS=${WITH_DEMUCS} USE_WHISPER=${WITH_WHISPER} WHISPER_MODEL=${WHISPER_MODEL} \
    HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 ALLOW_MODEL_FETCH=1 UVR_MODEL_DIR=/opt/models/uvr
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
