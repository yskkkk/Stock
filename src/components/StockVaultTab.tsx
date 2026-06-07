import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchGoldenCrossStatus,
  fetchStockVault,
  removeStockVaultItem,
} from "../api";
import { ko } from "../i18n/ko";
import type { GoldenCrossKind, StockVaultItem, StockVaultSource } from "../types";

const CROSS_LABEL: Record<GoldenCrossKind, string> = {
  "5>20": "5→20",
  "5>60": "5→60",
  "5>120": "5→120",
};

function fmtDate(ms: number): string {
  try {
    return new Date(ms).toLocaleString("ko-KR", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return "—";
  }
}

export default function StockVaultTab() {
  const [items, setItems] = useState<StockVaultItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | StockVaultSource>("all");
  const [scanHint, setScanHint] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [vault, status] = await Promise.all([
        fetchStockVault(),
        fetchGoldenCrossStatus().catch(() => null),
      ]);
      setItems(vault.items ?? []);
      if (status?.state) {
        const kr = status.state.krLastScanDate;
        const us = status.state.usLastScanDate;
        if (kr || us) {
          setScanHint(
            [kr ? `국내 ${kr}` : null, us ? `미국 ${us}` : null]
              .filter(Boolean)
              .join(" · "),
          );
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const filtered = useMemo(() => {
    if (filter === "all") return items;
    return items.filter((it) => it.source === filter);
  }, [items, filter]);

  const handleRemove = useCallback(async (symbol: string) => {
    try {
      await removeStockVaultItem(symbol);
      setItems((prev) => prev.filter((it) => it.symbol !== symbol));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  return (
    <div className="workspace stock-vault-tab">
      <section className="stock-vault-tab__panel card">
        <header className="stock-vault-tab__head">
          <div>
            <h2 className="stock-vault-tab__title">{ko.stockVault.title}</h2>
            <p className="stock-vault-tab__desc">{ko.stockVault.desc}</p>
            {scanHint ? (
              <p className="stock-vault-tab__scan-hint">
                {ko.stockVault.lastScan}: {scanHint}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            className="btn btn--secondary btn--compact"
            onClick={() => void reload()}
          >
            {ko.app.retry}
          </button>
        </header>

        <div className="stock-vault-tab__filters" role="tablist" aria-label={ko.stockVault.filterAria}>
          {(
            [
              ["all", ko.stockVault.filterAll],
              ["golden_cross", ko.stockVault.filterGolden],
              ["manual", ko.stockVault.filterManual],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={filter === id}
              className={filter === id ? "stock-vault-tab__filter active" : "stock-vault-tab__filter"}
              onClick={() => setFilter(id)}
            >
              {label}
            </button>
          ))}
        </div>

        {loading ? (
          <p className="stock-vault-tab__muted">{ko.stockVault.loading}</p>
        ) : error ? (
          <p className="stock-vault-tab__error" role="alert">
            {error}
          </p>
        ) : filtered.length === 0 ? (
          <p className="stock-vault-tab__muted">{ko.stockVault.empty}</p>
        ) : (
          <ul className="stock-vault-tab__list">
            {filtered.map((item) => (
              <li key={item.id} className="stock-vault-tab__row">
                <div className="stock-vault-tab__row-main">
                  <div className="stock-vault-tab__row-head">
                    <span className="stock-vault-tab__name" title={item.name}>
                      {item.name}
                    </span>
                    <span className="stock-vault-tab__sym">{item.symbol}</span>
                  </div>
                  <div className="stock-vault-tab__meta">
                    <span className="stock-vault-tab__market">
                      {item.market === "kr" ? ko.app.marketKr : ko.app.marketUs}
                    </span>
                    <span className="stock-vault-tab__source">
                      {item.source === "golden_cross"
                        ? ko.stockVault.sourceGolden
                        : ko.stockVault.sourceManual}
                    </span>
                    {item.scanDate ? (
                      <span className="stock-vault-tab__scan-date">{item.scanDate}</span>
                    ) : null}
                    <span className="stock-vault-tab__added">{fmtDate(item.updatedAtMs)}</span>
                  </div>
                  {item.crosses?.length ? (
                    <div className="stock-vault-tab__crosses">
                      {item.crosses.map((c) => (
                        <span key={c} className="stock-vault-tab__cross">
                          {CROSS_LABEL[c] ?? c}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="btn btn--ghost btn--compact stock-vault-tab__remove"
                  onClick={() => void handleRemove(item.symbol)}
                >
                  {ko.stockVault.remove}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
