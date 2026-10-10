' Presences Spotlight AI - Silent Desktop Application Launcher
' Launches the native PyQt6 application without opening any Command Prompt / Terminal window

Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)

WshShell.CurrentDirectory = scriptDir
WshShell.Run "pythonw.exe """ & scriptDir & "\desktop_app.py""", 0, False
