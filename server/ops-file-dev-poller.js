/**
 * 파일 반영 큐: JSON만 순차 디스크 반영. Cursor 에이전트·enqueueOpsAgentJob 미사용.
 */
import { applyFileDevPayload } from "./ops-file-dev-apply.js";
import {
  FILE_DEV_POLL_MS,
  claimNextPendingFileDevJob,
  finalizeFileDevApplied,
  finalizeFileDevError,
} from "./ops-file-dev-store.js";

/** @type {Promise<void>} */
let tickChain = Promise.resolve();

function tickOnce() {
  tickChain = tickChain
    .then(async () => {
      const dis = String(process.env.OPS_FILE_DEV_DISABLED ?? "").trim();
      if (dis === "1" || dis.toLowerCase() === "true") return;

      const claimed = await claimNextPendingFileDevJob();
      if (!claimed) return;

      const { id, requestJson, fingerprint } = claimed;
      try {
        const out = applyFileDevPayload(requestJson);
        const head = out.paths.slice(0, 10).join(", ");
        const more = out.paths.length > 10 ? ` … 외 ${out.paths.length - 10}개` : "";
        const summary = `${out.written}개 파일 반영: ${head}${more}`;
        await finalizeFileDevApplied(id, fingerprint, summary);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await finalizeFileDevError(id, msg);
      }
    })
    .catch(() => {});
}

export function startOpsFileDevPoller() {
  const g = /** @type {typeof globalThis & { __stockOpsFileDevPollerStarted?: boolean }} */ (
    globalThis
  );
  if (g.__stockOpsFileDevPollerStarted) return;
  g.__stockOpsFileDevPollerStarted = true;
  setInterval(() => {
    void tickOnce();
  }, FILE_DEV_POLL_MS);
  setTimeout(() => {
    void tickOnce();
  }, 2500);
}
