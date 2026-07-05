@echo off
setlocal EnableExtensions
title Stock dev:guard
cd /d "%~dp0.."

if exist "C:\Program Files\nodejs\npm.cmd" (
  set "PATH=C:\Program Files\nodejs;%PATH%"
)

set "PORT=5173"
if defined VITE_DEV_PORT set "PORT=%VITE_DEV_PORT%"

echo.
echo [Stock] auto-start %DATE% %TIME%
echo [Stock] folder: %CD%
echo [Stock] port: %PORT%
echo.

timeout /t 5 /nobreak >nul

where npm >nul 2>&1
if errorlevel 1 (
  echo [Stock] ERROR: npm not found. Install Node.js or fix PATH.
  pause
  exit /b 1
)

curl.exe -sf -o nul -m 8 "http://127.0.0.1:%PORT%/api/access/status"
if not errorlevel 1 (
  echo [Stock] already running: http://127.0.0.1:%PORT%
  echo.
  pause
  exit /b 0
)

echo [Stock] starting: npm run dev:guard
echo.
call npm run dev:guard
echo.
echo [Stock] dev:guard ended. exit=%errorlevel%
pause
endlocal
