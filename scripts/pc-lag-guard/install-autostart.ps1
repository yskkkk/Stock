# 로그인 시 PC Lag Guard 자동 시작 (현재 사용자 Run 키)
param(
  [switch]$Uninstall
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$GuardPs1 = Join-Path $ScriptDir "pc-lag-guard.ps1"
$Name = "StockPcLagGuard"
$RunKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"

if ($Uninstall) {
  Remove-ItemProperty -Path $RunKey -Name $Name -ErrorAction SilentlyContinue
  Write-Host "Removed autostart: $Name"
  exit 0
}

if (-not (Test-Path -LiteralPath $GuardPs1)) {
  throw "missing $GuardPs1"
}

$cmd = 'powershell.exe -NoProfile -WindowStyle Minimized -ExecutionPolicy Bypass -File "{0}"' -f $GuardPs1
New-ItemProperty -Path $RunKey -Name $Name -Value $cmd -PropertyType String -Force | Out-Null
Write-Host "Installed autostart: $Name"
Write-Host $cmd
