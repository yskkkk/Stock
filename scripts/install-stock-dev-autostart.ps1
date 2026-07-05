# Windows 로그인 시 Stock dev 서버 자동 기동 — 시작 프로그램 (CMD 창)
$ErrorActionPreference = "Stop"

$Root = Split-Path $PSScriptRoot -Parent
$StartCmd = Join-Path $PSScriptRoot "start-stock-dev-at-login.cmd"
$ShortcutName = "Stock-Dev-AutoStart.lnk"
$StartupDir = [Environment]::GetFolderPath("Startup")
$ShortcutPath = Join-Path $StartupDir $ShortcutName

if (-not (Test-Path $StartCmd)) {
  Write-Error "not found: $StartCmd"
}

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($ShortcutPath)
$shortcut.TargetPath = $StartCmd
$shortcut.WorkingDirectory = $Root
$shortcut.WindowStyle = 1
$shortcut.Description = "Stock dev — CMD에서 npm run dev:guard"
$shortcut.Save()

Write-Host "등록 완료: 시작 프로그램 (CMD 창)"
Write-Host "  $ShortcutPath"
Write-Host "  -> $StartCmd"
Write-Host "  해제: npm run autostart:uninstall"
