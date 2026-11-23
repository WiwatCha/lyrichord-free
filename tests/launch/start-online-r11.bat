@echo off
title Lyricord online
rem Use Lyricord from anywhere (phone, another computer) while THIS computer runs the AI backend.
rem A free Cloudflare quick tunnel gives a temporary https address; requests through it need the access key.
set "LYRICORD_NO_OPEN=1"
call "%~dp0start-lyricord.bat"
if errorlevel 1 exit /b 1
set "LYRICORD_NO_OPEN="
echo.
echo === Lyricord online: opening a secure tunnel (Cloudflare, free) ===
docker rm -f lyricord-tunnel >nul 2>&1
docker run -d --name lyricord-tunnel --add-host=host.docker.internal:host-gateway cloudflare/cloudflared:latest tunnel --no-autoupdate --url http://host.docker.internal:8000 >nul
if errorlevel 1 goto fail
set "URL="
set /a tries=0
:wait
timeout /t 2 /nobreak >nul
for /f "delims=" %%u in ('powershell -NoProfile -Command "$m = [regex]::Match((docker logs lyricord-tunnel 2>&1 | Out-String), 'https://[a-z0-9-]+\.trycloudflare\.com'); if ($m.Success) { $m.Value }"') do set "URL=%%u"
if defined URL goto got
set /a tries+=1
if %tries% lss 30 goto wait
goto fail
:got
set "KEY="
for /f "delims=" %%k in ('docker exec lyricord cat /data/access_key.txt') do set "KEY=%%k"
set "PAGES="
if exist "%~dp0..\pages-url.txt" set /p PAGES=<"%~dp0..\pages-url.txt"
if defined PAGES if "%PAGES:~-1%"=="/" set "PAGES=%PAGES:~0,-1%"
if defined PAGES (set "OPEN=%PAGES%/?api=%URL%&key=%KEY%") else (set "OPEN=%URL%/?key=%KEY%")
powershell -NoProfile -Command "Set-Clipboard -Value $env:OPEN"
rem tell the app the address (it shows the QR code too), and print the QR code here
chcp 65001 >nul
docker exec lyricord python -m app.online set "%URL%" "%PAGES%"
echo   Backend address : %URL%
echo   Access key      : %KEY%
if defined PAGES echo   Online page     : %PAGES%
echo.
echo iPhone / iPad: scan the QR code above with the camera, tap the link (Safari).
echo The full link is also copied. The address changes every time you run this file. Keep the key private.
start "" "http://localhost:8000/?showqr=1"
echo.
echo Leave this window open while you use Lyricord online.
echo Press any key here to stop online access (the app on this computer keeps running).
pause >nul
docker exec lyricord python -m app.online clear >nul 2>&1
docker rm -f lyricord-tunnel >nul 2>&1
echo Online access stopped.
timeout /t 2 /nobreak >nul
exit /b 0
:fail
echo.
echo Could not open the tunnel (internet needed). Details:
docker logs lyricord-tunnel 2>&1
docker rm -f lyricord-tunnel >nul 2>&1
pause
exit /b 1
