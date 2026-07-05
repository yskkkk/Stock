@echo off
setlocal EnableExtensions
echo [WOL test] Stopping listeners on UDP 7/9...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr "UDP.*:7 "') do taskkill /PID %%p /F >nul 2>&1
for /f "tokens=5" %%p in ('netstat -ano ^| findstr "UDP.*:9 "') do taskkill /PID %%p /F >nul 2>&1
echo Done. Retry: wol-test
pause
endlocal
