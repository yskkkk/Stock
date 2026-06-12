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
import {
  fetchPollerStatus,
  togglePollerRuntime,
  type PollerStatusRow,
} from "../api";
import { ko } from "../i18n/ko";
import LiveTradeDockYsHead from "./LiveTradeDockYsHead";

const POLLER_POPOVER_GAP_PX = 9;
const LIST_POLL_MS = 2_000;
const OVERLAY_Z = 10050;

function pollerPopoverStyle(anchor: HTMLElement): CSSProperties {
  const r = anchor.getBoundingClientRect();
  return {
    right: Math.max(8, window.innerWidth - r.left + POLLER_POPOVER_GAP_PX),
    bottom: Math.max(8, window.innerHeight - r.bottom),
  };
}

function detailPopoverStyle(anchor: HTMLElement): CSSProperties {
  const r = anchor.getBoundingClientRect();
  const maxW = Math.min(340, window.innerWidth * 0.92);
  let left = r.left;
  left = Math.min(Math.max(8, left), window.innerWidth - maxW - 8);
  const top = Math.max(8, r.top - 8);
  return {
    position: "fixed",
    left,
    top,
    transform: "translateY(-100%)",
    width: maxW,
    maxWidth: maxW,
    zIndex: OVERLAY_Z + 2,
  };
}

function passwordPopoverStyle(anchor: HTMLElement): CSSProperties {
  const r = anchor.getBoundingClientRect();
  const w = Math.min(240, window.innerWidth * 0.88);
  let left = r.right - w;
  left = Math.min(Math.max(8, left), window.innerWidth - w - 8);
  return {
    position: "fixed",
    left,
    top: Math.max(8, r.top - 7),
    transform: "translateY(-100%)",
    width: w,
    zIndex: OVERLAY_Z + 3,
  };
}

function formatIntervalMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${Math.round(ms / 1000)}초`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}분`;
  return `${(ms / 3_600_000).toFixed(1)}시간`;
}

function formatLastTick(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms)) return ko.app.liveTradeSideDockPollersNever;
  const sec = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (sec < 5) return "방금";
  if (sec < 60) return `${sec}초 전`;
  if (sec < 3600) return `${Math.floor(sec / 60)}분 전`;
  return new Date(ms).toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function pollerStatusLabel(p: PollerStatusRow): string {
  if (!p.bootEnabled) return ko.app.liveTradeSideDockPollersBootOff;
  if (!p.effectiveEnabled) return ko.app.liveTradeSideDockPollersStopped;
  if (p.running) return ko.app.liveTradeSideDockPollersRunning;
  return p.runtimeEnabled ? ko.app.liveTradeSideDockPollersRunning : ko.app.liveTradeSideDockPollersStopped;
}

function PollerIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className ?? "dock-poller-rail__icon"}
      viewBox="0 0 24 24"
      width={16}
      height={16}
      aria-hidden
    >
      <circle cx="12" cy="12" r="2.5" fill="currentColor" />
      <path
        d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4l1.4-1.4M17 7l1.4-1.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <circle
        cx="12"
        cy="12"
        r="6.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeDasharray="3 2"
        opacity="0.55"
      />
    </svg>
  );
}

function AdminPasswordBubble({
  anchorRef,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  busy: boolean;
  error: string | null;
  onConfirm: (password: string) => void;
  onCancel: () => void;
}) {
  const [password, setPassword] = useState("");
  const [style, setStyle] = useState<CSSProperties>({ visibility: "hidden" });
  const inputRef = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    const el = anchorRef.current;
    if (!el) return;
    setStyle(passwordPopoverStyle(el));
    inputRef.current?.focus();
  }, [anchorRef]);

  return createPortal(
    <div
      className="dock-poller-rail__password-pop"
      style={style}
      role="dialog"
      aria-label={ko.app.liveTradeSideDockPollersToggleNeedPassword}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <label className="dock-poller-rail__password-label">
        {ko.access.adminPasswordLabel}
        <input
          ref={inputRef}
          type="password"
          className="dock-poller-rail__password-input"
          value={password}
          autoComplete="off"
          disabled={busy}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onConfirm(password);
            if (e.key === "Escape") onCancel();
          }}
        />
      </label>
      {error ? (
        <p className="dock-poller-rail__password-err" role="alert">
          {error}
        </p>
      ) : null}
      <div className="dock-poller-rail__password-actions">
        <button
          type="button"
          className="btn btn--primary btn--sm"
          disabled={busy || !password.trim()}
          onClick={() => onConfirm(password)}
        >
          {ko.app.liveTradeSave}
        </button>
        <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={onCancel}>
          {ko.app.liveTradeCancelEdit}
        </button>
      </div>
    </div>,
    document.body,
  );
}

