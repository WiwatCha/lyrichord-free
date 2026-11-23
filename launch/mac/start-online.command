#!/bin/bash
# Use Lyricord from anywhere (phone, another computer) while THIS Mac runs the AI backend.
# A free Cloudflare quick tunnel gives a temporary https address; requests through it need the access key.
SCRIPTDIR="$(cd "$(dirname "$0")" && pwd)"
pause() { read -n 1 -s -r -p "Press any key to close"; echo; }
LYRICORD_NO_OPEN=1 bash "$SCRIPTDIR/start-lyricord.command" || exit 1
echo; echo "=== Lyricord online: opening a secure tunnel (Cloudflare, free) ==="
docker rm -f lyricord-tunnel >/dev/null 2>&1
fail() { echo; echo "Could not open the tunnel (internet needed). Details:"; docker logs lyricord-tunnel 2>&1 | tail -20; docker rm -f lyricord-tunnel >/dev/null 2>&1; pause; exit 1; }
docker run -d --name lyricord-tunnel --add-host=host.docker.internal:host-gateway cloudflare/cloudflared:latest tunnel --no-autoupdate --url http://host.docker.internal:8000 >/dev/null || fail
URL=""
for i in $(seq 30); do
  sleep 2; URL=$(docker logs lyricord-tunnel 2>&1 | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | head -1)
  [ -n "$URL" ] && break
done
[ -n "$URL" ] || fail
KEY=$(docker exec lyricord cat /data/access_key.txt)
PAGES=""; [ -f "$SCRIPTDIR/../pages-url.txt" ] && PAGES=$(head -1 "$SCRIPTDIR/../pages-url.txt" | tr -d '\r\n ' | sed 's:/*$::')
if [ -n "$PAGES" ]; then OPEN="$PAGES/?api=$URL&key=$KEY"; else OPEN="$URL/?key=$KEY"; fi
printf '%s' "$OPEN" | pbcopy
# tell the app the address (it shows the QR code too), and print the QR code here
docker exec lyricord python -m app.online set "$URL" "$PAGES"
echo "  Backend address : $URL"; echo "  Access key      : $KEY"; [ -n "$PAGES" ] && echo "  Online page     : $PAGES"
echo; echo "iPhone / iPad: scan the QR code above with the camera, tap the link (Safari)."
echo "The full link is also copied. The address changes every time you run this file. Keep the key private."
open "http://localhost:8000/?showqr=1"
echo; echo "Leave this window open while you use Lyricord online."
read -n 1 -s -r -p "Press any key here to stop online access (the app on this Mac keeps running)"; echo
docker exec lyricord python -m app.online clear >/dev/null 2>&1
docker rm -f lyricord-tunnel >/dev/null 2>&1; echo "Online access stopped."
