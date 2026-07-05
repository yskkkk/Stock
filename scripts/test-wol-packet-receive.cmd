@echo off
setlocal EnableExtensions
title WOL packet test (PC stays ON)
cd /d "%~dp0.."

net session >nul 2>&1
if errorlevel 1 (
  echo [WOL test] Admin helps bind UDP 7/9. UAC next...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b 0
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0test-wol-packet-receive.ps1" %*
echo.
pause
endlocal