function PollerCard({
  poller,
  onToggleRequest,
  onDetail,
}: {
  poller: PollerStatusRow;
  onToggleRequest: (p: PollerStatusRow, anchor: HTMLElement) => void;
  onDetail: (p: PollerStatusRow, anchor: HTMLElement) => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const canToggle = poller.runtimeToggleable && poller.bootEnabled && poller.bootStarted;
  const nextEnabled = !poller.runtimeEnabled;

  return (
    <article
      ref={cardRef}
      className={`dock-poller-rail__card${
        poller.effectiveEnabled ? " dock-poller-rail__card--on" : ""
      }${poller.running ? " dock-poller-rail__card--busy" : ""}`}
    >
      <button
        type="button"
        className="dock-poller-rail__card-head"
        onClick={() => {
          if (cardRef.current) onDetail(poller, cardRef.current);
        }}
        title={ko.app.liveTradeSideDockPollersDetail}
      >
        <span className="dock-poller-rail__card-title">{poller.labelKo}</span>
        <span className="dock-poller-rail__card-group">{poller.groupKo}</span>
        <span
          className={`dock-poller-rail__card-status${
            poller.effectiveEnabled
              ? " dock-poller-rail__card-status--on"
              : " dock-poller-rail__card-status--off"
          }`}
        >
          {pollerStatusLabel(poller)}
        </span>
      </button>
      <dl className="dock-poller-rail__card-meta">
        <div>
          <dt>{ko.app.liveTradeSideDockPollersInterval}</dt>
          <dd>{formatIntervalMs(poller.intervalMs)}</dd>
        </div>
        <div>
          <dt>{ko.app.liveTradeSideDockPollersLastTick}</dt>
          <dd>{formatLastTick(poller.lastTickAtMs)}</dd>
        </div>
      </dl>
      {canToggle ? (
        <button
          ref={toggleRef}
          type="button"
          className={`btn btn--sm dock-poller-rail__toggle${
            nextEnabled ? " btn--primary" : " btn--ghost"
          }`}
          onClick={(e) => {
            e.stopPropagation();
            if (toggleRef.current) onToggleRequest(poller, toggleRef.current);
          }}
        >
          {nextEnabled
            ? ko.app.liveTradeSideDockPollersStart
            : ko.app.liveTradeSideDockPollersStop}
        </button>
      ) : (
        <p className="dock-poller-rail__env-hint">
          {ko.app.liveTradeSideDockPollersEnvHint}: {poller.envDisable}
        </p>
      )}
    </article>
  );
}

/** 우측 도크 하단 — 서버 폴링 목록·on/off */
export default function LiveTradeDockPollerRail({
  onPopoverOpen,
}: {
  onPopoverOpen?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties>({});
  const [pollers, setPollers] = useState<PollerStatusRow[]>([]);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [detail, setDetail] = useState<{
    poller: PollerStatusRow;
    style: CSSProperties;
  } | null>(null);
  const [toggleTarget, setToggleTarget] = useState<{
    poller: PollerStatusRow;
    anchor: HTMLElement;
  } | null>(null);
  const [toggleBusy, setToggleBusy] = useState(false);
  const [toggleErr, setToggleErr] = useState<string | null>(null);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const toggleAnchorRef = useRef<HTMLElement | null>(null);

  const reload = useCallback(async () => {
    try {
      const out = await fetchPollerStatus();
      setPollers(out.pollers ?? []);
      setLoadErr(null);
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    const el = anchorRef.current;
    if (!el) return;
    const sync = () => setPopoverStyle(pollerPopoverStyle(el));
    sync();
    window.addEventListener("resize", sync);
    window.addEventListener("scroll", sync, true);
    return () => {
      window.removeEventListener("resize", sync);
      window.removeEventListener("scroll", sync, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    void reload();
    const id = window.setInterval(() => void reload(), LIST_POLL_MS);
    return () => window.clearInterval(id);
  }, [open, reload]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (anchorRef.current?.contains(t)) return;
      if (document.getElementById("app-live-trade-side-dock-pollers-popover")?.contains(t)) {
        return;
      }
      if ((t as HTMLElement).closest?.(".dock-poller-rail__password-pop")) return;
      if ((t as HTMLElement).closest?.(".dock-poller-rail__detail-pop")) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setDetail(null);
        setToggleTarget(null);
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      setDetail(null);
      setToggleTarget(null);
      setToggleErr(null);
    }
  }, [open]);

  useEffect(() => {
    toggleAnchorRef.current = toggleTarget?.anchor ?? null;
  }, [toggleTarget]);

  const onToggleConfirm = useCallback(
    async (password: string) => {
      if (!toggleTarget) return;
      setToggleBusy(true);
      setToggleErr(null);
      try {
        const out = await togglePollerRuntime(
          toggleTarget.poller.id,
          !toggleTarget.poller.runtimeEnabled,
          password,
        );
        if (!out.ok) {
          setToggleErr(out.error ?? ko.access.adminPasswordLabel);
          return;
        }
        setPollers(out.pollers ?? []);
        setToggleTarget(null);
      } catch (e) {
        setToggleErr(e instanceof Error ? e.message : String(e));
      } finally {
        setToggleBusy(false);
      }
    },
    [toggleTarget],
  );

  return (
    <>
      <span ref={anchorRef} className="app-live-trade-side-dock__api-anchor">
        <button
          type="button"
          className={[
            "app-live-trade-side-dock__rail-btn",
            "app-live-trade-side-dock__rail-btn--pollers",
            open ? "app-live-trade-side-dock__rail-btn--on" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          aria-selected={open}
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-controls={open ? "app-live-trade-side-dock-pollers-popover" : undefined}
          title={ko.app.liveTradeSideDockPollersTitle}
          onClick={() => {
            onPopoverOpen?.();
            setOpen((v) => !v);
          }}
        >
          <span
            className="app-live-trade-side-dock__rail-glyph app-live-trade-side-dock__rail-glyph--pollers"
            aria-hidden
          >
            <PollerIcon />
          </span>
          <span className="app-live-trade-side-dock__rail-label app-live-trade-side-dock__rail-label--stacked">
            <span className="app-live-trade-side-dock__rail-label-main">
              {ko.app.liveTradeSideDockRailPollers}
            </span>
          </span>
        </button>
      </span>

      {open
        ? createPortal(
            <div
              id="app-live-trade-side-dock-pollers-popover"
              className="app-live-trade-side-dock__api-popover app-live-trade-side-dock__pollers-popover app-live-trade-side-dock__api-popover--portal"
              style={popoverStyle}
              role="dialog"
              aria-label={ko.app.liveTradeSideDockPollersTitle}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <LiveTradeDockYsHead ariaLabel={ko.app.liveTradeSideDockPollersTitle} />
              {loadErr ? (
                <p className="dock-poller-rail__err" role="alert">
                  {loadErr}
                </p>
              ) : pollers.length === 0 ? (
                <p className="dock-poller-rail__empty">{ko.app.liveTradeSideDockPollersEmpty}</p>
              ) : (
                <div className="dock-poller-rail__list">
                  {pollers.map((p) => (
                    <PollerCard
                      key={p.id}
                      poller={p}
                      onToggleRequest={(row, anchor) => {
                        setToggleErr(null);
                        setToggleTarget({ poller: row, anchor });
                      }}
                      onDetail={(row, anchor) => {
                        setDetail({ poller: row, style: detailPopoverStyle(anchor) });
                      }}
                    />
                  ))}
                </div>
              )}
            </div>,
            document.body,
          )
        : null}

      {detail
        ? createPortal(
            <div
              className="dock-poller-rail__detail-pop"
              style={detail.style}
              role="tooltip"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <strong className="dock-poller-rail__detail-title">{detail.poller.labelKo}</strong>
              <p className="dock-poller-rail__detail-body">{detail.poller.descriptionKo}</p>
              <p className="dock-poller-rail__detail-env">
                {ko.app.liveTradeSideDockPollersEnvHint}: {detail.poller.envDisable}
              </p>
              <button
                type="button"
                className="btn btn--ghost btn--sm dock-poller-rail__detail-close"
                onClick={() => setDetail(null)}
              >
                {ko.app.liveTradeCancelEdit}
              </button>
            </div>,
            document.body,
          )
        : null}

      {toggleTarget ? (
        <AdminPasswordBubble
          anchorRef={toggleAnchorRef}
          busy={toggleBusy}
          error={toggleErr}
          onConfirm={(pw) => void onToggleConfirm(pw)}
          onCancel={() => {
            setToggleTarget(null);
            setToggleErr(null);
          }}
        />
      ) : null}
    </>
  );
}
