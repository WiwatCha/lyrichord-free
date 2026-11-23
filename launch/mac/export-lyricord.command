#!/bin/bash
# double-click in Finder. First time: right-click > Open (macOS asks once because it is a downloaded script)
export PATH="$PATH:/usr/local/bin:/opt/homebrew/bin:$HOME/.docker/bin:/Applications/Docker.app/Contents/Resources/bin"
SCRIPTDIR="$(cd "$(dirname "$0")" && pwd)"; cd "$SCRIPTDIR"
pause(){ read -n1 -r -p "Press any key to close..."; echo; }
cd ../..
echo "Saving the app to lyricord-image.tar (a few GB, takes a few minutes)..."
if docker save -o lyricord-image.tar lyricord; then echo "Done: $(pwd)/lyricord-image.tar"; echo "Copy the whole lyricord folder to the other computer and run import there."; else echo "Export failed. Is the app built?"; fi
pause
