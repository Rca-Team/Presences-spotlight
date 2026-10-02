@echo off
setlocal EnableDelayedExpansion
title Presences Spotlight AI — Package Zip for Distribution
color 0B
cls

echo =====================================================================
echo    PRESENCES SPOTLIGHT AI -- DISTRIBUTION ZIP CREATOR
echo =====================================================================
echo   Creating a standalone installer package for USB transfer...
echo =====================================================================
echo.

set SCRIPT_DIR=%~dp0
set OUTPUT_ZIP=%SCRIPT_DIR%..\Presences_Spotlight_Gate_Installer.zip

powershell -Command "Compress-Archive -Path '%SCRIPT_DIR%*' -DestinationPath '%OUTPUT_ZIP%' -Force -CompressionLevel Optimal"

if exist "%OUTPUT_ZIP%" (
    echo.
    echo =====================================================================
    echo [SUCCESS] Standalone installer zip created!
    echo Location: %OUTPUT_ZIP%
    echo.
    echo You can now copy this ZIP file to any USB drive or school PC.
    echo On the target PC: Extract the ZIP and double-click SETUP_ON_ANY_PC.bat!
    echo =====================================================================
) else (
    echo [ERROR] Could not create zip archive.
)

echo.
pause
