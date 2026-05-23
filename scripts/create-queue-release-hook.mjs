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
 * git push 이후 Stop이 발생하므로 push 완료 후 해제가 보장됨.
 * leaseId 해제 실패 시 release-active 폴백으로 stale 슬롯 방지.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const LEASE_FILE = path.join(process.cwd(), ".claude-queue-lease");
const PAUSE_FILE = path.join(process.cwd(), ".auto-git-sync.pause");
const IDE_LEASE_FILE = path.join(process.cwd(), ".stock-ops-ide-lease.json");
const PORT = Number(process.env.PORT) || 5173;

// pause 파일 즉시 제거 (git push 완료 후이므로 pull 허용)
try { fs.unlinkSync(PAUSE_FILE); } catch {}

let leaseId = "";
try { leaseId = fs.readFileSync(LEASE_FILE, "utf8").trim(); } catch {}

// IDE lease 파일 정리
try { fs.unlinkSync(IDE_LEASE_FILE); } catch {}

if (!leaseId) process.exit(0);

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

// 1차: leaseId로 정확한 해제
postJson("/api/ops/dev-queue/claude-code/release", { leaseId }, (err) => {
  try { fs.unlinkSync(LEASE_FILE); } catch {}
  if (!err) { process.exit(0); }
  // 2차 폴백: 실행 중인 슬롯 전체 해제 (stale 방지)
  postJson("/api/ops/dev-queue/ide/release-active", {}, () => process.exit(0));
});
`;

fs.writeFileSync(dest, content, "utf8");
console.log("완료:", dest);
