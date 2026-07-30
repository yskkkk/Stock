import Sp500SectorWheelMicro from "./Sp500SectorWheelMicro";
import { ko } from "../i18n/ko";

type Props = {
  onOpenNasdaqEtf: () => void;
  nasdaqEtfActive?: boolean;
  className?: string;
};

/**
 * S&P500 · 나스닥 ETF 단축 — 주요 지표 발표(매크로 바) 왼쪽 세로 스택.
 * 기업실적 아이콘 레일·지수 벨트와 섞지 않는다.
 */
export default function AppSp500EtfMicroStack({
  onOpenNasdaqEtf,
  nasdaqEtfActive = false,
  className,
}: Props) {
  const rootClass = ["macro-bar__quick-stack", className].filter(Boolean).join(" ");

  return (
    <div className={rootClass} aria-label={ko.app.mainNavHub}>
      <div className="macro-bar__quick-item">
        <Sp500SectorWheelMicro caption={ko.app.tabSp500Sector} />
      </div>
      <button
        type="button"
        className={
          nasdaqEtfActive
            ? "macro-bar__quick-etf macro-bar__quick-etf--on"
            : "macro-bar__quick-etf"
        }
        data-vu="nasdaq-etf-micro"
        onClick={onOpenNasdaqEtf}
        title={ko.app.nasdaqEtfTitle}
        aria-label={ko.app.nasdaqEtfTitle}
        aria-pressed={nasdaqEtfActive}
      >
        <span className="macro-bar__quick-etf-mark" aria-hidden>
          <svg viewBox="0 0 32 32" width="26" height="26" fill="none">
            <rect
              x="3"
              y="3"
              width="26"
              height="26"
              rx="8"
              fill="url(#macroQuickEtfGrad)"
              opacity="0.95"
            />
            <path
              d="M8 21.5V10.5h3.1l3.2 7.1 3.2-7.1H20.6v11h-2.55v-6.55l-2.85 6.05h-2.4L10.05 14.95V21.5H8z"
              fill="#fff"
            />
            <defs>
              <linearGradient
                id="macroQuickEtfGrad"
                x1="4"
                y1="4"
                x2="28"
                y2="28"
                gradientUnits="userSpaceOnUse"
              >
                <stop stopColor="#5b8def" />
                <stop offset="1" stopColor="#3d6fd4" />
              </linearGradient>
            </defs>
          </svg>
        </span>
        <span className="macro-bar__quick-etf-label">{ko.app.tabNasdaqEtf}</span>
      </button>
    </div>
  );
}
