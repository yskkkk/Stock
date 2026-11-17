# Remove Stock server auto-start (Startup / Run / scheduled tasks).
# Keeps the Python server-manager Startup shortcut unless -RemoveManager is set.
param(
  [switch]$RemoveManager
)

$ErrorActionPreference = "Stop"

$ShortcutName = "Stock-Dev-AutoStart.lnk"
$ManagerShortcutName = "Server-Manager.lnk"
$LegacyManagerName = ([string]::Concat([char]0xC11C, [char]0xBC84, " ", [char]0xAD00, [char]0xB9AC, ".lnk"))
$StartupDir = [Environment]::GetFolderPath("Startup")
$ShortcutPath = Join-Path $StartupDir $ShortcutName
$ManagerShortcutPath = Join-Path $StartupDir $ManagerShortcutName
$LegacyManagerPath = Join-Path $StartupDir $LegacyManagerName
$RunKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$DisabledMarker = Join-Path $PSScriptRoot "AUTOSTART_DISABLED"

if (Test-Path $ShortcutPath) {
  Remove-Item -LiteralPath $ShortcutPath -Force
  Write-Host "removed: $ShortcutPath"
} else {
  Write-Host "Startup Stock-Dev-AutoStart already gone"
}

Remove-ItemProperty -Path $RunKey -Name "StockDev" -ErrorAction SilentlyContinue
Write-Host "HKCU Run StockDev removed"

foreach ($name in @("Stock-Dev-AutoStart", "StockDevLogon", "StockDevWatch")) {
  cmd.exe /c "schtasks /Delete /F /TN `"$name`" >nul 2>&1" | Out-Null
  Write-Host "task '$name' removed"
}

if (-not (Test-Path $DisabledMarker)) {
  Set-Content -Path $DisabledMarker -Value ("manual-only via server-manager {0}`n" -f (Get-Date).ToString("o")) -Encoding utf8
}
Write-Host "marker: $DisabledMarker"

if ($RemoveManager) {
  foreach ($p in @($ManagerShortcutPath, $LegacyManagerPath)) {
    if (Test-Path -LiteralPath $p) {
      Remove-Item -LiteralPath $p -Force
      Write-Host "removed manager shortcut: $p"
    }
  }
} else {
  Write-Host "kept manager shortcut (use -RemoveManager to drop it)"
}
