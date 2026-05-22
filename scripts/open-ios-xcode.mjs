/**
 * Xcode에서 Swift 프로젝트 열기 (macOS)
 */
import { execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROJECT = path.join(
  ROOT,
  "ios-native",
  "StockDashboard",
  "StockDashboard.xcodeproj",
);

if (process.platform !== "darwin") {
  console.error("[ios] Xcode는 macOS에서만 열 수 있습니다.");
  console.error(`  프로젝트 경로: ${PROJECT}`);
  process.exit(1);
}

execSync(`open "${PROJECT}"`, { stdio: "inherit" });
