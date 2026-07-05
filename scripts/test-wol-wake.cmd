@echo off
setlocal EnableExtensions
title WOL wake test (sleep)
cd /d "%~dp0.."

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0test-wol-wake.ps1" %*
echo.
echo If you woke up from sleep, WOL works.
echo Check wake source: powercfg /lastwake
echo.
pause
endlocal
