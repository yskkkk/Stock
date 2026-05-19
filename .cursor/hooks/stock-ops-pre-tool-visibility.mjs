/**
 * beforeSubmit 미동작 시 백업 — 첫 도구 직전 enqueue + lease 즉시 표시.
 */
import fs from "node:fs";
import path from "node:path";
import {
  hookSessionId,
  postDevQueueApi,
  readIdeLeaseFile,
  repoRoot,
} from "./stock-ops-queue-hook-lib.mjs";
import { writeIdeLeaseDiskImmediate } from "../../server/ops-ide-lease-disk.js";

const TRANSCRIPT_POLLER_MARKER = path.join(
  repoRoot,
  ".stock-ops-transcript-poller.on",
);

function allow() {
  process.stdout.write(JSON.stringify({ permission: "allow" }) + "\n");
}

/** @param {unknown} input */
function promptFromPreToolInput(input) {
  const o = input && typeof input === "object" ? input : {};
  const direct = String(o.prompt ?? o.user_message ?? "").trim();
  if (direct) return direct;
  const lease = readIdeLeaseFile();
  const fromLease = String(
    lease?.instructionPreview ?? lease?.promptPreview ?? "",
  ).trim();
  return fromLease;
}

try {
  const raw = fs.readFileSync(0, "utf8");
  const input = raw ? JSON.parse(raw) : {};
  const prompt = promptFromPreToolInput(input);
  const sessionId = hookSessionId(input);

  if (prompt && !fs.existsSync(TRANSCRIPT_POLLER_MARKER)) {
    writeIdeLeaseDiskImmediate({ prompt, sessionId, queueStatus: "waiting" });
    void postDevQueueApi(
      "/api/ops/dev-queue/ide/enqueue",
      {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({
          prompt,
          session_id: sessionId,
        }),
        signal: AbortSignal.timeout(4_000),
      },
      { timeoutMs: 4_000 },
    ).catch(() => {});
  }

  allow();
  process.exit(0);
} catch {
  allow();
  process.exit(0);
}
