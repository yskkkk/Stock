Add-Type -AssemblyName System.Drawing

function Test-LogoGreenPixel([System.Drawing.Color]$c) {
  if ($c.A -le 12) { return $false }
  return ($c.G -ge $c.R + 10) -and ($c.G -ge $c.B + 8) -and ($c.G -ge 48)
}

function Test-BrandBluePixel([System.Drawing.Color]$c) {
  if ($c.A -le 12) { return $false }
  $r = $c.R; $g = $c.G; $b = $c.B
  return ($b -ge $r + 12) -and ($b -ge 70) -and ($g -ge 40)
}

function Test-MattePixel([System.Drawing.Color]$c) {
  if ($c.A -le 12) { return $true }
  if (Test-LogoGreenPixel $c) { return $false }
  if (Test-BrandBluePixel $c) { return $false }
  $r = $c.R; $g = $c.G; $b = $c.B
  $max = [Math]::Max($r, [Math]::Max($g, $b))
  $min = [Math]::Min($r, [Math]::Min($g, $b))
  $sat = $max - $min
  $lum = ($r + $g + $b) / 3.0
  if ($r -ge 238 -and $g -ge 238 -and $b -ge 238) { return $true }
  if ($sat -le 40 -and $lum -ge 200) { return $true }
  if ($sat -le 32 -and $lum -ge 105) { return $true }
  return $false
}

function Clear-MatteBackground([System.Drawing.Bitmap]$bmp) {
  $w = [int]$bmp.Width
  $h = [int]$bmp.Height
  for ($y = 0; $y -lt $h; $y++) {
    for ($x = 0; $x -lt $w; $x++) {
      $c = $bmp.GetPixel($x, $y)
      if (Test-MattePixel $c) {
        $bmp.SetPixel($x, $y, [System.Drawing.Color]::FromArgb(0, 0, 0, 0))
      }
    }
  }
}

function Flood-ClearOuterMatte([System.Drawing.Bitmap]$bmp) {
  $w = [int]$bmp.Width
  $h = [int]$bmp.Height
  if ($w -lt 2 -or $h -lt 2) { return }
  $seen = New-Object 'bool[]' ($w * $h)
  $q = New-Object System.Collections.Generic.Queue[object]
  $seeds = @(
    @(0, 0), @( ($w - 1), 0 ), @( 0, ($h - 1) ), @( ($w - 1), ($h - 1) ),
    @( [int]($w / 2), 0 ), @( [int]($w / 2), ($h - 1) ), @( 0, [int]($h / 2) ), @( ($w - 1), [int]($h / 2) )
  )
  foreach ($s in $seeds) {
    $x = [int]$s[0]; $y = [int]$s[1]
    if ($x -lt 0 -or $y -lt 0 -or $x -ge $w -or $y -ge $h) { continue }
    $idx = $y * $w + $x
    if ($seen[$idx]) { continue }
    $c = $bmp.GetPixel($x, $y)
    if (-not (Test-MattePixel $c)) { continue }
    $q.Enqueue(@($x, $y))
    $seen[$idx] = $true
  }
  while ($q.Count -gt 0) {
    $p = $q.Dequeue()
    $x = [int]$p[0]; $y = [int]$p[1]
    $bmp.SetPixel($x, $y, [System.Drawing.Color]::FromArgb(0, 0, 0, 0))
    foreach ($d in @(@( (-1), 0 ), @( 1, 0 ), @( 0, (-1) ), @( 0, 1 ))) {
      $nx = $x + [int]$d[0]; $ny = $y + [int]$d[1]
      if ($nx -lt 0 -or $ny -lt 0 -or $nx -ge $w -or $ny -ge $h) { continue }
      $nidx = $ny * $w + $nx
      if ($seen[$nidx]) { continue }
      $nc = $bmp.GetPixel($nx, $ny)
      if (-not (Test-MattePixel $nc)) { continue }
      $seen[$nidx] = $true
      $q.Enqueue(@($nx, $ny))
    }
  }
}

function Test-CheckerboardGrayPixel([System.Drawing.Color]$c) {
  if ($c.A -le 12) { return $false }
  $r = $c.R; $g = $c.G; $b = $c.B
  $max = [Math]::Max($r, [Math]::Max($g, $b))
  $min = [Math]::Min($r, [Math]::Min($g, $b))
  $sat = $max - $min
  $lum = ($r + $g + $b) / 3.0
  return ($sat -le 40) -and ($lum -ge 88) -and ($lum -le 218)
}

