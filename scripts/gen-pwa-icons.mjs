/**
 * YSTOCK 로고 → PWA·웹·Android·iOS 앱 아이콘 일괄 생성 (Windows System.Drawing)
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
$srcPath = '${srcEsc}'
$src = [System.Drawing.Image]::FromFile($srcPath)
function Save-Icon([int]$size, [string]$outPath) {
  $dir = Split-Path $outPath -Parent
  if ($dir) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $g.Clear([System.Drawing.Color]::Transparent)
  $pad = [Math]::Max(1, [int]($size * 0.04))
  $dest = $size - 2 * $pad
  $g.DrawImage($src, $pad, $pad, $dest, $dest)
  $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose()
  $bmp.Dispose()
}
${lines.join("\n")}
$src.Dispose()
Write-Host '[icons] ok (${targets.length} files from ystock logo)'
`;

fs.writeFileSync(ps1, psBody.trim() + "\n", "utf8");
execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${ps1}"`, {
  stdio: "inherit",
});
