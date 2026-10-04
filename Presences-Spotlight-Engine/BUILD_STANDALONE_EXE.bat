@echo off
title Building Presences Spotlight AI - Standalone Executable
color 0A

echo ==============================================================================
echo   PRESENCES SPOTLIGHT AI -- SINGLE-FILE STANDALONE EXECUTABLE BUILDER
echo   Bundling Google MediaPipe Vision, Appwrite Cloud SDK, and Full-Stack App
echo ==============================================================================
echo.

cd /d "%~dp0"

echo [1/3] Verifying PyInstaller and Dependencies...
python -m pip install pyinstaller mediapipe appwrite flask opencv-python numpy requests python-dotenv

echo.
echo [2/3] Compiling Single-File Standalone Executable (.exe)...
pyinstaller --noconfirm --clean --onefile ^
    --name "Presences-Spotlight-AI" ^
    --add-data "face_landmarker.task;." ^
    --add-data "spotlight_chime.wav;." ^
    --add-data ".env;." ^
    --hidden-import=mediapipe ^
    --hidden-import=mediapipe.tasks.python.vision ^
    --hidden-import=appwrite ^
    --hidden-import=appwrite.client ^
    --hidden-import=appwrite.services.databases ^
    --hidden-import=appwrite.services.storage ^
    --hidden-import=google.genai ^
    --hidden-import=flask ^
    --hidden-import=numpy ^
    --hidden-import=cv2 ^
    --hidden-import=face_recognition ^
    --hidden-import=face_recognition_models ^
    desktop_app.py

echo.
echo [3/3] Build Complete!
if exist "dist\Presences-Spotlight-AI.exe" (
    echo ==============================================================================
    echo  SUCCESS! Single Executable Created at:
    echo  %~dp0dist\Presences-Spotlight-AI.exe
    echo.
    echo  You can now share this ONE file with any PC - No Python or setup needed!
    echo ==============================================================================
) else (
    echo [ERROR] Build failed. Please check the log messages above.
)

pause
