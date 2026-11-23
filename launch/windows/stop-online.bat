@echo off
docker exec lyricord python -m app.online clear >nul 2>&1
docker rm -f lyricord-tunnel >nul 2>&1
echo Online access stopped. Lyricord on this computer keeps running (http://localhost:8000).
timeout /t 3 /nobreak >nul
