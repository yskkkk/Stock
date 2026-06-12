/**
 * 국내 유니버스 재무제표 아카이브 전량 갱신 (DART v2)
 * node scripts/refresh-kr-financials-archive.mjs
 */
import { loadEnvFile } from "../server/load-env.js";

loadEnvFile();

const { runFinancialsArchiveForMarket } = await import("../server/stock-financials-archive.js");
const { isDartEnabled } = await import("../server/dart.js");

if (!isDartEnabled()) {
  console.error("OPENDART_API_KEY가 없습니다. .env 확인 후 재시도하세요.");
  process.exit(1);
}

console.log("[refresh-kr-financials] KR 아카이브 시작…");
const result = await runFinancialsArchiveForMarket("kr");
console.log("[refresh-kr-financials] 완료", result);
