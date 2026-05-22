/**
 * IDE 에이전트 턴 종료 — 실행 중·고아 IDE 슬롯·디스크 lease 해제.
 */
import {
  clearIdeLeaseFile,
  clearIdeTurnRule,
  postDevQueueApi,
  readIdeLeaseFile,
} from "./stock-ops-queue-hook-lib.mjs";

async function postReleaseActive() {
  const lease = readIdeLeaseFile();
  const prompt = String(
    lease?.instructionBody ??
      lease?.instructionPreview ??
      lease?.prompt ??
      "",
  ).trim();
  const body = prompt
    ? JSON.stringify({
        userRequest: prompt,
        sessionId: String(lease?.sessionId ?? "").trim() || null,
      })
    : "{}";
  try {
    await postDevQueueApi(
      "/api/ops/dev-queue/ide/release-active",
      {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body,
        signal: AbortSignal.timeout(12_000),
      },
      { timeoutMs: 12_000 },
    );
  } catch {
    /* dev 미기동 등 */
  }
}

try {
  const lease = readIdeLeaseFile();
  const leaseId = String(lease?.leaseId ?? "").trim();
  if (leaseId) {
    try {
      const res = await postDevQueueApi(
        "/api/ops/dev-queue/ide/release",
        {
          method: "POST",
          headers: { "Content-Type": "application/json; charset=utf-8" },
          body: JSON.stringify({ leaseId }),
          signal: AbortSignal.timeout(12_000),
        },
        { timeoutMs: 12_000 },
      );
      if (!res.ok) {
        await postDevQueueApi(
          "/api/ops/dev-queue/ide/cancel",
          {
            method: "POST",
            headers: { "Content-Type": "application/json; charset=utf-8" },
            body: JSON.stringify({ leaseId }),
            signal: AbortSignal.timeout(8_000),
          },
          { timeoutMs: 8_000 },
        );
      }
    } catch {
      await postReleaseActive();
    }
  } else {
    await postReleaseActive();
  }
  clearIdeLeaseFile();
  clearIdeTurnRule();
} catch {
  await postReleaseActive();
  clearIdeLeaseFile();
  clearIdeTurnRule();
}

process.stdout.write("{}\n");
process.exit(0);
