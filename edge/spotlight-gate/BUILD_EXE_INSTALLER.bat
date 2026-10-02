@echo off
setlocal EnableDelayedExpansion
title Presences Spotlight AI — Build Standalone Setup Executable (.exe)
color 0B
cls

echo =====================================================================
echo    PRESENCES SPOTLIGHT AI -- EXECUTABLE INSTALLER COMPILER
echo =====================================================================
echo   Compiling standalone "Presences_Spotlight_Setup.exe"...
echo =====================================================================
echo.

set SCRIPT_DIR=%~dp0
cd /d "%SCRIPT_DIR%"

echo [1/3] Ensuring PyInstaller is installed...
python -m pip install pyinstaller --quiet

echo [2/3] Building standalone Setup GUI executable...
python -m PyInstaller --noconfirm --onedir --windowed --name "Presences_Spotlight_Setup" ^
    --add-data "spotlight_engine.py;." ^
    --add-data "config.py;." ^
    --add-data "sound_generator.py;." ^
    --add-data "installer_gui.py;." ^
    --add-data "enrollment_tool.py;." ^
    --add-data "benchmark_2k.py;." ^
    --add-data "START_SPOTLIGHT.bat;." ^
    --add-data "LAUNCH_SILENT.vbs;." ^
    --add-data "requirements.txt;." ^
    --add-data ".env.example;." ^
    --add-data "README.md;." ^
    --add-data "INSTALLATION_GUIDE.md;." ^
    installer_app.py

if %errorlevel% equ 0 (
    echo.
    echo =====================================================================
    echo 🎉 SUCCESS! Application Installer compiled successfully!
    echo Location: %SCRIPT_DIR%dist\Presences_Spotlight_Setup\Presences_Spotlight_Setup.exe
    echo =====================================================================
) else (
    echo.
    echo [ERROR] PyInstaller compilation encountered an issue.
)

echo.
pause
