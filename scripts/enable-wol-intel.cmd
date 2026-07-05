@echo off
setlocal EnableExtensions
net session >nul 2>&1
if errorlevel 1 (
  echo [WOL] Admin required. UAC prompt next...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b 0
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0enable-wol-intel.ps1"
echo.
pause
endlocal
