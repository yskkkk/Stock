import { useEffect } from "react";
import { createPortal } from "react-dom";
import {
  ko,
  screenFailuresSection,
  screenFailuresSub,
} from "../i18n/ko";
import type { ScreenFailure } from "../types";

interface ScreenFailuresModalProps {
  failures: ScreenFailure[];
  onClose: () => void;
}

export default function ScreenFailuresModal({
  failures,
  onClose,
}: ScreenFailuresModalProps) {
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

  const kr = failures.filter((f) => f.market === "kr");
  const us = failures.filter((f) => f.market === "us");

  return createPortal(
    <div
      className="news-modal-backdrop"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="news-modal card screen-failures-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="screen-failures-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="news-modal-header">
          <div>
            <h2 id="screen-failures-title">{ko.screenFailures.title}</h2>
            <p className="news-modal-sub">
              {screenFailuresSub(failures.length)}
            </p>
          </div>
          <button
            type="button"
            className="news-modal-close"
            onClick={onClose}
            aria-label={ko.screenFailures.close}
          >
            ×
          </button>
        </header>

        <div className="news-modal-body screen-failures-body">
          {failures.length === 0 ? (
            <p className="news-modal-status">{ko.screenFailures.empty}</p>
          ) : (
            <>
              {kr.length > 0 && (
                <FailureSection
                  title={screenFailuresSection("kr", kr.length)}
                  items={kr}
                />
              )}
              {us.length > 0 && (
                <FailureSection
                  title={screenFailuresSection("us", us.length)}
                  items={us}
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

function FailureSection({
  title,
  items,
}: {
  title: string;
  items: ScreenFailure[];
}) {
  return (
    <section className="screen-failures-section">
      <h3 className="screen-failures-section__title">{title}</h3>
      <ul className="screen-failures-list">
        {items.map((f) => (
          <li key={`${f.market}:${f.symbol}`} className="screen-failures-item">
            <div className="screen-failures-item__head">
              <span className="screen-failures-item__name" title={f.name}>
                {f.name}
              </span>
              <span className="screen-failures-item__symbol">{f.symbol}</span>
              <span className="screen-failures-item__market">
                {f.market === "kr" ? ko.screenFailures.kr : ko.screenFailures.us}
              </span>
            </div>
            <p className="screen-failures-item__reason">{f.reason}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
