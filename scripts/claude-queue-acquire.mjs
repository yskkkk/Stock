/**
 * Claude Code 작업 시작 전 개발 대기열 슬롯 등록.
 * 사용: node scripts/claude-queue-acquire.mjs "작업 설명"
 * 완료되면 .claude-queue-lease 에 leaseId 저장.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const PORT = Number(process.env.PORT) || 5173;
const LEASE_FILE = path.join(process.cwd(), ".claude-queue-lease");

const prompt = process.argv.slice(2).join(" ").trim() || "Claude Code 작업 중";

const body = JSON.stringify({ prompt });

const req = http.request(
  {
    hostname: "127.0.0.1",
    port: PORT,
    path: "/api/ops/dev-queue/claude-code/acquire",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
    },
    timeout: 60 * 60 * 1000, // 1시간 — 큐 대기 최대
  },
  (res) => {
    let d = "";
    res.on("data", (c) => (d += c));
    res.on("end", () => {
      try {
        const data = JSON.parse(d);
        if (!data.ok) {
          console.error("[claude-queue] acquire 실패:", data.error ?? d);
          process.exit(1);
        }
        fs.writeFileSync(LEASE_FILE, data.leaseId, "utf8");
        console.log(
          `[claude-queue] 큐 등록 완료 #${data.queueSeq} leaseId=${data.leaseId} 대기=${data.waitedMs}ms`,
        );
      } catch (e) {
        console.error("[claude-queue] 응답 파싱 실패:", d, e.message);
        process.exit(1);
      }
    });
  },
);

req.on("error", (e) => {
  console.error("[claude-queue] 연결 실패 (서버 꺼짐?):", e.message);
  process.exit(1);
});

console.log(`[claude-queue] 큐 대기 중... prompt="${prompt}" (port=${PORT})`);
req.write(body);
req.end();
