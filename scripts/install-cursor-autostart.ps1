# Windows 로그인 후 Cursor 에이전트만 따로 자동 기동 (여행 업로드·Stock 개발 서버와 합치지 않음)
$ErrorActionPreference = "Stop"

$Root = Split-Path $PSScriptRoot -Parent
$StartCmd = Join-Path $PSScriptRoot "autostart-cursor.cmd"
$Ensure = Join-Path $PSScriptRoot "ensure-cursor.ps1"
$ShortcutName = "Cursor-Agent-AutoStart.lnk"
$StartupDir = [Environment]::GetFolderPath("Startup")
$ShortcutPath = Join-Path $StartupDir $ShortcutName
$RunKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$ps = Join-Path $env:WINDIR "System32\WindowsPowerShell\v1.0\powershell.exe"
$cmdExe = Join-Path $env:WINDIR "System32\cmd.exe"

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
$shortcut.Description = "Cursor 에이전트 — 부팅 후 따로 자동 시작"
$shortcut.Save()

New-ItemProperty -Path $RunKey -Name "CursorAgent" -PropertyType String -Force -Value "`"$cmdExe`" /c start `"`" `"$StartCmd`"" | Out-Null
Enable-StartupApproved "StartupFolder" $ShortcutName
Enable-StartupApproved "Run" "CursorAgent"

$action = New-ScheduledTaskAction -Execute $ps -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$Ensure`"" -WorkingDirectory $Root
$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 5) `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 5) `
  -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
$logon = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$logon.Delay = "PT25S"
Register-ScheduledTask -TaskName "CursorAgentLogon" -Action $action -Trigger $logon -Settings $settings -Principal $principal -Force | Out-Null

try { Start-ScheduledTask -TaskName "CursorAgentLogon" } catch { Write-Output "task-start=skip $($_.Exception.Message)" }
& $ps -NoProfile -ExecutionPolicy Bypass -File $Ensure
Write-Output "ensure=$LASTEXITCODE"
Write-Host "등록 완료: Cursor 에이전트만 따로 자동 시작"
Write-Host "  $ShortcutPath"
Write-Host "  HKCU Run CursorAgent"
Write-Host "  작업 CursorAgentLogon"
Write-Host "  해제: npm run cursor:autostart:uninstall"
