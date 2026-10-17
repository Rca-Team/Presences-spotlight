# Full Native Android App Build & Release Script
$ErrorActionPreference = "Stop"

$REPO_ROOT = $PSScriptRoot
if (-not $REPO_ROOT) { $REPO_ROOT = "D:\codes\Presences-AI" }

$ANDROID_SDK = "C:\Android\Sdk"
$CMDLINE_TOOLS = "$ANDROID_SDK\cmdline-tools\latest"
$JDK21_HOME = "C:\Program Files\Eclipse Adoptium\jdk-21.0.12.101-hotspot"

# Set environment
if (Test-Path $JDK21_HOME) { $env:JAVA_HOME = $JDK21_HOME }
if (Test-Path $ANDROID_SDK) {
    $env:ANDROID_HOME = $ANDROID_SDK
    $env:ANDROID_SDK_ROOT = $ANDROID_SDK
    $env:Path = "$env:JAVA_HOME\bin;$CMDLINE_TOOLS\bin;$ANDROID_SDK\platform-tools;$env:Path"
}

Write-Host "=== Presences Android Build Environment ===" -ForegroundColor Cyan
Write-Host "Repository Root: $REPO_ROOT"
if ($env:JAVA_HOME) { Write-Host "JAVA_HOME = $env:JAVA_HOME" }
if ($env:ANDROID_HOME) { Write-Host "ANDROID_HOME = $env:ANDROID_HOME" }

# 1. Build Production Web Bundle
Write-Host ""
Write-Host "=== Step 1: Building production web bundle ===" -ForegroundColor Cyan
Set-Location $REPO_ROOT
npm run build

# 2. Sync to Android Native Assets
Write-Host ""
Write-Host "=== Step 2: Syncing web bundle to Android native assets ===" -ForegroundColor Cyan
npx cap sync android

# 3. Ensure local.properties exists
if ($env:ANDROID_HOME) {
    $sdkDirEscaped = $env:ANDROID_HOME.Replace('\', '/')
    Set-Content -Path "$REPO_ROOT\android\local.properties" -Value "sdk.dir=$sdkDirEscaped"
    Write-Host "local.properties configured with sdk.dir=$sdkDirEscaped"
}

# 4. Assemble Release APK
Write-Host ""
Write-Host "=== Step 3: Compiling Native Release APK ===" -ForegroundColor Cyan
Set-Location "$REPO_ROOT\android"
.\gradlew.bat assembleRelease

# 5. Copy to easy-access locations
Write-Host ""
Write-Host "=== Step 4: Finalizing APK artifacts ===" -ForegroundColor Cyan
$sourceApk = "$REPO_ROOT\android\app\build\outputs\apk\release\app-release.apk"
$targetApk1 = "$REPO_ROOT\android\app\build\outputs\apk\release\Presences-release.apk"
$targetApk2 = "$REPO_ROOT\Presences.apk"
$targetApk3 = "$REPO_ROOT\Presences-latest.apk"

if (Test-Path $sourceApk) {
    Copy-Item $sourceApk $targetApk1 -Force
    Copy-Item $sourceApk $targetApk2 -Force
    Copy-Item $sourceApk $targetApk3 -Force

    Write-Host "=== BUILD SUCCESSFUL ===" -ForegroundColor Green
    Get-Item $targetApk2 | ForEach-Object {
        Write-Host "APK: $($_.FullName) ($([math]::Round($_.Length/1MB, 2)) MB)" -ForegroundColor Green
    }
} else {
    Write-Warning "Could not find output release APK at $sourceApk"
}
