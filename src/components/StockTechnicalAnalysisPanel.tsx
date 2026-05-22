import { signalChipMeta } from "../constants/signalChips";
import type { SignalId } from "../constants/signals";
import { ko } from "../i18n/ko";
import type { StockTechnicalResponse } from "../types";

export type StockTechnicalAnalysisSlot =
  | { status: "loading" }
  | { status: "err"; message?: string }
  | { status: "ok"; data: StockTechnicalResponse };

function StatusBadge({
  ok,
  label,
}: {
  ok: boolean;
  label: string;
}) {
  return (
    <span
      className={
        ok
          ? "stock-search-analysis__badge stock-search-analysis__badge--ok"
          : "stock-search-analysis__badge stock-search-analysis__badge--no"
      }
    >
      {label}
    </span>
  );
}

export default function StockTechnicalAnalysisPanel({
  symbol,
  displayName,
  slot,
  onClose,
}: {
  symbol: string;
  displayName: string;
  slot: StockTechnicalAnalysisSlot;
  onClose: () => void;
}) {
  return (
    <section
      className="stock-search-analysis card"
      aria-label={ko.app.stockLookupAnalysisTitle}
    >
      <header className="stock-search-analysis__head">
        <div>
          <h3 className="stock-search-analysis__title">
            {ko.app.stockLookupAnalysisTitle}
          </h3>
          <p className="stock-search-analysis__sym">
            {displayName}{" "}
            <span className="stock-search-analysis__sym-code">{symbol}</span>
          </p>
        </div>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={onClose}
        >
          {ko.app.stockLookupAnalysisClose}
        </button>
      </header>

      {slot.status === "loading" && (
        <p className="stock-search-analysis__muted">{ko.app.stockLookupAnalysisLoading}</p>
      )}
      {slot.status === "err" && (
        <p className="stock-search-analysis__err" role="alert">
          {slot.message || ko.app.stockLookupAnalysisError}
        </p>
      )}
      {slot.status === "ok" && (
        <StockTechnicalAnalysisBody data={slot.data} />
      )}
    </section>
  );
}

function StockTechnicalAnalysisBody({ data }: { data: StockTechnicalResponse }) {
  const maxScore = data.techModelMaxScore ?? data.maxScore ?? 0;
  const conditionsMet = data.conditionsMet ?? data.signalIds.length;
  const conditionsRequired = data.conditionsRequired ?? 10;
  const conditionsTotal = data.conditionsTotal ?? 12;
  const pct = data.scorePctLabel ?? "—";
  const modelName = data.techModelName ?? ko.app.stockLookupAnalysisModelDefault;

  if (data.insufficientData) {
    return (
      <p className="stock-search-analysis__warn" role="status">
        {ko.app.stockLookupAnalysisInsufficient.replace(
          "{n}",
          String(data.candleCount ?? 0),
        )}
      </p>
    );
  }

  return (
    <>
      <p className="stock-search-analysis__model">
        {ko.app.stockLookupAnalysisModel.replace("{name}", modelName)}
        {maxScore > 0
          ? ` · ${ko.app.stockLookupAnalysisMaxScore.replace("{n}", String(maxScore))}`
          : ""}
      </p>

      <div className="stock-search-analysis__badges">
        <StatusBadge
          ok={Boolean(data.buy)}
          label={
            data.buy
              ? ko.app.stockLookupAnalysisBuyOk
              : ko.app.stockLookupAnalysisBuyNo
          }
        />
        <span className="stock-search-analysis__badge stock-search-analysis__badge--muted">
          {ko.app.stockLookupAnalysisConditions
            .replace("{met}", String(conditionsMet))
            .replace("{req}", String(conditionsRequired))
            .replace("{total}", String(conditionsTotal))}
        </span>
        <StatusBadge
          ok={Boolean(data.telegramEligible)}
          label={
            data.telegramEligible
              ? ko.app.stockLookupAnalysisTgOk
              : ko.app.stockLookupAnalysisTgNo
          }
        />
      </div>

      <div className="stock-search-analysis__score-row">
        <span className="stock-search-analysis__score-k">
          {ko.app.stockLookupAnalysisScore}
        </span>
        <span className="stock-search-analysis__score-v">
          {data.score}
          {maxScore > 0 ? ` / ${maxScore}` : ""}
          <span className="stock-search-analysis__score-pct">({pct}%)</span>
        </span>
      </div>
      {data.minTelegramScore != null && (
        <p className="stock-search-analysis__hint">
          {ko.app.stockLookupAnalysisTgHint.replace(
            "{min}",
            String(data.minTelegramScore),
          )}
        </p>
      )}

      <ul className="stock-search-analysis__signals">
        {(data.signalBreakdown ?? []).map((row) => {
          const chip = signalChipMeta(row.id as SignalId);
          return (
            <li
              key={row.id}
              className={
                row.met
                  ? "stock-search-analysis__signal stock-search-analysis__signal--met"
                  : "stock-search-analysis__signal stock-search-analysis__signal--miss"
              }
            >
              <span className={chip.className} title={row.label}>
                {chip.short}
              </span>
              <span className="stock-search-analysis__signal-label">
                {row.label}
              </span>
              {row.weight > 0 ? (
                <span className="stock-search-analysis__signal-w">
                  +{row.weight}
                </span>
              ) : (
                <span className="stock-search-analysis__signal-w stock-search-analysis__signal-w--zero">
                  0
                </span>
              )}
            </li>
          );
        })}
      </ul>
      <p className="stock-search-analysis__foot">
        {ko.app.stockLookupAnalysisFoot.replace(
          "{n}",
          String(data.candleCount ?? 0),
        )}
      </p>
    </>
  );
}
