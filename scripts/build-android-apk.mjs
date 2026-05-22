/**
 * Android debug APK 빌드 → public/downloads/stock-dashboard.apk
 * JDK 11+ 필요. SDK 없으면 프로젝트 .android-sdk 에 cmdline-tools 설치 시도.
 *
 * Usage: node scripts/build-android-apk.mjs
 */
import fs from "fs";
import path from "path";
import { execSync, spawnSync } from "child_process";
import { fileURLToPath } from "url";
import https from "https";
import { createWriteStream } from "fs";
import { pipeline } from "stream/promises";
import { ensureCapacitorWebdir } from "./ensure-capacitor-webdir.mjs";
import { resolveMobileServerUrl } from "./resolve-mobile-server-url.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const ANDROID_DIR = path.join(ROOT, "android");
const SDK_ROOT = path.join(ROOT, ".android-sdk");
const APK_OUT = path.join(ROOT, "public", "downloads", "stock-dashboard.apk");
const CMDLINE_URL =
  "https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip";

function findJdkHome() {
  if (process.env.JAVA_HOME) {
    const j = process.env.JAVA_HOME;
    if (fs.existsSync(path.join(j, "bin", "java.exe"))) return j;
  }
  const candidates = [
    "C:\\Program Files\\Java\\jdk-21",
    "C:\\Program Files\\Java\\jdk-17",
    "C:\\Program Files\\Java\\jdk-18.0.2.1",
    "C:\\Program Files\\Android\\Android Studio\\jbr",
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, "bin", "java.exe"))) return c;
  }
  throw new Error("JDK 11+ not found. Set JAVA_HOME (e.g. C:\\Program Files\\Java\\jdk-21).");
}

function run(cmd, opts = {}) {
  console.log(">", cmd);
  execSync(cmd, {
    stdio: "inherit",
    cwd: opts.cwd ?? ROOT,
    env: { ...process.env, ...opts.env },
    shell: true,
  });
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(dest);
    https
      .get(url, (res) => {
        if (res.statusCode === 302 || res.statusCode === 301) {
          const loc = res.headers.location;
          if (!loc) return reject(new Error("redirect without location"));
          file.close();
          fs.unlinkSync(dest);
          return resolve(downloadFile(loc, dest));
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        }
        res.pipe(file);
        file.on("finish", () => file.close(resolve));
      })
      .on("error", reject);
  });
}

async function unzipWindows(zipPath, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  run(
    `powershell -NoProfile -Command "Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force"`,
  );
}

function sdkManagerBin() {
  const latest = path.join(SDK_ROOT, "cmdline-tools", "latest", "bin", "sdkmanager.bat");
  if (fs.existsSync(latest)) return latest;
  const alt = path.join(SDK_ROOT, "cmdline-tools", "bin", "sdkmanager.bat");
  if (fs.existsSync(alt)) return alt;
  return null;
}

async function ensureAndroidSdk() {
  const platformDir = path.join(SDK_ROOT, "platforms", "android-35");
  if (fs.existsSync(platformDir)) return;

  fs.mkdirSync(SDK_ROOT, { recursive: true });
  let sm = sdkManagerBin();
  if (!sm) {
    console.log("[apk] Downloading Android command-line tools…");
    const zipPath = path.join(SDK_ROOT, "cmdline-tools.zip");
    await downloadFile(CMDLINE_URL, zipPath);
    const extractTmp = path.join(SDK_ROOT, "_cmdline_extract");
    fs.rmSync(extractTmp, { recursive: true, force: true });
    await unzipWindows(zipPath, extractTmp);
    const inner = path.join(extractTmp, "cmdline-tools");
    fs.mkdirSync(path.join(SDK_ROOT, "cmdline-tools"), { recursive: true });
    fs.renameSync(inner, path.join(SDK_ROOT, "cmdline-tools", "latest"));
    fs.rmSync(extractTmp, { recursive: true, force: true });
    fs.unlinkSync(zipPath);
    sm = sdkManagerBin();
  }
  if (!sm) throw new Error("sdkmanager not found after install");

  console.log("[apk] Installing SDK packages (first run may take several minutes)…");
  const env = {
    ...process.env,
    JAVA_HOME: findJdkHome(),
    ANDROID_HOME: SDK_ROOT,
    ANDROID_SDK_ROOT: SDK_ROOT,
  };
  const yes = Buffer.from("y\n".repeat(40));
  const lic = spawnSync(sm, ["--sdk_root=" + SDK_ROOT, "--licenses"], {
    env,
    input: yes,
    stdio: ["pipe", "inherit", "inherit"],
    shell: true,
  });
  if (lic.error) throw lic.error;
  const install = spawnSync(
    sm,
    [
      "--sdk_root=" + SDK_ROOT,
      "platform-tools",
      "platforms;android-35",
      "build-tools;35.0.0",
    ],
    { env, stdio: "inherit", shell: true },
  );
  if (install.status !== 0) {
    throw new Error(`sdkmanager install failed (exit ${install.status ?? "null"})`);
  }
}

function writeLocalProperties() {
  const sdkDir = process.env.ANDROID_HOME?.trim() || SDK_ROOT;
  const escaped = sdkDir.replace(/\\/g, "\\\\");
  fs.writeFileSync(
    path.join(ANDROID_DIR, "local.properties"),
    `sdk.dir=${escaped}\n`,
    "utf8",
  );
}

function findBuiltApk() {
  const base = path.join(ANDROID_DIR, "app", "build", "outputs", "apk");
  if (!fs.existsSync(base)) return null;
  const found = [];
  function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".apk")) found.push(p);
    }
  }
  walk(base);
  found.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return found[0] ?? null;
}

async function main() {
  const jdk = findJdkHome();
  process.env.JAVA_HOME = jdk;
  process.env.ANDROID_HOME = process.env.ANDROID_HOME || SDK_ROOT;
  process.env.ANDROID_SDK_ROOT = process.env.ANDROID_SDK_ROOT || SDK_ROOT;

  const mobileUrl = resolveMobileServerUrl({
    required: true,
    allowLanFallback: false,
  });
  console.log(`[apk] WebView 고정 URL (웹과 동일): ${mobileUrl}`);
  console.log("[apk] cap sync …");
  ensureCapacitorWebdir();
  run("npx cap sync android", {
    env: {
      JAVA_HOME: jdk,
      CAPACITOR_SERVER_URL: mobileUrl,
      VITE_API_BASE_URL: mobileUrl,
    },
  });

  await ensureAndroidSdk();
  writeLocalProperties();

  const gradlew = path.join(ANDROID_DIR, "gradlew.bat");
  run(`"${gradlew}" assembleDebug`, {
    cwd: ANDROID_DIR,
    env: { JAVA_HOME: jdk, ANDROID_HOME: process.env.ANDROID_HOME },
  });

  const built = findBuiltApk();
  if (!built) throw new Error("APK not found under android/app/build/outputs/apk");

  fs.mkdirSync(path.dirname(APK_OUT), { recursive: true });
  fs.copyFileSync(built, APK_OUT);
  const distApk = path.join(ROOT, "dist", "downloads", "stock-dashboard.apk");
  if (fs.existsSync(path.join(ROOT, "dist"))) {
    fs.mkdirSync(path.dirname(distApk), { recursive: true });
    fs.copyFileSync(built, distApk);
  }
  const mb = (fs.statSync(APK_OUT).size / (1024 * 1024)).toFixed(2);
  console.log(`[apk] Published ${APK_OUT} (${mb} MB) from ${built}`);
}

main().catch((err) => {
  console.error("[apk]", err instanceof Error ? err.message : err);
  process.exit(1);
});
