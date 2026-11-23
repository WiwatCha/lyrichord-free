#!/bin/bash
docker exec lyricord python -m app.online clear >/dev/null 2>&1
docker rm -f lyricord-tunnel >/dev/null 2>&1
echo "Online access stopped. Lyricord on this Mac keeps running (http://localhost:8000)."
