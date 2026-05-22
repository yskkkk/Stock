@echo off
chcp 65001 > nul
setlocal enabledelayedexpansion

echo ====================================================
echo  [.cursorrules 파일 자동 리셋 및 UTF-8 교정]
echo ====================================================
echo.

set "TARGET_FILE=.cursorrules"
set "BACKUP_DIR=%USERPROFILE%\Desktop\Cursor_Backup"
set "BACKUP_FILE=%BACKUP_DIR%\.cursorrules_backup_%date:~0,4%%date:~5,2%%date:~8,2%_%time:~0,2%%time:~3,2%%time:~6,2%.txt"
set "BACKUP_FILE=%BACKUP_FILE: =0%"

:: 1. 기존 파일이 있는지 확인 후 백업
if exist "%TARGET_FILE%" (
    echo [1/3] 기존 %TARGET_FILE% 파일을 발견했습니다.
    if not exist "%BACKUP_DIR%" mkdir "%BACKUP_DIR%"
    
    :: 안전하게 복사
    copy /Y "%TARGET_FILE%" "%BACKUP_FILE%" > nul
    echo      -^> 바탕화면 'Cursor_Backup' 폴더에 안전하게 백업되었습니다.
    
    :: 2. 기존의 고장난 파일 강제 삭제 (인코딩 찌꺼기 제거)
    echo [2/3] 고장 난 기존 파일을 강제로 삭제합니다...
    del /F /Q "%TARGET_FILE%"
) else (
    echo [1/3] 기존에 생성된 %TARGET_FILE% 파일이 없습니다. 새 파일 생성을 진행합니다.
    echo [2/3] 삭제할 기존 파일이 없어 건너뜁니다.
)

:: 3. PowerShell을 이용해 BOM이 없는 '순수 UTF-8' 형식으로 새 파일 생성
echo [3/3] BOM이 없는 깨끗한 UTF-8 형식으로 새 %TARGET_FILE% 생성 중...

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$utf8NoBom = New-Object System.Text.UTF8Encoding($false);" ^
    "if (Test-Path '%BACKUP_FILE%') {" ^
        "$content = [System.IO.File]::ReadAllText('%BACKUP_FILE%');" ^
        "[System.IO.File]::WriteAllText('%TARGET_FILE%', $content, $utf8NoBom);" ^
        "Write-Host '     -> 백업된 기존 규칙 내용을 새 파일에 완벽하게 복구했습니다.' -ForegroundColor Green;" ^
    "} else {" ^
        "[System.IO.File]::WriteAllText('%TARGET_FILE%', '# Cursor Rules', $utf8NoBom);" ^
        "Write-Host '     -> 빈 규칙 파일을 깨끗하게 새로 만들었습니다.' -ForegroundColor Green;" ^
    "}"

echo.
echo ====================================================
echo  모든 작업이 완료되었습니다!
echo  반드시 Cursor에서 새 대화창(Ctrl + I)을 열어 사용하세요.
echo ====================================================
pause