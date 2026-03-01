# install-fegis.ps1 — Fegis Extension Installer for Windows
$ErrorActionPreference = "Stop"

$installDir = "$env:LOCALAPPDATA\Fegis\extension"
$zipUrl = "https://cheesehacks26.vercel.app/downloads/fegis-extension.zip"
$zipPath = "$env:TEMP\fegis-extension.zip"

Write-Host ""
Write-Host "  Fegis Extension Installer" -ForegroundColor Magenta
Write-Host ""

Write-Host "[1/3] Downloading extension..." -ForegroundColor Cyan
Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath -UseBasicParsing

Write-Host "[2/3] Extracting to $installDir..." -ForegroundColor Cyan
if (Test-Path $installDir) { Remove-Item -Recurse -Force $installDir }
New-Item -ItemType Directory -Force -Path $installDir | Out-Null
Expand-Archive -Path $zipPath -DestinationPath $installDir -Force
Remove-Item $zipPath -Force

Write-Host "[3/3] Opening Chrome extensions page..." -ForegroundColor Cyan
Start-Process "chrome" "chrome://extensions"

Write-Host ""
Write-Host "  Almost done! In Chrome:" -ForegroundColor Yellow
Write-Host "  1. Enable 'Developer mode' (top-right toggle)"
Write-Host "  2. Click 'Load unpacked'"
Write-Host "  3. Select: $installDir" -ForegroundColor Green
Write-Host ""
