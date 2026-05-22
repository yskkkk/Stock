/**
 * Swift 네이티브 iOS 앱 → IPA + OTA manifest (macOS + Xcode 필수)
 *
 * .env: CAPACITOR_SERVER_URL, IOS_DEVELOPMENT_TEAM
 * Usage: npm run ipa:build
 */
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { injectIosNativeServerUrl } from "./inject-ios-native-url.mjs";
import { resolveMobileServerUrl } from "./resolve-mobile-server-url.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const PROJECT = path.join(ROOT, "ios-native", "StockDashboard", "StockDashboard.xcodeproj");
const SCHEME = "StockDashboard";
const BUILD_DIR = path.join(ROOT, ".ios-build");
const ARCHIVE_PATH = path.join(BUILD_DIR, "StockDashboard.xcarchive");
const EXPORT_DIR = path.join(BUILD_DIR, "export");
const IPA_OUT = path.join(ROOT, "public", "downloads", "stock-dashboard.ipa");
const MANIFEST_OUT = path.join(ROOT, "public", "downloads", "ios-manifest.plist");

function run(cmd, opts = {}) {
  console.log(">", cmd);
  execSync(cmd, {
    stdio: "inherit",
    cwd: opts.cwd ?? ROOT,
    env: { ...process.env, ...opts.env },
  });
}

function readEnvTeam() {
  const fromEnv = String(process.env.IOS_DEVELOPMENT_TEAM ?? "").trim();
  if (fromEnv) return fromEnv;
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return "";
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const m = t.match(/^IOS_DEVELOPMENT_TEAM\s*=\s*(.+)$/);
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  }
  return "";
}

function writeExportOptions(teamId, method) {
  const template = fs.readFileSync(
    path.join(ROOT, "ios-native", "ExportOptions.plist.template"),
    "utf8",
  );
  const plist = template
    .replace("__TEAM_ID__", teamId)
    .replace("__EXPORT_METHOD__", method);
  const out = path.join(BUILD_DIR, "ExportOptions.plist");
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  fs.writeFileSync(out, plist, "utf8");
  return out;
}

function findExportedIpa() {
  if (!fs.existsSync(EXPORT_DIR)) return null;
  const files = fs
    .readdirSync(EXPORT_DIR)
    .filter((f) => f.endsWith(".ipa"))
    .map((f) => path.join(EXPORT_DIR, f));
  files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return files[0] ?? null;
}

function writeOtaManifest(publicOrigin) {
  const base = publicOrigin.replace(/\/+$/, "");
  const ipaUrl = `${base}/downloads/stock-dashboard.ipa`;
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>items</key>
	<array>
		<dict>
			<key>assets</key>
			<array>
				<dict>
					<key>kind</key>
					<string>software-package</string>
					<key>url</key>
					<string>${ipaUrl}</string>
				</dict>
			</array>
			<key>metadata</key>
			<dict>
				<key>bundle-identifier</key>
				<string>com.stock.dashboard</string>
				<key>bundle-version</key>
				<string>1.0.0</string>
				<key>kind</key>
				<string>software</string>
				<key>title</key>
				<string>종목 대시보드</string>
			</dict>
		</dict>
	</array>
</dict>
</plist>
`;
  fs.mkdirSync(path.dirname(MANIFEST_OUT), { recursive: true });
  fs.writeFileSync(MANIFEST_OUT, xml, "utf8");
  const distManifest = path.join(ROOT, "dist", "downloads", "ios-manifest.plist");
  if (fs.existsSync(path.join(ROOT, "dist"))) {
    fs.mkdirSync(path.dirname(distManifest), { recursive: true });
    fs.copyFileSync(MANIFEST_OUT, distManifest);
  }
  console.log(`[ipa] OTA manifest → ${MANIFEST_OUT}`);
}

async function main() {
  if (process.platform !== "darwin") {
    console.error(
      "[ipa] iOS IPA 빌드는 macOS + Xcode가 필요합니다.\n" +
        "  Mac에서: npm run ipa:build\n" +
        "  또는 Xcode: open ios-native/StockDashboard/StockDashboard.xcodeproj",
    );
    process.exit(1);
  }

  const teamId = readEnvTeam();
  if (!teamId) {
    console.error(
      "[ipa] .env에 Apple Team ID가 필요합니다.\n" +
        "  IOS_DEVELOPMENT_TEAM=XXXXXXXXXX\n" +
        "  (developer.apple.com → Membership → Team ID)",
    );
    process.exit(1);
  }

  const mobileUrl = resolveMobileServerUrl({
    required: true,
    allowLanFallback: false,
  });
  injectIosNativeServerUrl({ required: true, allowLanFallback: false });
  console.log(`[ipa] WebView 고정 URL: ${mobileUrl}`);

  const exportMethod =
    String(process.env.IOS_EXPORT_METHOD ?? "development").trim() || "development";
  const exportPlist = writeExportOptions(teamId, exportMethod);

  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  fs.mkdirSync(BUILD_DIR, { recursive: true });

  run(
    `xcodebuild -project "${PROJECT}" -scheme ${SCHEME} -configuration Release -destination "generic/platform=iOS" -archivePath "${ARCHIVE_PATH}" DEVELOPMENT_TEAM=${teamId} archive`,
    { env: { DEVELOPMENT_TEAM: teamId } },
  );

  run(
    `xcodebuild -exportArchive -archivePath "${ARCHIVE_PATH}" -exportPath "${EXPORT_DIR}" -exportOptionsPlist "${exportPlist}"`,
  );

  const built = findExportedIpa();
  if (!built) throw new Error("IPA not found under .ios-build/export");

  fs.mkdirSync(path.dirname(IPA_OUT), { recursive: true });
  fs.copyFileSync(built, IPA_OUT);
  const distIpa = path.join(ROOT, "dist", "downloads", "stock-dashboard.ipa");
  if (fs.existsSync(path.join(ROOT, "dist"))) {
    fs.mkdirSync(path.dirname(distIpa), { recursive: true });
    fs.copyFileSync(built, distIpa);
  }

  writeOtaManifest(mobileUrl);

  const mb = (fs.statSync(IPA_OUT).size / (1024 * 1024)).toFixed(2);
  console.log(`[ipa] Published ${IPA_OUT} (${mb} MB)`);
  console.log("[ipa] iPhone 설치: HTTPS /install-ios.html → 네이티브 앱 설치");
}

main().catch((err) => {
  console.error("[ipa]", err instanceof Error ? err.message : err);
  process.exit(1);
});
