@echo off
title Create Desktop Shortcut for Presences Spotlight AI
cls
echo Creating desktop application shortcut for Presences Spotlight AI...

set SCRIPT_DIR=%~dp0
set SHORTCUT_NAME=Presences Spotlight AI.lnk
set DESKTOP_DIR=%USERPROFILE%\Desktop
set ICON_PATH=%SCRIPT_DIR%app_icon.ico

if exist "%SCRIPT_DIR%dist\Presences-Spotlight-AI.exe" (
    set TARGET_EXE=%SCRIPT_DIR%dist\Presences-Spotlight-AI.exe
    powershell -NoProfile -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%DESKTOP_DIR%\%SHORTCUT_NAME%'); $s.TargetPath = '%TARGET_EXE%'; $s.WorkingDirectory = '%SCRIPT_DIR%'; $s.IconLocation = '%ICON_PATH%, 0'; $s.Description = 'Presences Spotlight AI Gate Attendance Terminal'; $s.Save()"
) else (
    set TARGET_EXE=wscript.exe
    set ARGS="%SCRIPT_DIR%Launch_Spotlight_App.vbs"
    powershell -NoProfile -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%DESKTOP_DIR%\%SHORTCUT_NAME%'); $s.TargetPath = '%TARGET_EXE%'; $s.Arguments = '%ARGS%'; $s.WorkingDirectory = '%SCRIPT_DIR%'; $s.IconLocation = '%ICON_PATH%, 0'; $s.Description = 'Presences Spotlight AI Gate Attendance Terminal'; $s.Save()"
)

if exist "%DESKTOP_DIR%\%SHORTCUT_NAME%" (
    echo.
    echo =====================================================================
    echo [SUCCESS] Native Desktop Shortcut created on your Desktop!
    echo   File: %DESKTOP_DIR%\%SHORTCUT_NAME%
    echo   Icon: %ICON_PATH%
    echo.
    echo Double-click "Presences Spotlight AI" on your Desktop to run silently
    echo with ZERO command prompt or terminal windows!
    echo =====================================================================
) else (
    echo [ERROR] Could not create shortcut automatically.
)

echo.
pause
