#!/bin/bash
# Lyricord: dev setup, tests and the PARALLEL_LYRICS benchmark on macOS (Apple Silicon).
#   bash tools/mac_dev.sh setup   # venv + libraries + models (15-25 min, needs internet once)
#   bash tools/mac_dev.sh test    # unit, backend and JS tests
#   bash tools/mac_dev.sh bench   # PARALLEL_LYRICS=0 vs 1 on every song in tests/real (one process per run)
#   bash tools/mac_dev.sh all     # all three
#   bash tools/mac_dev.sh accuracy --label after --compare baseline   # key/BPM/chords/melody (tests/bench)
#   bash tools/mac_dev.sh regress [--accept] [--lyrics]   # same results as before? short clips, ~2 min (tests/regress)
# Everything stays in backend/data/ (gitignored): .venv is in backend/.venv, models in backend/data/models,
# logs and results in backend/data/mac_logs/.
set -u
REPO="$(cd "$(dirname "$0")/.." && pwd)"
B="$REPO/backend"
PY="$B/.venv/bin/python"
M="$B/data/models"
LOG="$B/data/mac_logs"
mkdir -p "$LOG"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
STAMP=$(date +%Y%m%d-%H%M%S)
exec > >(tee -a "$LOG/run_$STAMP.log") 2>&1
rm -f "$LOG/DONE"
FAILS=""

die() { echo "FAILED: $*"; echo "failed: $*" > "$LOG/DONE"; exit 1; }
run() { echo "+ $*"; "$@" || die "$*"; }

env_models() {
  export BTC_DIR="$M/btc" OCR_MODEL_DIR="$M/ppocr" BEAT_THIS_CKPT="$M/beat_this-final0.ckpt" \
         TORCH_HOME="$M/torch" UVR_MODEL_DIR="$M/uvr" WHISPER_MODEL="$M/whisper-small" \
         DATA_DIR="$B/data" HF_HUB_OFFLINE=1 PYTHONPATH="$B"
}

machine() {
  echo "machine: $(sysctl -n machdep.cpu.brand_string), $(sysctl -n hw.ncpu) cores" \
       "($(sysctl -n hw.perflevel0.physicalcpu 2>/dev/null) performance)," \
       "RAM $(( $(sysctl -n hw.memsize) / 1073741824 )) GB, macOS $(sw_vers -productVersion)"
  echo "repo: $(git -C "$REPO" log -1 --format='%h %s' 2>/dev/null) / VERSION $(cat "$B/VERSION")"
}

setup() {
  echo "=== setup ==="
  command -v python3.11 >/dev/null || die "python3.11 not found (brew install python@3.11)"
  [ -x "$PY" ] || run python3.11 -m venv "$B/.venv"
  local P="$B/.venv/bin/pip"
  run "$P" install -q -U pip
  run "$P" install -q -r "$B/requirements.txt" pyyaml "setuptools<80"   # resampy imports pkg_resources
  run "$P" install -q --no-deps basic-pitch==0.4.0
  run "$P" install -q -r "$B/requirements-whisper.txt"
  run "$P" install -q torch==2.5.1 torchaudio==2.5.1
  run "$P" install -q -r "$B/requirements-demucs.txt"
  run "$P" install -q --no-deps beat-this==1.1.0
  run "$P" install -q einops rotary-embedding-torch soxr
  run "$P" install -q --no-deps audio-separator==0.48.0                 # de-reverb (UVR VR model)
  run "$P" install -q audioread pydub requests tqdm samplerate
  run "$PY" "$REPO/desktop/fetch_models.py" "$M"
  env_models
  run "$PY" -c "
from app import pipeline as PL, chordnet, dereverb, ocr
checks = dict(whisper=PL.has_whisper(), demucs=PL.has_demucs(), beat_this=PL.has_beat_this(),
              btc=chordnet.available(), dereverb=dereverb.available() and dereverb.have_model(), ocr=ocr.available())
print('models:', checks)
print('cores', PL.CPUS, '| parallel auto =', PL.PARALLEL, '| whisper threads', PL.WHISPER_THREADS)
assert all(checks.values()), 'some models are missing'"
}

test_all() {
  echo "=== tests ==="
  env_models; cd "$REPO"
  local fails=""
  echo "--- test_guards.py"; "$PY" tests/test_guards.py || fails="$fails test_guards"
  echo "--- test_inbox.py"; "$PY" tests/test_inbox.py || fails="$fails test_inbox"
  if command -v node >/dev/null; then
    echo "--- make_wavs.js"; node tests/make_wavs.js || fails="$fails make_wavs"
    for t in js_test tuning_safety_test levels_test; do
      echo "--- $t.js"; node "tests/$t.js" || fails="$fails $t"
    done
  else
    echo "node not found: JS tests and make_wavs skipped (brew install node)"; fails="$fails (no-node)"
  fi
  echo "--- test_backend.py"; "$PY" tests/test_backend.py || fails="$fails test_backend"
  if [ -z "$fails" ]; then echo "TESTS: all passed"; else echo "TESTS FAILED:$fails"; FAILS="$FAILS tests:$fails"; fi
}

