import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchLiveTradingPortfolio,
  simulateLiveTradeSell,
  type LiveTradeHolding,
  type LiveTradePortfolioResponse,
  type LiveTradeProgram,
  type LiveTradeRecord,
} from "../api";
import LiveTradeSimPanel from "./LiveTradeSimPanel";
import { formatPercent, formatPrice, formatSignedMoney } from "../lib/format";
import { ko } from "../i18n/ko";

type PanelTab = "summary" | "holdings" | "trades";

function formatTs(ms: number): string {
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

function sideLabel(side: LiveTradeRecord["side"]): string {
  return side === "buy" ? ko.app.liveTradeSideBuy : ko.app.liveTradeSideSell;
}

function SummaryTiles({ summary }: { summary: LiveTradePortfolioResponse["summary"] }) {
  const ret = summary.totalReturnPct;
  const retUp = ret != null && ret >= 0;
  return (
    <div className="live-portfolio__summary">
      <div className="live-portfolio__tile">
        <span className="live-portfolio__tile-k">{ko.app.liveTradePfHoldings}</span>
        <span className="live-portfolio__tile-v">{summary.holdingCount}</span>
      </div>
      <div className="live-portfolio__tile">
        <span className="live-portfolio__tile-k">{ko.app.liveTradePfInvested}</span>
        <span className="live-portfolio__tile-v">
          {formatPrice(summary.investedOpen, "KRW")}
        </span>
      </div>
      <div className="live-portfolio__tile">
        <span className="live-portfolio__tile-k">{ko.app.liveTradePfEval}</span>
        <span className="live-portfolio__tile-v">
          {formatPrice(summary.marketValueOpen, "KRW")}
        </span>
      </div>
      <div className="live-portfolio__tile">
        <span className="live-portfolio__tile-k">{ko.app.liveTradePfUnrealized}</span>
        <span
          className={
            summary.unrealizedPnl >= 0
              ? "live-portfolio__tile-v live-portfolio__tile-v--up"
              : "live-portfolio__tile-v live-portfolio__tile-v--down"
          }
        >
          {formatSignedMoney(summary.unrealizedPnl, "KRW")}
        </span>
      </div>
      <div className="live-portfolio__tile">
        <span className="live-portfolio__tile-k">{ko.app.liveTradePfRealized}</span>
        <span
          className={
            summary.realizedPnl >= 0
              ? "live-portfolio__tile-v live-portfolio__tile-v--up"
              : "live-portfolio__tile-v live-portfolio__tile-v--down"
          }
        >
          {formatSignedMoney(summary.realizedPnl, "KRW")}
        </span>
      </div>
      <div className="live-portfolio__tile">
        <span className="live-portfolio__tile-k">{ko.app.liveTradePfReturn}</span>
        <span
          className={
            ret == null
              ? "live-portfolio__tile-v"
              : retUp
                ? "live-portfolio__tile-v live-portfolio__tile-v--up"
                : "live-portfolio__tile-v live-portfolio__tile-v--down"
          }
        >
          {ret == null ? "—" : formatPercent(ret)}
        </span>
        <span className="live-portfolio__tile-sub">{ko.app.liveTradePfFeeNote}</span>
      </div>
    </div>
  );
}

function HoldingRow({
  row,
  busy,
  onSold,
}: {
  row: LiveTradeHolding;
  busy: boolean;
  onSold: () => void;
}) {
  const [sellOpen, setSellOpen] = useState(false);
  const [sellQty, setSellQty] = useState(() => String(row.quantity));
  const [sellErr, setSellErr] = useState<string | null>(null);
  const [sellOk, setSellOk] = useState<string | null>(null);

  const up = (row.changePct ?? 0) >= 0;

  const submitSell = () => {
    const quantity = Number(sellQty);
    setSellErr(null);
    setSellOk(null);
    void simulateLiveTradeSell({
      programId: row.programId,
      symbol: row.symbol,
      market: row.market,
      quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : undefined,
    })
      .then((res) => {
        setSellOpen(false);
        setSellOk(
          ko.app.liveTradeSimFilled
            .replace("{price}", formatPrice(res.quote.price, row.currency))
            .replace("{time}", formatTs(res.quote.atMs)),
        );
        onSold();
      })
      .catch((e) => setSellErr(e instanceof Error ? e.message : String(e)));
  };

  return (
    <tr className="live-portfolio__row">
      <td>
        <span className="live-portfolio__sym">{row.symbol}</span>
        <span className="live-portfolio__nm">{row.name}</span>
        <span className="live-portfolio__prog">{row.programName ?? row.programId}</span>
      </td>
      <td className="live-portfolio__num">{row.quantity.toLocaleString("ko-KR")}</td>
      <td className="live-portfolio__num">
        {formatPrice(row.avgEntryPrice, row.currency)}
      </td>
      <td className="live-portfolio__num live-portfolio__num--price">
        <span>{formatPrice(row.currentPrice ?? undefined, row.currency)}</span>
        {row.changePct != null ? (
          <span
            className={
              up
                ? "live-portfolio__inline-pct live-portfolio__inline-pct--up"
                : "live-portfolio__inline-pct live-portfolio__inline-pct--down"
            }
          >
            {formatPercent(row.changePct)}
          </span>
        ) : null}
      </td>
      <td className="live-portfolio__num">
        {row.targetSellPrice != null
          ? formatPrice(row.targetSellPrice, row.currency)
          : "—"}
      </td>
      <td
        className={
          row.unrealizedPnl == null
            ? "live-portfolio__num"
            : row.unrealizedPnl >= 0
              ? "live-portfolio__num live-portfolio__num--up"
              : "live-portfolio__num live-portfolio__num--down"
        }
      >
        {row.unrealizedPnl == null
          ? "—"
          : formatSignedMoney(row.unrealizedPnl, row.currency)}
      </td>
      <td className="live-portfolio__actions">
        {!sellOpen ? (
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            disabled={busy}
            onClick={() => {
              setSellOpen(true);
              setSellQty(String(row.quantity));
              setSellErr(null);
              setSellOk(null);
            }}
          >
            {ko.app.liveTradeSimSell}
          </button>
        ) : (
          <div className="live-portfolio__sell-form">
            <p className="live-portfolio__sell-hint">{ko.app.liveTradeSimSellHint}</p>
            <input
              type="number"
              className="input"
              min={1}
              max={row.quantity}
              placeholder={ko.app.liveTradePfSellQty}
              value={sellQty}
              onChange={(e) => setSellQty(e.target.value)}
            />
            <button
              type="button"
              className="btn btn--primary btn--sm"
              disabled={busy}
              onClick={submitSell}
            >
              {ko.app.liveTradePfSellConfirm}
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => setSellOpen(false)}
            >
              {ko.app.liveTradeCancelEdit}
            </button>
            {sellErr ? (
              <span className="live-portfolio__sell-err" role="alert">
                {sellErr}
              </span>
            ) : null}
          </div>
        )}
        {sellOk && !sellOpen ? (
          <span className="live-portfolio__sell-ok" role="status">
            {sellOk}
          </span>
        ) : null}
      </td>
    </tr>
  );
}

