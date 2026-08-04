# PC Lag Guard — Windows 주기 감시 + 안전 정리
# 사용:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\pc-lag-guard\pc-lag-guard.ps1
#   powershell ... -File scripts\pc-lag-guard\pc-lag-guard.ps1 -Once
#   powershell ... -File scripts\pc-lag-guard\pc-lag-guard.ps1 -DryRun
#
# 기본: CPU/메모리/디스크가 연속으로 임계치를 넘으면 DNS flush · 워킹셋 trim · 오래된 TEMP 정리 · (옵션) 안전 패턴 프로세스만 종료

param(
  [switch]$Once,
  [switch]$DryRun,
  [string]$ConfigPath = ""
)

$ErrorActionPreference = "Continue"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $ConfigPath) { $ConfigPath = Join-Path $ScriptDir "config.json" }
$LogPath = Join-Path $ScriptDir "pc-lag-guard.log"
$StatePath = Join-Path $ScriptDir "pc-lag-guard.state.json"

function Read-Config {
  if (-not (Test-Path -LiteralPath $ConfigPath)) {
    throw "config not found: $ConfigPath"
  }
  return (Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json)
}

function Write-Log([string]$msg) {
  $line = "{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg
  Write-Host $line
  try {
    Add-Content -LiteralPath $LogPath -Value $line -Encoding UTF8
    $cfg = $script:Config
    if ($cfg -and (Test-Path -LiteralPath $LogPath)) {
      $maxBytes = [int](($cfg.logMaxKb | ForEach-Object { $_ }) * 1024)
      if ($maxBytes -lt 64KB) { $maxBytes = 512KB }
      $len = (Get-Item -LiteralPath $LogPath).Length
      if ($len -gt $maxBytes) {
        $tail = Get-Content -LiteralPath $LogPath -Tail 200 -ErrorAction SilentlyContinue
        Set-Content -LiteralPath $LogPath -Value $tail -Encoding UTF8
      }
    }
  } catch { }
}

