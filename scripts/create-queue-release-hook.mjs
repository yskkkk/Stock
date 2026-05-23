/**
 * 일회성 셋업 스크립트: .claude/hooks/queue-release.mjs 생성
 * 사용: node scripts/create-queue-release-hook.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dest = path.join(root, ".claude", "hooks", "queue-release.mjs");

const content = `/**
 * Stop hook: 큐 슬롯 해제 + auto-git-sync 재개.
 * 1차: leaseId로 정확한 해제
 * 2차: 항상 release-active 호출 — running·waiting 고아 슬롯 일괄 정리
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const LEASE_FILE = path.join(process.cwd(), ".claude-queue-lease");
const PAUSE_FILE = path.join(process.cwd(), ".auto-git-sync.pause");
const IDE_LEASE_FILE = path.join(process.cwd(), ".stock-ops-ide-lease.json");
const PORT = Number(process.env.PORT) || 5173;

try { fs.unlinkSync(PAUSE_FILE); } catch {}

let leaseId = "";
try { leaseId = fs.readFileSync(LEASE_FILE, "utf8").trim(); } catch {}

try { fs.unlinkSync(IDE_LEASE_FILE); } catch {}
try { fs.unlinkSync(LEASE_FILE); } catch {}

function postJson(pathname, body, cb) {
  const b = JSON.stringify(body);
  const req = http.request(
    { hostname: "127.0.0.1", port: PORT, path: pathname, method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(b) },
      timeout: 10_000 },
    (res) => { res.resume(); res.on("end", () => cb(null)); },
  );
  req.on("error", cb);
  req.on("timeout", () => { req.destroy(); cb(new Error("timeout")); });
  req.write(b);
  req.end();
}

// 1차: leaseId로 정확한 해제 (pending이면 서버에 슬롯 없으므로 바로 2차로)
const doReleaseActive = () =>
  postJson("/api/ops/dev-queue/ide/release-active", {}, () => process.exit(0));

if (!leaseId || leaseId === "pending") {
  doReleaseActive();
} else {
  postJson("/api/ops/dev-queue/claude-code/release", { leaseId }, () => {
    // 성공·실패 무관하게 항상 release-active로 고아 슬롯까지 정리
    doReleaseActive();
  });
}
`;

fs.writeFileSync(dest, content, "utf8");
console.log("완료:", dest);
