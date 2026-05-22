/**
 * YSTOCK 로고 → PWA·웹·Android·iOS 앱 아이콘 일괄 생성 (Windows System.Drawing)
 * 흰/밝은 배경은 투명 처리해 탭·헤더에 사각 박스가 보이지 않게 함.
 * Usage: node scripts/gen-pwa-icons.mjs
 */
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultSource = path.join(root, "public", "branding", "ystock-logo-source.png");
const source = process.env.STOCK_ICON_SOURCE?.trim() || defaultSource;

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

const ps1 = path.join(root, "scripts", "_gen-pwa-icons.ps1");
const srcEsc = source.replace(/'/g, "''");
const lines = targets.map(([rel, size]) => {
  const out = path.join(root, rel).replace(/'/g, "''");
  return `Save-Icon ${size} '${out}'`;
});

const psBody = `
Add-Type -AssemblyName System.Drawing

function New-TransparentLogo([System.Drawing.Image]$src) {
  $bmp = New-Object System.Drawing.Bitmap $src.Width, $src.Height, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.Clear([System.Drawing.Color]::Transparent)
  $g.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.DrawImage($src, 0, 0, $src.Width, $src.Height)
  $g.Dispose()
  $threshold = 235
  for ($y = 0; $y -lt $bmp.Height; $y++) {
    for ($x = 0; $x -lt $bmp.Width; $x++) {
      $c = $bmp.GetPixel($x, $y)
      if ($c.A -gt 8 -and $c.R -ge $threshold -and $c.G -ge $threshold -and $c.B -ge $threshold) {
        $bmp.SetPixel($x, $y, [System.Drawing.Color]::FromArgb(0, 0, 0, 0))
      }
    }
  }
  return $bmp
}

$srcPath = '${srcEsc}'
$raw = [System.Drawing.Image]::FromFile($srcPath)
$logo = New-TransparentLogo $raw
$raw.Dispose()

function Save-Icon([int]$size, [string]$outPath) {
  $dir = Split-Path $outPath -Parent
  if ($dir) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  $bmp = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $g.Clear([System.Drawing.Color]::Transparent)
  $pad = [Math]::Max(1, [int]($size * 0.06))
  $dest = $size - 2 * $pad
  $g.DrawImage($logo, $pad, $pad, $dest, $dest)
  $g.Dispose()
  $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}
${lines.join("\n")}
$logo.Dispose()
Write-Host '[icons] ok (${targets.length} files, white matte removed)'
`;

fs.writeFileSync(ps1, psBody.trim() + "\n", "utf8");
execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${ps1}"`, {
  stdio: "inherit",
});
