import { useCallback, useEffect, useRef, useState } from "react";
import { fetchMacroEvents } from "../api";
import { ko } from "../i18n/ko";
import {
  formatMacroCountdown,
  formatMacroWhen,
  formatSectorEarningsDday,
  formatSectorEarningsWhen,
  macroUrgency,
} from "../lib/formatMacro";
import { getMacroSurpriseUpBias } from "../lib/macroSentiment";
import type { MacroEvent, SectorEarningsSpotlightItem } from "../types";
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

function SectorEarningsCard({
  row,
  now,
}: {
  row: SectorEarningsSpotlightItem;
  now: number;
}) {
  const msLeft = row.at - now;
  const urgency = macroUrgency(msLeft);
  const dday = formatSectorEarningsDday(row.at, now, row.timezone);
  const when = formatSectorEarningsWhen(row.at, row.timezone);
  const href = `https://finance.yahoo.com/quote/${encodeURIComponent(row.symbol)}`;
  return (
    <a
      className={`macro-card macro-card--earnings macro-card--${urgency}`}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={ko.macro.sectorEarningsCardHint}
      aria-label={`${row.name} · ${row.symbol} · ${dday}`}
    >
      <div className="macro-card__top">
        <span className="macro-card__code macro-card__code--sector">{row.sectorLabel}</span>
        <span className={`macro-card__region macro-card__region--${row.market}`}>
          {row.market === "kr" ? ko.macro.regionKr : ko.macro.regionUs}
        </span>
      </div>
      <p className="macro-card__name macro-card__name--earnings" title={row.name}>
        {row.name}
      </p>
      <p className="macro-card__sym" title={row.symbol}>
        {row.symbol}
      </p>
      <p className="macro-card__dday" aria-live="polite">
        {dday}
      </p>
      <p className="macro-card__when">{when}</p>
      {urgency === "live" && <span className="macro-card__pill">{ko.macro.live}</span>}
      {urgency === "soon" && msLeft > 0 && (
        <span className="macro-card__pill macro-card__pill--soon">{ko.macro.soon}</span>
      )}
    </a>
  );
}

const SECRET_ADMIN_TAPS = 10;
const SECRET_ADMIN_GAP_MS = 2800;

type MacroEventsBarProps = {
  /** 제목 문구를 연속으로 눌렀을 때만 호출 (접근 관리 등). */
  onSecretAdminOpen?: () => void;
};

export default function MacroEventsBar({
  onSecretAdminOpen,
}: MacroEventsBarProps) {
  const [events, setEvents] = useState<MacroEvent[]>([]);
  const [sectorEarnings, setSectorEarnings] = useState<SectorEarningsSpotlightItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const [infoEvent, setInfoEvent] = useState<MacroEvent | null>(null);
  const secretTitleTapRef = useRef({ count: 0, at: 0 });

  const handleMacroTitleClick = useCallback(() => {
    if (!onSecretAdminOpen) return;
    const nowMs = Date.now();
    const prev = secretTitleTapRef.current;
    if (nowMs - prev.at > SECRET_ADMIN_GAP_MS) prev.count = 0;
    prev.at = nowMs;
    prev.count += 1;
    if (prev.count < SECRET_ADMIN_TAPS) return;
    prev.count = 0;
    onSecretAdminOpen();
  }, [onSecretAdminOpen]);

  useEffect(() => {
    let cancelled = false;
    fetchMacroEvents()
      .then((data) => {
        if (!cancelled) {
          setEvents(data.events);
          setSectorEarnings(
            Array.isArray(data.sectorEarnings) ? data.sectorEarnings : [],
          );
        }
      })
      .catch(() => {
        if (!cancelled) {
          setEvents([]);
          setSectorEarnings([]);
        }
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
    let cancelled = false;
    const id = window.setInterval(() => {
      fetchMacroEvents()
        .then((data) => {
          if (cancelled) return;
          setEvents(data.events);
          setSectorEarnings(
            Array.isArray(data.sectorEarnings) ? data.sectorEarnings : [],
          );
        })
        .catch(() => {
          /* 다음 주기에서 재시도 — 기존 이벤트 유지 */
        });
    }, 5 * 60 * 1000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const visible = events.filter((e) => e.at > now - 30 * 60 * 1000);
  const visibleEarnings = sectorEarnings.filter((e) => e.at > now - 12 * 60 * 60 * 1000);

  return (
    <>
      <section className="macro-bar card" aria-label={ko.macro.title}>
        <div className="macro-bar__head">
          <div className="macro-bar__title-wrap">
            <div
              className={
                onSecretAdminOpen
                  ? "macro-bar__title-group macro-bar__title-group--secret"
                  : "macro-bar__title-group"
              }
            >
              <h2 className="macro-bar__title">{ko.macro.title}</h2>
              {onSecretAdminOpen ? (
                <span
                  className="macro-bar__title-secret-hit"
                  onClick={handleMacroTitleClick}
                  aria-hidden
                />
              ) : null}
            </div>
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

        {!loading && visibleEarnings.length > 0 ? (
          <div className="macro-bar__sector-block">
            <div className="macro-bar__sector-head">
              <span className="macro-bar__sector-title">{ko.macro.sectorEarningsTitle}</span>
              <span className="macro-bar__sector-sub">{ko.macro.sectorEarningsSubtitle}</span>
            </div>
            <div className="macro-bar__track macro-bar__track--earnings">
              {visibleEarnings.map((row) => (
                <SectorEarningsCard key={row.id} row={row} now={now} />
              ))}
            </div>
          </div>
        ) : null}
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
