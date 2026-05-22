import { loadEnvFile } from "../server/load-env.js";
import { getIosInstallStatus } from "../server/ios-ota-manifest.js";
import { resolveMobileIpaPath } from "../server/mobile-ios-download.js";

loadEnvFile();

const s = getIosInstallStatus();
const ipa = resolveMobileIpaPath();

console.log("[ios-ota] httpsOrigin:", s.httpsOrigin ?? "(없음)");
console.log("[ios-ota] ipa:", ipa ? "OK" : "없음 — Mac에서 npm run ipa:build");
console.log("[ios-ota] manifest:", s.ota.manifestUrl ?? "(생성 불가)");
console.log("[ios-ota] canInstall:", s.ota.canInstall && !!ipa);
if (s.ota.originBlockReason) {
  console.log("[ios-ota] originBlock:", s.ota.originBlockReason);
}
if (!s.httpsOrigin) {
  console.log("\n→ .env 에 APP_PUBLIC_BASE_URL=https://도메인 추가");
  console.log("→ docs/IOS_HTTPS_INSTALL.md 참고");
  process.exit(1);
}
if (!ipa) process.exit(1);
