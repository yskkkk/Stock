# Stock dev — Windows 로그인 시 1회 기동 (이미 떠 있으면 생략)
$ErrorActionPreference = "Stop"
$Root = Split-Path $PSScriptRoot -Parent
$LogDir = Join-Path $Root "server\.logs"
$LogFile = Join-Path $LogDir "autostart-dev-guard.log"
$Port = if ($env:VITE_DEV_PORT) { [int]$env:VITE_DEV_PORT } else { 5173 }

function Write-Log([string]$msg) {
  $line = "$(Get-Date -Format o) $msg"
  New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
  Add-Content -Path $LogFile -Value $line -Encoding utf8
}

function Test-DevServerUp {
  try {
    $uri = "http://127.0.0.1:$Port/api/access/status"
    $r = Invoke-WebRequest -Uri $uri -UseBasicParsing -TimeoutSec 8
    return $r.StatusCode -ge 200 -and $r.StatusCode -lt 500
  } catch {
    return $false
  }
}

try {
  if (Test-DevServerUp) {
    Write-Log "port $Port already up — skip"
    exit 0
  }

  $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  if ($machinePath -and $userPath) {
    $env:Path = "$machinePath;$userPath"
  }

  Set-Location $Root
  Write-Log "starting npm run dev:guard (cwd=$Root)"

  Start-Process `
    -FilePath "npm.cmd" `
    -ArgumentList "run", "dev:guard" `
    -WorkingDirectory $Root `
    -WindowStyle Minimized

  Write-Log "spawned dev:guard"
  exit 0
} catch {
  Write-Log "ERROR: $($_.Exception.Message)"
  exit 1
}
