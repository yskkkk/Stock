/**
 * 박스권 카탈로그 스캔 워커 스레드
 * 메인 스레드 GC Stop-the-World 없이 대량 일봉 로드·분석 실행
 */
import { workerData, parentPort } from "node:worker_threads";

const { scanType } = workerData ?? {};

async function run() {
  try {
    let result;
    if (scanType === "us") {
      const { runSp500BoxRangeCatalogScan } = await import(
        "./sp500-scan-runner.js"
      );
      result = await runSp500BoxRangeCatalogScan();
    } else if (scanType === "kr") {
      const { runKrBoxRangeCatalogScan } = await import(
        "./kr-scan-runner.js"
      );
      result = await runKrBoxRangeCatalogScan();
    } else if (scanType === "crypto") {
      const { runCryptoBoxRangeCatalogScan } = await import(
        "./crypto-scan-runner.js"
      );
      result = await runCryptoBoxRangeCatalogScan();
    } else {
      throw new Error(`unknown scanType: ${scanType}`);
    }
    parentPort?.postMessage({ ok: true, result });
  } catch (e) {
    parentPort?.postMessage({
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

run();
