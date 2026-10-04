@echo off
title Presences Spotlight AI - Live Gate Terminal
color 0B

echo ==============================================================================
echo   PRESENCES SPOTLIGHT AI -- FULL-STACK PC DESKTOP TERMINAL
echo   Google MediaPipe 478 3D Mesh Vision Pipeline + Appwrite Cloud
echo ==============================================================================
echo.

cd /d "%~dp0"
python desktop_app.py

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Application stopped or encountered an error.
    pause
)
