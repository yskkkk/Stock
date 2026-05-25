import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import type { AuthUser } from "../api";
import { useLiveTradingStatusPoll } from "../hooks/useLiveTradingStatusPoll";
import { ko } from "../i18n/ko";
import {
  LiveTradeExchangeApiPanel,
  type LiveTradeExchangeApiKind,
} from "./LiveTradeExchangeApiPanel";
import { BithumbBrandMark, TossBrandMark } from "./ExchangeBrandMarks";

const API_POPOVER_GAP_PX = 9;

function apiPopoverPortalStyle(anchor: HTMLElement): CSSProperties {
  const r = anchor.getBoundingClientRect();
  return {
    right: Math.max(8, window.innerWidth - r.left + API_POPOVER_GAP_PX),
    bottom: Math.max(8, window.innerHeight - r.bottom),
  };
}

function ExchangeBrandMark({
  exchange,
  ready,
}: {
  exchange: LiveTradeExchangeApiKind;
  ready: boolean;
}) {
  const className = ready
    ? "app-live-trade-side-dock__exchange-mark"
    : "app-live-trade-side-dock__exchange-mark app-live-trade-side-dock__exchange-mark--muted";
  return exchange === "toss" ? (
    <TossBrandMark className={className} />
  ) : (
    <BithumbBrandMark className={className} />
  );
}

function DockApiRailButton({
  exchange,
  ready,
  selected,
  anchorRef,
  onClick,
}: {
  exchange: LiveTradeExchangeApiKind;
  ready: boolean;
  selected: boolean;
  anchorRef: RefObject<HTMLSpanElement | null>;
  onClick: () => void;
}) {
  const label =
    exchange === "toss"
      ? ko.app.liveTradeSideDockRailTossApi
      : ko.app.liveTradeSideDockRailBithumbApi;
  const title =
    exchange === "toss" ? ko.app.liveTradeTossTitle : ko.app.liveTradeBithumbTitle;

  return (
    <span ref={anchorRef} className="app-live-trade-side-dock__api-anchor">
      <button
        type="button"
        className={[
          "app-live-trade-side-dock__rail-btn",
          "app-live-trade-side-dock__rail-btn--exchange",
          selected ? "app-live-trade-side-dock__rail-btn--on" : "",
          ready ? "app-live-trade-side-dock__rail-btn--exchange-ready" : "",
          !ready && !selected ? "app-live-trade-side-dock__rail-btn--exchange-off" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        aria-selected={selected}
        aria-expanded={selected}
        aria-haspopup="dialog"
        aria-controls={
          selected ? `app-live-trade-side-dock-api-popover-${exchange}` : undefined
        }
        title={title}
        onClick={onClick}
      >
        <span
          className="app-live-trade-side-dock__rail-glyph app-live-trade-side-dock__rail-glyph--exchange"
          aria-hidden
        >
          <ExchangeBrandMark exchange={exchange} ready={ready} />
        </span>
        <span
          className={
            exchange === "bithumb"
              ? "app-live-trade-side-dock__rail-label app-live-trade-side-dock__rail-label--bithumb"
              : "app-live-trade-side-dock__rail-label"
          }
        >
          {exchange === "bithumb" ? (
            <>
              <span className="app-live-trade-side-dock__rail-label-main">빗썸</span>
              <span className="app-live-trade-side-dock__rail-label-sub">API</span>
            </>
          ) : (
            label
          )}
        </span>
      </button>
    </span>
  );
}

/** 우측 도크 하단 — 토스·빗썸 API 연동(로그아웃 위) */
export default function LiveTradeDockApiRail({
  user,
  onCredentialsUpdated,
  onPopoverOpen,
}: {
  user: AuthUser;
  onCredentialsUpdated: () => void;
  /** API 팝오버 열릴 때 로그인 팝오버 등 닫기 */
  onPopoverOpen?: () => void;
}) {
  const status = useLiveTradingStatusPoll();
  const [open, setOpen] = useState<LiveTradeExchangeApiKind | null>(null);
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties>({});
  const tossAnchorRef = useRef<HTMLSpanElement>(null);
  const bithumbAnchorRef = useRef<HTMLSpanElement>(null);

  const tossReady = Boolean(status?.toss?.ready);
  const bithumbReady = Boolean(status?.bithumb?.ready);

  const toggle = useCallback(
    (kind: LiveTradeExchangeApiKind) => {
      setOpen((prev) => {
        const next = prev === kind ? null : kind;
        if (next) onPopoverOpen?.();
        return next;
      });
    },
    [onPopoverOpen],
  );

  useLayoutEffect(() => {
    if (!open) return;
    const anchor =
      open === "toss" ? tossAnchorRef.current : bithumbAnchorRef.current;
    if (!anchor) return;
    const sync = () => setPopoverStyle(apiPopoverPortalStyle(anchor));
    sync();
    window.addEventListener("resize", sync);
    window.addEventListener("scroll", sync, true);
    return () => {
      window.removeEventListener("resize", sync);
      window.removeEventListener("scroll", sync, true);
    };
  }, [open]);

  useEffect(() => {
    const onCloseApi = () => setOpen(null);
    window.addEventListener("live-trade-dock-close-api-popover", onCloseApi);
    return () =>
      window.removeEventListener("live-trade-dock-close-api-popover", onCloseApi);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (tossAnchorRef.current?.contains(t)) return;
      if (bithumbAnchorRef.current?.contains(t)) return;
      if (
        document
          .getElementById(`app-live-trade-side-dock-api-popover-${open}`)
          ?.contains(t)
      ) {
        return;
      }
      setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const popover =
    open && status ? (
      <div
        id={`app-live-trade-side-dock-api-popover-${open}`}
        className="app-live-trade-side-dock__auth-popover app-live-trade-side-dock__api-popover app-live-trade-side-dock__api-popover--portal"
        style={popoverStyle}
        role="dialog"
        aria-label={open === "toss" ? ko.app.liveTradeTossTitle : ko.app.liveTradeBithumbTitle}
        onMouseDown={(ev) => ev.stopPropagation()}
      >
        <LiveTradeExchangeApiPanel
          exchange={open}
          status={status}
          user={user}
          onUpdated={onCredentialsUpdated}
        />
      </div>
    ) : null;

  return (
    <>
      <DockApiRailButton
        exchange="toss"
        ready={tossReady}
        selected={open === "toss"}
        anchorRef={tossAnchorRef}
        onClick={() => toggle("toss")}
      />
      <DockApiRailButton
        exchange="bithumb"
        ready={bithumbReady}
        selected={open === "bithumb"}
        anchorRef={bithumbAnchorRef}
        onClick={() => toggle("bithumb")}
      />
      {popover ? createPortal(popover, document.body) : null}
    </>
  );
}
