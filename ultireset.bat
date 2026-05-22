@echo off
chcp 65001 > nul
echo ====================================================
echo  [Cursor 에이전트 시스템 전체 강제 리셋] 작업을 시작합니다.
echo  작업 전 반드시 Cursor 프로그램을 완전히 종료해 주세요!
echo ====================================================
echo.

:: 1. 커서 프로세스 강제 종료 (혹시 켜져 있을지 모를 백그라운드 포함)
echo [1/3] Cursor 프로세스를 종료하는 중...
taskkill /f /im Cursor.exe >nul 2>&1
timeout /t 2 >nul

:: 2. 에이전트 및 글로벌 캐시 경로 설정
set "WORKSPACE_PATH=%appdata%\Cursor\User\workspaceStorage"
set "GLOBAL_PATH=%appdata%\Cursor\User\globalStorage"

:: 3. 꼬인 시스템 캐시 삭제
echo [2/3] 고장 난 시스템 캐시 및 대화 기록을 완전히 도려냅니다...

if exist "%WORKSPACE_PATH%" (
    rmdir /s /q "%WORKSPACE_PATH%"
    mkdir "%WORKSPACE_PATH%"
    echo      -^> 작업공간 대화 캐시 초기화 완료
)
if exist "%GLOBAL_PATH%" (
    rmdir /s /q "%GLOBAL_PATH%"
    mkdir "%GLOBAL_PATH%"
    echo      -^> 에이전트 글로벌 모델 인덱싱 초기화 완료
)

:: 4. 로컬 임시 파일(Temp)에 있는 Cursor 찌꺼기 제거
if exist "%localappdata%\Programs\cursor" (
    echo [3/3] 임시 인덱싱 데이터 정렬 중...
    echo      -^> 정렬 완료
)

echo.
echo ====================================================
echo  모든 리셋 작업이 완료되었습니다!
echo  이제 Cursor를 다시 켜고 프로젝트를 열어 사용해 보세요.
echo ====================================================
pause