import { buildLiveTradeHistoryPayload } from "./live-trade-history.js";
import { getProgramArmedMarkets } from "./live-trade-arm-gate.js";
import {
  buildLiveTradePortfolioSnapshot,
  buildProgramPortfolioSummariesMap,
  enrichProgramReturnsFromHoldings,
} from "./live-trade-portfolio-store.js";
import {
  healOwnerMissingProgramErrorsSync,
  healStuckSimProgramErrorsSync,
  listLiveTradeProgramsForUserSync,
  readProgramsStoreSync,
} from "./live-trade-programs-store.js";

async function portfolioPayloadForUser(userId, programId) {
  const uid = String(userId ?? "").trim();
  const pid = programId ? String(programId).trim() : null;
  const snap = await buildLiveTradePortfolioSnapshot({
    userId: uid,
    programId: pid,
  });
  const programs = listLiveTradeProgramsSync(uid);
  const nameById = new Map(programs.map((p) => [p.id, p.name]));
  return {
    ...snap,
    holdings: snap.holdings.map((h) => ({
      ...h,
      programName: nameById.get(h.programId) ?? h.programId,
    })),
    trades: snap.trades.map((t) => ({
      ...t,
      programName: nameById.get(t.programId) ?? t.programId,
    })),
  };
}

/** @param {string} userId */
export async function buildAdminLiveTradingUserStatusPayload(userId) {
  const uid = String(userId ?? "").trim();
  if (!uid) throw new Error("userId required");
  let programs = listLiveTradeProgramsForUserSync(uid);
  let programReturns = await buildProgramPortfolioSummariesMap(
    programs.map((p) => p.id),
    uid,
  );
  programReturns = await enrichProgramReturnsFromHoldings(programReturns, uid);
  programs = healStuckSimProgramErrorsSync(programs, programReturns);
  programs = healOwnerMissingProgramErrorsSync(programs);
  return {
    programs,
    programReturns,
    armedCount: programs.filter((p) => p.status === "armed").length,
    simCount: programs.filter((p) => p.status === "sim").length,
    userId: uid,
    fetchedAtMs: Date.now(),
  };
}

export function buildAdminLiveTradingRunningPayload() {
  const all = readProgramsStoreSync().programs;
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

  app.get(
    "/api/access/admin/live-trading/user-status",
    requireAdmin,
    async (req, res) => {
      try {
        const userId = String(req.query?.userId ?? "").trim();
        if (!userId) {
          res.status(400).json({ error: "userId required" });
          return;
        }
        const payload = await buildAdminLiveTradingUserStatusPayload(userId);
        res.json(payload);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        res.status(500).json({ error: msg });
      }
    },
  );

  app.get(
    "/api/access/admin/live-trading/trades/history",
    requireAdmin,
    async (req, res) => {
      try {
        const userId = String(req.query?.userId ?? "").trim();
        if (!userId) {
          res.status(400).json({ error: "userId required" });
          return;
        }
        const endDay = String(req.query?.endDay ?? "").trim() || undefined;
        const days = req.query?.days;
        const payload = buildLiveTradeHistoryPayload(userId, {
          endDay,
          days: days != null ? Number(days) : 1,
        });
        res.json(payload);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        res.status(500).json({ error: msg });
      }
    },
  );

  app.get(
    "/api/access/admin/live-trading/portfolio",
    requireAdmin,
    async (req, res) => {
      try {
        const userId = String(req.query?.userId ?? "").trim();
        const programId = String(req.query?.programId ?? "").trim() || null;
        if (!userId) {
          res.status(400).json({ error: "userId required" });
          return;
        }
        const snap = await portfolioPayloadForUser(userId, programId);
        res.json(snap);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        res.status(500).json({ error: msg });
      }
    },
  );
}
