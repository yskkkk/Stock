@echo off
REM Boot auto-start of the Stock server is disabled.
REM Use the Python server-manager GUI (Startup: Server-Manager.lnk) and press 켜기.
if exist "%~dp0AUTOSTART_DISABLED" (
  echo [Stock] auto-start disabled — open server-manager and start manually.
  exit /b 0
)
call "%~dp0autostart-stock.cmd" %*
