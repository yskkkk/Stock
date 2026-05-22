@echo off
chcp 65001 > nul
setlocal enabledelayedexpansion

echo ====================================================
echo  [BOM 자동 제거 프로그램] 작업 시작...
echo ====================================================
echo.

:: PowerShell 오타 수정 (Recurper -> Recurse)
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$files = Get-ChildItem -Recurse -File | Where-Object { $_.Extension -match '^\.(json|js|ts|tsx|py|txt|cursorrules)$' };" ^
    "foreach ($file in $files) {" ^
        "$bytes = [System.IO.File]::ReadAllBytes($file.FullName);" ^
        "if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {" ^
            "Write-Host '[수정 완료] BOM 삭제됨:' $file.FullName -ForegroundColor Cyan;" ^
            "$newBytes = New-Object byte[] ($bytes.Length - 3);" ^
            "[System.Array]::Copy($bytes, 3, $newBytes, 0, $bytes.Length - 3);" ^
            "[System.IO.File]::WriteAllBytes($file.FullName, $newBytes);" ^
        "}" ^
    "}"

echo.
echo ====================================================
echo  모든 작업이 완료되었습니다.
echo  Cursor에서 'Developer: Reload Window'를 실행하세요!
echo ====================================================
pause