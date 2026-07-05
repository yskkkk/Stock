# Stock dev 자동 기동 — 시작 프로그램 해제
$ErrorActionPreference = "Stop"

$ShortcutName = "Stock-Dev-AutoStart.lnk"
$StartupDir = [Environment]::GetFolderPath("Startup")
$ShortcutPath = Join-Path $StartupDir $ShortcutName

if (Test-Path $ShortcutPath) {
  Remove-Item -LiteralPath $ShortcutPath -Force
  Write-Host "해제 완료: $ShortcutPath"
} else {
  Write-Host "시작 프로그램 항목 없음 — 이미 해제됨"
}

# 예전 작업 스케줄러 등록이 있으면 함께 제거
$TaskName = "Stock-Dev-AutoStart"
$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Host "작업 스케줄러 '$TaskName' 도 해제함"
}
