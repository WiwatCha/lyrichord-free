@echo off
title Lyricord - import (no internet needed)
cd /d "%~dp0..\.."
if not exist lyricord-image.tar ( echo lyricord-image.tar not found in %cd% & pause & exit /b 1 )
docker info >nul 2>&1
if errorlevel 1 ( echo Open Docker Desktop first, then run this file again. & pause & exit /b 1 )
docker stop lyricord >nul 2>&1
docker rm lyricord >nul 2>&1
docker rm -f chord-app >nul 2>&1
echo Loading the app (a few minutes)...
docker load -i lyricord-image.tar
if errorlevel 1 ( echo Import failed. & pause & exit /b 1 )
call "%~dp0start-lyricord.bat"
