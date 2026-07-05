@echo off
setlocal EnableExtensions
title WOL wake result
echo.
echo --- last wake ---
powercfg /lastwake
echo.
echo --- wake devices ---
powercfg /devicequery wake_armed
echo.
pause
endlocal
