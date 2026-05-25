import type {
  LiveTradeArmLane,
  LiveTradeBoxRangePublicBox,
  LiveTradeProgram,
  TechModelRecord,
} from "../api";
import { BOX_RANGE_MODEL_ID } from "../lib/boxRangeTechModel";
import { ko } from "../i18n/ko";
import { formatPercent } from "../lib/format";
import { showProgramRunError } from "../lib/liveProgramDisplay";
import LiveTradeProgramBoxRangeSection from "./LiveTradeProgramBoxRangeSection";

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
  busy,
  showArmLaneButton,
  onSimStop,
  onDisarm,
  onSimStart,
  onArmLane,
  onEdit,
  onDelete,
  readOnly = false,
  boxRangeBoxes,
}: {
  program: LiveTradeProgram;
  model?: TechModelRecord;
  displayStatus: LiveTradeProgram["status"];
  returnPct: number | null | undefined;
  holdingCount: number;
  busy: boolean;
  showArmLaneButton: (lane: LiveTradeArmLane) => boolean;
  onSimStop: () => void;
  onDisarm: () => void;
  onSimStart: () => void;
  onArmLane: (lane: LiveTradeArmLane) => void;
  onEdit: () => void;
  onDelete: () => void;
  readOnly?: boolean;
  /** 박스권 프로그램 — 감시·보유 박스 */
  boxRangeBoxes?: LiveTradeBoxRangePublicBox[];
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

  return (
    <article
      className={`live-trading-tab__program live-trading-tab__program--${displayStatus}`}
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
        {isBoxRange
          ? ko.app.liveTradeCumulativeReturn
          : ko.app.liveTradeCurrentReturn}
        :{" "}
        <span className={returnClass}>{formatPercent(returnPct ?? undefined)}</span>
      </p>
      {isBoxRange && boxRangeBoxes ? (
        <LiveTradeProgramBoxRangeSection boxes={boxRangeBoxes} />
      ) : null}
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
      {!readOnly ? (
      <div className="live-trading-tab__program-actions">
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
            {showArmLaneButton("bithumb") ? (
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                disabled={busy}
                onClick={() => onArmLane("bithumb")}
              >
                {ko.app.liveTradeArmBithumb}
              </button>
            ) : null}
            {showArmLaneButton("toss") ? (
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                disabled={busy}
                onClick={() => onArmLane("toss")}
              >
                {ko.app.liveTradeArmToss}
              </button>
            ) : null}
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
            {showArmLaneButton("bithumb") ? (
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                disabled={busy}
                onClick={() => onArmLane("bithumb")}
              >
                {ko.app.liveTradeArmBithumb}
              </button>
            ) : null}
            {showArmLaneButton("toss") ? (
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                disabled={busy}
                onClick={() => onArmLane("toss")}
              >
                {ko.app.liveTradeArmToss}
              </button>
            ) : null}
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
      </div>
      ) : null}
    </article>
  );
}
