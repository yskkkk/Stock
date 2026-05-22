@echo off
title Package Cleaner
cls

echo ====================================================
echo  [Cursor Package Reset Tool]
echo ====================================================
echo.
echo  Closing Cursor...
taskkill /f /im Cursor.exe >nul 2>&1
timeout /t 2 >nul

echo  Deleting node_modules folder...
if exist "node_modules" (
    rmdir /s /q "node_modules"
    echo  -^> Done.
) else (
    echo  -^> node_modules not found. Skip.
)

echo  Deleting package-lock.json...
if exist "package-lock.json" (
    del /f /q "package-lock.json"
    echo  -^> Done.
) else (
    echo  -^> package-lock.json not found. Skip.
)

echo  Running npm install...
echo  (Please wait a few seconds)
echo.
call npm install

echo.
echo ====================================================
echo  Success! All tasks completed.
echo  Please restart Cursor and open a New Chat (Ctrl+I).
echo ====================================================
pause