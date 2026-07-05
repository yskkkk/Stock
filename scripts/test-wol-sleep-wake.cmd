@echo off
setlocal EnableExtensions
title WOL sleep wake test
cd /d "%~dp0.."

echo.
echo [WOL sleep test] PC will SLEEP in 5 sec, then magic packet is sent.
echo Close unsaved work first. Ctrl+C to cancel.
echo.
timeout /t 5

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0send-wol-magic-packet.ps1"
timeout /t 2 /nobreak >nul
powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Application]::SetSuspendState('Suspend',$false,$false)"

echo If PC woke up, WOL path works. Shutdown-only fail = BIOS ErP.
pause
endlocal
