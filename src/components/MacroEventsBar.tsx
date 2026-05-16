import { useEffect, useState } from "react";
import { fetchMacroEvents } from "../api";
import { ko } from "../i18n/ko";
import {
  formatMacroCountdown,
  formatMacroWhen,
  macroUrgency,
} from "../lib/formatMacro";
import { getMacroSurpriseUpBias } from "../lib/macroSentiment";
import type { MacroEvent } from "../types";
import MacroEventInfoModal from "./MacroEventInfoModal";

const CATEGORY_ICON: Record<string, string> = {
  inflation: "◆",
  employment: "▲",
  rates: "◎",
  growth: "◇",
  pmi: "■",
  sentiment: "●",
};

function MacroEventCard({
  event,
  now,
  onOpen,
}: {
  event: MacroEvent;
  now: number;
  onOpen: (event: MacroEvent) => void;
}) {
  const msLeft = event.at - now;
  const urgency = macroUrgency(msLeft);
  const codeShort = event.code.replace(/^KR_/, "");
  const upBias = getMacroSurpriseUpBias(event.code);
  const biasClass =
    upBias === "positive"
      ? " macro-card--bias-up-positive"
      : upBias === "negative"
        ? " macro-card--bias-up-negative"
        : "";

  return (
    <button
      type="button"
      className={`macro-card macro-card--btn macro-card--${event.importance} macro-card--${urgency}${biasClass}`}
      data-region={event.region}
      onClick={() => onOpen(event)}
      title={ko.macro.cardHint}
      aria-label={`${event.name}, ${ko.macro.cardHint}`}
    >
      <div className="macro-card__top">
        <span className="macro-card__code">{codeShort}</span>
        <span className={`macro-card__region macro-card__region--${event.region}`}>
          {event.region === "kr" ? ko.macro.regionKr : ko.macro.regionUs}
        </span>
        <span className="macro-card__cat" aria-hidden>
          {CATEGORY_ICON[event.category] ?? "•"}
        </span>
      </div>
      <p className="macro-card__name">{event.name}</p>
      <p className="macro-card__countdown" aria-live="polite">
        {formatMacroCountdown(msLeft)}
      </p>
      <p className="macro-card__when">{formatMacroWhen(event.at, event.timezone)}</p>
      {urgency === "live" && (
        <span className="macro-card__pill">{ko.macro.live}</span>
      )}
      {urgency === "soon" && msLeft > 0 && (
        <span className="macro-card__pill macro-card__pill--soon">{ko.macro.soon}</span>
      )}
    </button>
  );
}

export default function MacroEventsBar() {
  const [events, setEvents] = useState<MacroEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const [infoEvent, setInfoEvent] = useState<MacroEvent | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchMacroEvents()
      .then((data) => {
        if (!cancelled) setEvents(data.events);
      })
      .catch(() => {
        if (!cancelled) setEvents([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => {
      fetchMacroEvents()
        .then((data) => setEvents(data.events))
        .catch(() => {});
    }, 5 * 60 * 1000);
    return () => window.clearInterval(id);
  }, []);

  const visible = events.filter((e) => e.at > now - 30 * 60 * 1000);

  return (
    <>
      <section className="macro-bar card" aria-label={ko.macro.title}>
        <div className="macro-bar__head">
          <div className="macro-bar__title-wrap">
            <h2 className="macro-bar__title">{ko.macro.title}</h2>
            <span className="macro-bar__sub">{ko.macro.subtitle}</span>
          </div>
        </div>
        <div className="macro-bar__track">
          {loading && (
            <p className="macro-bar__status">{ko.macro.loading}</p>
          )}
          {!loading && visible.length === 0 && (
            <p className="macro-bar__status">{ko.macro.empty}</p>
          )}
          {!loading &&
            visible.map((event) => (
              <MacroEventCard
                key={event.id}
                event={event}
                now={now}
                onOpen={setInfoEvent}
              />
            ))}
        </div>
      </section>

      {infoEvent && (
        <MacroEventInfoModal
          event={infoEvent}
          now={now}
          onClose={() => setInfoEvent(null)}
        />
      )}
    </>
  );
}
