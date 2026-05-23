/**
 * PreToolUse hook: 쓰기 도구 최초 사용 시 개발 큐 등록 후 차례까지 대기.
 * 이미 lease 파일이 있으면 스킵(동일 턴 내 재진입).
 * 서버 미기동 시 fail-open.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const LEASE_FILE = path.join(process.cwd(), ".claude-queue-lease");
const PAUSE_FILE = path.join(process.cwd(), ".auto-git-sync.pause");
const IDE_LEASE_FILE = path.join(process.cwd(), ".stock-ops-ide-lease.json");
const PORT = Number(process.env.PORT) || 5173;

// 읽기 전용 도구 — 큐 불필요
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

// 읽기 전용 도구면 스킵
if (READ_ONLY_TOOLS.has(toolName)) process.exit(0);

// 이미 큐 획득됨 — 스킵
if (fs.existsSync(LEASE_FILE)) process.exit(0);

// auto-git-sync 즉시 일시 정지
try { fs.writeFileSync(PAUSE_FILE, new Date().toISOString(), "utf8"); } catch {}

// 프롬프트 구성 (도구 입력에서 추출)
const inp = input.tool_input ?? {};
const prompt = String(
  inp.description ?? inp.command ?? inp.instruction ?? inp.prompt ??
  inp.file_path ?? ""
).slice(0, 220).trim() || "Claude Code 작업 중";

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
    timeout: 60 * 60 * 1000,
  },
  (res) => {
    let d = "";
    res.on("data", (c) => (d += c));
    res.on("end", () => {
      try {
        const data = JSON.parse(d);
        if (data.ok && data.leaseId) {
          fs.writeFileSync(LEASE_FILE, data.leaseId, "utf8");
          // ops IDE lease 파일에도 기록 (웹 UI 표시용)
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
            }, null, 2) + "\n",
            "utf8",
          );
        }
      } catch {}
      process.exit(0);
    });
  },
);

req.on("error", () => process.exit(0)); // 서버 미기동 — fail-open
req.on("timeout", () => { try { req.destroy(); } catch {} });
req.write(body);
req.end();
