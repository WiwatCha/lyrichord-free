@echo off
title Lyricord - build / update
echo === Lyricord: building (needs internet, first time 15-25 minutes) ===
cd /d "%~dp0..\..\backend"
if not exist Dockerfile (
  echo Cannot find the backend folder. Keep this file inside lyricord\launch\windows.
  pause
  exit /b 1
)
docker info >nul 2>&1
if errorlevel 1 (
  echo Open Docker Desktop first, wait until it says "Engine running", then run this file again.
  pause
  exit /b 1
)
docker stop lyricord >nul 2>&1
docker rm lyricord >nul 2>&1
docker rm -f chord-app >nul 2>&1
for /f %%i in ('docker ps -q --filter "publish=8000"') do docker stop %%i >nul
docker build -t lyricord .
if errorlevel 1 (
  echo.
  echo BUILD FAILED. Take a screenshot of the red lines above and send it to Claude.
  pause
  exit /b 1
)
docker rmi chord-app >nul 2>&1
echo Build finished. After this the app works without internet (except YouTube links).
call "%~dp0start-lyricord.bat"
