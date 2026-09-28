# Build APK script for Presences using JDK 21 and Android SDK
$ErrorActionPreference = "Stop"

$ANDROID_SDK = "C:\Android\Sdk"
$CMDLINE_TOOLS = "$ANDROID_SDK\cmdline-tools\latest"
$JDK21_HOME = "C:\Program Files\Eclipse Adoptium\jdk-21.0.12.101-hotspot"

# Set environment
$env:JAVA_HOME = $JDK21_HOME
$env:ANDROID_HOME = $ANDROID_SDK
$env:ANDROID_SDK_ROOT = $ANDROID_SDK
$env:Path = "$JDK21_HOME\bin;$CMDLINE_TOOLS\bin;$ANDROID_SDK\platform-tools;$env:Path"

Write-Host "=== Java Environment ===" -ForegroundColor Cyan
java -version
Write-Host "JAVA_HOME = $env:JAVA_HOME"
Write-Host "ANDROID_HOME = $env:ANDROID_HOME"

# Ensure local.properties exists
$sdkDirEscaped = $ANDROID_SDK.Replace('\', '/')
Set-Content -Path "C:\Users\pukhr\Downloads\Presences-AI\android\local.properties" -Value "sdk.dir=$sdkDirEscaped"
Write-Host "local.properties set to sdk.dir=$sdkDirEscaped"

Write-Host ""
Write-Host "=== Building release APK ===" -ForegroundColor Cyan
Set-Location "C:\Users\pukhr\Downloads\Presences-AI\android"
.\gradlew.bat assembleRelease

Write-Host ""
Write-Host "=== BUILD FINISHED ===" -ForegroundColor Green
$apkDir = "C:\Users\pukhr\Downloads\Presences-AI\android\app\build\outputs\apk\release"
if (Test-Path $apkDir) {
    Get-ChildItem $apkDir -Filter *.apk | ForEach-Object {
        Write-Host "APK Generated: $($_.FullName) ($([math]::Round($_.Length/1MB, 2)) MB)" -ForegroundColor Green
    }
} else {
    Write-Warning "APK directory not found at $apkDir"
}
