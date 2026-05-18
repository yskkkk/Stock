import {
  resolvePickSignalIds,
  signalChipMeta,
} from "../constants/signalChips";
import PickQuoteStrip from "./PickQuoteStrip";
import { formatPercent } from "../lib/format";
import { ko } from "../i18n/ko";
import type { Market, StockPick } from "../types";

function formatFirstPickDateLabel(ymd: string | undefined): string {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return "";
  const [y, m, d] = ymd.split("-").map((x) => parseInt(x, 10));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return ymd;
  try {
    return new Date(`${ymd}T12:00:00+09:00`).toLocaleDateString("ko-KR", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return ymd;
  }
}

interface PickListProps {
  market?: Market;
  picks: StockPick[];
  totalCount: number;
  selected: string | null;
  onSelect: (pick: StockPick) => void;
  onNews: (pick: StockPick) => void;
  onReason: (pick: StockPick) => void;
}

export default function PickList({
  market = "kr",
  picks,
  totalCount,
  selected,
  onSelect,
  onNews,
  onReason,
}: PickListProps) {
  if (picks.length === 0) {
    const emptyMsg =
      totalCount === 0
        ? `${market === "kr" ? "국내" : "나스닥"} 종목 분석 중입니다…`
        : "선택한 조건에 맞는 종목이 없습니다. 필터를 줄여 보세요.";
    return <p className="picks-empty">{emptyMsg}</p>;
  }

  return (
    <ul className="pick-list">
      {picks.map((pick) => {
        const isActive = selected === pick.symbol;
        const signalIds = resolvePickSignalIds(pick);

        return (
          <li
            key={pick.symbol}
            className={isActive ? "pick-item active" : "pick-item"}
          >
            <button
              type="button"
              className="pick-row"
              onClick={() => onSelect(pick)}
            >
              <div className="pick-head">
                <span className="pick-name" title={pick.name}>
                  {pick.name}
                </span>
                <span className="pick-score">{pick.score}</span>
              </div>
              <PickQuoteStrip
                symbol={pick.symbol}
                price={pick.price}
                currency={pick.currency}
                changePercent={pick.changePercent}
              />
              {signalIds.length > 0 && (
                <div className="pick-signals">
                  {signalIds.map((id) => {
                    const chip = signalChipMeta(id);
                    return (
                      <span
                        key={id}
                        className={chip.className}
                        title={chip.label}
                      >
                        {chip.short}
                      </span>
                    );
                  })}
                </div>
              )}
              {pick.pickStats && (
                <div
                  className="pick-stats"
                  title={
                    pick.pickStats.firstPickDate
                      ? `${ko.app.picksStatsFirstDateTitle}: ${formatFirstPickDateLabel(pick.pickStats.firstPickDate)}`
                      : undefined
                  }
                >
                  <span className="pick-stats__item">
                    <span className="pick-stats__label">{ko.app.picksStatsStreakLabel}</span>{" "}
                    <span className="pick-stats__value">
                      {pick.pickStats.consecutiveWeekdays > 0
                        ? `${pick.pickStats.consecutiveWeekdays}${ko.app.picksStatsStreakUnit}`
                        : "—"}
                    </span>
                  </span>
                  <span className="pick-stats__sep" aria-hidden>
                    ·
                  </span>
                  <span className="pick-stats__item">
                    <span className="pick-stats__label">{ko.app.picksStatsSinceFirstLabel}</span>{" "}
                    <span
                      className={
                        pick.pickStats.sinceFirstPickPct == null
                          ? "pick-stats__value"
                          : pick.pickStats.sinceFirstPickPct >= 0
                            ? "pick-stats__value pick-stats__pct--up"
                            : "pick-stats__value pick-stats__pct--down"
                      }
                    >
                      {pick.pickStats.sinceFirstPickPct == null
                        ? "—"
                        : formatPercent(pick.pickStats.sinceFirstPickPct)}
                    </span>
                  </span>
                </div>
              )}
            </button>
            <div className="pick-actions">
              <button
                type="button"
                className="pick-action pick-action--reason"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onReason(pick);
                }}
              >
                <span className="pick-action__icon" aria-hidden>
                  ◆
                </span>
                이유
              </button>
              <button
                type="button"
                className="pick-action pick-action--news"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onNews(pick);
                }}
              >
                <span className="pick-action__icon" aria-hidden>
                  ▸
                </span>
                뉴스
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
