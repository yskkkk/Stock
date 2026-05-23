/**
 * Cursor IDE → 단일 개발 큐(FIFO).
 * - enqueue: 웹 대기열에 즉시 표시
 * - wait-grant: 차례까지 대기 (Cursor 훅 타임아웃 방지를 위해 짧은 HTTP 타임아웃으로 폴링)
 * - dev 서버 없음: fail-open (IDE 단독)
 */
import fs from "node:fs";
import {
  clearIdeLeaseFile,
  clearIdeTurnRule,
  hookSessionId,
  postDevQueueApi,
  writeIdeLeaseFile,
  writeIdeTurnRule,
} from "./stock-ops-queue-hook-lib.mjs";
import { writeIdeLeaseDiskImmediate } from "../../server/ops-ide-lease-disk.js";
import { hookUserPromptFromInput } from "./stock-ops-hook-user-prompt.mjs";
import { beginChatTurn } from "./stock-ops-chat-turn-lib.mjs";

/** wait-grant는 서버에서 차례까지 HTTP를 붙잡음 — 짧으면 큐 대기 중 오탐 타임아웃 */
const HOOK_GRANT_WAIT_MS = (() => {
  const n = Number(process.env.STOCK_IDE_HOOK_GRANT_WAIT_MS);
  if (Number.isFinite(n) && n >= 15_000) return Math.min(n, 46 * 60 * 1000);
  return 10 * 60 * 1000;
})();

function allow() {
  process.stdout.write(JSON.stringify({ continue: true }) + "\n");
}

function block(msg) {
  process.stdout.write(
    JSON.stringify({
      continue: false,
      user_message: msg,
    }) + "\n",
  );
}

function cleanupLocal() {
  clearIdeLeaseFile();
  clearIdeTurnRule();
}

const DEBUG_LOG = new URL("../../server/.logs/cursor-hook-debug.log", import.meta.url).pathname;
function debugLog(msg) {
  try {
    fs.mkdirSync(new URL("../../server/.logs", import.meta.url).pathname, { recursive: true });
    fs.appendFileSync(DEBUG_LOG, `[${new Date().toISOString()}] ${msg}\n`, "utf8");
  } catch {}
}

try {
  const raw = fs.readFileSync(0, "utf8");
  debugLog(`beforeSubmitPrompt RAW stdin keys=${Object.keys(raw ? JSON.parse(raw) : {}).join(",")}`);
  const input = raw ? JSON.parse(raw) : {};
  const sessionId = hookSessionId(input);
  const prompt = hookUserPromptFromInput(input);

  debugLog(`beforeSubmitPrompt triggered. prompt="${(prompt ?? "").slice(0, 60)}"`);

  if (!prompt) {
    debugLog("no prompt — allow");
    allow();
    process.exit(0);
  }

  beginChatTurn(sessionId, prompt);

  /* 전송 직후 웹 UI(0.1s 폴링)에 먼저 표시 — transcript(jsonl)는 10~30초 늦게 기록됨 */
  writeIdeLeaseDiskImmediate({ prompt, sessionId, queueStatus: "waiting" });
  writeIdeLeaseFile({
    leaseId: null,
    sessionId,
    sinceMs: Date.now(),
    queueSeq: null,
    queueStatus: "waiting",
    instructionPreview: prompt.slice(0, 220),
    instructionBody: prompt.slice(0, 16_000),
  });

  let enqRes;
  try {
    enqRes = await postDevQueueApi(
      "/api/ops/dev-queue/ide/enqueue",
      {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({
          prompt,
          session_id: sessionId,
        }),
        signal: AbortSignal.timeout(12_000),
      },
      { timeoutMs: 12_000 },
    );
  } catch (err) {
    /* 디스크 lease 유지 → UI 즉시 표시; dev 미연결 시 fail-open */
    console.error(
      "[stock-ops-hook] dev 큐 연결 실패 — npm run dev 실행·5173 포트 확인:",
      err instanceof Error ? err.message : err,
    );
    allow();
    process.exit(0);
  }

  const enqText = await enqRes.text();
  /** @type {{ ok?: boolean; error?: string; code?: string; leaseId?: string; queueSeq?: number }} */
  let enqBody = {};
  try {
    enqBody = enqText ? JSON.parse(enqText) : {};
  } catch {
    enqBody = {};
  }

  if (!enqRes.ok) {
    const code =
      enqBody && typeof enqBody === "object" && "code" in enqBody
        ? String(/** @type {{ code?: string }} */ (enqBody).code)
        : "";
    const errMsg =
      typeof enqBody.error === "string"
        ? enqBody.error
        : `개발 큐 등록 오류 (HTTP ${enqRes.status})`;
    if (code === "OPS_QUEUE_FULL" || code === "IDE_SESSION_BUSY") {
      cleanupLocal();
      block(errMsg);
      process.exit(0);
    }
    allow();
    process.exit(0);
  }

  const leaseId = String(enqBody.leaseId ?? "").trim();
  if (!leaseId) {
    allow();
    process.exit(0);
  }

  writeIdeLeaseDiskImmediate({ prompt, sessionId, leaseId });

  writeIdeLeaseFile({
    leaseId,
    sessionId,
    sinceMs: Date.now(),
    queueSeq: enqBody.queueSeq ?? null,
    queueStatus: "waiting",
  });

  /** @type {Record<string, unknown> | null} */
  let grantBody = null;
  let grantRes;
  try {
    grantRes = await postDevQueueApi(
      "/api/ops/dev-queue/ide/wait-grant",
      {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ leaseId }),
        signal: AbortSignal.timeout(HOOK_GRANT_WAIT_MS + 5_000),
      },
      { timeoutMs: HOOK_GRANT_WAIT_MS },
    );
    const grantText = await grantRes.text();
    try {
      grantBody = grantText ? JSON.parse(grantText) : {};
    } catch {
      grantBody = {};
    }
  } catch {
    grantBody = null;
  }

  if (!grantBody || grantBody.ok === false) {
    /* 슬롯·lease는 서버에 남겨 display JSON·웹 UI에 대기로 보이게 함(취소하면 파일이 바로 비어 보임) */
    cleanupLocal();
    block(
      "개발 큐에서 실행 차례를 기다리는 중 시간이 초과되었습니다.\n\n" +
        "웹 에이전트가 끝난 뒤 다시 보내세요. 계속 막히면 `npm run dev`를 재시작하세요.",
    );
    process.exit(0);
  }

  const contextNote = String(grantBody.contextNote ?? "").slice(0, 4000);
  writeIdeLeaseFile({
    leaseId,
    sessionId,
    sinceMs: Date.now(),
    queueSeq: grantBody.queueSeq ?? enqBody.queueSeq ?? null,
    waitedMs: grantBody.waitedMs ?? null,
    gitHead: grantBody.gitHead ?? null,
    queueStatus: "running",
    contextNote,
  });
  writeIdeTurnRule(contextNote);

  // auto-git-sync 일시 정지 (Cursor 작업 중 서버 pull 방지)
  try {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(new URL("../../.auto-git-sync.pause", import.meta.url).pathname, new Date().toISOString(), "utf8");
  } catch {}

  debugLog(`grant ok — allow (queueSeq=${grantBody.queueSeq ?? "?"})`);
  allow();
  process.exit(0);
} catch (e) {
  debugLog(`CATCH error — fail-open: ${e instanceof Error ? e.message : String(e)}`);
  cleanupLocal();
  allow();
  process.exit(0);
}
