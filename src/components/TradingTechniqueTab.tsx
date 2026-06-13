import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchTechModels, type TechModelRecord } from "../api";
import PickList from "./PickList";
import { ko } from "../i18n/ko";
import { peekLiveTradingPrefetch } from "../lib/tabPrefetch";
import {
  clearSelectedTechModelId,
  peekSelectedTechModelId,
  saveSelectedTechModelId,
} from "../lib/tradingTechniqueSession";
import type { Market, PicksResponse, StockPick } from "../types";

type MarketFilter = "all" | Market;

function allPicks(picks: PicksResponse | null): StockPick[] {
  if (!picks) return [];
  return [...(picks.kr ?? []), ...(picks.us ?? []), ...(picks.crypto ?? [])];
}

export default function TradingTechniqueTab({
  picks,
  onOpenPick,
  onNews,
  onReason,
}: {
  picks: PicksResponse | null;
  onOpenPick: (pick: StockPick) => void;
  onNews: (pick: StockPick) => void;
  onReason: (pick: StockPick) => void;
}) {
  const prefetched = peekLiveTradingPrefetch();
  const [models, setModels] = useState<TechModelRecord[]>(
    () => prefetched?.techModels.models ?? [],
  );
  const [modelsLoading, setModelsLoading] = useState(() => models.length === 0);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(() =>
    peekSelectedTechModelId(),
  );
  const [market, setMarket] = useState<MarketFilter>("all");
  const [selectedPick, setSelectedPick] = useState<string | null>(null);

  useEffect(() => {
    if (models.length) return;
    let cancelled = false;
    void (async () => {
      setModelsLoading(true);
      setModelsError(null);
      try {
        const res = await fetchTechModels();
        if (cancelled) return;
        setModels(res.models ?? []);
      } catch (e) {
        if (!cancelled) {
          setModelsError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!cancelled) setModelsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [models.length]);

  const pickCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of allPicks(picks)) {
      const id = p.techModelId?.trim();
      if (!id) continue;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
  }, [picks]);

  const modelPicks = useMemo(() => {
    if (!selectedModelId) return [];
    return allPicks(picks).filter((p) => {
      if (p.techModelId !== selectedModelId) return false;
      if (market === "all") return true;
      return p.market === market;
    });
  }, [picks, selectedModelId, market]);

  const marketCounts = useMemo(() => {
    if (!selectedModelId) return { all: 0, kr: 0, us: 0 };
    const base = allPicks(picks).filter((p) => p.techModelId === selectedModelId);
    return {
      all: base.length,
      kr: base.filter((p) => p.market === "kr").length,
      us: base.filter((p) => p.market === "us").length,
    };
  }, [picks, selectedModelId]);

  const selectedModel = useMemo(
    () => models.find((m) => m.id === selectedModelId) ?? null,
    [models, selectedModelId],
  );

  const handleSelectModel = useCallback((id: string) => {
    setSelectedModelId(id);
    saveSelectedTechModelId(id);
    setMarket("all");
    setSelectedPick(null);
  }, []);

  const handleBack = useCallback(() => {
    setSelectedModelId(null);
    clearSelectedTechModelId();
    setMarket("all");
    setSelectedPick(null);
  }, []);

  const handlePickSelect = useCallback(
    (pick: StockPick) => {
      setSelectedPick(pick.symbol);
      onOpenPick(pick);
    },
    [onOpenPick],
  );

  if (!selectedModelId) {
    return (
      <div className="workspace stock-vault-tab trading-technique-tab">
        <section className="stock-vault-tab__panel card">
          <header className="stock-vault-tab__head">
            <h2 className="stock-vault-tab__title">{ko.tradingTechnique.title}</h2>
            <p className="stock-vault-tab__desc">{ko.tradingTechnique.selectDesc}</p>
          </header>
          {modelsLoading ? (
            <p className="stock-vault-tab__muted">{ko.tradingTechnique.loading}</p>
          ) : null}
          {modelsError ? (
            <p className="stock-vault-tab__error" role="alert">
              {modelsError}
            </p>
          ) : null}
          {!modelsLoading && !modelsError && models.length === 0 ? (
            <p className="stock-vault-tab__muted">{ko.tradingTechnique.emptyModels}</p>
          ) : null}
          <ul className="trading-technique-tab__model-list">
            {models.map((m) => {
              const count = pickCounts.get(m.id) ?? 0;
              return (
                <li key={m.id}>
                  <button
                    type="button"
                    className="trading-technique-tab__model-btn"
                    onClick={() => handleSelectModel(m.id)}
                  >
                    <span className="trading-technique-tab__model-name">{m.name}</span>
                    <span className="trading-technique-tab__model-count">
                      {ko.tradingTechnique.discoveredCount(count)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    );
  }

  return (
    <div className="workspace stock-vault-tab trading-technique-tab">
      <section className="stock-vault-tab__panel card">
        <header className="stock-vault-tab__head">
          <div className="stock-vault-tab__head-row">
            <button
              type="button"
              className="stock-vault-tab__head-btn trading-technique-tab__back"
              onClick={handleBack}
            >
              {ko.tradingTechnique.back}
            </button>
            <h2 className="stock-vault-tab__title">
              {selectedModel?.name ?? ko.tradingTechnique.title}
            </h2>
          </div>
        </header>

        <div
          className="stock-vault-tab__filters panel-head__filters"
          role="group"
          aria-label={ko.stockVault.filterMarketAria}
        >
          <div className="market-tabs">
            {(
              [
                ["all", ko.stockVault.filterAll, marketCounts.all],
                ["kr", ko.app.marketKr, marketCounts.kr],
                ["us", ko.app.marketUs, marketCounts.us],
              ] as const
            ).map(([key, label, count]) => (
              <button
                key={key}
                type="button"
                className={market === key ? "market-tab active" : "market-tab"}
                aria-pressed={market === key}
                onClick={() => setMarket(key)}
              >
                {label}
                <span className="market-tab__count">{count}</span>
              </button>
            ))}
          </div>
        </div>

        {modelPicks.length === 0 ? (
          <p className="stock-vault-tab__muted">{ko.tradingTechnique.emptyPicks}</p>
        ) : (
          <PickList
            picks={modelPicks}
            totalCount={modelPicks.length}
            scanning={Boolean(picks?.running)}
            scanProgress={picks?.progress}
            scanTotal={picks?.total}
            selected={selectedPick}
            onSelect={handlePickSelect}
            onNews={onNews}
            onReason={onReason}
          />
        )}
      </section>
    </div>
  );
}
