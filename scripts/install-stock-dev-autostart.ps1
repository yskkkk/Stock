# Windows 로그인·부팅 후 Stock만 따로 자동 기동 (여행 업로드와 합치지 않음)
$ErrorActionPreference = "Stop"

$Root = Split-Path $PSScriptRoot -Parent
$StartCmd = Join-Path $PSScriptRoot "autostart-stock.cmd"
$Ensure = Join-Path $PSScriptRoot "ensure-stock-dev.ps1"
$WatchCmd = Join-Path $PSScriptRoot "watch-stock.cmd"
$ShortcutName = "Stock-Dev-AutoStart.lnk"
$StartupDir = [Environment]::GetFolderPath("Startup")
$ShortcutPath = Join-Path $StartupDir $ShortcutName
$RunKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$ps = Join-Path $env:WINDIR "System32\WindowsPowerShell\v1.0\powershell.exe"

if (-not (Test-Path $StartCmd)) { throw "not found: $StartCmd" }
if (-not (Test-Path $Ensure)) { throw "not found: $Ensure" }

function Enable-StartupApproved($kind, $name) {
  $path = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\$kind"
  if (-not (Test-Path $path)) { New-Item -Path $path -Force | Out-Null }
  New-ItemProperty -Path $path -Name $name -PropertyType Binary -Value ([byte[]](2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)) -Force | Out-Null
}

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($ShortcutPath)
$shortcut.TargetPath = $StartCmd
$shortcut.WorkingDirectory = $Root
$shortcut.WindowStyle = 1
$shortcut.Description = "Stock — 부팅 후 따로 자동 시작"
$shortcut.Save()

New-ItemProperty -Path $RunKey -Name "StockDev" -PropertyType String -Force -Value "`"$StartCmd`"" | Out-Null
Enable-StartupApproved "StartupFolder" $ShortcutName
Enable-StartupApproved "Run" "StockDev"

$action = New-ScheduledTaskAction -Execute $ps -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$Ensure`"" -WorkingDirectory $Root
$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 8) `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 5) `
  -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
$logon = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$logon.Delay = "PT60S"
$daily = New-ScheduledTaskTrigger -Daily -At "00:04"
$daily.Repetition = (New-ScheduledTaskTrigger -Once -At "00:04" -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration (New-TimeSpan -Hours 23)).Repetition
Register-ScheduledTask -TaskName "StockDevLogon" -Action $action -Trigger @($logon, $daily) -Settings $settings -Principal $principal -Force | Out-Null

cmd.exe /c "schtasks /Create /F /TN StockDevWatch /SC MINUTE /MO 5 /RL LIMITED /TR `"C:\Stock\scripts\watch-stock.cmd`""
Write-Output "task-minute=StockDevWatch exit=$LASTEXITCODE"

try { Start-ScheduledTask -TaskName "StockDevLogon" } catch { Write-Output "task-start=skip $($_.Exception.Message)" }
& $ps -NoProfile -ExecutionPolicy Bypass -File $Ensure
Write-Output "ensure=$LASTEXITCODE"
Write-Host "등록 완료: Stock만 따로 자동 시작"
Write-Host "  $ShortcutPath"
Write-Host "  HKCU Run StockDev"
Write-Host "  작업 StockDevLogon / StockDevWatch"
Write-Host "  해제: npm run autostart:uninstall"
