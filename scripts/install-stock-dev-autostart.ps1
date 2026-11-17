# Boot: Python server-manager GUI only. Servers start manually from that UI.
$ErrorActionPreference = "Stop"

$Root = Split-Path $PSScriptRoot -Parent
$ManagerPy = Join-Path $PSScriptRoot "server-manager\server_manager.py"
$DisabledMarker = Join-Path $PSScriptRoot "AUTOSTART_DISABLED"
# ASCII name avoids PowerShell encoding issues with Korean filenames in scripts.
$ShortcutName = "Server-Manager.lnk"
$LegacyManagerName = ([string]::Concat([char]0xC11C, [char]0xBC84, " ", [char]0xAD00, [char]0xB9AC, ".lnk")) # 서버 관리.lnk
$OldShortcutName = "Stock-Dev-AutoStart.lnk"
$StartupDir = [Environment]::GetFolderPath("Startup")
$ShortcutPath = Join-Path $StartupDir $ShortcutName
$LegacyManagerPath = Join-Path $StartupDir $LegacyManagerName
$OldShortcutPath = Join-Path $StartupDir $OldShortcutName
$RunKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"

if (-not (Test-Path $ManagerPy)) { throw "not found: $ManagerPy" }

function Enable-StartupApproved($kind, $name) {
  $path = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\$kind"
  if (-not (Test-Path $path)) { New-Item -Path $path -Force | Out-Null }
  New-ItemProperty -Path $path -Name $name -PropertyType Binary -Value ([byte[]](2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)) -Force | Out-Null
}

# Remove legacy auto-start of npm/dev server
if (Test-Path $OldShortcutPath) {
  Remove-Item -LiteralPath $OldShortcutPath -Force
  Write-Host "removed legacy: $OldShortcutPath"
}
Remove-ItemProperty -Path $RunKey -Name "StockDev" -ErrorAction SilentlyContinue
foreach ($name in @("Stock-Dev-AutoStart", "StockDevLogon", "StockDevWatch")) {
  cmd.exe /c "schtasks /Delete /F /TN `"$name`" >nul 2>&1" | Out-Null
}

# Block ensure/watch from resurrecting the server
Set-Content -Path $DisabledMarker -Value ("manual-only via server-manager {0}`n" -f (Get-Date).ToString("o")) -Encoding utf8

# Prefer pyw.exe; fall back to start-server-manager.cmd
$pyw = Join-Path $env:WINDIR "pyw.exe"
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($ShortcutPath)
if (Test-Path $pyw) {
  $shortcut.TargetPath = $pyw
  $shortcut.Arguments = "-3 `"$ManagerPy`""
} else {
  $shortcut.TargetPath = Join-Path $PSScriptRoot "start-server-manager.cmd"
  $shortcut.Arguments = ""
}
$shortcut.WorkingDirectory = $Root
$shortcut.WindowStyle = 1
$shortcut.Description = "Local server manager — manual start only"
$shortcut.Save()
Enable-StartupApproved "StartupFolder" $ShortcutName

# Drop duplicate Korean-named shortcut if present
if (Test-Path -LiteralPath $LegacyManagerPath) {
  Remove-Item -LiteralPath $LegacyManagerPath -Force
  Write-Host "removed duplicate: $LegacyManagerPath"
}

Write-Host "Registered: boot opens server-manager GUI only"
Write-Host "  $ShortcutPath"
Write-Host "  marker $DisabledMarker"
Write-Host "  Servers: start manually from GUI (or npm run servers:manage)"
