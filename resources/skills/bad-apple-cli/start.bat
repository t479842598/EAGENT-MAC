@echo off
chcp 936 >nul
title Bad Apple
mode con cols=88 lines=34
cd /d "%~dp0"
ba.exe frames.gray audio.wav
echo.
echo ===== done =====
pause