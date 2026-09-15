@echo off
setlocal EnableExtensions
title Stock
cd /d "%~dp0.."
if not exist logs mkdir logs
echo [%date% %time%] autostart-stock %* >> logs\autostart-stock.log

set "PATH=C:\Program Files\nodejs;%PATH%"
if exist "%ProgramFiles%\nodejs\npm.cmd" set "PATH=%ProgramFiles%\nodejs;%PATH%"

set "QUIET=0"
if /I "%~1"=="/quiet" set "QUIET=1"

where npm >nul 2>&1
if errorlevel 1 (
  echo [Stock] npm 없음 >> logs\autostart-stock.log
  if "%QUIET%"=="1" exit /b 1
  echo [Stock] ERROR: npm not found.
  pause
  exit /b 1
)

echo [Stock] starting npm run dev:guard >> logs\autostart-stock.log
if "%QUIET%"=="1" (
  start "Stock dev:guard" /MIN cmd /c "cd /d "%CD%" && "%ProgramFiles%\nodejs\npm.cmd" run dev:guard >> logs\dev-guard-run.log 2>&1"
  exit /b 0
)

echo.
echo [Stock] auto-start %DATE% %TIME%
echo [Stock] folder: %CD%
echo.
call "%ProgramFiles%\nodejs\npm.cmd" run dev:guard
echo.
echo [Stock] dev:guard ended. exit=%errorlevel% >> logs\autostart-stock.log
echo [Stock] dev:guard ended. exit=%errorlevel%
if not "%QUIET%"=="1" pause
endlocal
