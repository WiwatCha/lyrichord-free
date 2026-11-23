#!/bin/bash
# double-click in Finder. First time: right-click > Open (macOS asks once because it is a downloaded script)
export PATH="$PATH:/usr/local/bin:/opt/homebrew/bin:$HOME/.docker/bin:/Applications/Docker.app/Contents/Resources/bin"
SCRIPTDIR="$(cd "$(dirname "$0")" && pwd)"; cd "$SCRIPTDIR"
pause(){ read -n1 -r -p "Press any key to close..."; echo; }
docker stop lyricord chord-app >/dev/null 2>&1; echo "Lyricord stopped."; sleep 2
