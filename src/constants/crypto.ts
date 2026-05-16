export interface CryptoAsset {
  symbol: string;
  name: string;
  /** USDT 거래대금(24h), 목록 정렬·표시용 */
  quoteVolume?: number;
}

/** Binance USDT 현물 — 초기 표시(서버 유니버스 로드 후 갱신) */
export const CRYPTO_ASSETS: readonly CryptoAsset[] = [
  { symbol: "BTC-USDT", name: "Bitcoin / 비트코인" },
  { symbol: "ETH-USDT", name: "Ethereum / 이더리움" },
  { symbol: "SOL-USDT", name: "Solana / 솔라나" },
] as const;
