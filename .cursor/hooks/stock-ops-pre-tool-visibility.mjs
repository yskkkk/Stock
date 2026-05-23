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

const _debugLog2 = (msg) => {
  try {
    const p = new URL("../../server/.logs/cursor-hook-debug.log", import.meta.url).pathname;
    fs.appendFileSync(p, `[${new Date().toISOString()}] [preToolUse] ${msg}\n`, "utf8");
  } catch {}
};

try {
  const raw = fs.readFileSync(0, "utf8");
  const input = raw ? JSON.parse(raw) : {};
  _debugLog2(`fired. tool=${input.tool_name ?? "?"} keys=${Object.keys(input).join(",")}`);
  const sessionId = hookSessionId(input);
  const prompt =
    hookUserPromptFromInput(input) || readLatestUserPromptFromTranscriptsSync();

  _debugLog2(`prompt="${(prompt ?? "").slice(0, 60)}"`);

  if (prompt) {
    await ensureIdeQueueEnqueued(prompt, sessionId);
  }

  allow();
  process.exit(0);
} catch (e) {
  _debugLog2(`CATCH: ${e instanceof Error ? e.message : String(e)}`);
  allow();
  process.exit(0);
}
