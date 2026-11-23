# Third-party software and models

Lyrichord is MIT-licensed. It is built on the open-source software and models below, each under its own licence.
The installers also contain each Python package's own licence file (inside `python/.../site-packages/*.dist-info`).
Thank you to everyone who made them.

## AI models (downloaded when the app is built, shipped inside the installer)

| Component | Used for | Licence | Source |
|---|---|---|---|
| Demucs (htdemucs), Meta Platforms, Inc. | separating vocals, bass, drums | MIT | https://github.com/facebookresearch/demucs |
| Beat This! (final0), CPJKU / JKU Linz | beats and downbeats | MIT | https://github.com/CPJKU/beat_this |
| BTC – Bi-directional Transformer for Chord recognition (Park et al., ISMIR 2019) | chords | MIT | https://github.com/jayg996/BTC-ISMIR19 (code in `backend/app/btc`) |
| Basic Pitch, Spotify AB | note detection | Apache-2.0 | https://github.com/spotify/basic-pitch |
| RMVPE (Wei et al. 2023); weights from RVC-Project | sung melody | weights MIT (RVC-Project), original code Apache-2.0 | https://github.com/Dream-High/RMVPE · https://huggingface.co/lj1995/VoiceConversionWebUI |
| Whisper small (OpenAI) via faster-whisper (SYSTRAN) | lyrics | MIT | https://github.com/openai/whisper · https://github.com/SYSTRAN/faster-whisper |
| PaddleOCR PP-OCRv5 (Baidu) | reading lyrics / chords from pictures | Apache-2.0 | https://github.com/PaddlePaddle/PaddleOCR |

**Not in Lyrichord Free:** the UVR DeEcho-DeReverb model (its licence is not stated clearly) and YouTube download (yt-dlp is not used, because of YouTube's terms of service).

## Libraries

| Component | Licence | Source |
|---|---|---|
| PyTorch, torchaudio | BSD-3-Clause | https://pytorch.org |
| NumPy, SciPy | BSD-3-Clause | https://numpy.org · https://scipy.org |
| librosa | ISC | https://librosa.org |
| FastAPI, Starlette, Uvicorn, Pydantic | MIT / BSD-3-Clause | https://fastapi.tiangolo.com |
| CTranslate2 | MIT | https://github.com/OpenNMT/CTranslate2 |
| ONNX Runtime | MIT | https://onnxruntime.ai |
| PyAV | BSD-3-Clause | https://github.com/PyAV-Org/PyAV |
| soundfile (libsndfile) | BSD-3-Clause / LGPL-2.1 | https://github.com/bastibe/python-soundfile |
| segno (QR codes) | BSD-3-Clause | https://github.com/heuer/segno |
| PptxGenJS (PowerPoint export, in the web page) | MIT | https://github.com/gitbrent/PptxGenJS |
| Python (python-build-standalone) | PSF License | https://www.python.org · https://github.com/astral-sh/python-build-standalone |

## Fonts

| Font | Licence | Source |
|---|---|---|
| Bai Jamjuree (Cadson Demak) | SIL Open Font License 1.1 | https://fonts.google.com/specimen/Bai+Jamjuree |
| IBM Plex Sans Thai (IBM) | SIL Open Font License 1.1 | https://fonts.google.com/specimen/IBM+Plex+Sans+Thai |

## The standard licence texts

- MIT: https://opensource.org/license/mit
- Apache-2.0: https://www.apache.org/licenses/LICENSE-2.0
- BSD-3-Clause: https://opensource.org/license/bsd-3-clause
- ISC: https://opensource.org/license/isc-license-txt
- SIL OFL 1.1: https://openfontlicense.org
