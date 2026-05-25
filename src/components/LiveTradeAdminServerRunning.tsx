import { useCallback, useEffect, useState } from "react";
import {
  fetchAccessAdminLiveTradingRunning,
  getStoredAccessAdminToken,
  type AccessAdminLiveTradeProgram,
} from "../api";
import { ko } from "../i18n/ko";
import { RefreshIconButton } from "./RefreshIconButton";

function statusLabel(status: AccessAdminLiveTradeProgram["status"]): string {
  if (status === "armed") return ko.app.liveTradeStatusArmed;
  if (status === "sim") return ko.app.liveTradeStatusSim;
  return status;
}

function formatMarkets(m: AccessAdminLiveTradeProgram["markets"]): string {
  const parts: string[] = [];
  if (m.kr) parts.push(ko.app.liveTradeMarketKr);
  if (m.us) parts.push(ko.app.liveTradeMarketUs);
  if (m.crypto) parts.push(ko.app.liveTradeMarketCrypto);
  return parts.length ? parts.join(" · ") : "—";
}

export default function LiveTradeAdminServerRunning({
  enabled,
  adminIpBypass,
  onViewUser,
}: {
  enabled: boolean;
  /** 관리자 IP — Bearer 없이 API 호출 */
  adminIpBypass?: boolean;
  onViewUser: (p: {
    userId: string;
    programId: string;
    name: string;
  }) => void;
}) {
  const [programs, setPrograms] = useState<AccessAdminLiveTradeProgram[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!enabled) return;
    const token = getStoredAccessAdminToken() ?? "";
    if (!token.trim() && !adminIpBypass) {
      setPrograms([]);
      setErr(ko.access.adminPasswordLabel);
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const data = await fetchAccessAdminLiveTradingRunning(token);
      setPrograms(data.programs ?? []);
    } catch (e) {
      setPrograms([]);
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [enabled, adminIpBypass]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => void load(), 10_000);
    return () => window.clearInterval(id);
  }, [enabled, load]);

  if (!enabled) return null;

  return (
    <section
      className="live-sim-run card live-trade-server-running"
      aria-label={ko.access.liveTradeServerRunningTitle}
    >
      <div className="live-sim-run__head">
        <div>
          <h3 className="live-trading-tab__section-title">
            {ko.access.liveTradeServerRunningTitle}
          </h3>
          <p className="live-sim-run__subhead">{ko.access.liveTradeServerRunningSub}</p>
        </div>
        <RefreshIconButton
          label={ko.access.adminLiveTradeReload}
          className="btn btn--secondary btn--sm"
          disabled={busy}
          onClick={() => void load()}
        />
      </div>
      {err ? (
        <p className="live-sim-run__err" role="alert">
          {err}
        </p>
      ) : null}
      {!busy && programs.length === 0 && !err ? (
        <p className="live-sim-run__empty">{ko.access.liveTradeServerRunningEmpty}</p>
      ) : (
        <ul className="live-trade-server-running__list">
          {programs.map((p) => (
            <li key={p.id} className="live-trade-server-running__item">
              <div className="live-trade-server-running__meta">
                <strong>{p.name}</strong>
                <span
                  className={
                    p.status === "armed"
                      ? "access-admin-live-trade-badge access-admin-live-trade-badge--armed"
                      : "access-admin-live-trade-badge access-admin-live-trade-badge--sim"
                  }
                >
                  {statusLabel(p.status)}
                </span>
              </div>
              <p className="live-trade-server-running__user">
                <code>{p.userId ?? "—"}</code>
                {" · "}
                {formatMarkets(p.markets)}
              </p>
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                onClick={() => {
                  const uid = String(p.userId ?? "").trim();
                  if (!uid) return;
                  onViewUser({ userId: uid, programId: p.id, name: p.name });
                }}
              >
                {ko.access.liveTradeServerRunningView}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
