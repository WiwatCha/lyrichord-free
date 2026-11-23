#!/bin/bash
# double-click in Finder. First time: right-click > Open (macOS asks once because it is a downloaded script)
export PATH="$PATH:/usr/local/bin:/opt/homebrew/bin:$HOME/.docker/bin:/Applications/Docker.app/Contents/Resources/bin"
SCRIPTDIR="$(cd "$(dirname "$0")" && pwd)"; cd "$SCRIPTDIR"
pause(){ read -n1 -r -p "Press any key to close..."; echo; }
if ! docker info >/dev/null 2>&1; then
  echo "Opening Docker Desktop, please wait..."; open -a Docker
  for i in $(seq 1 60); do sleep 3; docker info >/dev/null 2>&1 && break; done
fi
if ! docker info >/dev/null 2>&1; then echo "Docker Desktop did not start. Open it, then run this again."; pause; exit 1; fi
cd ../..
[ -f lyricord-image.tar ] || { echo "lyricord-image.tar not found in $(pwd)"; pause; exit 1; }
docker stop lyricord >/dev/null 2>&1; docker rm lyricord >/dev/null 2>&1; docker rm -f chord-app >/dev/null 2>&1
echo "Loading the app (a few minutes)..."
docker load -i lyricord-image.tar || { echo "Import failed."; pause; exit 1; }
bash "$SCRIPTDIR/start-lyricord.command"
