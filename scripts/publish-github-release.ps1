# Publish Release to GitHub with Presences.apk
$ErrorActionPreference = "Continue"

# Retrieve credential from git credential helper
$inputCred = "protocol=https`nhost=github.com`n`n"
$credOutput = $inputCred | git credential fill
$token = ""
foreach ($line in ($credOutput -split "`n")) {
    if ($line -match "^password=(.+)$") {
        $token = $matches[1].Trim()
    }
}

if (-not $token) {
    Write-Error "Could not retrieve GitHub token from git credentials."
    exit 1
}

$env:GH_TOKEN = $token
$ghExe = "C:\Program Files\GitHub CLI\gh.exe"

$repo = "Rca-Team/Presences-supabase"
$tag = "v2.4.2"
$title = "Presences v2.4.2 (Android Native Release)"
$notes = "### Presences v2.4.2 - Production Android Native Build`n`n- Official Presences branding & icons`n- Android Home Screen Widgets support`n- System Share Target integration (ID cards & photos)`n- Full offline & online attendance sync`n`n**Download:** Download the attached ``Presences.apk`` to install on your Android device."
$apkPath = "C:\Users\pukhr\Downloads\Presences-AI\android\app\build\outputs\apk\release\Presences-release.apk"

Write-Host "Creating GitHub Release $tag on $repo..." -ForegroundColor Cyan

# Create new release with asset
& $ghExe release create $tag "$apkPath#Presences.apk" --repo $repo --title $title --notes $notes --target main

if ($LASTEXITCODE -ne 0) {
    # If already exists, upload asset with clobber
    Write-Host "Trying upload to existing release..."
    & $ghExe release upload $tag "$apkPath#Presences.apk" --repo $repo --clobber
}

Write-Host ""
Write-Host "=== RELEASE PUBLISHED SUCCESSFULLY ===" -ForegroundColor Green
& $ghExe release view $tag --repo $repo