function Test-WhiteMarkFloodCell([System.Drawing.Color]$c) {
  if ($c.A -le 12) { return $false }
  if (Test-CheckerboardGrayPixel $c) { return $false }
  $lum = ($c.R + $c.G + $c.B) / 3.0
  if ($lum -lt 65) { return $false }
  return $lum -ge 108
}

function Test-WhiteMarkSeedPixel([System.Drawing.Color]$c) {
  if ($c.A -le 12) { return $false }
  if (Test-CheckerboardGrayPixel $c) { return $false }
  $lum = ($c.R + $c.G + $c.B) / 3.0
  return ($lum -ge 90) -and ($lum -le 235)
}

function Prepare-WhiteMarkBitmap([System.Drawing.Bitmap]$bmp) {
  $w = [int]$bmp.Width
  $h = [int]$bmp.Height
  $cx = [int]($w / 2)
  $cy = [int]($h / 2)
  $seed = $null
  $maxScan = [int]([Math]::Min($w, $h) * 0.38)
  for ($rad = 0; $rad -le $maxScan; $rad++) {
    for ($dy = -$rad; $dy -le $rad; $dy++) {
      for ($dx = -$rad; $dx -le $rad; $dx++) {
        if ([Math]::Abs($dx) -ne $rad -and [Math]::Abs($dy) -ne $rad) { continue }
        $x = $cx + $dx
        $y = $cy + $dy
        if ($x -lt 0 -or $y -lt 0 -or $x -ge $w -or $y -ge $h) { continue }
        if (Test-WhiteMarkSeedPixel ($bmp.GetPixel($x, $y))) {
          $seed = @($x, $y)
          break
        }
      }
      if ($seed) { break }
    }
    if ($seed) { break }
  }
  if (-not $seed) { return }
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
      if (-not (Test-WhiteMarkFloodCell $nc)) { continue }
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
}

function Prepare-LogoBitmap([System.Drawing.Image]$src) {
  $bmp = New-Object System.Drawing.Bitmap $src.Width, $src.Height, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.Clear([System.Drawing.Color]::Transparent)
  $g.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.DrawImage($src, 0, 0, $src.Width, $src.Height)
  $g.Dispose()
  if ($whiteMark) {
    Prepare-WhiteMarkBitmap $bmp
    return $bmp
  }
  Flood-ClearOuterMatte $bmp
  Clear-MatteBackground $bmp
  return $bmp
}

$fullBleed = $false
$whiteMark = $true
$srcPath = 'C:\Stock\public\branding\ystock-logo-source.png'
$raw = [System.Drawing.Image]::FromFile($srcPath)
$logo = Prepare-LogoBitmap $raw
$raw.Dispose()

function Save-Png([System.Drawing.Bitmap]$bmp, [string]$outPath) {
  $dir = Split-Path $outPath -Parent
  if ($dir) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
}

function Save-Icon([int]$size, [string]$outPath) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $g.Clear([System.Drawing.Color]::Transparent)
  $pad = if ($fullBleed) { 0 } else { [Math]::Max(1, [int]($size * 0.04)) }
  $dest = $size - 2 * $pad
  $g.DrawImage($logo, $pad, $pad, $dest, $dest)
  $g.Dispose()
  if (-not $whiteMark) { Flood-ClearOuterMatte $bmp }
  Save-Png $bmp $outPath
  $bmp.Dispose()
}

function Save-Splash([int]$w, [int]$h, [string]$outPath) {
  $bmp = New-Object System.Drawing.Bitmap $w, $h, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush (
    (New-Object System.Drawing.Rectangle 0, 0, $w, $h),
    [System.Drawing.Color]::FromArgb(255, 18, 72, 168),
    [System.Drawing.Color]::FromArgb(255, 56, 189, 212),
    45
  )
  $g.FillRectangle($brush, 0, 0, $w, $h)
  $brush.Dispose()
  $iconSize = [int]([Math]::Min($w, $h) * 0.38)
  $x = [int](($w - $iconSize) / 2)
  $y = [int](($h - $iconSize) / 2)
  $g.DrawImage($logo, $x, $y, $iconSize, $iconSize)
  $g.Dispose()
  Save-Png $bmp $outPath
  $bmp.Dispose()
}

