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
    $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 "http://127.0.0.1:$port/api/health"
    return $r.StatusCode -ge 200 -and $r.StatusCode -lt 500
  } catch {
    try {
      $r2 = Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 "http://127.0.0.1:$port/api/access/status"
      return $r2.StatusCode -ge 200 -and $r2.StatusCode -lt 500
    } catch {
      return $false
    }
  }
}

function Get-StockProcs {
  $nodes = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object {
      $_.CommandLine -and (
        $_.CommandLine -match "C:\\Stock.*dev-server-guard\.mjs|C:\\Stock.*vite\.js|scripts\\dev-server-guard\.mjs|vite\\bin\\vite\.js"
      ) -and ($_.CommandLine -notmatch "kis-account")
    })
  $cmds = @(Get-CimInstance Win32_Process -Filter "Name='cmd.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and ($_.CommandLine -match "autostart-stock\.cmd") })
  return @($nodes) + @($cmds)
}

function Stop-StockProcs {
  $procs = @(Get-StockProcs)
  foreach ($p in $procs) {
    try {
      Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
    } catch {}
  }
  Start-Sleep -Seconds 1
  # free port leftovers
  $lines = @(netstat -ano | Select-String ":$port\s+.*LISTENING")
  foreach ($l in $lines) {
    if ($l.Line -match "\s(\d+)\s*$") {
      $id = [int]$Matches[1]
      try { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue } catch {}
    }
  }
  Start-Sleep -Seconds 1
}

if (-not (Test-Path $root)) { throw "no $root" }
if (Test-StockUp) {
  Write-Watch "running port=$port"
  exit 0
}

$live = @(Get-StockProcs)
if ($live.Count -gt 0) {
  Write-Watch ("unhealthy-procs pid=" + (($live | ForEach-Object { $_.ProcessId }) -join ",") + " — restart")
  Stop-StockProcs
}

if (-not (Test-Path $cmd)) { throw "missing $cmd" }
Start-Process -FilePath $cmd -ArgumentList "/quiet" -WorkingDirectory $root -WindowStyle Minimized
for ($w = 0; $w -lt 45; $w += 1) {
  Start-Sleep -Seconds 2
  if (Test-StockUp) {
    Write-Watch "started"
    exit 0
  }
}
Write-Watch "start-failed"
exit 1
