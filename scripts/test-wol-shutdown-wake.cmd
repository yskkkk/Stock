@echo off
setlocal EnableExtensions
title WOL shutdown wake test
cd /d C:\Stock

echo.
echo ========================================
echo  WOL SHUTDOWN TEST (full power off)
echo ========================================
echo.
echo Sleep WOL worked. This tests FULL SHUTDOWN wake.
echo.
echo BEFORE you continue:
echo   1) Save all work
echo   2) Phone or router WOL ready (MAC A8-A1-59-BF-42-CC)
echo   3) If PC does NOT wake: enter BIOS and set
echo        Wake on LAN = Enabled
echo        ErP / EuP / Deep Sleep = Disabled
echo.
echo PC will SHUTDOWN in 15 seconds.
echo After power off, send WOL within 2 minutes.
echo.
choice /C YN /M "Continue with shutdown test"
if errorlevel 2 exit /b 0

for /l %%i in (15,-1,1) do (
  echo Shutdown in %%i ...
  timeout /t 1 /nobreak >nul
)

echo Shutting down now. Send WOL from router or phone!
shutdown /s /t 0 /f
endlocal
