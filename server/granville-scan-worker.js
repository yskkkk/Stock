/**
 * 그랜빌 8법칙 스캔 워커 스레드
 * 메인 스레드 GC Stop-the-World 없이 전체 종목 스캔 실행
 */
import { workerData, parentPort } from "node:worker_threads";

const { trigger, markets } = workerData ?? {};

async function run() {
  try {
    const { runFullGranvilleScanInternal } = await import("./granville-poller.js");
    const scanMarkets =
      Array.isArray(markets) && markets.length ? markets : ["kr", "us"];
    const result = await runFullGranvilleScanInternal(
      new Date(),
      trigger ?? "scheduled",
      scanMarkets,
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
