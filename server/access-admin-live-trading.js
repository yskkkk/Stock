import { getProgramArmedMarkets } from "./live-trade-arm-gate.js";
import { listLiveTradeProgramsSync } from "./live-trade-programs-store.js";

export function buildAdminLiveTradingRunningPayload() {
  const all = listLiveTradeProgramsSync();
  const programs = all
    .filter((p) => p.status === "armed" || p.status === "sim")
    .sort((a, b) => {
      const rank = (s) => (s === "armed" ? 0 : 1);
      const ra = rank(a.status);
      const rb = rank(b.status);
      if (ra !== rb) return ra - rb;
      return a.name.localeCompare(b.name, "ko");
    })
    .map((p) => ({
      id: p.id,
      name: p.name,
      status: p.status,
      userId: p.userId,
      modelId: p.modelId,
      markets: p.markets ?? { kr: false, us: false, crypto: false },
      armedMarkets: getProgramArmedMarkets(p),
      minScoreRatio: p.minScoreRatio,
      maxOpenPositions: p.maxOpenPositions,
      orderAmountKrw: p.orderAmountKrw,
      orderAmountUsd: p.orderAmountUsd,
      armedAtMs: p.armedAtMs,
      lastRunAtMs: p.lastRunAtMs,
      lastError: p.lastError,
      updatedAtMs: p.updatedAtMs,
    }));
  return {
    programs,
    armedCount: programs.filter((p) => p.status === "armed").length,
    simCount: programs.filter((p) => p.status === "sim").length,
    totalPrograms: all.length,
    fetchedAtMs: Date.now(),
  };
}

/**
 * @param {import("express").Express} app
 * @param {import("express").RequestHandler} requireAdmin
 */
export function registerAccessAdminLiveTradingRoute(app, requireAdmin) {
  app.get("/api/access/admin/live-trading/running", requireAdmin, (_req, res) => {
    try {
      res.json(buildAdminLiveTradingRunningPayload());
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      res.status(500).json({ error: msg });
    }
  });
}
