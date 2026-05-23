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

const body = JSON.stringify({ leaseId });

const req = http.request(
  {
    hostname: "127.0.0.1",
    port: PORT,
    path: "/api/ops/dev-queue/claude-code/release",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
    },
    timeout: 15_000,
  },
  (res) => {
    let d = "";
    res.on("data", (c) => (d += c));
    res.on("end", () => {
      try { fs.unlinkSync(LEASE_FILE); } catch {}
      process.exit(0);
    });
  },
);

req.on("error", () => {
  try { fs.unlinkSync(LEASE_FILE); } catch {}
  process.exit(0);
});

req.on("timeout", () => {
  try { req.destroy(); } catch {}
  try { fs.unlinkSync(LEASE_FILE); } catch {}
  process.exit(0);
});

req.write(body);
req.end();
`;

fs.writeFileSync(dest, content, "utf8");
console.log("완료:", dest);
