/**
 * 매집봉 고속 스캔 Worker — 메인 스레드 GC·이벤트 루프 부담 분리
 */
import { workerData, parentPort } from "node:worker_threads";

async function run() {
  try {
    const { runBookAccumulationFastScan } = await import(
      "./book-accumulation-fast-scan.js"
    );
    const result = await runBookAccumulationFastScan(workerData ?? {});
    parentPort?.postMessage({ ok: true, result });
  } catch (e) {
    parentPort?.postMessage({
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

run();
