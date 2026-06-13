/**
 * 골든크로스·종목보관 스캔 워커 스레드
 * 메인 스레드 GC Stop-the-World 없이 전체 종목 차트 분석 실행
 */
import { workerData, parentPort } from "node:worker_threads";

const { market } = workerData ?? {};

async function run() {
  try {
    const { runGoldenCrossScanIfDue } = await import(
      "./golden-cross-poller.js"
    );
    const result = await runGoldenCrossScanIfDue(market);
    parentPort?.postMessage({ ok: true, result });
  } catch (e) {
    parentPort?.postMessage({
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

run();
