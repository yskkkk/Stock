# Cursor 에이전트 자동 기동 해제 — 시작 프로그램·Run 키·작업 스케줄러
$ErrorActionPreference = "Stop"

$ShortcutName = "Cursor-Agent-AutoStart.lnk"
$StartupDir = [Environment]::GetFolderPath("Startup")
$ShortcutPath = Join-Path $StartupDir $ShortcutName
$RunKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"

if (Test-Path $ShortcutPath) {
  Remove-Item -LiteralPath $ShortcutPath -Force
  Write-Host "해제 완료: $ShortcutPath"
} else {
  Write-Host "시작 프로그램 항목 없음 — 이미 해제됨"
}

Remove-ItemProperty -Path $RunKey -Name "CursorAgent" -ErrorAction SilentlyContinue
Write-Host "HKCU Run CursorAgent 해제"

foreach ($name in @("CursorAgentLogon")) {
  cmd.exe /c "schtasks /Delete /F /TN `"$name`" >nul 2>&1"
  Write-Host "작업 '$name' 해제"
}
