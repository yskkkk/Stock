import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchGoldenCrossStatus,
  fetchStockVault,
  removeStockVaultItem,
  triggerGoldenCrossScan,
} from "../api";
import { ko } from "../i18n/ko";
import type { GoldenCrossKind, StockVaultItem, StockVaultSource } from "../types";

const CROSS_LABEL: Record<GoldenCrossKind, string> = {
  "5>20": "5→20",
  "5>60": "5→60",
  "5>120": "5→120",
};

const SCAN_POLL_MS = 2500;

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

function scanHintFromState(state: {
  krLastScanDate: string | null;
  usLastScanDate: string | null;
}) {
  const kr = state.krLastScanDate;
  const us = state.usLastScanDate;
  if (!kr && !us) return null;
  return [kr ? `국내 ${kr}` : null, us ? `미국 ${us}` : null]
    .filter(Boolean)
    .join(" · ");
}

export default function StockVaultTab({
  onVaultChange,
}: {
  onVaultChange?: (symbols: string[]) => void;
}) {
  const [items, setItems] = useState<StockVaultItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | StockVaultSource>("all");
  const [scanHint, setScanHint] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [scanEnabled, setScanEnabled] = useState(true);
  const [scanRunning, setScanRunning] = useState(false);
  const [scanConfirmOpen, setScanConfirmOpen] = useState(false);
  const [scanNotice, setScanNotice] = useState<string | null>(null);
  const scanBtnRef = useRef<HTMLButtonElement>(null);
  const scanPopoverRef = useRef<HTMLDivElement>(null);

  const reloadVault = useCallback(async () => {
    const vault = await fetchStockVault();
    setItems(vault.items ?? []);
    onVaultChange?.((vault.items ?? []).map((it) => it.symbol));
  }, [onVaultChange]);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [vault, status] = await Promise.all([
        fetchStockVault(),
        fetchGoldenCrossStatus().catch(() => null),
      ]);
      setItems(vault.items ?? []);
      onVaultChange?.((vault.items ?? []).map((it) => it.symbol));
      if (status) {
        setScanEnabled(status.enabled);
        setScanRunning(Boolean(status.running));
        setScanHint(status.state ? scanHintFromState(status.state) : null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [onVaultChange]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!scanRunning) return;
    const id = window.setInterval(() => {
      void (async () => {
        try {
          const status = await fetchGoldenCrossStatus();
          setScanEnabled(status.enabled);
          setScanRunning(Boolean(status.running));
          if (status.state) setScanHint(scanHintFromState(status.state));
          if (!status.running) {
            await reloadVault();
            setScanNotice(ko.stockVault.scanDone);
          }
        } catch {
          /* ignore poll errors */
        }
      })();
    }, SCAN_POLL_MS);
    return () => window.clearInterval(id);
  }, [scanRunning, reloadVault]);

  useEffect(() => {
    if (!scanConfirmOpen) return;
    const onDocDown = (ev: MouseEvent) => {
      const t = ev.target;
      if (!(t instanceof Node)) return;
      if (scanBtnRef.current?.contains(t)) return;
      if (scanPopoverRef.current?.contains(t)) return;
      setScanConfirmOpen(false);
    };
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [scanConfirmOpen]);

  const filtered = useMemo(() => {
    if (filter === "all") return items;
    return items.filter((it) => it.source === filter);
  }, [items, filter]);

  const handleRemove = useCallback(
    async (symbol: string) => {
      const sym = symbol.trim().toUpperCase();
      setRemoving(sym);
      setError(null);
      try {
        await removeStockVaultItem(symbol);
        setItems((prev) => {
          const next = prev.filter((it) => it.symbol !== sym);
          onVaultChange?.(next.map((it) => it.symbol));
          return next;
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setRemoving(null);
      }
    },
    [onVaultChange],
  );

  const handleScanConfirm = useCallback(async () => {
    setScanConfirmOpen(false);
    setScanNotice(null);
    setError(null);
    try {
      const res = await triggerGoldenCrossScan();
      if (!res.started) {
        setScanNotice(
          res.reason === "busy"
            ? ko.stockVault.scanBusy
            : res.reason === "disabled"
              ? ko.stockVault.scanDisabled
              : res.error ?? ko.errors.request,
        );
        return;
      }
      setScanRunning(true);
      setScanNotice(ko.stockVault.scanRunning);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  return (
    <div className="workspace stock-vault-tab">
      <section className="stock-vault-tab__panel card">
        <header className="stock-vault-tab__head">
          <div className="stock-vault-tab__head-text">
            <h2 className="stock-vault-tab__title">{ko.stockVault.title}</h2>
            {scanHint ? (
              <p className="stock-vault-tab__scan-hint">
                {ko.stockVault.lastScan}: {scanHint}
              </p>
            ) : null}
            {scanNotice ? (
              <p className="stock-vault-tab__scan-notice">{scanNotice}</p>
            ) : null}
          </div>
          <div className="stock-vault-tab__head-actions">
            <div className="stock-vault-tab__scan-wrap">
              <button
                ref={scanBtnRef}
                type="button"
                className="stock-vault-tab__head-btn"
                disabled={!scanEnabled || scanRunning}
                aria-expanded={scanConfirmOpen}
                aria-haspopup="dialog"
                onClick={() => setScanConfirmOpen((open) => !open)}
              >
                {scanRunning ? ko.stockVault.scanRunning : ko.stockVault.scanRun}
              </button>
              {scanConfirmOpen ? (
                <div
                  ref={scanPopoverRef}
                  className="stock-vault-tab__scan-popover"
                  role="dialog"
                  aria-labelledby="stock-vault-scan-popover-title"
                  onMouseDown={(ev) => ev.stopPropagation()}
                >
                  <p
                    id="stock-vault-scan-popover-title"
                    className="stock-vault-tab__scan-popover-lead"
                  >
                    {ko.stockVault.scanConfirmLead}
                  </p>
                  <p className="stock-vault-tab__scan-popover-body">
                    {ko.stockVault.scanConfirmBody}
                  </p>
                  <div className="stock-vault-tab__scan-popover-actions">
                    <button
                      type="button"
                      className="stock-vault-tab__scan-popover-btn stock-vault-tab__scan-popover-btn--primary"
                      onClick={() => void handleScanConfirm()}
                    >
                      {ko.stockVault.scanConfirmOk}
                    </button>
                    <button
                      type="button"
                      className="stock-vault-tab__scan-popover-btn"
                      onClick={() => setScanConfirmOpen(false)}
                    >
                      {ko.stockVault.scanConfirmCancel}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
            <button
              type="button"
              className="stock-vault-tab__head-btn"
              onClick={() => void reload()}
            >
              {ko.app.retry}
            </button>
          </div>
        </header>

        <div
          className="stock-vault-tab__filters panel-head__filters"
          role="tablist"
          aria-label={ko.stockVault.filterAria}
        >
          <div className="market-tabs">
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
                className={filter === id ? "market-tab active" : "market-tab"}
                onClick={() => setFilter(id)}
              >
                {label}
              </button>
            ))}
          </div>
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
                  className="stock-vault-tab__remove"
                  aria-label={`${item.name} ${ko.stockVault.removeAria}`}
                  title={ko.stockVault.remove}
                  disabled={removing === item.symbol}
                  onClick={() => void handleRemove(item.symbol)}
                >
                  <span className="stock-vault-tab__remove-icon" aria-hidden>
                    ×
                  </span>
                  <span className="stock-vault-tab__remove-label">{ko.stockVault.remove}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
