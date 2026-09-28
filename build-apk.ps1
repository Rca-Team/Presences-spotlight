# Full Native Android App Build & Release Script
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

# 1. Build Production Web Bundle
Write-Host ""
Write-Host "=== Step 1: Building production web bundle ===" -ForegroundColor Cyan
Set-Location "C:\Users\pukhr\Downloads\Presences-AI"
npm run build

# 2. Sync to Android Native Assets
Write-Host ""
Write-Host "=== Step 2: Syncing web bundle to Android native assets ===" -ForegroundColor Cyan
npx cap copy android

# 3. Ensure local.properties exists
$sdkDirEscaped = $ANDROID_SDK.Replace('\', '/')
Set-Content -Path "C:\Users\pukhr\Downloads\Presences-AI\android\local.properties" -Value "sdk.dir=$sdkDirEscaped"
Write-Host "local.properties set to sdk.dir=$sdkDirEscaped"

# 4. Assemble Release APK
Write-Host ""
Write-Host "=== Step 3: Compiling Native Release APK ===" -ForegroundColor Cyan
Set-Location "C:\Users\pukhr\Downloads\Presences-AI\android"
.\gradlew.bat assembleRelease

# 5. Copy to easy-access locations
Write-Host ""
Write-Host "=== Step 4: Finalizing APK artifacts ===" -ForegroundColor Cyan
$sourceApk = "C:\Users\pukhr\Downloads\Presences-AI\android\app\build\outputs\apk\release\app-release.apk"
$targetApk1 = "C:\Users\pukhr\Downloads\Presences-AI\android\app\build\outputs\apk\release\Presences-release.apk"
$targetApk2 = "C:\Users\pukhr\Downloads\Presences.apk"
$targetApk3 = "C:\Users\pukhr\Downloads\Presences-AI\Presences.apk"

Copy-Item $sourceApk $targetApk1 -Force
Copy-Item $sourceApk $targetApk2 -Force
Copy-Item $sourceApk $targetApk3 -Force

Write-Host "=== BUILD SUCCESSFUL ===" -ForegroundColor Green
Get-Item $targetApk1 | ForEach-Object {
    Write-Host "APK: $($_.FullName) ($([math]::Round($_.Length/1MB, 2)) MB)" -ForegroundColor Green
}
