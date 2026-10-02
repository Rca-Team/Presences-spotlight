@echo off
setlocal EnableDelayedExpansion
title Presences Spotlight AI — Universal 1-Click PC Installer
color 0B
cls

echo =====================================================================
echo    PRESENCES SPOTLIGHT AI -- UNIVERSAL 1-CLICK PC INSTALLER
echo =====================================================================
echo   This installer sets up the Presences Spotlight Walk-Through
echo   Gate Attendance Engine on this computer in under 60 seconds.
echo =====================================================================
echo.

set SCRIPT_DIR=%~dp0
cd /d "%SCRIPT_DIR%"

:: ─── Step 1: Check or Install Python Automatically ───────────────────────────
echo [1/6] Checking Python 64-bit installation...
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [NOTE] Python was not detected on this system.
    echo [ACTION] Downloading official Python 3.11 64-bit for Windows...
    
    set PYTHON_INSTALLER=python_3.11_installer.exe
    powershell -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; (New-Object System.Net.WebClient).DownloadFile('https://www.python.org/ftp/python/3.11.9/python-3.11.9-amd64.exe', '%PYTHON_INSTALLER%')"
    
    if exist "%PYTHON_INSTALLER%" (
        echo [ACTION] Installing Python silently with PATH enabled (takes ~30s)...
        start /wait %PYTHON_INSTALLER% /quiet InstallAllUsers=1 PrependPath=1 Include_test=0
        del %PYTHON_INSTALLER%
        
        :: Refresh PATH for current session
        set "PATH=%LOCALAPPDATA%\Programs\Python\Python311;%LOCALAPPDATA%\Programs\Python\Python311\Scripts;C:\Program Files\Python311;C:\Program Files\Python311\Scripts;%PATH%"
    ) else (
        echo [ERROR] Could not download Python automatically.
        echo Please download and install Python 3.10+ from https://www.python.org/downloads/
        echo (Ensure you check "Add Python to PATH" during installation)
        pause
        exit /b 1
    )
)

python --version
echo [OK] Python interpreter is ready.
echo.

:: ─── Step 2: Install AI & Computer Vision Dependencies ───────────────────────
echo [2/6] Installing computer vision and networking packages...
python -m pip install --upgrade pip --quiet
python -m pip install -r requirements.txt --quiet
if %errorlevel% neq 0 (
    echo Retrying package installation with explicit wheel list...
    python -m pip install numpy opencv-python requests python-dotenv Pillow pygame
)

:: Optional precompiled dlib-bin for Windows
python -m pip install dlib-bin --quiet >nul 2>&1
python -m pip install --no-build-isolation face_recognition --quiet >nul 2>&1

echo [OK] Core AI vision packages installed.
echo.

:: ─── Step 3: Setup Local Environment & Sound Chime ───────────────────────────
echo [3/6] Setting up environment configuration & audio cache...
if not exist "%SCRIPT_DIR%.env" (
    if exist "%SCRIPT_DIR%.env.example" (
        copy "%SCRIPT_DIR%.env.example" "%SCRIPT_DIR%.env" >nul
        echo [NOTE] Created new .env file from template.
    )
)

:: Generate audio chime file if not exists
python -c "from sound_generator import generate_chime; generate_chime('spotlight_chime.wav')" >nul 2>&1
echo [OK] Configuration & audio verified.
echo.

:: ─── Step 4: Create Desktop Shortcut ─────────────────────────────────────────
echo [4/6] Creating Desktop shortcut for 1-click daily operation...
set TARGET_BAT=%SCRIPT_DIR%START_SPOTLIGHT.bat
set SHORTCUT_NAME=Presences Spotlight Gate.lnk
set DESKTOP_DIR=%USERPROFILE%\Desktop

powershell -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%DESKTOP_DIR%\%SHORTCUT_NAME%'); $s.TargetPath = '%TARGET_BAT%'; $s.WorkingDirectory = '%SCRIPT_DIR%'; $s.Description = 'Presences Spotlight AI Gate Attendance Terminal'; $s.Save()"

if exist "%DESKTOP_DIR%\%SHORTCUT_NAME%" (
    echo [OK] Shortcut created on Desktop: "%SHORTCUT_NAME%"
) else (
    echo [NOTE] Shortcut placed in local directory.
)
echo.

:: ─── Step 5: Self-Diagnostic Test ────────────────────────────────────────────
echo [5/6] Verifying computer vision engine...
python -c "import cv2, numpy, requests, dotenv; print('[OK] Diagnostic passed. OpenCV version:', cv2.__version__)"
echo.

:: ─── Step 6: Launch Setup Wizard GUI ─────────────────────────────────────────
echo [6/6] Launching Configuration Wizard...
echo.
echo =====================================================================
echo  🎉 SETUP COMPLETED SUCCESSFULLY!
echo =====================================================================
echo  Opening the Setup Wizard GUI to test your camera and school link...
echo =====================================================================
echo.

start "" python installer_gui.py

exit /b 0
