import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { displayStockSymbol, formatNewsDate } from "../lib/format";
import type { NewsItem, NewsSentiment, StockPick } from "../types";

const SENTIMENT_LABEL: Record<NewsSentiment, string> = {
  positive: "긍정",
  negative: "부정",
  neutral: "중립",
};

function NewsSentimentBadge({ sentiment }: { sentiment?: NewsSentiment }) {
  const key = sentiment ?? "neutral";
  return (
    <span className={`sentiment-badge sentiment-${key}`}>
      {SENTIMENT_LABEL[key]}
    </span>
  );
}

interface NewsModalProps {
  pick: StockPick;
  items: NewsItem[];
  loading: boolean;
  error: string | null;
  onClose: () => void;
}

export default function NewsModal({
  pick,
  items,
  loading,
  error,
  onClose,
}: NewsModalProps) {
  const [selected, setSelected] = useState<number | null>(null);
  const openLock = useRef(false);
  const openLockTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setSelected(null);
  }, [pick.symbol, items]);

  useEffect(() => {
    return () => {
      if (openLockTimerRef.current != null) {
        window.clearTimeout(openLockTimerRef.current);
        openLockTimerRef.current = null;
      }
      openLock.current = false;
    };
  }, []);

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

  const current =
    selected != null && selected >= 0 ? (items[selected] ?? null) : null;

  function openOriginal() {
    if (!current?.url || openLock.current) return;
    openLock.current = true;
    window.open(current.url, "_blank", "noopener,noreferrer");
    if (openLockTimerRef.current != null) {
      window.clearTimeout(openLockTimerRef.current);
    }
    openLockTimerRef.current = window.setTimeout(() => {
      openLockTimerRef.current = null;
      openLock.current = false;
    }, 800);
  }

  return createPortal(
    <div
      className="news-modal-backdrop"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="news-modal card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="news-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="news-modal-header">
          <div>
            <h2 id="news-modal-title">{pick.name}</h2>
            <p className="news-modal-sub">
              {displayStockSymbol(pick.symbol)} · {pick.name} 관련만 표시 · 최신순
            </p>
          </div>
          <button
            type="button"
            className="news-modal-close"
            onClick={onClose}
            aria-label="닫기"
          >
            ×
          </button>
        </header>

        <div className="news-modal-body">
          {loading && (
            <div className="news-modal-status">
              <div className="spinner" />
              <p>뉴스·공시 불러오는 중…</p>
            </div>
          )}
          {!loading && error && (
            <p className="news-modal-status news-modal-error">{error}</p>
          )}
          {!loading && !error && items.length === 0 && (
            <p className="news-modal-status">
              이 종목과 관련된 기사를 찾지 못했습니다.
            </p>
          )}
          {!loading && !error && items.length > 0 && (
            <div
              className={
                current
                  ? "news-modal-layout"
                  : "news-modal-layout news-modal-layout--list-only"
              }
            >
              <ul className="news-list news-list--select">
                {items.map((item, index) => (
                  <li key={`${item.id}-${index}`}>
                    <button
                      type="button"
                      className={
                        selected === index
                          ? "news-list-item active"
                          : "news-list-item"
                      }
                      onClick={() => setSelected(index)}
                    >
                      <div className="news-item-head">
                        <span
                          className={
                            item.type === "disclosure"
                              ? "news-badge disclosure"
                              : "news-badge"
                          }
                        >
                          {item.type === "disclosure" ? "공시" : "뉴스"}
                        </span>
                        <NewsSentimentBadge sentiment={item.sentiment} />
                        <time dateTime={new Date(item.publishedAt).toISOString()}>
                          {formatNewsDate(item.publishedAt)}
                        </time>
                      </div>
                      <span className="news-list-item__title">{item.title}</span>
                      <span className="news-source">{item.source}</span>
                    </button>
                  </li>
                ))}
              </ul>

              {current ? (
                <div className="news-detail">
                  <div className="news-detail__badges">
                    <span
                      className={
                        current.type === "disclosure"
                          ? "news-badge disclosure"
                          : "news-badge"
                      }
                    >
                      {current.type === "disclosure" ? "공시" : "뉴스"}
                    </span>
                    <NewsSentimentBadge sentiment={current.sentiment} />
                    <span className="news-source">{current.source}</span>
                  </div>
                  <h3 className="news-detail__title">{current.title}</h3>
                  <p className="news-detail__meta">
                    {formatNewsDate(current.publishedAt)}
                  </p>
                  <button
                    type="button"
                    className="btn btn--primary news-detail__open"
                    onClick={openOriginal}
                  >
                    원문 보기 (새 탭)
                  </button>
                </div>
              ) : (
                <p className="news-modal-hint">
                  기사를 선택하면 원문 보기가 표시됩니다.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
