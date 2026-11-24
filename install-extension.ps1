param([switch]$NoRestart)

$ErrorActionPreference = "Stop"

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
    Write-Host "spicetify CLI not found in PATH or standard locations." -ForegroundColor Red
    Write-Host "Install Spicetify first: https://spicetify.app/docs/getting-started"
    exit 1
}

$userdataDir = (spicetify path userdata | Out-String).Trim()
if (-not $userdataDir) {
    $configPath = (spicetify -c | Out-String).Trim()
    $userdataDir = Split-Path -Path $configPath -Parent
}
$extDir = Join-Path $userdataDir "Extensions"
if (-not (Test-Path -LiteralPath $extDir)) {
    New-Item -ItemType Directory -Path $extDir -Force | Out-Null
}
Write-Host "Target Extensions dir: $extDir" -ForegroundColor DarkGray

$src = Join-Path $PSScriptRoot "extension\spotify-http-bridge.js"
$dst = Join-Path $extDir "spotify-http-bridge.js"

Copy-Item -LiteralPath $src -Destination $dst -Force
if (-not (Test-Path -LiteralPath $dst)) {
    Write-Host "Failed to copy extension to $dst" -ForegroundColor Red
    exit 1
}
Write-Host "Copied extension to $dst" -ForegroundColor Green

spicetify config extensions spotify-http-bridge.js
if ($NoRestart) {
    Stop-Process -Name Spotify -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 800
    spicetify apply -n
} else {
    spicetify apply
}

Write-Host "Done! Restart Spotify if needed, then run 'npm start' to launch the HTTP API server." -ForegroundColor Cyan
