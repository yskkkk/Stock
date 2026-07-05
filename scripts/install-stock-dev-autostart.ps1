# Windows 로그인 시 Stock dev 서버 자동 기동 — 시작 프로그램 등록
$ErrorActionPreference = "Stop"

$Root = Split-Path $PSScriptRoot -Parent
$StartScript = Join-Path $PSScriptRoot "start-stock-dev-at-login.ps1"
$ShortcutName = "Stock-Dev-AutoStart.lnk"
$StartupDir = [Environment]::GetFolderPath("Startup")
$ShortcutPath = Join-Path $StartupDir $ShortcutName

if (-not (Test-Path $StartScript)) {
  Write-Error "not found: $StartScript"
}

$pwsh = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
$args = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$StartScript`""

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($ShortcutPath)
$shortcut.TargetPath = $pwsh
$shortcut.Arguments = $args
$shortcut.WorkingDirectory = $Root
$shortcut.WindowStyle = 7
$shortcut.Description = "Stock npm run dev:guard — 로그인 시 자동 기동"
$shortcut.Save()

Write-Host "등록 완료: 시작 프로그램"
Write-Host "  $ShortcutPath"
Write-Host "  다음 로그인부터 dev:guard 자동 기동 (http://127.0.0.1:5173)"
Write-Host "  로그: server\.logs\autostart-dev-guard.log"
Write-Host "  해제: npm run autostart:uninstall"