function Get-Sample {
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  $cpu = 0.0
  try {
    $cpu = [double](Get-Counter '\Processor(_Total)\% Processor Time' -ErrorAction Stop).CounterSamples[0].CookedValue
  } catch {
    try {
      $cpu = [double](Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average
    } catch { $cpu = 0 }
  }

  $os = Get-CimInstance Win32_OperatingSystem
  $availMb = [math]::Round([double]$os.FreePhysicalMemory / 1024.0, 1)
  $totalMb = [math]::Round([double]$os.TotalVisibleMemorySize / 1024.0, 1)
  $commitPct = 0.0
  if ($totalMb -gt 0) {
    $commitPct = [math]::Round(100.0 * (1.0 - ($availMb / $totalMb)), 1)
  }

  $diskQ = 0.0
  try {
    $diskQ = [double](Get-Counter '\PhysicalDisk(_Total)\Current Disk Queue Length' -ErrorAction Stop).CounterSamples[0].CookedValue
  } catch { $diskQ = 0 }

  $sw.Stop()
  return [pscustomobject]@{
    AtMs        = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
    CpuPercent  = [math]::Round($cpu, 1)
    AvailMemMb  = $availMb
    CommitPct   = $commitPct
    DiskQueue   = [math]::Round($diskQ, 2)
    SampleMs    = $sw.ElapsedMilliseconds
  }
}

function Test-IsLaggy($sample, $th) {
  $reasons = @()
  if ($sample.CpuPercent -ge [double]$th.cpuPercent) { $reasons += ("cpu={0}%" -f $sample.CpuPercent) }
  if ($sample.AvailMemMb -le [double]$th.availMemMb) { $reasons += ("availRam={0}MB" -f $sample.AvailMemMb) }
  if ($sample.CommitPct -ge [double]$th.commitPercent) { $reasons += ("commit={0}%" -f $sample.CommitPct) }
  if ($sample.DiskQueue -ge [double]$th.diskQueue) { $reasons += ("diskQ={0}" -f $sample.DiskQueue) }
  if ($sample.SampleMs -ge [double]$th.sampleSlowMs) { $reasons += ("sampleSlow={0}ms" -f $sample.SampleMs) }
  return ,$reasons
}

function Get-TopProcesses([int]$n = 8) {
  Get-Process -ErrorAction SilentlyContinue |
    Sort-Object -Property @{Expression = 'CPU'; Descending = $true}, @{Expression = 'WorkingSet64'; Descending = $true} |
    Select-Object -First $n Name, Id, @{N = 'CpuSec'; E = { [math]::Round($_.CPU, 1) } }, @{N = 'MemMb'; E = { [math]::Round($_.WorkingSet64 / 1MB, 0) } }
}

function Invoke-TrimWorkingSets {
  if ($DryRun) {
    Write-Log "[dry-run] trim working sets"
    return
  }
  $sig = @'
using System;
using System.Runtime.InteropServices;
public static class NativeWs {
  [DllImport("psapi.dll")]
  public static extern bool EmptyWorkingSet(IntPtr hProcess);
  [DllImport("kernel32.dll")]
  public static extern IntPtr OpenProcess(uint dwDesiredAccess, bool bInheritHandle, int dwProcessId);
  [DllImport("kernel32.dll")]
  public static extern bool CloseHandle(IntPtr hObject);
  public const uint PROCESS_QUERY_INFORMATION = 0x0400;
  public const uint PROCESS_SET_QUOTA = 0x0100;
}
'@
  try {
    if (-not ("NativeWs" -as [type])) {
      Add-Type -TypeDefinition $sig -ErrorAction Stop
    }
  } catch {
    Write-Log ("trim WS Add-Type fail: {0}" -f $_.Exception.Message)
    return
  }

  $protected = @("Idle", "System", "Registry", "Memory Compression", "Secure System", "csrss", "smss", "wininit", "services", "lsass", "winlogon", "dwm", "fontdrvhost")
  $trimmed = 0
  foreach ($p in Get-Process -ErrorAction SilentlyContinue) {
    if ($protected -contains $p.Name) { continue }
    if ($p.WorkingSet64 -lt 80MB) { continue }
    try {
      $h = [NativeWs]::OpenProcess(0x0500, $false, $p.Id)
      if ($h -eq [IntPtr]::Zero) { continue }
      try {
        if ([NativeWs]::EmptyWorkingSet($h)) { $trimmed++ }
      } finally {
        [void][NativeWs]::CloseHandle($h)
      }
    } catch { }
  }
  Write-Log ("trimmed working sets: {0} processes" -f $trimmed)
}

function Invoke-FlushDns {
  if ($DryRun) {
    Write-Log "[dry-run] ipconfig /flushdns"
    return
  }
  try {
    & ipconfig /flushdns | Out-Null
    Write-Log "flushed DNS"
  } catch {
    Write-Log ("flushdns fail: {0}" -f $_.Exception.Message)
  }
}

function Invoke-CleanTemp([int]$olderHours) {
  if ($olderHours -le 0) { return }
  $cutoff = (Get-Date).AddHours(-[math]::Abs($olderHours))
  $roots = @(
    $env:TEMP,
    (Join-Path $env:LOCALAPPDATA "Temp")
  ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -Unique

  $removed = 0
  foreach ($root in $roots) {
    Get-ChildItem -LiteralPath $root -Force -ErrorAction SilentlyContinue |
      Where-Object {
        -not $_.PSIsContainer -and
        $_.LastWriteTime -lt $cutoff -and
        $_.Length -lt 80MB
      } |
      Select-Object -First 400 |
      ForEach-Object {
        if ($DryRun) { $removed++; return }
        try {
          Remove-Item -LiteralPath $_.FullName -Force -ErrorAction Stop
          $removed++
        } catch { }
      }
  }
  Write-Log ("temp cleanup removed≈{0} files older than {1}h" -f $removed, $olderHours)
}

function Test-NameProtected([string]$name, $neverList) {
  foreach ($frag in $neverList) {
    if ($name -like ("*{0}*" -f $frag)) { return $true }
  }
  return $false
}

function Invoke-SafeKill($patterns, $neverList) {
  if (-not $patterns -or $patterns.Count -eq 0) { return }
  $killed = 0
  foreach ($pat in $patterns) {
    $rx = [regex]::new($pat, [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
      Where-Object {
        $cmd = [string]($_.CommandLine)
        $nm = [string]($_.Name)
        if (-not $cmd -and -not $nm) { return $false }
        if (Test-NameProtected $nm $neverList) { return $false }
        if (Test-NameProtected $cmd $neverList) { return $false }
        return ($rx.IsMatch($cmd) -or $rx.IsMatch($nm))
      } |
      ForEach-Object {
        $msg = "safe-kill pid={0} name={1}" -f $_.ProcessId, $_.Name
        if ($DryRun) {
          Write-Log ("[dry-run] {0}" -f $msg)
          return
        }
        try {
          Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop
          Write-Log $msg
          $killed++
        } catch {
          Write-Log ("{0} fail: {1}" -f $msg, $_.Exception.Message)
        }
      }
  }
  if ($killed -gt 0) { Write-Log ("safe-kill count={0}" -f $killed) }
}

function Test-ExplorerHung {
  $tray = Get-Process explorer -ErrorAction SilentlyContinue
  if (-not $tray) { return $true }
  try {
    $shell = New-Object -ComObject Shell.Application
    $null = $shell.Windows()
    return $false
  } catch {
    return $true
  }
}

function Invoke-RestartExplorer {
  if (-not (Test-ExplorerHung)) { return }
  Write-Log "explorer appears hung"
  if ($DryRun) {
    Write-Log "[dry-run] restart explorer"
    return
  }
  try {
    Stop-Process -Name explorer -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
    Start-Process explorer.exe
    Write-Log "restarted explorer"
  } catch {
    Write-Log ("explorer restart fail: {0}" -f $_.Exception.Message)
  }
}

function Invoke-Remediate($reasons) {
  Write-Log ("LAG detected: {0}" -f ($reasons -join ", "))
  $tops = Get-TopProcesses 8
  foreach ($t in $tops) {
    Write-Log ("  top {0} pid={1} cpuSec={2} memMb={3}" -f $t.Name, $t.Id, $t.CpuSec, $t.MemMb)
  }

  $a = $script:Config.actions
  if ($a.beep) {
    try { [Console]::Beep(660, 120); [Console]::Beep(440, 180) } catch { }
  }
  if ($a.flushDns) { Invoke-FlushDns }
  if ($a.trimWorkingSets) { Invoke-TrimWorkingSets }
  if ([int]$a.cleanTempOlderHours -gt 0) { Invoke-CleanTemp ([int]$a.cleanTempOlderHours) }
  if ($a.killSafePatterns) {
    Invoke-SafeKill $script:Config.safeKillPatterns $script:Config.neverKillNameContains
  }
  if ($a.restartExplorerIfHung) { Invoke-RestartExplorer }
  Write-Log "remediation done"
}

function Save-State($streak, $last) {
  $obj = [pscustomobject]@{
    streak = $streak
    last   = $last
  }
  $obj | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $StatePath -Encoding UTF8
}

# --- main ---
$script:Config = Read-Config
$streak = 0
Write-Log ("pc-lag-guard start once={0} dryRun={1} poll={2}s sustain={3}" -f `
  [bool]$Once, [bool]$DryRun, $script:Config.pollIntervalSec, $script:Config.sustainSamples)

while ($true) {
  $sample = Get-Sample
  $reasons = Test-IsLaggy $sample $script:Config.thresholds
  $summary = "cpu={0}% avail={1}MB commit={2}% diskQ={3} sampleMs={4}" -f `
    $sample.CpuPercent, $sample.AvailMemMb, $sample.CommitPct, $sample.DiskQueue, $sample.SampleMs

  if ($reasons.Count -gt 0) {
    $streak++
    Write-Log ("warn[{0}/{1}] {2} :: {3}" -f $streak, $script:Config.sustainSamples, $summary, ($reasons -join ", "))
    if ($streak -ge [int]$script:Config.sustainSamples) {
      Invoke-Remediate $reasons
      $streak = 0
      Start-Sleep -Seconds 20
    }
  } else {
    if ($streak -gt 0) { Write-Log ("ok recover {0}" -f $summary) }
    $streak = 0
  }

  Save-State $streak $sample
  if ($Once) { break }
  $sleep = [math]::Max(10, [int]$script:Config.pollIntervalSec)
  Start-Sleep -Seconds $sleep
}

Write-Log "pc-lag-guard exit"
