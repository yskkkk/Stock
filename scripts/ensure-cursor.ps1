# Cursor 에이전트 — 이미 켜져 있으면 그대로, 없으면 Stock 워크스페이스로 연다.
$ErrorActionPreference = "Stop"
$root = "C:\Stock"
$log = Join-Path $root "logs\autostart-cursor.log"
$workspace = $root

function Write-Watch($line) {
  $dir = Split-Path $log
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
  Add-Content -Path $log -Value ("[{0}] {1}" -f (Get-Date).ToString("o"), $line) -Encoding utf8
}

function Get-CursorExe {
  $candidates = @(
    (Join-Path $env:LOCALAPPDATA "Programs\cursor\Cursor.exe"),
    (Join-Path $env:LOCALAPPDATA "Programs\cursor\_\Cursor.exe")
  )
  foreach ($p in $candidates) {
    if (Test-Path -LiteralPath $p) { return $p }
  }
  $proc = Get-CimInstance Win32_Process -Filter "Name='Cursor.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.ExecutablePath } |
    Select-Object -First 1
  if ($proc -and $proc.ExecutablePath -and (Test-Path -LiteralPath $proc.ExecutablePath)) {
    return $proc.ExecutablePath
  }
  return $null
}

if (Get-Process -Name Cursor -ErrorAction SilentlyContinue) {
  Write-Watch "running"
  exit 0
}

$exe = Get-CursorExe
if (-not $exe) {
  Write-Watch "missing Cursor.exe"
  exit 1
}

Start-Process -FilePath $exe -ArgumentList "`"$workspace`""
Write-Watch "started $exe"
exit 0
