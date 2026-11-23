#!/bin/bash
# double-click in Finder. First time: right-click > Open (macOS asks once because it is a downloaded script)
export PATH="$PATH:/usr/local/bin:/opt/homebrew/bin:$HOME/.docker/bin:/Applications/Docker.app/Contents/Resources/bin"
SCRIPTDIR="$(cd "$(dirname "$0")" && pwd)"; cd "$SCRIPTDIR"
pause(){ read -n1 -r -p "Press any key to close..."; echo; }
echo "=== Lyricord: starting ==="
if ! docker info >/dev/null 2>&1; then
  echo "Opening Docker Desktop, please wait..."; open -a Docker
  for i in $(seq 1 60); do sleep 3; docker info >/dev/null 2>&1 && break; done
fi
if ! docker info >/dev/null 2>&1; then echo "Docker Desktop did not start. Open it, then run this again."; pause; exit 1; fi
# make sure the installed app is the version in this folder
WANT=$(cat ../../backend/VERSION 2>/dev/null); HAVE=$(docker run --rm --pull never --entrypoint cat lyricord /app/VERSION 2>/dev/null)
if [ "$WANT" != "$HAVE" ]; then
  echo "This folder has Lyricord $WANT but the installed app is \"$HAVE\". Installing this version now (needs internet; first time 15-25 minutes)..."
  exec bash "$SCRIPTDIR/update-lyricord.command"
fi
docker stop chord-app >/dev/null 2>&1
if ! docker start lyricord >/dev/null 2>&1; then
  ids=$(docker ps -q --filter "publish=8000"); [ -n "$ids" ] && docker stop $ids >/dev/null
  if ! docker run -d --name lyricord -p 8000:8000 --restart unless-stopped -v chord-data:/data lyricord >/dev/null; then
    echo 'The app is not installed yet. Double-click "update-lyricord.command" (needs internet once),'
    echo 'or "import-lyricord.command" if you copied lyricord-image.tar from another computer.'; pause; exit 1
  fi
fi
sleep 4; [ -n "$LYRICORD_NO_OPEN" ] || open http://localhost:8000
