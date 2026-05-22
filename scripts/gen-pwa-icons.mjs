/**
 * YSTOCK 앱 아이콘 → PWA·웹·Android·iOS·스플래시 일괄 생성 (Windows System.Drawing)
 * STOCK_ICON_FULL_BLEED=1(기본): 완성형 앱 아이콘(그라데이션 배경 포함) 그대로 리사이즈
 * STOCK_ICON_FULL_BLEED=0: 투명/매트 배경 로고 — 체커보드·흰/회색 제거 후 리사이즈
 * Usage: node scripts/gen-pwa-icons.mjs
 */
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultSource = path.join(root, "public", "branding", "ystock-logo-source.png");
const source = process.env.STOCK_ICON_SOURCE?.trim() || defaultSource;
const fullBleed = process.env.STOCK_ICON_FULL_BLEED !== "0";

if (!fs.existsSync(source)) {
  console.error(`[icons] source not found: ${source}`);
  process.exit(1);
}

const targets = [
  ["public/branding/ystock-logo-mark.png", 128],
  ["public/icons/icon-32.png", 32],
  ["public/icons/apple-touch-icon.png", 180],
  ["public/icons/icon-192.png", 192],
  ["public/icons/icon-512.png", 512],
  ["public/apple-touch-icon.png", 180],
  ["ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png", 1024],
  ["android/app/src/main/res/mipmap-mdpi/ic_launcher.png", 48],
  ["android/app/src/main/res/mipmap-hdpi/ic_launcher.png", 72],
  ["android/app/src/main/res/mipmap-xhdpi/ic_launcher.png", 96],
  ["android/app/src/main/res/mipmap-xxhdpi/ic_launcher.png", 144],
  ["android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png", 192],
  ["android/app/src/main/res/mipmap-mdpi/ic_launcher_round.png", 48],
  ["android/app/src/main/res/mipmap-hdpi/ic_launcher_round.png", 72],
  ["android/app/src/main/res/mipmap-xhdpi/ic_launcher_round.png", 96],
  ["android/app/src/main/res/mipmap-xxhdpi/ic_launcher_round.png", 144],
  ["android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_round.png", 192],
  ["android/app/src/main/res/mipmap-mdpi/ic_launcher_foreground.png", 108],
  ["android/app/src/main/res/mipmap-hdpi/ic_launcher_foreground.png", 162],
  ["android/app/src/main/res/mipmap-xhdpi/ic_launcher_foreground.png", 216],
  ["android/app/src/main/res/mipmap-xxhdpi/ic_launcher_foreground.png", 324],
  ["android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_foreground.png", 432],
];

const splashTargets = [
  ["android/app/src/main/res/drawable/splash.png", 480, 800],
  ["android/app/src/main/res/drawable-port-mdpi/splash.png", 480, 800],
  ["android/app/src/main/res/drawable-port-hdpi/splash.png", 720, 1280],
  ["android/app/src/main/res/drawable-port-xhdpi/splash.png", 960, 1600],
  ["android/app/src/main/res/drawable-port-xxhdpi/splash.png", 1440, 2560],
  ["android/app/src/main/res/drawable-port-xxxhdpi/splash.png", 1920, 3200],
  ["android/app/src/main/res/drawable-land-mdpi/splash.png", 800, 480],
  ["android/app/src/main/res/drawable-land-hdpi/splash.png", 1280, 720],
  ["android/app/src/main/res/drawable-land-xhdpi/splash.png", 1600, 960],
  ["android/app/src/main/res/drawable-land-xxhdpi/splash.png", 2560, 1440],
  ["android/app/src/main/res/drawable-land-xxxhdpi/splash.png", 3200, 1920],
  ["ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732.png", 2732, 2732],
  ["ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732-1.png", 2732, 2732],
  ["ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732-2.png", 2732, 2732],
];

const ps1 = path.join(root, "scripts", "_gen-pwa-icons.ps1");
const srcEsc = source.replace(/'/g, "''");
const markOut = path.join(root, "public/branding/ystock-logo-mark.png").replace(/'/g, "''");
const lines = targets.map(([rel, size]) => {
  const out = path.join(root, rel).replace(/'/g, "''");
  return `Save-Icon ${size} '${out}'`;
});
const splashLines = splashTargets.map(([rel, w, h]) => {
  const out = path.join(root, rel).replace(/'/g, "''");
  return `Save-Splash ${w} ${h} '${out}'`;
});
const fullBleedPs = fullBleed ? "$true" : "$false";

const psBody = `
Add-Type -AssemblyName System.Drawing

function Test-LogoGreenPixel([System.Drawing.Color]$c) {
  if ($c.A -le 12) { return $false }
  return ($c.G -ge $c.R + 10) -and ($c.G -ge $c.B + 8) -and ($c.G -ge 48)
}

function Test-MattePixel([System.Drawing.Color]$c) {
  if ($c.A -le 12) { return $true }
  if (Test-LogoGreenPixel $c) { return $false }
  $r = $c.R; $g = $c.G; $b = $c.B
  $max = [Math]::Max($r, [Math]::Max($g, $b))
  $min = [Math]::Min($r, [Math]::Min($g, $b))
  $sat = $max - $min
  $lum = ($r + $g + $b) / 3.0
  if ($r -ge 245 -and $g -ge 245 -and $b -ge 245) { return $true }
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

function New-TransparentLogo([System.Drawing.Image]$src) {
  $bmp = New-Object System.Drawing.Bitmap $src.Width, $src.Height, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.Clear([System.Drawing.Color]::Transparent)
  $g.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.DrawImage($src, 0, 0, $src.Width, $src.Height)
  $g.Dispose()
  Clear-MatteBackground $bmp
  return $bmp
}

$fullBleed = ${fullBleedPs}
$srcPath = '${srcEsc}'
$raw = [System.Drawing.Image]::FromFile($srcPath)
if ($fullBleed) {
  $logo = New-Object System.Drawing.Bitmap $raw
  $raw.Dispose()
} else {
  $logo = New-TransparentLogo $raw
  $raw.Dispose()
}

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

Save-Icon 128 '${markOut}'
${lines.filter((l) => !l.includes("ystock-logo-mark")).join("\n")}
${splashLines.join("\n")}
$logo.Dispose()
Write-Host '[icons] ok (${targets.length} icons + ${splashTargets.length} splashes, fullBleed=${fullBleed})'
`;

fs.writeFileSync(ps1, psBody.trim() + "\n", "utf8");
execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${ps1}"`, {
  stdio: "inherit",
});
