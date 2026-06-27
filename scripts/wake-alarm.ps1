# YSTOCK wake alarm - daily 05:40, loops until OK clicked
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/wake-alarm.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/wake-alarm.ps1 -Test
param(
  [switch]$Test,
  [int]$TestSeconds = 12
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms

$MediaDir = Join-Path $env:WINDIR "Media"
$WavPath = @(
  (Join-Path $MediaDir "Alarm01.wav"),
  (Join-Path $MediaDir "Alarm02.wav"),
  (Join-Path $MediaDir "Windows Notify System Generic.wav")
) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1

$BeepWorkerScript = @'
$wav = $env:YSTOCK_ALARM_WAV
$player = $null
if ($wav -and (Test-Path -LiteralPath $wav)) {
  try {
    $player = New-Object System.Media.SoundPlayer($wav)
    $player.Load()
  } catch { }
}
while ($true) {
  foreach ($f in 880,1100,1320,880,1100,1320) {
    try { [Console]::Beep($f, 320) } catch { Start-Sleep -Milliseconds 320 }
  }
  try { [System.Media.SystemSounds]::Exclamation.Play() } catch { }
  try { [System.Media.SystemSounds]::Hand.Play() } catch { }
  if ($player) { try { $player.PlaySync() } catch { } }
  Start-Sleep -Milliseconds 160
}
'@

function Start-AlarmBeepWorker {
  if ($WavPath) { $env:YSTOCK_ALARM_WAV = $WavPath }
  return Start-Process -FilePath "powershell.exe" -PassThru -WindowStyle Hidden -ArgumentList @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-Command", $BeepWorkerScript
  )
}

function Stop-AlarmBeepWorker([System.Diagnostics.Process]$proc) {
  if ($proc -and -not $proc.HasExited) {
    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
  }
}

function Play-AlarmBurstOnce {
  foreach ($freq in @(880, 1100, 1320, 880, 1100)) {
    try { [Console]::Beep($freq, 280) } catch { }
  }
  try { [System.Media.SystemSounds]::Exclamation.Play() } catch { }
  if ($WavPath) {
    try {
      $p = New-Object System.Media.SoundPlayer($WavPath)
      $p.PlaySync()
      $p.Dispose()
    } catch { }
  }
}

if ($Test) {
  Write-Host "wake-alarm TEST ${TestSeconds}s - Beep 880/1100/1320Hz + SystemSounds + WAV"
  if ($WavPath) { Write-Host "WAV: $WavPath" }
  else { Write-Host "WAV missing - Beep and SystemSounds only" }
  $deadline = (Get-Date).AddSeconds($TestSeconds)
  while ((Get-Date) -lt $deadline) {
    Play-AlarmBurstOnce
    Start-Sleep -Milliseconds 120
  }
  Write-Host "wake-alarm TEST done"
  exit 0
}

$worker = Start-AlarmBeepWorker
try {
  $nowKst = try {
    [TimeZoneInfo]::ConvertTimeBySystemTimeZoneId((Get-Date), "Korea Standard Time").ToString("yyyy-MM-dd HH:mm:ss")
  } catch {
    (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
  }
  $wavNote = if ($WavPath) { "WAV: $WavPath" } else { "WAV missing - Beep and SystemSounds" }

  $body = "KST now: $nowKst`n`nAlarm is ringing.`nClick OK when you are awake.`n`n$wavNote"
  [void][System.Windows.Forms.MessageBox]::Show(
    $body,
    "YSTOCK Wake Alarm 05:40",
    [System.Windows.Forms.MessageBoxButtons]::OK,
    [System.Windows.Forms.MessageBoxIcon]::Exclamation,
    [System.Windows.Forms.MessageBoxDefaultButton]::Button1,
    [System.Windows.Forms.MessageBoxOptions]::DefaultDesktopOnly
  )
} finally {
  Stop-AlarmBeepWorker $worker
}
