@echo off
setlocal EnableExtensions
cd /d "%~dp0.."
set "PY="
where py >nul 2>&1 && set "PY=py -3"
if not defined PY where python >nul 2>&1 && set "PY=python"
if not defined PY (
  echo Python 이 없습니다. Python 3 를 설치하세요.
  pause
  exit /b 1
)
if "%~1"=="" (
  start "서버 관리" pyw -3 "scripts\server-manager\server_manager.py"
  exit /b 0
)
%PY% "scripts\server-manager\server_manager.py" %*
endlocal
