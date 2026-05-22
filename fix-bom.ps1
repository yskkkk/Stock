Write-Host ""
Write-Host "=== UTF-8 BOM 자동 수정 시작 ==="
Write-Host ""

$extensions = @("*.json", "*.mdc", "*.ts", "*.tsx", "*.js", "*.jsx")

$files = Get-ChildItem -Recurse -File -Include $extensions

$fixed = 0

foreach ($file in $files) {

    try {
        $bytes = [System.IO.File]::ReadAllBytes($file.FullName)

        if ($bytes.Length -ge 3 `
            -and $bytes[0] -eq 239 `
            -and $bytes[1] -eq 187 `
            -and $bytes[2] -eq 191) {

            Write-Host "BOM 제거:" $file.FullName

            $content = [System.IO.File]::ReadAllText($file.FullName)

            $utf8NoBom = New-Object System.Text.UTF8Encoding($false)

            [System.IO.File]::WriteAllText(
                $file.FullName,
                $content,
                $utf8NoBom
            )

            $fixed++
        }

    } catch {
        Write-Host "실패:" $file.FullName
    }
}

Write-Host ""
Write-Host "완료. 수정된 파일 수:" $fixed
Write-Host ""

pause