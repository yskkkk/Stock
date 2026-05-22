import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useModalDrag } from "../hooks/useModalDrag";
import PickQuoteStrip from "./PickQuoteStrip";
import { formatPrice } from "../lib/format";
import {
  ko,
  telegramSentSection,
  telegramSentSub,
} from "../i18n/ko";
import type { TelegramSentItem } from "../types";

interface TelegramSentModalProps {
  items: TelegramSentItem[];
  loading: boolean;
  error: string | null;
  onClose: () => void;
  /** 종목 행 클릭 시 차트로 이동 */
  onOpenStock?: (item: TelegramSentItem) => void;
}

function formatTelegramSentPrice(item: TelegramSentItem): string {
  const p = item.price;
  if (p == null || !Number.isFinite(p)) return "—";
  return formatPrice(p, item.currency ?? undefined);
}

function formatSentAt(ts: number) {
  if (!ts) return "";
  return new Date(ts).toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export default function TelegramSentModal({
  items,
  loading,
  error,
  onClose,
  onOpenStock,
}: TelegramSentModalProps) {
  useEffect(() => {
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
  }, [onClose]);

  const drag = useModalDrag([items.length, loading, Boolean(error)]);

  const kr = items.filter((i) => i.market === "kr");
  const us = items.filter((i) => i.market === "us");
  const crypto = items.filter((i) => i.market === "crypto");

  return createPortal(
    <div
      className="news-modal-backdrop"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="news-modal card telegram-sent-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="telegram-sent-title"
        style={drag.modalStyle}
        onClick={(e) => e.stopPropagation()}
      >
        <header
          className="news-modal-header modal-drag-handle"
          onPointerDown={drag.onDragHandlePointerDown}
        >
          <div>
            <h2 id="telegram-sent-title">{ko.telegramSent.title}</h2>
            <p className="news-modal-sub">
              {loading
                ? ko.telegramSent.loading
                : telegramSentSub(items.length)}
            </p>
          </div>
          <button
            type="button"
            className="news-modal-close"
            onClick={onClose}
            aria-label={ko.telegramSent.close}
          >
            ×
          </button>
        </header>

        <div className="news-modal-body telegram-sent-body">
          {loading && (
            <div className="news-modal-status">
              <div className="spinner" />
              <p>{ko.telegramSent.loading}</p>
            </div>
          )}
          {!loading && error && (
            <p className="news-modal-status news-modal-error">{error}</p>
          )}
          {!loading && !error && items.length === 0 && (
            <p className="news-modal-status">{ko.telegramSent.empty}</p>
          )}
          {!loading && !error && items.length > 0 && (
            <>
              {kr.length > 0 && (
                <SentSection
                  title={telegramSentSection("kr", kr.length)}
                  items={kr}
                  onOpenStock={onOpenStock}
                />
              )}
              {us.length > 0 && (
                <SentSection
                  title={telegramSentSection("us", us.length)}
                  items={us}
                  onOpenStock={onOpenStock}
                />
              )}
              {crypto.length > 0 && (
                <SentSection
                  title={telegramSentSection("crypto", crypto.length)}
                  items={crypto}
                  onOpenStock={onOpenStock}
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function SentSection({
  title,
  items,
  onOpenStock,
}: {
  title: string;
  items: TelegramSentItem[];
  onOpenStock?: (item: TelegramSentItem) => void;
}) {
  return (
    <section className="telegram-sent-section">
      <h3 className="telegram-sent-section__title">{title}</h3>
      <ul className="telegram-sent-list">
        {items.map((item) => (
          <li
            key={`${item.market}:${item.symbol}`}
            className={
              onOpenStock
                ? "telegram-sent-item telegram-sent-item--clickable"
                : "telegram-sent-item"
            }
            role={onOpenStock ? "button" : undefined}
            tabIndex={onOpenStock ? 0 : undefined}
            aria-label={
              onOpenStock ? `${item.name} — ${ko.telegramSent.openStockRowAria}` : undefined
            }
            onClick={
              onOpenStock
                ? () => {
                    onOpenStock(item);
                  }
                : undefined
            }
            onKeyDown={
              onOpenStock
                ? (e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onOpenStock(item);
                    }
                  }
                : undefined
            }
          >
            <div className="telegram-sent-item__head">
              <span className="telegram-sent-item__name" title={item.name}>
                {item.name}
              </span>
              <span className="telegram-sent-item__score">
                {item.score}
                {ko.telegramSent.scoreSuffix}
              </span>
            </div>
            <div className="telegram-sent-item__body">
              <PickQuoteStrip
                symbol={item.symbol}
                changePercent={item.changePercent}
              />
              <p
                className="telegram-sent-item__price"
                title={ko.telegramSent.priceAtSendTitle}
              >
                <span className="telegram-sent-item__price-label">
                  {ko.telegramSent.priceAtSendLabel}
                </span>{" "}
                {formatTelegramSentPrice(item)}
              </p>
            </div>
            <footer className="telegram-sent-item__foot">
              <time
                className="telegram-sent-item__time"
                dateTime={new Date(item.sentAt).toISOString()}
              >
                {formatSentAt(item.sentAt)}
              </time>
            </footer>
          </li>
        ))}
      </ul>
    </section>
  );
}
