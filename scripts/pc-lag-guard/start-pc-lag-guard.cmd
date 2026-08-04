@echo off
REM PC Lag Guard — 백그라운드 감시 시작
cd /d "%~dp0\..\.."
start "PC Lag Guard" /MIN powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0pc-lag-guard.ps1"
echo Started PC Lag Guard (minimized). Log: scripts\pc-lag-guard\pc-lag-guard.log
