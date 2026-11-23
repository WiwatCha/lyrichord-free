#!/bin/bash
# double-click in Finder. First time: right-click > Open (macOS asks once because it is a downloaded script)
export PATH="$PATH:/usr/local/bin:/opt/homebrew/bin:$HOME/.docker/bin:/Applications/Docker.app/Contents/Resources/bin"
SCRIPTDIR="$(cd "$(dirname "$0")" && pwd)"; cd "$SCRIPTDIR"
pause(){ read -n1 -r -p "Press any key to close..."; echo; }
echo "=== Lyricord: building (needs internet, first time 15-25 minutes) ==="
if ! docker info >/dev/null 2>&1; then
  echo "Opening Docker Desktop, please wait..."; open -a Docker
  for i in $(seq 1 60); do sleep 3; docker info >/dev/null 2>&1 && break; done
fi
if ! docker info >/dev/null 2>&1; then echo "Docker Desktop did not start. Open it, then run this again."; pause; exit 1; fi
cd ../../backend || { echo "Keep this file inside lyricord/launch/mac"; pause; exit 1; }
docker stop lyricord >/dev/null 2>&1; docker rm lyricord >/dev/null 2>&1; docker rm -f chord-app >/dev/null 2>&1
ids=$(docker ps -q --filter "publish=8000"); [ -n "$ids" ] && docker stop $ids >/dev/null
if ! docker build -t lyricord .; then echo; echo "BUILD FAILED. Take a screenshot of the red lines above and send it to Claude."; pause; exit 1; fi
docker rmi chord-app >/dev/null 2>&1
echo "Build finished. After this the app works without internet (except YouTube links)."
bash "$SCRIPTDIR/start-lyricord.command"
