import { useMemo } from "react";
import type {
  BithumbTradingStatus,
  LiveTradeArmLane,
  LiveTradeProgram,
  TechModelRecord,
  TossTradingStatus,
} from "../api";
import { BOX_RANGE_MODEL_ID } from "../lib/boxRangeTechModel";
import { ko } from "../i18n/ko";
import { formatPercent } from "../lib/format";
import {
  buildLiveArmLaneOptions,
  filterLiveArmLaneOptions,
} from "../lib/liveTradeArmLanes";
import { showProgramRunError } from "../lib/liveProgramDisplay";
import LiveTradeArmStartMenu from "./LiveTradeArmStartMenu";

function formatMoney(
  n: number | null | undefined,
  kind: "krw" | "usd",
): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (kind === "usd") {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(n);
  }
  return `${Math.round(n).toLocaleString("ko-KR")}원`;
}

function krwAmountFieldLabel(cryptoOnly: boolean): string {
  return cryptoOnly
    ? ko.app.liveTradeFieldAmountCrypto
    : ko.app.liveTradeFieldAmountKrw;
}

function usdAmountFieldLabel(us: boolean, crypto: boolean): string {
  if (us && crypto) return ko.app.liveTradeFieldAmountUsdCrypto;
  return ko.app.liveTradeFieldAmountUsd;
}

