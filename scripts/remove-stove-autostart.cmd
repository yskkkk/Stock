@echo off
setlocal EnableExtensions
net session >nul 2>&1
if errorlevel 1 (
  echo [STOVE] Admin required. UAC prompt next...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b 0
)

echo [STOVE] Removing boot autostart...
reg delete "HKLM\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Run" /v STOVE /f >nul 2>&1
if errorlevel 1 (
  echo [STOVE] WARN: Run key delete failed
) else (
  echo [STOVE] Run key removed
)

if exist "C:\ProgramData\Smilegate\STOVE" (
  echo [STOVE] Removing C:\ProgramData\Smilegate\STOVE ...
  rd /s /q "C:\ProgramData\Smilegate\STOVE" 2>nul
  if exist "C:\ProgramData\Smilegate\STOVE" (
    ren "C:\ProgramData\Smilegate\STOVE\STOVE.exe" "STOVE.exe.disabled" >nul 2>&1
    echo [STOVE] Folder locked; STOVE.exe renamed to .disabled
  ) else (
    echo [STOVE] Folder deleted
  )
)

reg delete "HKCU\Software\Smilegate\Backup_STOVE" /f >nul 2>&1

echo [STOVE] Done. Reboot to verify no popup.
timeout /t 5 /nobreak >nul
endlocal
