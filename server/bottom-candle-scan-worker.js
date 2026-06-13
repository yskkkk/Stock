/**
 * 바닥봉 스캔 워커 스레드
 * 메인 스레드 GC Stop-the-World 없이 전체 종목 스캔 실행
 */
import { workerData, parentPort } from "node:worker_threads";

const { trigger } = workerData ?? {};

async function run() {
  try {
    const { runFullBottomCandleScanInternal } = await import(
      "./bottom-candle-poller.js"
    );
    const result = await runFullBottomCandleScanInternal(
      new Date(),
      trigger ?? "scheduled",
    );
    parentPort?.postMessage({ ok: true, result });
  } catch (e) {
    parentPort?.postMessage({
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

run();
