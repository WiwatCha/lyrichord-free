# Lyrichord Free

**แกะคอร์ด คีย์ ทำนอง และเนื้อร้องจากไฟล์เพลง แล้วเล่นตาม ซ้อม ขึ้นเวที และส่งออก ทำงานในเครื่องของคุณ แจกฟรีและเปิดซอร์สโค้ด**
**Chords, key, melody and lyrics from a song file, then play along, practise, perform and export. Runs on your own computer. Free and open source.**

แจกจ่ายด้วยความตั้งใจให้เป็นประโยชน์กับพี่น้องคริสเตียนและทุกคนที่รักดนตรี
Given freely, for our brothers and sisters in Christ and for everyone who loves music.

## ดาวน์โหลด · Download

ไปที่หน้า **[Releases](../../releases)** แล้วเลือกไฟล์ของเครื่องคุณ
Go to **[Releases](../../releases)** and pick the file for your computer:

- Mac (Apple Silicon): `LyrichordFree-<version>-mac-arm64.dmg`
- Windows 10/11 (64-bit): `LyrichordFree-Setup-<version>.exe`

วิธีติดตั้ง และทำไมเครื่องถึงเตือนตอนติดตั้ง: **[docs/INSTALL-free.md](docs/INSTALL-free.md)**
How to install, and why your computer shows a warning: **[docs/INSTALL-free.md](docs/INSTALL-free.md)**

## ทำอะไรได้ · What it does

- **แกะเพลง** จากไฟล์เพลง ไมค์ หรือเสียงจากแท็บ: คอร์ดทุกจังหวะ คีย์ BPM ห้องเพลง ทำนอง และเนื้อร้องพร้อมเวลา (แผ่นโน้ตขึ้นก่อน ~30–40 วินาที เนื้อร้องตามมา)
- **คอร์ด 3 ระดับ** พื้นฐาน / มาตรฐาน / ละเอียด · เลขโรมัน · เปลี่ยนคีย์ · **แนะนำคาโป้** สำหรับกีตาร์ · รูปจับเปียโน/กีตาร์
- **แก้บนแผ่นโน้ต**: แตะคอร์ดเพื่อเปลี่ยน (มี AI แนะนำ), แตะสองครั้งแก้เนื้อร้อง, ลากวาง, ย้อนกลับ · นำเข้าเนื้อร้องจากไฟล์หรือรูปภาพ (OCR)
- **เล่นตามเพลง**: คอร์ด เนื้อร้อง ทำนอง เลื่อนตามจังหวะ · เล่นช้า 50/75% · วนท่อน
- **โหมดเวที + เซ็ตเพลง**: ตัวใหญ่ เลื่อนหน้าด้วยแป้นเหยียบ Bluetooth จบเพลงแล้วไปเพลงถัดไปเอง
- **คลังเพลง** เก็บเพลงที่แกะแล้วพร้อมทุกอย่างที่แก้
- **ส่งออก** PDF, PowerPoint (แก้ต่อได้), MusicXML (MuseScore), MIDI
- **ใช้บนมือถือ / iPad / Android** ผ่าน Wi-Fi วงเดียวกัน (สแกน QR ไม่ต้องใช้อินเทอร์เน็ต)
- ภาษาไทย / English

- **Analyse** a song file, the microphone or a browser tab: chords on every beat, key, BPM, bars, melody, and timed lyrics (the sheet first in ~30–40 s, the words follow)
- **Three chord levels**, Roman numerals, transpose, **capo suggestions** for guitar, piano / guitar shapes
- **Edit on the sheet**: tap a chord (with AI suggestions), double-tap lyrics, drag and drop, undo · import lyrics from files or pictures (OCR)
- **Play along**: chords, lyrics and melody moving with the beat · 50 / 75% speed · loop a row
- **Stage mode and setlists**: big text, page turns with a Bluetooth pedal, the next song comes up by itself
- **Library** of every song you analysed, with your edits
- **Export** PDF, PowerPoint (editable), MusicXML (MuseScore), MIDI
- **Phones, iPad and Android** on the same Wi-Fi: scan a QR code, no internet needed

## ความเป็นส่วนตัวและลิขสิทธิ์ · Privacy and copyright

เพลงและทุกอย่างที่คุณแก้ อยู่ในเครื่องของคุณเท่านั้น ไม่มีบัญชีผู้ใช้ ไม่เก็บสถิติ ไม่มีโฆษณา
ใช้กับเพลงที่คุณมีสิทธิ์ใช้ อย่าเผยแพร่หรือขายคอร์ดและเนื้อร้องของเพลงที่มีลิขสิทธิ์ การใช้ในพิธีนมัสการหรือฉายบนจอ ควรมีใบอนุญาตที่เหมาะสม (เช่น CCLI)

Your songs and edits stay on your computer: no accounts, no tracking, no ads.
Use songs you have the right to use; don't publish or sell copyrighted chords and lyrics. For worship services or projection, have the right licence (e.g. CCLI).

## ทำงานอย่างไร · How it works

```
song file ─► Demucs (vocals / bass / drums / other) ─► Beat This! (beats, bars) ─► Basic Pitch (notes)
          ─► BTC (chords) ─► key ─► RMVPE (sung melody) ─► sheet shown
          ─► Whisper (lyrics, in the background)
```

Everything runs on your computer (Python + PyTorch, FastAPI backend, a single-file web page). Credits and licences: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## สำหรับนักพัฒนา · For developers

```bash
cd backend && python3.11 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt && pip install --no-deps basic-pitch==0.4.0
pip install -r requirements-whisper.txt
pip install torch==2.5.1 torchaudio==2.5.1 && pip install -r requirements-demucs.txt
pip install --no-deps beat-this==1.1.0 && pip install einops rotary-embedding-torch soxr
python ../desktop/fetch_models.py data/models --no-dereverb      # all models, once (~1 GB)
M=$PWD/data/models
BTC_DIR=$M/btc OCR_MODEL_DIR=$M/ppocr BEAT_THIS_CKPT=$M/beat_this-final0.ckpt TORCH_HOME=$M/torch \
  WHISPER_MODEL=$M/whisper-small LYRICORD_EDITION=free HF_HUB_OFFLINE=1 uvicorn app.main:app --port 8000
```

- The web page lives in `web/parts/`; `python3 build.py --edition free` assembles `backend/web/index.html` (needs Node; checks every Thai string has English in `web/i18n/en.json`).
- Tests: `PYTHONPATH=backend python3 tests/test_guards.py`, `node tests/js_test.js`, `node tests/levels_test.js`.
- Installers: GitHub Actions (`.github/workflows/desktop.yml`) builds the Mac and Windows installers when a tag `free-v<version>` is pushed.

ยินดีรับการช่วยพัฒนา: เปิด Issue หรือส่ง Pull Request ได้เลย
Contributions are welcome: open an issue or a pull request.

## License

[MIT](LICENSE) © 2026 Lyrichord contributors
