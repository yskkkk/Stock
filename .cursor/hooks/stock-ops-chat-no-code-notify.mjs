/**
 * stop/sessionEnd — 코드 반영 없이 끝난 IDE 턴이면 ops 텔레그램 1통.
 */
import fs from "node:fs";
import {
  postDevQueueApi,
  readIdeLeaseFile,
} from "./stock-ops-queue-hook-lib.mjs";
import { hookUserPromptFromInput } from "./stock-ops-hook-user-prompt.mjs";
import {
  beginChatTurn,
  evaluateChatNoCodeEnd,
} from "./stock-ops-chat-turn-lib.mjs";

async function notifyNoCodeTurn() {
  const lease = readIdeLeaseFile();
  const prompt = String(
    lease?.instructionBody ??
      lease?.instructionPreview ??
      lease?.prompt ??
      "",
  ).trim();
  if (prompt) {
    beginChatTurn(String(lease?.sessionId ?? "").trim() || null, prompt);
  }

  const evalOut = evaluateChatNoCodeEnd();
  if (!evalOut?.shouldNotify) {
    process.stdout.write("{}\n");
    process.exit(0);
    return;
  }

  try {
    await postDevQueueApi(
      "/api/ops/chat-no-code-notify",
      {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({
          userRequest: evalOut.userRequest,
          sessionId: evalOut.sessionId || null,
        }),
        signal: AbortSignal.timeout(12_000),
      },
      { timeoutMs: 12_000 },
    );
  } catch {
    /* dev 미기동 — 알림 생략 */
  }

  process.stdout.write("{}\n");
  process.exit(0);
}

try {
  const raw = fs.readFileSync(0, "utf8");
  const input = raw ? JSON.parse(raw) : {};
  const sessionId =
    String(
      input.session_id ??
        input.sessionId ??
        input.conversation_id ??
        "",
    ).trim() || null;
  const prompt = hookUserPromptFromInput(input);
  if (prompt) beginChatTurn(sessionId, prompt);
} catch {
  /* stdin 없음 — lease만 사용 */
}

await notifyNoCodeTurn();
