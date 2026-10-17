@echo off
title Presences - Spotlight Engine - One-Click Setup & Launch
color 0B

echo ==============================================================================
echo   PRESENCES - SPOTLIGHT ENGINE -- DEDICATED SCHOOL ATTENDANCE TERMINAL
echo   Zero-Bloat Autonomous Edge Marking Engine (Dual-Camera Google Vision)
echo ==============================================================================
echo.

cd /d "%~dp0"

echo [1/3] Checking Python 3 Installation...
where python >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Python 3 is not found in system PATH.
    echo Please install Python 3.10+ from https://www.python.org/downloads/
    echo and ensure "Add Python to PATH" is checked during installation.
    pause
    exit /b 1
)

echo [2/3] Checking and Installing Required Engine Libraries...
python -m pip install -q -r requirements.txt
if %ERRORLEVEL% NEQ 0 (
    echo [WARNING] Some dependencies had installation warnings. Attempting launch...
)

echo [3/3] Launching Presences Spotlight Engine...
echo.
python spotlight_engine.py

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Terminal exited with an error.
    pause
)
