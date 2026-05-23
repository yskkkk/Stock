/**
 * Claude Code 작업 완료 후 개발 대기열 슬롯 해제.
 * 사용: node scripts/claude-queue-release.mjs
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const PORT = Number(process.env.PORT) || 5173;
const LEASE_FILE = path.join(process.cwd(), ".claude-queue-lease");
const IDE_LEASE_FILE = path.join(process.cwd(), ".stock-ops-ide-lease.json");

let leaseId = "";
try {
  leaseId = fs.readFileSync(LEASE_FILE, "utf8").trim();
} catch {
  // lease 파일 없으면 release-active로 폴백
}

const endpoint = leaseId
  ? "/api/ops/dev-queue/claude-code/release"
  : "/api/ops/dev-queue/ide/release-active";
const body = leaseId ? JSON.stringify({ leaseId }) : "{}";

const req = http.request(
  {
    hostname: "127.0.0.1",
    port: PORT,
    path: endpoint,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
    },
  },
  (res) => {
    let d = "";
    res.on("data", (c) => (d += c));
    res.on("end", () => {
      try {
        const data = JSON.parse(d);
        if (data.ok) {
          console.log("[claude-queue] 슬롯 해제 완료");
        } else {
          console.warn("[claude-queue] 해제 응답:", d);
        }
      } catch {
        console.warn("[claude-queue] 해제 응답 파싱 실패:", d);
      }
      try {
        if (leaseId) fs.unlinkSync(LEASE_FILE);
        try { fs.unlinkSync(IDE_LEASE_FILE); } catch {}
        try { fs.unlinkSync(path.join(process.cwd(), ".auto-git-sync.pause")); } catch {}
      } catch {}
    });
  },
);

req.on("error", (e) => {
  console.warn("[claude-queue] release 연결 실패:", e.message);
  try {
    if (leaseId) fs.unlinkSync(LEASE_FILE);
    try { fs.unlinkSync(IDE_LEASE_FILE); } catch {}
    try { fs.unlinkSync(path.join(process.cwd(), ".auto-git-sync.pause")); } catch {}
  } catch {}
});

req.write(body);
req.end();
