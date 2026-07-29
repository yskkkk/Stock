import Sp500SectorWheelMicro from "./Sp500SectorWheelMicro";
import { ko } from "../i18n/ko";

type Props = {
  appTab: string;
  onOpenNasdaqEtf: () => void;
  className?: string;
};

/** S&P500 도넛 + NQ ETF — 기업실적 레일 상단 세로 스택 */
export default function AppSp500EtfMicroStack({
  appTab,
  onOpenNasdaqEtf,
  className,
}: Props) {
  const rootClass = ["app__sp500-micro-anchor", "app__sp500-micro-anchor--rail", className]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={rootClass} aria-label="S&P500 · 나스닥 ETF">
      <Sp500SectorWheelMicro caption="S&P" />
      <button
        type="button"
        className="app__nasdaq-etf-micro"
        data-vu="nasdaq-etf-micro"
        onClick={onOpenNasdaqEtf}
        title={ko.macro.nasdaqEtfBtnHint}
        aria-label={ko.macro.nasdaqEtfBtnHint}
        aria-pressed={appTab === "nasdaqEtf"}
      >
        <span className="app__nasdaq-etf-micro-icon" aria-hidden>
          <svg viewBox="0 0 24 24" width="20" height="20" focusable="false">
            <rect x="3" y="13" width="4" height="8" rx="1" fill="currentColor" opacity="0.9" />
            <rect x="10" y="7" width="4" height="14" rx="1" fill="currentColor" />
            <rect x="17" y="3" width="4" height="18" rx="1" fill="currentColor" opacity="0.75" />
          </svg>
        </span>
        <span className="app__nasdaq-etf-micro-label">ETF</span>
      </button>
    </div>
  );
}
