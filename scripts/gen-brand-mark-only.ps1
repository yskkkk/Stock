# One-off: header brand mark only (transparent YS, no checkerboard tile)
Add-Type -AssemblyName System.Drawing

$root = Split-Path $PSScriptRoot -Parent
$srcPath = Join-Path $root "public\branding\ystock-logo-source.png"
$outPath = Join-Path $root "public\branding\ystock-logo-mark.png"
$size = 128

function Test-CheckerboardGray([System.Drawing.Color]$c) {
  if ($c.A -le 12) { return $false }
  $r = $c.R; $g = $c.G; $b = $c.B
  $max = [Math]::Max($r, [Math]::Max($g, $b))
  $min = [Math]::Min($r, [Math]::Min($g, $b))
  $sat = $max - $min
  $lum = ($r + $g + $b) / 3.0
  return ($sat -le 40) -and ($lum -ge 88) -and ($lum -le 218)
}

function Lum([System.Drawing.Color]$c) {
  return ($c.R + $c.G + $c.B) / 3.0
}

$raw = [System.Drawing.Image]::FromFile($srcPath)
$prep = 512
$bmp = New-Object System.Drawing.Bitmap $prep, $prep, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.Clear([System.Drawing.Color]::Transparent)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.DrawImage($raw, 0, 0, $prep, $prep)
$g.Dispose()
$raw.Dispose()

$w = [int]$bmp.Width
$h = [int]$bmp.Height

# 1) drop checkerboard gray + near-black matte
for ($y = 0; $y -lt $h; $y++) {
  for ($x = 0; $x -lt $w; $x++) {
    $c = $bmp.GetPixel($x, $y)
    $lum = Lum $c
    if (Test-CheckerboardGray $c -or $lum -lt 62) {
      $bmp.SetPixel($x, $y, [System.Drawing.Color]::FromArgb(0, 0, 0, 0))
    }
  }
}

# 2) keep only logo island (flood from center shadow/bevel)
function Test-FloodPass([System.Drawing.Color]$c) {
  if ($c.A -le 12) { return $false }
  if (Test-CheckerboardGray $c) { return $false }
  $r = $c.R; $g = $c.G; $b = $c.B
  $max = [Math]::Max($r, [Math]::Max($g, $b))
  $min = [Math]::Min($r, [Math]::Min($g, $b))
  $sat = $max - $min
  $lum = ($r + $g + $b) / 3.0
  if ($lum -lt 108 -or $lum -gt 232) { return $false }
  if ($lum -ge 218 -and $sat -le 14) { return $false }
  return $true
}

function Test-Seed([System.Drawing.Color]$c) {
  if ($c.A -le 12) { return $false }
  if (Test-CheckerboardGray $c) { return $false }
  $lum = Lum $c
  return ($lum -ge 90) -and ($lum -le 235)
}

$cx = [int]($w / 2)
$cy = [int]($h / 2)
$seed = $null
$maxScan = [int]([Math]::Min($w, $h) * 0.35)
for ($rad = 0; $rad -le $maxScan; $rad++) {
  for ($dy = -$rad; $dy -le $rad; $dy++) {
    for ($dx = -$rad; $dx -le $rad; $dx++) {
      if ([Math]::Abs($dx) -ne $rad -and [Math]::Abs($dy) -ne $rad) { continue }
      $x = $cx + $dx
      $y = $cy + $dy
      if ($x -lt 0 -or $y -lt 0 -or $x -ge $w -or $y -ge $h) { continue }
      if (Test-Seed ($bmp.GetPixel($x, $y))) {
        $seed = @($x, $y)
        break
      }
    }
    if ($seed) { break }
  }
  if ($seed) { break }
}
if (-not $seed) { throw "no logo seed in source" }

