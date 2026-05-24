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

function cleanupLocalFiles() {
  try { fs.unlinkSync(LEASE_FILE); } catch {}
  try { fs.unlinkSync(IDE_LEASE_FILE); } catch {}
  try { fs.unlinkSync(path.join(process.cwd(), ".auto-git-sync.pause")); } catch {}
}

let leaseId = "";
try {
  leaseId = fs.readFileSync(LEASE_FILE, "utf8").trim();
} catch {
  // lease 파일 없음
}

if (!leaseId) {
  // leaseId 없으면 로컬 파일만 정리하고 종료 — IDE 슬롯 건드리지 않음
  cleanupLocalFiles();
  console.log("[claude-queue] lease 없음 — 로컬 파일만 정리");
  process.exit(0);
}

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
      cleanupLocalFiles();
    });
  },
);

req.on("error", (e) => {
  console.warn("[claude-queue] release 연결 실패:", e.message);
  cleanupLocalFiles();
});

req.write(body);
req.end();
