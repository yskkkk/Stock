@echo off
REM Use test-wol-wake.cmd instead (fixed order: sleep first, then you send WOL)
call "%~dp0test-wol-wake.cmd" %*
