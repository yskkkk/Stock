/**
 * 일회성 셋업: .claude/hooks/queue-acquire.mjs 생성
 * 사용: node scripts/create-queue-acquire-hook.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dest = path.join(root, ".claude", "hooks", "queue-acquire.mjs");

const content = `/**
 * PreToolUse hook: 쓰기 도구 최초 사용 시 개발 큐 등록 후 차례까지 대기.
 * - lease 파일이 있으면 스킵 (동일 턴 재진입 방지)
 * - HTTP 전에 placeholder 기록 → 훅 타임아웃 시에도 중복 등록 없음
 * - 서버 미기동 시 fail-open
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const LEASE_FILE = path.join(process.cwd(), ".claude-queue-lease");
const PAUSE_FILE = path.join(process.cwd(), ".auto-git-sync.pause");
const IDE_LEASE_FILE = path.join(process.cwd(), ".stock-ops-ide-lease.json");
const PORT = Number(process.env.PORT) || 5173;

const READ_ONLY_TOOLS = new Set([
  "Read", "Glob", "Grep", "LS", "NotebookRead",
  "WebFetch", "WebSearch", "TaskGet", "TaskList", "TaskOutput",
]);

let input = {};
try {
  const raw = fs.readFileSync(0, "utf8");
  if (raw.trim()) input = JSON.parse(raw);
} catch {}

const toolName = String(input.tool_name ?? "").trim();
if (READ_ONLY_TOOLS.has(toolName)) process.exit(0);

// 이미 큐 획득됨 (또는 이번 턴 진행 중) — 스킵
if (fs.existsSync(LEASE_FILE)) process.exit(0);

// placeholder 먼저 기록: 훅이 타임아웃돼도 같은 턴 내 중복 등록 방지
try { fs.writeFileSync(LEASE_FILE, "pending", "utf8"); } catch {}
try { fs.writeFileSync(PAUSE_FILE, new Date().toISOString(), "utf8"); } catch {}

const inp = input.tool_input ?? {};
const prompt = String(
  inp.description ?? inp.command ?? inp.instruction ?? inp.prompt ?? inp.file_path ?? ""
).slice(0, 220).trim() || "Claude Code 작업 중";

const body = JSON.stringify({ prompt });

const req = http.request(
  {
    hostname: "127.0.0.1", port: PORT,
    path: "/api/ops/dev-queue/claude-code/acquire",
    method: "POST",
    headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
    timeout: 60 * 60 * 1000,
  },
  (res) => {
    let d = "";
    res.on("data", (c) => (d += c));
    res.on("end", () => {
      try {
        const data = JSON.parse(d);
        if (data.ok && data.leaseId) {
          // placeholder → 실제 leaseId로 교체
          fs.writeFileSync(LEASE_FILE, data.leaseId, "utf8");
          fs.writeFileSync(
            IDE_LEASE_FILE,
            JSON.stringify({
              leaseId: data.leaseId,
              sessionId: null,
              sinceMs: Date.now(),
              queueSeq: data.queueSeq ?? null,
              queueStatus: "running",
              instructionPreview: prompt,
              requestIp: "claude-code",
            }, null, 2) + "\\n",
            "utf8",
          );
        }
      } catch {}
      process.exit(0);
    });
  },
);

req.on("error", () => {
  // 서버 미기동 — placeholder 제거 후 fail-open
  try { fs.unlinkSync(LEASE_FILE); } catch {}
  process.exit(0);
});
req.on("timeout", () => { try { req.destroy(); } catch {} });
req.write(body);
req.end();
`;

fs.mkdirSync(path.join(root, ".claude", "hooks"), { recursive: true });
fs.writeFileSync(dest, content, "utf8");
console.log("완료:", dest);
