/** 우측 실매매 도크 패널·팝오버 공통 상단 브랜드(YS 또는 거래소) */

import { BithumbBrandMark, TossBrandMark } from "./ExchangeBrandMarks";
import type { LiveTradeExchangeApiKind } from "./LiveTradeExchangeApiPanel";

const YS_LOGO_SRC = "/branding/ystock-logo-alpha.png?v=24";

export default function LiveTradeDockYsHead({
  ariaLabel,
  exchange,
}: {
  ariaLabel?: string;
  /** 토스·빗썸 API 연동 창 — YS 대신 거래소 아이콘(좌측 정렬) */
  exchange?: LiveTradeExchangeApiKind;
}) {
  const headClass = [
    "live-trade-dock-ys-head",
    exchange ? "live-trade-dock-ys-head--exchange" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <header className={headClass} aria-label={ariaLabel}>
      <span className="live-trade-dock-ys-head__brand brand-mark" aria-hidden>
        {exchange === "toss" ? (
          <TossBrandMark className="brand-mark__img live-trade-dock-ys-head__exchange-mark" />
        ) : exchange === "bithumb" ? (
          <BithumbBrandMark className="brand-mark__img live-trade-dock-ys-head__exchange-mark" />
        ) : (
          <img
            className="brand-mark__img"
            src={YS_LOGO_SRC}
            alt=""
            width={24}
            height={24}
            decoding="async"
          />
        )}
      </span>
    </header>
  );
}
