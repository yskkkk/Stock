# Register Windows scheduled task: daily 05:40 wake alarm (local time, KST recommended)
param(
  [string]$TaskName = "YSTOCK-Wake-Alarm-0540-KST"
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$AlarmScript = Join-Path $RepoRoot "scripts\wake-alarm.ps1"
if (-not (Test-Path -LiteralPath $AlarmScript)) {
  Write-Error "wake-alarm.ps1 not found: $AlarmScript"
}

$PsExe = (Get-Command powershell.exe).Source
$Args = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Normal -File `"$AlarmScript`""

$Action = New-ScheduledTaskAction -Execute $PsExe -Argument $Args -WorkingDirectory $RepoRoot
$Trigger = New-ScheduledTaskTrigger -Daily -At "05:40"
$Settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Hours 4)

$Principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $Action `
  -Trigger $Trigger `
  -Settings $Settings `
  -Principal $Principal `
  -Description "YSTOCK daily 05:40 wake alarm until OK. $RepoRoot" `
  -Force | Out-Null

$tz = Get-TimeZone
Write-Host "Registered: $TaskName at 05:40 daily"
Write-Host "Timezone: $($tz.Id)"
Write-Host "Test: npm run alarm:test"
Write-Host "Remove: Unregister-ScheduledTask -TaskName '$TaskName' -Confirm:`$false"