$seen = New-Object 'bool[]' ($w * $h)
$q = New-Object System.Collections.Generic.Queue[object]
$sx = [int]$seed[0]
$sy = [int]$seed[1]
$q.Enqueue(@($sx, $sy))
$seen[$sy * $w + $sx] = $true
while ($q.Count -gt 0) {
  $p = $q.Dequeue()
  $x = [int]$p[0]
  $y = [int]$p[1]
  foreach ($d in @(@(-1, 0), @(1, 0), @(0, -1), @(0, 1))) {
    $nx = $x + [int]$d[0]
    $ny = $y + [int]$d[1]
    if ($nx -lt 0 -or $ny -lt 0 -or $nx -ge $w -or $ny -ge $h) { continue }
    $idx = $ny * $w + $nx
    if ($seen[$idx]) { continue }
    $nc = $bmp.GetPixel($nx, $ny)
    if (-not (Test-FloodPass $nc)) { continue }
    $seen[$idx] = $true
    $q.Enqueue(@($nx, $ny))
  }
}
for ($y = 0; $y -lt $h; $y++) {
  for ($x = 0; $x -lt $w; $x++) {
    if (-not $seen[$y * $w + $x]) {
      $bmp.SetPixel($x, $y, [System.Drawing.Color]::FromArgb(0, 0, 0, 0))
    }
  }
}

# 3) inside logo island: drop flat checker whites (keep bevel/shadow)
for ($y = 1; $y -lt ($h - 1); $y++) {
  for ($x = 1; $x -lt ($w - 1); $x++) {
    $idx = $y * $w + $x
    if (-not $seen[$idx]) { continue }
    $c = $bmp.GetPixel($x, $y)
    if ($c.A -le 12) { continue }
    $lum = Lum $c
    $sat = [Math]::Max($c.R, [Math]::Max($c.G, $c.B)) - [Math]::Min($c.R, [Math]::Min($c.G, $c.B))
    if (-not ($lum -ge 236 -and $sat -le 22)) { continue }
    $nearBevel = $false
    foreach ($d in @(@(-1,0),@(1,0),@(0,-1),@(0,1))) {
      $nc = $bmp.GetPixel($x + $d[0], $y + $d[1])
      if ($nc.A -le 12) { continue }
      $nl = Lum $nc
      if ($nl -ge 68 -and $nl -le 228) { $nearBevel = $true; break }
    }
    if (-not $nearBevel) {
      $bmp.SetPixel($x, $y, [System.Drawing.Color]::FromArgb(0, 0, 0, 0))
      $seen[$idx] = $false
    }
  }
}

function Save-LogoPng([System.Drawing.Bitmap]$logo, [int]$size, [string]$outPath, [int]$darkR, [int]$darkG, [int]$darkB) {
  $out = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $og = [System.Drawing.Graphics]::FromImage($out)
  $og.SmoothingMode = 'AntiAlias'
  $og.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $og.Clear([System.Drawing.Color]::FromArgb(0, 0, 0, 0))
  $padPx = [Math]::Max(1, [int]($size * 0.06))
  $dest = $size - 2 * $padPx
  $og.DrawImage($logo, $padPx, $padPx, $dest, $dest)
  $og.Dispose()
  if ($darkR -ge 0) {
    for ($y = 0; $y -lt $size; $y++) {
      for ($x = 0; $x -lt $size; $x++) {
        $c = $out.GetPixel($x, $y)
        if ($c.A -le 12) { continue }
        $out.SetPixel($x, $y, [System.Drawing.Color]::FromArgb($c.A, $darkR, $darkG, $darkB))
      }
    }
  }
  $dir = Split-Path $outPath -Parent
  if ($dir) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  $out.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $out.Dispose()
}

Save-LogoPng $bmp 128 $outPath -1 -1 -1
Save-LogoPng $bmp 32 (Join-Path $root "public\icons\icon-32.png") -1 -1 -1
Save-LogoPng $bmp 192 (Join-Path $root "public\icons\icon-192.png") -1 -1 -1
Save-LogoPng $bmp 180 (Join-Path $root "public\icons\apple-touch-icon.png") -1 -1 -1
Save-LogoPng $bmp 180 (Join-Path $root "public\apple-touch-icon.png") -1 -1 -1
Save-LogoPng $bmp 512 (Join-Path $root "public\icons\icon-512.png") -1 -1 -1
$bmp.Dispose()
Write-Host "[brand-mark] ok mark + web icons"