function formatTs(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  try {
    return new Date(ms).toLocaleString("ko-KR", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return "—";
  }
}

function statusLabel(status: LiveTradeProgram["status"]): string {
  switch (status) {
    case "armed":
      return ko.app.liveTradeStatusArmed;
    case "sim":
      return ko.app.liveTradeStatusSim;
    case "error":
      return ko.app.liveTradeStatusError;
    case "paused":
      return ko.app.liveTradeStatusPaused;
    default:
      return ko.app.liveTradeStatusDraft;
  }
}

export default function LiveTradeRegisteredProgramCard({
  program: p,
  model,
  displayStatus,
  returnPct,
  holdingCount,
  tradeCount,
  busy,
  showArmLaneButton,
  tossStatus,
  bithumbStatus,
  onSimStop,
  onDisarm,
  onSimStart,
  onArmLane,
  onEdit,
  onDelete,
  onSelect,
  selected = false,
  deleting = false,
  readOnly = false,
  cardLayout = false,
}: {
  program: LiveTradeProgram;
  model?: TechModelRecord;
  displayStatus: LiveTradeProgram["status"];
  returnPct: number | null | undefined;
  holdingCount: number;
  tradeCount: number;
  busy: boolean;
  showArmLaneButton: (lane: LiveTradeArmLane) => boolean;
  tossStatus?: TossTradingStatus | null;
  bithumbStatus?: BithumbTradingStatus | null;
  onSimStop: () => void;
  onDisarm: () => void;
  onSimStart: () => void;
  onArmLane: (lane: LiveTradeArmLane) => void;
  onEdit: () => void;
  onDelete: () => void;
  /** 도크 카드 클릭 — 좌측 거래내역 */
  onSelect?: () => void;
  selected?: boolean;
  deleting?: boolean;
  readOnly?: boolean;
  /** 도크 프로그램 탭 — 컴팩트 카드 */
  cardLayout?: boolean;
}) {
  const isBoxRange = p.modelId === BOX_RANGE_MODEL_ID;
  const markets = [
    p.markets.kr ? ko.app.liveTradeMarketKr : "",
    p.markets.us ? ko.app.liveTradeMarketUs : "",
    p.markets.crypto ? ko.app.liveTradeMarketCrypto : "",
  ]
    .filter(Boolean)
    .join(" · ");

  const amountLine = p.markets.kr
    ? `${krwAmountFieldLabel(p.markets.crypto && !p.markets.us)}: ${formatMoney(p.orderAmountKrw, "krw")}`
    : p.markets.crypto && !p.markets.us && !p.markets.kr
      ? `${ko.app.liveTradeFieldAmountCrypto}: ${
          p.orderAmountKrw != null
            ? formatMoney(p.orderAmountKrw, "krw")
            : p.orderAmountUsd != null
              ? formatMoney(p.orderAmountUsd, "usd")
              : "—"
        }`
      : p.markets.us
        ? `${usdAmountFieldLabel(p.markets.us, p.markets.crypto)}: ${formatMoney(p.orderAmountUsd, "usd")}`
        : "";

  const retUp = returnPct != null && returnPct >= 0;
  const returnClass =
    returnPct == null
      ? "live-trading-tab__program-return-val"
      : retUp
        ? "live-trading-tab__program-return-val live-trading-tab__program-return-val--up"
        : "live-trading-tab__program-return-val live-trading-tab__program-return-val--down";

  const armLaneOptions = useMemo(
    () => buildLiveArmLaneOptions(p, tossStatus, bithumbStatus),
    [p, tossStatus, bithumbStatus],
  );
  const extraArmLaneOptions = useMemo(
    () => filterLiveArmLaneOptions(armLaneOptions, showArmLaneButton),
    [armLaneOptions, showArmLaneButton],
  );

  const returnLabel =
    p.status === "sim" || displayStatus === "sim"
      ? ko.app.liveTradeTotalReturn
      : isBoxRange
        ? ko.app.liveTradeCumulativeReturn
        : ko.app.liveTradeCurrentReturn;

  const stopCardActionBubble = (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
  };

  const actionButtons = !readOnly ? (
    <>
      {p.status === "sim" ? (
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            disabled={busy}
            onClick={onSimStop}
          >
            {ko.app.liveTradeSimStop}
          </button>
        ) : p.status === "armed" ? (
          <>
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              disabled={busy}
              onClick={onDisarm}
            >
              {ko.app.liveTradeDisarm}
            </button>
            <LiveTradeArmStartMenu
              options={extraArmLaneOptions}
              busy={busy}
              triggerLabel={ko.app.liveTradeArmMenuAddLane}
              onSelect={onArmLane}
            />
          </>
        ) : (
          <>
            <button
              type="button"
              className="btn btn--primary btn--sm"
              disabled={busy}
              onClick={onSimStart}
            >
              {ko.app.liveTradeSimStart}
            </button>
            <LiveTradeArmStartMenu
              options={armLaneOptions}
              busy={busy}
              onSelect={onArmLane}
            />
          </>
        )}
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          disabled={busy}
          onClick={onEdit}
        >
          {ko.app.liveTradeEdit}
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          disabled={busy}
          onClick={onDelete}
        >
          {ko.app.liveTradeDelete}
        </button>
    </>
  ) : null;

  if (deleting) {
    return (
      <article
        className={`live-trading-tab__program live-trading-tab__program--${displayStatus} live-trading-tab__program--deleting`}
        aria-busy="true"
      >
        <div className="live-trading-tab__program-deleting" role="status" aria-live="polite">
          <div className="spinner" aria-hidden />
          <span>{ko.app.liveTradeDeletingProgram}</span>
        </div>
      </article>
    );
  }

  if (cardLayout) {
    const subline = [model?.name ?? p.modelId, markets]
      .filter(Boolean)
      .join(" · ");
    const isRunning =
      displayStatus === "sim" || displayStatus === "armed";
    const principalLine = (() => {
      const cap =
        p.markets.us && p.simInitialCapitalUsd != null
          ? formatMoney(p.simInitialCapitalUsd, "usd")
          : !p.markets.us && p.simInitialCapitalKrw != null
            ? formatMoney(p.simInitialCapitalKrw, "krw")
            : null;
      return cap ? `투자원금 ${cap}` : "투자원금 —";
    })();
    return (
      <article
        className={[
          "live-trading-tab__program",
          `live-trading-tab__program--${displayStatus}`,
          "live-trading-tab__program--card",
          "live-trading-tab__program--pickable",
          isRunning
            ? "live-trading-tab__program--running"
            : "live-trading-tab__program--idle",
          selected ? "live-trading-tab__program--selected" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        onClick={onSelect}
        onKeyDown={
          onSelect
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect();
                }
              }
            : undefined
        }
        tabIndex={onSelect ? 0 : undefined}
        aria-current={selected ? "true" : undefined}
        title={ko.app.liveTradeProgramsTabTrades}
      >
        <div className="live-trading-tab__program-card-body">
          <div className="live-trading-tab__program-head live-trading-tab__program-head--card">
            <strong>{p.name}</strong>
            <span
              className={`live-trading-tab__badge live-trading-tab__badge--${displayStatus}`}
            >
              {statusLabel(displayStatus)}
            </span>
          </div>
          {subline ? (
            <p className="live-trading-tab__program-card-sub">{subline}</p>
          ) : null}
          <p className="live-trading-tab__program-card-return">
            <span className="live-trading-tab__program-card-return-label">
              {returnLabel}
            </span>{" "}
            <span className={returnClass}>
              {formatPercent(returnPct ?? undefined)}
            </span>
          </p>
          <p className="live-trading-tab__program-card-sub">
            {principalLine} · 거래 {Math.max(0, tradeCount)}회
          </p>
          {showProgramRunError(p, holdingCount) ? (
            <p className="live-trading-tab__program-err" role="alert">
              {p.lastError}
            </p>
          ) : null}
        </div>
        {actionButtons ? (
          <div
            className="live-trading-tab__program-actions live-trading-tab__program-actions--card"
            onClick={stopCardActionBubble}
            onKeyDown={stopCardActionBubble}
          >
            {actionButtons}
          </div>
        ) : null}
      </article>
    );
  }

  return (
    <article
      className={[
        "live-trading-tab__program",
        `live-trading-tab__program--${displayStatus}`,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="live-trading-tab__program-head">
        <strong>{p.name}</strong>
        <span className={`live-trading-tab__badge live-trading-tab__badge--${displayStatus}`}>
          {statusLabel(displayStatus)}
        </span>
      </div>
      <p className="live-trading-tab__program-meta">
        {ko.app.liveTradeFieldModel}: {model?.name ?? p.modelId}
      </p>
      {markets ? (
        <p className="live-trading-tab__program-meta">
          {ko.app.liveTradeFieldMarkets}: {markets}
          {!isBoxRange ? (
            <>
              {" "}
              · {ko.app.liveTradeMinScoreShort}{" "}
              {Math.round(p.minScoreRatio * 100)}%
            </>
          ) : null}
        </p>
      ) : null}
      {amountLine ? (
        <p className="live-trading-tab__program-meta">{amountLine}</p>
      ) : null}
      <p className="live-trading-tab__program-meta">
        {returnLabel}:{" "}
        <span className={returnClass}>{formatPercent(returnPct ?? undefined)}</span>
      </p>
      {showProgramRunError(p, holdingCount) ? (
        <p className="live-trading-tab__program-err" role="alert">
          {p.lastError}
        </p>
      ) : null}
      <p className="live-trading-tab__program-ts">
        {p.status === "armed" && p.armedAtMs
          ? `${ko.app.liveTradeArmedAt}: ${formatTs(p.armedAtMs)}`
          : null}
        {p.lastRunAtMs
          ? `${p.status === "armed" && p.armedAtMs ? " · " : ""}${ko.app.liveTradeLastRun}: ${formatTs(p.lastRunAtMs)}`
          : null}
      </p>
      {actionButtons ? (
        <div className="live-trading-tab__program-actions">{actionButtons}</div>
      ) : null}
    </article>
  );
}
