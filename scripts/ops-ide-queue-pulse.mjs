#!/usr/bin/env node
/**
 * Cursor 훅 없이 에이전트가 도구를 쓰기 직전·직후 큐에 즉시 올릴 때 사용.
 * usage: node scripts/ops-ide-queue-pulse.mjs "사용자 요청 한 줄 요약"
 */
const prompt = process.argv.slice(2).join(" ").trim();
if (!prompt) process.exit(0);

const bases = [
  String(process.env.STOCK_DEV_QUEUE_API ?? "").replace(/\/$/, ""),
  "http://127.0.0.1:5173",
  "http://localhost:5173",
].filter(Boolean);

async function post(pathname, body) {
  let lastErr = null;
  for (const base of bases) {
    try {
      const res = await fetch(`${base}${pathname}`, {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8_000),
      });
      if (res.status === 404) continue;
      return res;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error("dev 서버 연결 실패");
}

try {
  await post("/api/ops/dev-queue/ide/enqueue", {
    prompt,
    session_id: "agent-pulse",
  });
} catch {
  process.exit(0);
}
