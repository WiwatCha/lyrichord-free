@echo off
docker stop lyricord >nul 2>&1
docker stop chord-app >nul 2>&1
echo Lyricord stopped.
timeout /t 2 /nobreak >nul
