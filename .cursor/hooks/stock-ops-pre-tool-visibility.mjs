/**
 * beforeSubmit 미동작·Agent stdin 무prompt 시 — 첫 도구 직전 enqueue.
 */
import fs from "node:fs";
import {
  hookSessionId,
  postDevQueueApi,
  writeIdeLeaseFile,
} from "./stock-ops-queue-hook-lib.mjs";
import {
  hookUserPromptFromInput,
  readLatestUserPromptFromTranscriptsSync,
} from "./stock-ops-hook-user-prompt.mjs";
import { writeIdeLeaseDiskImmediate } from "../../server/ops-ide-lease-disk.js";

function allow() {
  process.stdout.write(JSON.stringify({ permission: "allow" }) + "\n");
}

async function ensureIdeQueueEnqueued(prompt, sessionId) {
  writeIdeLeaseDiskImmediate({ prompt, sessionId, queueStatus: "waiting" });
  writeIdeLeaseFile({
    leaseId: null,
    sessionId,
    sinceMs: Date.now(),
    queueSeq: null,
    queueStatus: "waiting",
    instructionPreview: prompt.slice(0, 220),
  });

  try {
    const enqRes = await postDevQueueApi(
      "/api/ops/dev-queue/ide/enqueue",
      {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ prompt, session_id: sessionId }),
        signal: AbortSignal.timeout(5_000),
      },
      { timeoutMs: 5_000 },
    );
    const enqText = await enqRes.text();
    let body = {};
    try {
      body = enqText ? JSON.parse(enqText) : {};
    } catch {
      body = {};
    }
    const leaseId = String(body.leaseId ?? "").trim();
    if (leaseId) {
      writeIdeLeaseDiskImmediate({ prompt, sessionId, leaseId, queueStatus: "waiting" });
      writeIdeLeaseFile({
        leaseId,
        sessionId,
        sinceMs: Date.now(),
        queueSeq: body.queueSeq ?? null,
        queueStatus: "waiting",
        instructionPreview: prompt.slice(0, 220),
      });
    }
  } catch {
    /* dev 미기동 — lease만 */
  }
}

try {
  const raw = fs.readFileSync(0, "utf8");
  const input = raw ? JSON.parse(raw) : {};
  const sessionId = hookSessionId(input);
  const prompt =
    hookUserPromptFromInput(input) || readLatestUserPromptFromTranscriptsSync();

  if (prompt) {
    await ensureIdeQueueEnqueued(prompt, sessionId);
  }

  allow();
  process.exit(0);
} catch {
  allow();
  process.exit(0);
}
