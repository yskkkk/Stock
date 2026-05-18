import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type SetStateAction,
} from "react";
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

type MacroTrackEdge = { side: "none" | "left" | "right"; pull: number };

/** 끝에서 세로 스크롤로 넘기기까지 휠 델타 누적(음영 pull에도 사용) */
const MACRO_EDGE_THRESHOLD = 500;
/** 휠 입력이 이 시간(ms) 동안 없으면 음영·누적·게이트 초기화 후 다음 휠부터 다시 카운트 */
const MACRO_WHEEL_IDLE_RESET_MS = 500;

function attachMacroTrackWheel(
  el: HTMLElement,
  setEdge: Dispatch<SetStateAction<MacroTrackEdge>>,
) {
  const acc = { left: 0, right: 0 };
  let gateL = false;
  let gateR = false;
  let resetTimer: number | undefined;

  const clearEdge = () => setEdge({ side: "none", pull: 0 });

  const scheduleReset = () => {
    if (resetTimer !== undefined) window.clearTimeout(resetTimer);
    resetTimer = window.setTimeout(() => {
      acc.left = 0;
      acc.right = 0;
      gateL = false;
      gateR = false;
      clearEdge();
    }, MACRO_WHEEL_IDLE_RESET_MS);
  };

  const onWheel = (e: WheelEvent) => {
    scheduleReset();

    if (el.scrollWidth <= el.clientWidth + 1) return;

    let dy = e.deltaY;
    if (e.deltaMode === WheelEvent.DOM_DELTA_LINE) dy *= 16;
    else if (e.deltaMode === WheelEvent.DOM_DELTA_PAGE) dy *= el.clientHeight * 0.9;

    if (Math.abs(e.deltaX) >= Math.abs(e.deltaY) && e.deltaX !== 0) {
      acc.left = 0;
      acc.right = 0;
      gateL = false;
      gateR = false;
      clearEdge();
      return;
    }

    const max = el.scrollWidth - el.clientWidth;
    const sl = el.scrollLeft;
    const eps = 2;
    const atStart = sl <= eps;
    const atEnd = sl >= max - eps;

    if (sl > eps) gateL = false;
    if (sl < max - eps) gateR = false;

    if (!atStart && !atEnd) {
      acc.left = 0;
      acc.right = 0;
      clearEdge();
      e.preventDefault();
      el.scrollLeft = Math.min(max, Math.max(0, sl + dy));
      return;
    }

    if (!atStart && dy < 0) {
      acc.left = 0;
      acc.right = 0;
      clearEdge();
      e.preventDefault();
      el.scrollLeft = Math.min(max, Math.max(0, sl + dy));
      return;
    }
    if (!atEnd && dy > 0) {
      acc.left = 0;
      acc.right = 0;
      clearEdge();
      e.preventDefault();
      el.scrollLeft = Math.min(max, Math.max(0, sl + dy));
      return;
    }

    if (atEnd && dy > 0) {
      e.preventDefault();
      if (gateR) {
        window.scrollBy({ top: dy, left: 0, behavior: "auto" });
        clearEdge();
        return;
      }
      acc.right += Math.abs(dy);
      acc.left = 0;
      setEdge({ side: "right", pull: Math.min(1, acc.right / MACRO_EDGE_THRESHOLD) });
      if (acc.right >= MACRO_EDGE_THRESHOLD) {
        gateR = true;
        acc.right = 0;
        window.scrollBy({ top: dy, left: 0, behavior: "auto" });
        clearEdge();
      }
      return;
    }

    if (atStart && dy < 0) {
      e.preventDefault();
      if (gateL) {
        window.scrollBy({ top: dy, left: 0, behavior: "auto" });
        clearEdge();
        return;
      }
      acc.left += Math.abs(dy);
      acc.right = 0;
      setEdge({ side: "left", pull: Math.min(1, acc.left / MACRO_EDGE_THRESHOLD) });
      if (acc.left >= MACRO_EDGE_THRESHOLD) {
        gateL = true;
        acc.left = 0;
        window.scrollBy({ top: dy, left: 0, behavior: "auto" });
        clearEdge();
      }
      return;
    }

    if (atStart && dy > 0) {
      acc.left = 0;
      acc.right = 0;
      clearEdge();
      e.preventDefault();
      el.scrollLeft = Math.min(max, sl + dy);
      return;
    }
    if (atEnd && dy < 0) {
      acc.left = 0;
      acc.right = 0;
      clearEdge();
      e.preventDefault();
      el.scrollLeft = Math.max(0, sl + dy);
      return;
    }
  };

  el.addEventListener("wheel", onWheel, { passive: false });
  return () => {
    el.removeEventListener("wheel", onWheel);
    if (resetTimer !== undefined) window.clearTimeout(resetTimer);
  };
}

function macroTrackWrapClass(edge: MacroTrackEdge) {
  const base = "macro-bar__track-wrap";
  if (edge.side === "left") return `${base} macro-bar__track-wrap--edge-left`;
  if (edge.side === "right") return `${base} macro-bar__track-wrap--edge-right`;
  return base;
}

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
      aria-label={`${event.name}, ${ko.macro.forecastLabel} ${event.forecast?.trim() || ko.macro.forecastPending}, ${ko.macro.cardHint}`}
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
      <p
        className="macro-card__forecast"
        title={event.forecast?.trim() ? undefined : ko.macro.forecastHelp}
      >
        <span className="macro-card__forecast-k">{ko.macro.forecastLabel}</span>
        <span className="macro-card__forecast-sep" aria-hidden>
          {" "}
          ·{" "}
        </span>
        <span className="macro-card__forecast-v">
          {event.forecast?.trim() || ko.macro.forecastPending}
        </span>
      </p>
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

  const eventsTrackRef = useRef<HTMLDivElement>(null);
  const earningsTrackRef = useRef<HTMLDivElement>(null);
  const [eventsTrackEdge, setEventsTrackEdge] = useState<MacroTrackEdge>({
    side: "none",
    pull: 0,
  });
  const [earningsTrackEdge, setEarningsTrackEdge] = useState<MacroTrackEdge>({
    side: "none",
    pull: 0,
  });

  useEffect(() => {
    const el1 = eventsTrackRef.current;
    const el2 = earningsTrackRef.current;
    const c1 = el1 ? attachMacroTrackWheel(el1, setEventsTrackEdge) : () => {};
    const c2 = el2 ? attachMacroTrackWheel(el2, setEarningsTrackEdge) : () => {};
    return () => {
      c1();
      c2();
    };
  }, [loading, visible.length, visibleEarnings.length]);

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
        <div
          className={macroTrackWrapClass(eventsTrackEdge)}
          style={
            {
              "--macro-edge-pull": String(eventsTrackEdge.pull),
            } as CSSProperties
          }
        >
          <div className="macro-bar__track" ref={eventsTrackRef}>
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
        </div>

        {!loading && visibleEarnings.length > 0 ? (
          <div className="macro-bar__sector-block">
            <div className="macro-bar__sector-head">
              <span className="macro-bar__sector-title">{ko.macro.sectorEarningsTitle}</span>
              <span className="macro-bar__sector-sub">{ko.macro.sectorEarningsSubtitle}</span>
            </div>
            <div
              className={macroTrackWrapClass(earningsTrackEdge)}
              style={
                {
                  "--macro-edge-pull": String(earningsTrackEdge.pull),
                } as CSSProperties
              }
            >
              <div className="macro-bar__track macro-bar__track--earnings" ref={earningsTrackRef}>
                {visibleEarnings.map((row) => (
                  <SectorEarningsCard key={row.id} row={row} now={now} />
                ))}
              </div>
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