bench() {
  echo "=== bench: PARALLEL_LYRICS 0 vs 1 ==="
  env_models; cd "$REPO"
  local OUT="$LOG/bench_$STAMP"; mkdir -p "$OUT"
  local i=0 song f order m
  # copy the songs (and *_ref.txt) first, so renaming or moving files in tests/real during the run changes nothing
  local SONGS="$OUT/songs"; mkdir -p "$SONGS"
  find "$REPO/tests/real" -maxdepth 1 -type f \( -name '*.mp3' -o -name '*.wav' -o -name '*.m4a' -o -name '*.flac' \
       -o -name '*_ref.txt' \) -exec cp {} "$SONGS/" \;
  export LYRICORD_TESTDATA="$SONGS"
  echo "songs copied to $SONGS: $(ls "$SONGS" | tr '\n' ' ')"
  # one process per run (several songs in one process ran de-reverb out of memory on the test machine);
  # order alternates per song so drift in machine speed hits both modes equally
  while IFS= read -r -d '' f; do
    song=$(basename "$f"); song="${song%.*}"
    if [ $((i % 2)) -eq 0 ]; then order="0 1"; else order="1 0"; fi
    for m in $order; do
      echo "--- $song  PARALLEL_LYRICS=$m  ($(date +%H:%M:%S))"
      if ! PARALLEL_LYRICS=$m E2E_OUT="$OUT" /usr/bin/time -l "$PY" tests/e2e/e2e_cmp.py "p$m" "$song" \
           2> "$OUT/stderr_p${m}_$i.txt"; then
        FAILS="$FAILS bench:$song/p$m"
        grep -v -E "^ +[0-9.]+ +(real|[a-z ]+)$|^ +[0-9]+  " "$OUT/stderr_p${m}_$i.txt" | tail -5
      fi
      grep "maximum resident set size" "$OUT/stderr_p${m}_$i.txt" | awk '{printf "peak RAM %.1f GB\n", $1/1073741824}'
    done
    i=$((i + 1))
  done < <(find "$SONGS" -maxdepth 1 -type f \( -name '*.mp3' -o -name '*.wav' -o -name '*.m4a' -o -name '*.flac' \) -print0 | sort -z)
  "$PY" - "$OUT" <<'EOF'
import glob, json, os, sys
out = sys.argv[1]
rows = {}
for p in sorted(glob.glob(os.path.join(out, "e2e_p*_*.json"))):
    name = os.path.basename(p)[4:-5]
    mode, song = name[1], name[3:]
    d = json.load(open(p))
    rows.setdefault(song, {})[mode] = d
print("\n=== summary (seconds; same = identical result between the two modes) ===")
print(f"{'song':42} {'seq':>6} {'par':>6} {'saved':>7}  words seq/par  chords  notes  lyrics src seq/par")
tot = [0, 0]
for song, r in rows.items():
    if "0" not in r or "1" not in r:
        print(f"{song[:42]:42} incomplete: {sorted(r)}"); continue
    a, b = r["0"]["row"], r["1"]["row"]
    tot[0] += a["sec"]; tot[1] += b["sec"]
    same_ch = "same" if r["0"]["chords"] == r["1"]["chords"] else "DIFF"
    same_no = "same" if r["0"]["notes"] == r["1"]["notes"] else "DIFF"
    print(f"{song[:42]:42} {a['sec']:6} {b['sec']:6} {100 * (a['sec'] - b['sec']) / max(1, a['sec']):6.0f}%"
          f"  {a['lyr_words']:5}/{b['lyr_words']:<5}  {same_ch:6} {same_no:5}  {a['lyr_source']}/{b['lyr_source']}")
    if "lyrics_recall" in a:
        f = lambda x: f"{x:.0%}" if isinstance(x, (int, float)) else str(x)
        print(f"{'':42} lyrics recall {f(a['lyrics_recall'])} -> {f(b.get('lyrics_recall'))}, "
              f"precision {f(a.get('lyrics_precision'))} -> {f(b.get('lyrics_precision'))}")
    for k in ("bpm", "key", "warnings", "spoken", "instrumental"):
        if a.get(k) != b.get(k):
            print(f"{'':42} {k}: {a.get(k)} -> {b.get(k)}")
if tot[0]:
    print(f"{'TOTAL':42} {tot[0]:6} {tot[1]:6} {100 * (tot[0] - tot[1]) / tot[0]:6.0f}%")
json.dump({s: {m: d["row"] for m, d in r.items()} for s, r in rows.items()},
          open(os.path.join(out, "summary.json"), "w"), ensure_ascii=False, indent=1)
EOF
}

caffeinate -i -w $$ &   # keep the Mac awake while this script runs
machine
case "${1:-all}" in
  setup) setup ;;
  test) test_all ;;
  bench) bench ;;
  accuracy) env_models; cd "$REPO" && "$PY" tests/bench/bench.py "${@:2}" || FAILS="$FAILS accuracy" ;;
  regress) env_models; cd "$REPO" && "$PY" tests/regress/regress.py "${@:2}" || FAILS="$FAILS regress" ;;
  all) setup; test_all; bench ;;
  *) echo "usage: bash tools/mac_dev.sh [setup|test|bench|all|accuracy [--label NAME] [--compare OLD]|regress [--accept] [--lyrics]]"; exit 2 ;;
esac
echo "finished $(date +%H:%M:%S)"
if [ -z "$FAILS" ]; then echo "ok $STAMP" > "$LOG/DONE"
else echo "FAILED:$FAILS"; echo "failed $STAMP:$FAILS" > "$LOG/DONE"; fi
