import { memo } from "react";
import PickQuoteStrip from "./PickQuoteStrip";
import {
  PickConditionHeader,
  PickConditionRow,
} from "./PickConditionMatrix";
import { formatPercent } from "../lib/format";
import { ko } from "../i18n/ko";
import type { Market, PickRecommendationStats, StockPick } from "../types";

function samePickStats(
  a: PickRecommendationStats | undefined,
  b: PickRecommendationStats | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return !a && !b;
  return (
    a.consecutiveWeekdays === b.consecutiveWeekdays &&
    a.firstPickDate === b.firstPickDate &&
    a.firstPickPrice === b.firstPickPrice &&
    a.sinceFirstPickPct === b.sinceFirstPickPct
  );
}

function sameSignalsForPick(a: StockPick, b: StockPick): boolean {
  const idsA = a.signalIds ?? [];
  const idsB = b.signalIds ?? [];
  if (idsA.length !== idsB.length) return false;
  for (let i = 0; i < idsA.length; i++) {
    if (idsA[i] !== idsB[i]) return false;
  }
  const sA = a.signals;
  const sB = b.signals;
  if (sA.length !== sB.length) return false;
  for (let i = 0; i < sA.length; i++) {
    if (sA[i] !== sB[i]) return false;
  }
  return true;
}

function samePickForRow(a: StockPick, b: StockPick): boolean {
  if (a === b) return true;
  return (
    a.symbol === b.symbol &&
    a.name === b.name &&
    a.score === b.score &&
    a.price === b.price &&
    a.change === b.change &&
    a.changePercent === b.changePercent &&
    (a.currency ?? "") === (b.currency ?? "") &&
    a.turnover === b.turnover &&
    samePickStats(a.pickStats, b.pickStats) &&
    sameSignalsForPick(a, b)
  );
}

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
  scanning?: boolean;
  scanProgress?: number;
  scanTotal?: number;
  selected: string | null;
  onSelect: (pick: StockPick) => void;
  onNews: (pick: StockPick) => void;
  onReason: (pick: StockPick) => void;
}

interface PickListRowProps {
  pick: StockPick;
  isActive: boolean;
  onSelect: (pick: StockPick) => void;
  onNews: (pick: StockPick) => void;
  onReason: (pick: StockPick) => void;
}

const PickListRow = memo(
  function PickListRow({
    pick,
    isActive,
    onSelect,
    onNews,
    onReason,
  }: PickListRowProps) {
    return (
      <li className={isActive ? "pick-item active" : "pick-item"}>
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
            {pick.techModelName ? (
              <span className="pick-model" title={pick.techModelName}>
                {pick.techModelName}
              </span>
            ) : null}
          </div>
          <PickQuoteStrip
            symbol={pick.symbol}
            price={pick.price}
            currency={pick.currency}
            changePercent={pick.changePercent}
            turnover={pick.turnover}
          />
          <PickConditionRow pick={pick} />
        </button>
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
  },
  (prev, next) =>
    prev.isActive === next.isActive &&
    samePickForRow(prev.pick, next.pick) &&
    prev.onSelect === next.onSelect &&
    prev.onNews === next.onNews &&
    prev.onReason === next.onReason,
);

export default function PickList({
  market = "kr",
  picks,
  totalCount,
  scanning = false,
  scanProgress,
  scanTotal,
  selected,
  onSelect,
  onNews,
  onReason,
}: PickListProps) {
  if (picks.length === 0) {
    const marketLabel =
      market === "kr"
        ? ko.app.marketKr
        : market === "crypto"
          ? ko.app.marketCrypto
          : ko.app.marketUs;
    let emptyMsg = "선택한 조건에 맞는 종목이 없습니다. 필터를 줄여 보세요.";
    if (scanning) {
      const prog =
        typeof scanProgress === "number" &&
        typeof scanTotal === "number" &&
        scanTotal > 0
          ? ` (${scanProgress}/${scanTotal})`
          : "";
      emptyMsg =
        totalCount === 0
          ? `${marketLabel} 조건 충족 종목을 찾는 중입니다…${prog}`
          : `${marketLabel} 필터 결과가 없습니다. 분석은 계속됩니다…${prog}`;
    } else if (totalCount === 0) {
      emptyMsg = `${marketLabel} 매수 후보가 없습니다. 전체 재분석을 눌러 보세요.`;
    }
    return <p className="picks-empty">{emptyMsg}</p>;
  }

  return (
    <>
      <div className="pick-cond-matrix" role="table" aria-label="기술적 조건">
        <PickConditionHeader />
      </div>
      <ul className="pick-list">
      {picks.map((pick) => (
        <PickListRow
          key={pick.symbol}
          pick={pick}
          isActive={selected === pick.symbol}
          onSelect={onSelect}
          onNews={onNews}
          onReason={onReason}
        />
      ))}
      </ul>
    </>
  );
}