export default function LiveTradePortfolioPanel({
  programs,
}: {
  programs: LiveTradeProgram[];
}) {
  const [tab, setTab] = useState<PanelTab>("summary");
  const [programId, setProgramId] = useState<string>("");
  const [data, setData] = useState<LiveTradePortfolioResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const snap = await fetchLiveTradingPortfolio(programId || null);
      setData(snap);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [programId]);

  useEffect(() => {
    setLoading(true);
    void load();
    const id = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(id);
  }, [load]);

  const programOptions = useMemo(
    () => [{ id: "", name: ko.app.liveTradePfAllPrograms }, ...programs],
    [programs],
  );

  return (
    <>
      <LiveTradeSimPanel
        programs={programs}
        defaultProgramId={programId || undefined}
        onTraded={() => {
          setBusy(true);
          void load().finally(() => setBusy(false));
        }}
      />
      <section className="live-portfolio card" aria-label={ko.app.liveTradePfTitle}>
      <div className="live-portfolio__head">
        <h3 className="live-trading-tab__section-title">{ko.app.liveTradePfTitle}</h3>
        <div className="live-portfolio__head-tools">
          <label className="live-portfolio__filter">
            <span className="live-portfolio__filter-label">{ko.app.liveTradePfProgramFilter}</span>
            <select
              className="input"
              value={programId}
              onChange={(e) => setProgramId(e.target.value)}
            >
              {programOptions.map((p) => (
                <option key={p.id || "all"} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            disabled={loading}
            onClick={() => {
              setLoading(true);
              void load();
            }}
          >
            {ko.app.liveTradePfRefresh}
          </button>
        </div>
      </div>

      <div className="live-portfolio__tabs" role="tablist">
        {(
          [
            ["summary", ko.app.liveTradePfTabSummary],
            ["holdings", ko.app.liveTradePfTabHoldings],
            ["trades", ko.app.liveTradePfTabTrades],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={
              tab === id
                ? "live-portfolio__tab live-portfolio__tab--active"
                : "live-portfolio__tab"
            }
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {loading && !data ? (
        <p className="live-portfolio__muted">{ko.app.liveTradePfLoading}</p>
      ) : null}
      {err ? (
        <p className="live-portfolio__err" role="alert">
          {err}
        </p>
      ) : null}

      {data ? (
        <div className="live-portfolio__body">
          {tab === "summary" ? <SummaryTiles summary={data.summary} /> : null}

          {tab === "holdings" ? (
            data.holdings.length === 0 ? (
              <p className="live-portfolio__muted">{ko.app.liveTradePfNoHoldings}</p>
            ) : (
              <div className="live-portfolio__table-wrap">
                <table className="live-portfolio__table">
                  <thead>
                    <tr>
                      <th>{ko.app.liveTradePfColSymbol}</th>
                      <th>{ko.app.liveTradePfColQty}</th>
                      <th>{ko.app.liveTradePfColAvg}</th>
                      <th>{ko.app.liveTradePfColCurrent}</th>
                      <th>{ko.app.liveTradePfColTargetSell}</th>
                      <th>{ko.app.liveTradePfColPnl}</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {data.holdings.map((h) => (
                      <HoldingRow
                        key={`${h.programId}:${h.market}:${h.symbol}`}
                        row={h}
                        busy={busy}
                        onSold={() => {
                          setBusy(true);
                          void load().finally(() => setBusy(false));
                        }}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : null}

          {tab === "trades" ? (
            data.trades.length === 0 ? (
              <p className="live-portfolio__muted">{ko.app.liveTradePfNoTrades}</p>
            ) : (
              <div className="live-portfolio__table-wrap">
                <table className="live-portfolio__table">
                  <thead>
                    <tr>
                      <th>{ko.app.liveTradePfColTime}</th>
                      <th>{ko.app.liveTradePfColSide}</th>
                      <th>{ko.app.liveTradePfColSymbol}</th>
                      <th>{ko.app.liveTradePfColQty}</th>
                      <th>{ko.app.liveTradePfColPrice}</th>
                      <th>{ko.app.liveTradePfColAmount}</th>
                      <th>{ko.app.liveTradePfColProgram}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.trades.map((t) => (
                      <tr
                        key={t.id}
                        className={
                          t.side === "buy"
                            ? "live-portfolio__row live-portfolio__row--buy"
                            : "live-portfolio__row live-portfolio__row--sell"
                        }
                      >
                        <td className="live-portfolio__ts">{formatTs(t.atMs)}</td>
                        <td>
                          <span
                            className={
                              t.side === "buy"
                                ? "live-portfolio__side live-portfolio__side--buy"
                                : "live-portfolio__side live-portfolio__side--sell"
                            }
                          >
                            {sideLabel(t.side)}
                            {t.simulated ? (
                              <span className="live-portfolio__sim">{ko.app.liveTradeSimTag}</span>
                            ) : null}
                          </span>
                        </td>
                        <td>
                          <span className="live-portfolio__sym">{t.symbol}</span>
                          <span className="live-portfolio__nm">{t.name}</span>
                        </td>
                        <td className="live-portfolio__num">{t.quantity}</td>
                        <td className="live-portfolio__num">
                          {formatPrice(t.price, t.currency)}
                        </td>
                        <td className="live-portfolio__num">
                          {formatPrice(t.amount, t.currency)}
                        </td>
                        <td className="live-portfolio__prog">
                          {t.programName ?? t.programId}
                          {t.note ? (
                            <span className="live-portfolio__note" title={t.note}>
                              · {t.note}
                            </span>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : null}

          {data.updatedAtMs ? (
            <p className="live-portfolio__updated">
              {formatTs(data.updatedAtMs)} {ko.app.liveTradePfUpdated}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
    </>
  );
}
