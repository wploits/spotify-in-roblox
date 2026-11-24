param([switch]$Uninstall)

$ErrorActionPreference = "Stop"

$startupDir = [Environment]::GetFolderPath("Startup")
$shortcutPath = Join-Path $startupDir "SpotifyHttpBridge.lnk"

if ($Uninstall) {
    if (Test-Path -LiteralPath $shortcutPath) {
        Remove-Item -LiteralPath $shortcutPath -Force
        Write-Host "Removed autostart shortcut: $shortcutPath" -ForegroundColor Yellow
    } else {
        Write-Host "Autostart shortcut not found." -ForegroundColor DarkGray
    }
    exit 0
}

$vbsPath = Join-Path $PSScriptRoot "start-bridge-hidden.vbs"
if (-not (Test-Path -LiteralPath $vbsPath)) {
    Write-Host "Missing launcher: $vbsPath" -ForegroundColor Red
    exit 1
}

$wsh = New-Object -ComObject WScript.Shell
$shortcut = $wsh.CreateShortcut($shortcutPath)
$shortcut.TargetPath = "wscript.exe"
$shortcut.Arguments = "`"$vbsPath`""
$shortcut.WorkingDirectory = $PSScriptRoot
$shortcut.Description = "Spotify HTTP Bridge (Background Server)"
$shortcut.Save()

Write-Host "Registered autostart shortcut: $shortcutPath" -ForegroundColor Green
Write-Host "The bridge server will now start automatically in the background on Windows login." -ForegroundColor Cyan
