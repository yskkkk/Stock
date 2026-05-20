export interface CryptoAsset {
  symbol: string;
  name: string;
  /** 빗썸 KRW 24h 거래대금(acc_trade_value), 목록 정렬·표시 */
  quoteTurnoverKrw?: number;
}

/** 거래대금 내림차순 */
export function sortCryptoAssetsByTurnover<T extends CryptoAsset>(assets: T[]): T[] {
  return [...assets].sort(
    (a, b) => (b.quoteTurnoverKrw ?? 0) - (a.quoteTurnoverKrw ?? 0),
  );
}

/** 빗썸 KRW 기준 — 초기 표시(서버 유니버스 로드 후 갱신, 심볼 키는 -USDT 유지) */
export const CRYPTO_ASSETS: readonly CryptoAsset[] = [
  { symbol: "BTC-USDT", name: "Bitcoin / 비트코인" },
  { symbol: "ETH-USDT", name: "Ethereum / 이더리움" },
  { symbol: "SOL-USDT", name: "Solana / 솔라나" },
] as const;
