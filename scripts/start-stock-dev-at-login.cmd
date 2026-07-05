@echo off
setlocal
chcp 65001 >nul
title Stock dev:guard
cd /d "%~dp0.."

set "PORT=5173"
if defined VITE_DEV_PORT set "PORT=%VITE_DEV_PORT%"

echo.
echo [Stock] auto-start  %DATE% %TIME%
echo [Stock] folder: %CD%
echo [Stock] port:   %PORT%
echo.

rem 로그인 직후 PATH·네트워크 준비 대기
timeout /t 5 /nobreak >nul

powershell -NoProfile -Command ^
  "try { $r=Invoke-WebRequest -Uri 'http://127.0.0.1:%PORT%/api/access/status' -UseBasicParsing -TimeoutSec 6; exit ([int]($r.StatusCode -ge 200 -and $r.StatusCode -lt 500)) } catch { exit 1 }"
if %errorlevel%==0 (
  echo [Stock] already running on http://127.0.0.1:%PORT% — skip
  echo.
  pause
  exit /b 0
)

echo [Stock] npm run dev:guard
echo.
call npm run dev:guard
echo.
echo [Stock] dev:guard ended. exit=%errorlevel%
pause
endlocal
