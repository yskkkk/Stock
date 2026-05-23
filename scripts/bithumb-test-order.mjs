/**
 * 빗썸 실주문 스모크 테스트 (로컬 .env 필요)
 *   node scripts/bithumb-test-order.mjs DOGE 1        # 1 DOGE (최소금액 미만이면 거절)
 *   node scripts/bithumb-test-order.mjs DOGE 5500     # 5,500원 시장가 매수
 */
import { loadEnvFile } from "../server/load-env.js";
import { fetchBithumbKrwTicker } from "../server/bithumb-krw.js";
import {
  executeBithumbMarketBuyKrw,
  executeBithumbMarketBuyVolume,
  getBithumbTradingStatus,
  yahooSymbolToBithumbMarket,
} from "../server/bithumb-trading-adapter.js";

loadEnvFile();

const base = String(process.argv[2] ?? "DOGE").trim().toUpperCase();
const arg = process.argv[3];

const status = getBithumbTradingStatus();
console.log("[status]", status);

const market =
  yahooSymbolToBithumbMarket(`${base}-USDT`) ?? `KRW-${base}`;
const ticker = await fetchBithumbKrwTicker(base);
const price = Number(ticker.closing_price);
console.log(`[${market}] 현재가 약 ${price} KRW`);

if (arg != null && /^\d+$/.test(arg) && Number(arg) >= 5000) {
  const krw = Number(arg);
  console.log(`[주문] 시장가 매수 ${krw} KRW …`);
  const out = await executeBithumbMarketBuyKrw(market, krw);
  console.log(JSON.stringify(out, null, 2));
  process.exit(out.ok ? 0 : 1);
}

const vol = arg != null ? Number(arg) : 1;
console.log(`[주문] 시장가 매수 수량 ${vol} ${base} (약 ${Math.round(vol * price)} KRW) …`);
const outVol = await executeBithumbMarketBuyVolume(market, vol);
console.log(JSON.stringify(outVol, null, 2));
if (!outVol.ok && vol === 1 && price * vol < 5000) {
  console.log("\n→ 1개는 빗썸 최소 주문(약 5,000원) 미만입니다. 예: node scripts/bithumb-test-order.mjs DOGE 5500");
}
process.exit(outVol.ok ? 0 : 1);
