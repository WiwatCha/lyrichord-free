@echo off
title Lyricord
echo === Lyricord: starting ===
docker info >nul 2>&1
if not errorlevel 1 goto ready
echo Opening Docker Desktop, please wait...
start "" "%ProgramFiles%\Docker\Docker\Docker Desktop.exe"
set /a tries=0
:wait
timeout /t 3 /nobreak >nul
set /a tries+=1
docker info >nul 2>&1
if not errorlevel 1 goto ready
if %tries% lss 60 goto wait
echo Docker Desktop did not start. Open it manually, then run this file again.
pause
exit /b 1
:ready
rem make sure the installed app is the version in this folder (an old app kept running was the cause of "old screen" reports)
set "WANT="
set /p WANT=<"%~dp0..\..\backend\VERSION"
set "HAVE="
for /f "delims=" %%v in ('docker run --rm --pull never --entrypoint cat lyricord /app/VERSION 2^>nul') do set "HAVE=%%v"
if "%HAVE%"=="%WANT%" goto same
echo.
echo This folder has Lyricord %WANT% but the installed app is "%HAVE%".
echo Installing this version now (needs internet; first time 15-25 minutes)...
call "%~dp0update-lyricord.bat"
exit /b
:same
docker stop chord-app >nul 2>&1
docker start lyricord >nul 2>&1
if not errorlevel 1 goto open
for /f %%i in ('docker ps -q --filter "publish=8000"') do docker stop %%i >nul
docker run -d --name lyricord -p 8000:8000 --restart unless-stopped -v chord-data:/data lyricord >nul
if errorlevel 1 goto fail
:open
if defined LYRICORD_NO_OPEN exit /b 0
echo Opening http://localhost:8000 ...
timeout /t 4 /nobreak >nul
start "" http://localhost:8000
exit /b 0
:fail
echo.
echo The app is not installed yet. Double-click "update-lyricord.bat" (needs internet once),
echo or "import-lyricord.bat" if you copied lyricord-image.tar from another computer.
pause
exit /b 1
