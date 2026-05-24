import { useState } from "react";
import { cryptoCoinIconUrl, cryptoIconSlug } from "../lib/cryptoCoinIcon";
import type { LiveTradeMarket } from "../types";

export default function CryptoCoinIcon({
  symbol,
  market,
  size = 22,
  className = "",
}: {
  symbol: string;
  market?: LiveTradeMarket | "crypto" | "kr" | "us";
  size?: number;
  className?: string;
}) {
  const slug = cryptoIconSlug(symbol, market);
  const [failed, setFailed] = useState(false);

  if (!slug) return null;

  const letter = slug.slice(0, 1).toUpperCase();
  const px = `${size}px`;

  if (failed) {
    return (
      <span
        className={`live-coin-icon live-coin-icon--fallback ${className}`.trim()}
        style={{ width: px, height: px }}
        aria-hidden
      >
        {letter}
      </span>
    );
  }

  return (
    <img
      className={`live-coin-icon ${className}`.trim()}
      src={cryptoCoinIconUrl(slug)}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      style={{ width: px, height: px }}
    />
  );
}
