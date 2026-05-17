import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { formatPrice } from "../lib/format";
import { ko } from "../i18n/ko";

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function formatDatetimeLocalFromMs(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function parseDatetimeLocalToMs(s: string): number | null {
  if (!s.trim()) return null;
  const t = new Date(s).getTime();
  return Number.isFinite(t) ? t : null;
}

interface ProfitModelModalProps {
  open: boolean;
  browserUserId: string;
  currentPrice: number | undefined;
  currency: string | undefined;
  entry: number | null;
  entryAtMs: number | null;
  exit: number | null;
  onClose: () => void;
  onApply: (entryPrice: number, entryAtMs: number) => void;
  onClear: () => void;
  onRecordSell: () => void;
}

export default function ProfitModelModal({
  open,
  browserUserId,
  currentPrice,
  currency,
  entry,
  entryAtMs,
  exit,
  onClose,
  onApply,
  onClear,
  onRecordSell,
}: ProfitModelModalProps) {
  const [draft, setDraft] = useState("");
  const [entryAtLocal, setEntryAtLocal] = useState("");

  useEffect(() => {
    if (!open) return;
    setDraft(
      entry != null && entry > 0
        ? String(entry)
        : currentPrice != null
          ? String(currentPrice)
          : "",
    );
    const baseMs =
      entryAtMs != null && entryAtMs > 0 ? entryAtMs : Date.now();
    setEntryAtLocal(formatDatetimeLocalFromMs(baseMs));
  }, [open, entry, currentPrice, entryAtMs]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  function handleApply() {
    const n = Number(String(draft).replace(/\s/g, "").replace(/,/g, ""));
    if (!Number.isFinite(n) || n <= 0) return;
    const ms = parseDatetimeLocalToMs(entryAtLocal) ?? Date.now();
    onApply(n, ms);
    onClose();
  }

  function handleUseQuote() {
    if (currentPrice == null || !Number.isFinite(currentPrice)) return;
    setDraft(String(currentPrice));
  }

  const canSell =
    entry != null &&
    entry > 0 &&
    currentPrice != null &&
    Number.isFinite(currentPrice) &&
    currentPrice > 0;

  return createPortal(
    <div
      className="news-modal-backdrop profit-model-backdrop"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="news-modal card profit-model-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="profit-model-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="news-modal-header">
          <div>
            <h2 id="profit-model-title">{ko.app.profitModelTitle}</h2>
            <p className="news-modal-sub">{ko.app.profitModelHint}</p>
            <p className="profit-model-persist-hint">{ko.app.profitModelPersistHint}</p>
            <p className="profit-model-browser-id">
              <span className="profit-model-browser-id__label">
                {ko.app.profitModelBrowserId}
              </span>
              <code className="profit-model-browser-id__code">{browserUserId}</code>
            </p>
          </div>
          <button
            type="button"
            className="news-modal-close"
            onClick={onClose}
            aria-label={ko.app.profitModelClose}
          >
            ×
          </button>
        </header>
        <div className="news-modal-body profit-model-body">
          <label className="profit-model-label" htmlFor="profit-model-entry">
            {ko.app.profitModelEntry}
          </label>
          <div className="profit-model-row">
            <input
              id="profit-model-entry"
              className="profit-model-input"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              placeholder={ko.app.profitModelPlaceholder}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <button
              type="button"
              className="btn btn--secondary"
              disabled={currentPrice == null}
              onClick={handleUseQuote}
            >
              {ko.app.profitModelUseQuote}
            </button>
          </div>
          <label className="profit-model-label" htmlFor="profit-model-entry-at">
            {ko.app.profitModelEntryTime}
          </label>
          <div className="profit-model-row">
            <input
              id="profit-model-entry-at"
              className="profit-model-input"
              type="datetime-local"
              value={entryAtLocal}
              onChange={(e) => setEntryAtLocal(e.target.value)}
            />
          </div>
          {currentPrice != null && (
            <p className="profit-model-quote-ref">
              {ko.app.profitModelCurrentRef}{" "}
              <strong>{formatPrice(currentPrice, currency)}</strong>
            </p>
          )}
          {exit != null && exit > 0 && (
            <p className="profit-model-quote-ref">
              {ko.app.profitModelStripExit}{" "}
              <strong>{formatPrice(exit, currency)}</strong>
            </p>
          )}
          <div className="profit-model-actions">
            <button type="button" className="btn btn--ghost" onClick={onClose}>
              {ko.app.profitModelCancel}
            </button>
            {entry != null && entry > 0 && (
              <button type="button" className="btn btn--ghost" onClick={onClear}>
                {ko.app.profitModelClear}
              </button>
            )}
            <button
              type="button"
              className="btn btn--secondary"
              disabled={!canSell}
              onClick={() => {
                if (!canSell) return;
                onRecordSell();
              }}
            >
              {ko.app.profitModelSell}
            </button>
            <button type="button" className="btn btn--primary" onClick={handleApply}>
              {ko.app.profitModelApply}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
