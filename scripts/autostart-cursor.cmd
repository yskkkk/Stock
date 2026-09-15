@echo off
setlocal EnableExtensions
cd /d "%~dp0.."
if not exist logs mkdir logs
echo [%date% %time%] autostart-cursor >> logs\autostart-cursor.log
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0ensure-cursor.ps1"
exit /b %ERRORLEVEL%
