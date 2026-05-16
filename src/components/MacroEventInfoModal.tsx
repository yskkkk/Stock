import { useEffect } from "react";
import { createPortal } from "react-dom";
import { formatMacroCountdown, formatMacroWhen } from "../lib/formatMacro";
import { getMacroScenarioSentiment } from "../lib/macroSentiment";
import { getMacroGuide, ko } from "../i18n/ko";
import type { MacroEvent } from "../types";

interface MacroEventInfoModalProps {
  event: MacroEvent;
  now: number;
  onClose: () => void;
}

export default function MacroEventInfoModal({
  event,
  now,
  onClose,
}: MacroEventInfoModalProps) {
  const guide = getMacroGuide(event.code);
  const scenarioSentiment = getMacroScenarioSentiment(event.code);
  const msLeft = event.at - now;
  const codeShort = event.code.replace(/^KR_/, "");

  const highClass = scenarioSentiment
    ? scenarioSentiment.high === "positive"
      ? "macro-info-scenario--positive"
      : "macro-info-scenario--negative"
    : "macro-info-scenario--high";
  const lowClass = scenarioSentiment
    ? scenarioSentiment.low === "positive"
      ? "macro-info-scenario--positive"
      : "macro-info-scenario--negative"
    : "macro-info-scenario--low";

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

  return createPortal(
    <div
      className="news-modal-backdrop macro-info-backdrop"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="news-modal card macro-info-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="macro-info-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="news-modal-header macro-info-header">
          <div>
            <div className="macro-info-header__badges">
              <span className="macro-card__code">{codeShort}</span>
              <span
                className={`macro-card__region macro-card__region--${event.region}`}
              >
                {event.region === "kr" ? ko.macro.regionKr : ko.macro.regionUs}
              </span>
              <span
                className={`macro-info-importance macro-info-importance--${event.importance}`}
              >
                {event.importance === "high" ? "HIGH" : "MED"}
              </span>
            </div>
            <h2 id="macro-info-title">{event.name}</h2>
            <p className="macro-info-meta">
              {formatMacroWhen(event.at, event.timezone)}
              <span className="macro-info-meta__sep">·</span>
              <span className="macro-info-meta__countdown">
                {formatMacroCountdown(msLeft)}
              </span>
            </p>
          </div>
          <button
            type="button"
            className="news-modal-close"
            onClick={onClose}
            aria-label={ko.macro.guideClose}
          >
            ×
          </button>
        </header>

        <div className="macro-info-body">
          {guide ? (
            <>
              <section className="macro-info-block">
                <h3>{ko.macro.guideWhat}</h3>
                <p>{guide.what}</p>
              </section>
              <div className="macro-info-scenarios">
                <section className={`macro-info-scenario ${highClass}`}>
                  <h3>{ko.macro.guideHigh}</h3>
                  <p>{guide.high}</p>
                </section>
                <section className={`macro-info-scenario ${lowClass}`}>
                  <h3>{ko.macro.guideLow}</h3>
                  <p>{guide.low}</p>
                </section>
              </div>
              {"note" in guide && guide.note ? (
                <section className="macro-info-block macro-info-block--note">
                  <h3>{ko.macro.guideNote}</h3>
                  <p>{guide.note}</p>
                </section>
              ) : null}
            </>
          ) : (
            <p className="macro-info-fallback">{event.name}</p>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
