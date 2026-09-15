$ErrorActionPreference = "Stop"
$root = "C:\Stock"
$log = Join-Path $root "logs\autostart-stock.log"
$cmd = Join-Path $root "scripts\autostart-stock.cmd"
$port = if ($env:VITE_DEV_PORT) { [int]$env:VITE_DEV_PORT } else { 5173 }

function Write-Watch($line) {
  $dir = Split-Path $log
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
  Add-Content -Path $log -Value ("[{0}] {1}" -f (Get-Date).ToString("o"), $line) -Encoding utf8
}

function Test-StockUp {
  try {
    $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 "http://127.0.0.1:$port/api/access/status"
    return $r.StatusCode -ge 200 -and $r.StatusCode -lt 500
  } catch {
    return $false
  }
}

function Get-StockProcs {
  $nodes = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and ($_.CommandLine -match "dev-server-guard\.mjs|vite\.js") })
  $cmds = @(Get-CimInstance Win32_Process -Filter "Name='cmd.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and ($_.CommandLine -match "autostart-stock\.cmd") })
  return @($nodes) + @($cmds)
}

if (-not (Test-Path $root)) { throw "no $root" }
if (Test-StockUp) {
  Write-Watch "running port=$port"
  exit 0
}

$live = @(Get-StockProcs)
if ($live.Count -gt 0) {
  Write-Watch ("starting pid=" + (($live | ForEach-Object { $_.ProcessId }) -join ","))
  for ($w = 0; $w -lt 20; $w += 1) {
    Start-Sleep -Seconds 2
    if (Test-StockUp) { Write-Watch "running after-wait"; exit 0 }
  }
}

if (-not (Test-Path $cmd)) { throw "missing $cmd" }
Start-Process -FilePath $cmd -WorkingDirectory $root
for ($w = 0; $w -lt 25; $w += 1) {
  Start-Sleep -Seconds 2
  if (Test-StockUp) { Write-Watch "started"; exit 0 }
  $again = @(Get-StockProcs)
  if ($again.Count -gt 0 -and $w -ge 3) {
    Write-Watch ("launched pid=" + (($again | ForEach-Object { $_.ProcessId }) -join ","))
    exit 0
  }
}
Write-Watch "start-failed"
exit 1