Save-Icon 128 'C:\Stock\public\branding\ystock-logo-mark.png'
Save-Icon 32 'C:\Stock\public\icons\icon-32.png'
Save-Icon 180 'C:\Stock\public\icons\apple-touch-icon.png'
Save-Icon 192 'C:\Stock\public\icons\icon-192.png'
Save-Icon 512 'C:\Stock\public\icons\icon-512.png'
Save-Icon 180 'C:\Stock\public\apple-touch-icon.png'
Save-Icon 1024 'C:\Stock\ios\App\App\Assets.xcassets\AppIcon.appiconset\AppIcon-512@2x.png'
Save-Icon 48 'C:\Stock\android\app\src\main\res\mipmap-mdpi\ic_launcher.png'
Save-Icon 72 'C:\Stock\android\app\src\main\res\mipmap-hdpi\ic_launcher.png'
Save-Icon 96 'C:\Stock\android\app\src\main\res\mipmap-xhdpi\ic_launcher.png'
Save-Icon 144 'C:\Stock\android\app\src\main\res\mipmap-xxhdpi\ic_launcher.png'
Save-Icon 192 'C:\Stock\android\app\src\main\res\mipmap-xxxhdpi\ic_launcher.png'
Save-Icon 48 'C:\Stock\android\app\src\main\res\mipmap-mdpi\ic_launcher_round.png'
Save-Icon 72 'C:\Stock\android\app\src\main\res\mipmap-hdpi\ic_launcher_round.png'
Save-Icon 96 'C:\Stock\android\app\src\main\res\mipmap-xhdpi\ic_launcher_round.png'
Save-Icon 144 'C:\Stock\android\app\src\main\res\mipmap-xxhdpi\ic_launcher_round.png'
Save-Icon 192 'C:\Stock\android\app\src\main\res\mipmap-xxxhdpi\ic_launcher_round.png'
Save-Icon 108 'C:\Stock\android\app\src\main\res\mipmap-mdpi\ic_launcher_foreground.png'
Save-Icon 162 'C:\Stock\android\app\src\main\res\mipmap-hdpi\ic_launcher_foreground.png'
Save-Icon 216 'C:\Stock\android\app\src\main\res\mipmap-xhdpi\ic_launcher_foreground.png'
Save-Icon 324 'C:\Stock\android\app\src\main\res\mipmap-xxhdpi\ic_launcher_foreground.png'
Save-Icon 432 'C:\Stock\android\app\src\main\res\mipmap-xxxhdpi\ic_launcher_foreground.png'
Save-Splash 480 800 'C:\Stock\android\app\src\main\res\drawable\splash.png'
Save-Splash 480 800 'C:\Stock\android\app\src\main\res\drawable-port-mdpi\splash.png'
Save-Splash 720 1280 'C:\Stock\android\app\src\main\res\drawable-port-hdpi\splash.png'
Save-Splash 960 1600 'C:\Stock\android\app\src\main\res\drawable-port-xhdpi\splash.png'
Save-Splash 1440 2560 'C:\Stock\android\app\src\main\res\drawable-port-xxhdpi\splash.png'
Save-Splash 1920 3200 'C:\Stock\android\app\src\main\res\drawable-port-xxxhdpi\splash.png'
Save-Splash 800 480 'C:\Stock\android\app\src\main\res\drawable-land-mdpi\splash.png'
Save-Splash 1280 720 'C:\Stock\android\app\src\main\res\drawable-land-hdpi\splash.png'
Save-Splash 1600 960 'C:\Stock\android\app\src\main\res\drawable-land-xhdpi\splash.png'
Save-Splash 2560 1440 'C:\Stock\android\app\src\main\res\drawable-land-xxhdpi\splash.png'
Save-Splash 3200 1920 'C:\Stock\android\app\src\main\res\drawable-land-xxxhdpi\splash.png'
Save-Splash 2732 2732 'C:\Stock\ios\App\App\Assets.xcassets\Splash.imageset\splash-2732x2732.png'
Save-Splash 2732 2732 'C:\Stock\ios\App\App\Assets.xcassets\Splash.imageset\splash-2732x2732-1.png'
Save-Splash 2732 2732 'C:\Stock\ios\App\App\Assets.xcassets\Splash.imageset\splash-2732x2732-2.png'
$logo.Dispose()
Write-Host '[icons] ok (22 icons + 14 splashes, whiteMark=true, fullBleed=false)'
