import {
  resolvePickSignalIds,
  signalChipMeta,
} from "../constants/signalChips";
import PickQuoteStrip from "./PickQuoteStrip";
import type { Market, StockPick } from "../types";

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
                showSymbol={false}
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
