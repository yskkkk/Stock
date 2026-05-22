/**
 * Composer 세션 시작 — 후속 훅에서 dev 큐 API 베이스 사용.
 */
import fs from "node:fs";

try {
  const raw = fs.readFileSync(0, "utf8");
  const input = raw ? JSON.parse(raw) : {};
  const sessionId = String(
    input.session_id ?? input.sessionId ?? input.conversation_id ?? "",
  ).trim();

  process.stdout.write(
    JSON.stringify({
      env: {
        STOCK_DEV_QUEUE_API: "http://127.0.0.1:5173",
      },
      ...(sessionId
        ? { additional_context: `Stock ops dev-queue session: ${sessionId}` }
        : {}),
    }) + "\n",
  );
} catch {
  process.stdout.write(
    JSON.stringify({
      env: { STOCK_DEV_QUEUE_API: "http://127.0.0.1:5173" },
    }) + "\n",
  );
}

process.exit(0);
