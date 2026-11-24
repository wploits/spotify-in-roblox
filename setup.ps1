$ErrorActionPreference = "Stop"

Write-Host "=== spotify in roblox - Setup ===" -ForegroundColor Green

# 1. Check Node.js
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "Node.js is not installed. Please install Node.js LTS from https://nodejs.org/ and run this script again." -ForegroundColor Red
    exit 1
}

# 2. Check Spicetify
$spicetifyCmd = Get-Command spicetify -ErrorAction SilentlyContinue
if (-not $spicetifyCmd) {
    $candidates = @(
        (Join-Path $env:LOCALAPPDATA "spicetify\spicetify.exe"),
        (Join-Path $env:USERPROFILE ".spicetify\spicetify.exe"),
        (Join-Path $env:USERPROFILE "spicetify-cli\spicetify.exe")
    )
    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate) {
            $env:PATH = "$(Split-Path -Path $candidate -Parent);$env:PATH"
            $spicetifyCmd = Get-Command spicetify -ErrorAction SilentlyContinue
            break
        }
    }
}
if (-not $spicetifyCmd) {
    Write-Host "Spicetify CLI not found. Install it first in PowerShell:" -ForegroundColor Red
    Write-Host "  iwr -useb https://raw.githubusercontent.com/spicetify/cli/main/install.ps1 | iex" -ForegroundColor Yellow
    exit 1
}

# 3. Install npm packages
Write-Host "[1/4] Installing dependencies..." -ForegroundColor Cyan
Set-Location -LiteralPath $PSScriptRoot
npm install

# 4. Install Spicetify extension
Write-Host "[2/4] Installing Spicetify extension..." -ForegroundColor Cyan
& (Join-Path $PSScriptRoot "install-extension.ps1")

# 5. Register background autostart on login
Write-Host "[3/4] Registering Windows startup autostart..." -ForegroundColor Cyan
& (Join-Path $PSScriptRoot "install-autostart.ps1")

# 6. Launch background bridge server right now
Write-Host "[4/4] Starting background HTTP bridge server..." -ForegroundColor Cyan
$vbsPath = Join-Path $PSScriptRoot "start-bridge-hidden.vbs"
Start-Process -FilePath "wscript.exe" -ArgumentList "`"$vbsPath`""

Write-Host ""
Write-Host "Setup complete!" -ForegroundColor Green
Write-Host "Run this in Roblox:" -ForegroundColor Cyan
Write-Host 'loadstring(game:HttpGet("https://raw.githubusercontent.com/wploits/spotify-in-roblox/main/roblox/spotify-player.lua"))()' -ForegroundColor White
