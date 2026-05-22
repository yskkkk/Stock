import { useEffect, useState } from "react";
import {
  fetchLiveSimRecommendations,
  type LiveSimRecommendationItem,
  type LiveSimRecommendationsResponse,
} from "../api";
import { ko } from "../i18n/ko";

export type LiveSimDraftPatch = {
  modelId?: string;
  marketsKr?: boolean;
  marketsUs?: boolean;
  minScoreRatio?: number;
  maxOpenPositions?: number;
  orderAmountKrw?: string;
  orderAmountUsd?: string;
  simAutoBuy?: boolean;
  autoSellAtTarget?: boolean;
};

export default function LiveSimRecommendationsPanel({
  onApplyPatch,
}: {
  onApplyPatch: (patch: LiveSimDraftPatch) => void;
}) {
  const [data, setData] = useState<LiveSimRecommendationsResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void fetchLiveSimRecommendations()
      .then(setData)
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, []);

  if (err) {
    return (
      <p className="live-trading-tab__hint live-trading-tab__err" role="alert">
        {err}
      </p>
    );
  }

  if (!data?.items?.length) return null;

  const toDraft = (item: LiveSimRecommendationItem): LiveSimDraftPatch => {
    const p = item.patch;
    return {
      modelId: p.modelId,
      marketsKr: p.markets?.kr ?? true,
      marketsUs: p.markets?.us ?? false,
      minScoreRatio: p.minScoreRatio,
      maxOpenPositions: p.maxOpenPositions,
      orderAmountKrw:
        p.orderAmountKrw != null ? String(Math.round(p.orderAmountKrw)) : undefined,
      orderAmountUsd:
        p.orderAmountUsd != null ? String(p.orderAmountUsd) : undefined,
      simAutoBuy: p.simAutoBuy,
      autoSellAtTarget: p.autoSellAtTarget,
    };
  };

  return (
    <section className="live-trading-tab__rec" aria-label={ko.app.liveTradeSimRecTitle}>
      <h4 className="live-trading-tab__rec-title">{ko.app.liveTradeSimRecTitle}</h4>
      <p className="live-trading-tab__rec-sub">{ko.app.liveTradeSimRecSub}</p>
      <ul className="live-trading-tab__rec-list">
        {data.items.map((item) => (
          <li key={item.id} className="live-trading-tab__rec-item">
            <div className="live-trading-tab__rec-head">
              <strong>{item.title}</strong>
              {item.winRatePct != null ? (
                <span className="live-trading-tab__rec-pct">
                  {item.winRatePct.toFixed(1)}%
                </span>
              ) : null}
            </div>
            <p className="live-trading-tab__rec-reason">{item.reason}</p>
            <button
              type="button"
              className="btn btn--secondary btn--sm live-trading-tab__rec-apply"
              onClick={() => onApplyPatch(toDraft(item))}
            >
              {ko.app.liveTradeSimRecApply}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
