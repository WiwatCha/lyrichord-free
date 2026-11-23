@echo off
title Lyricord - export for another computer
cd /d "%~dp0..\.."
echo Saving the app to lyricord-image.tar (a few GB, takes a few minutes)...
docker save -o lyricord-image.tar lyricord
if errorlevel 1 ( echo Export failed. Is the app built? & pause & exit /b 1 )
echo Done: %cd%\lyricord-image.tar
echo Copy the whole lyricord folder (with this .tar) to the other computer,
echo then run launch\windows\import-lyricord.bat (or launch/mac/import-lyricord.command) there.
pause
