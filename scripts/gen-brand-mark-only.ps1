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
  return (Lum $c) -ge 108
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

# 3) scale to mark size
$out = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$og = [System.Drawing.Graphics]::FromImage($out)
$og.SmoothingMode = 'AntiAlias'
$og.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$og.Clear([System.Drawing.Color]::Transparent)
$padPx = [Math]::Max(1, [int]($size * 0.06))
$dest = $size - 2 * $padPx
$og.DrawImage($bmp, $padPx, $padPx, $dest, $dest)
$og.Dispose()
$bmp.Dispose()

$dir = Split-Path $outPath -Parent
if ($dir) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
$out.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
$out.Dispose()
Write-Host "[brand-mark] ok $outPath"
