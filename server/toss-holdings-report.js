/**
 * 토스 보유 종목 — 업종·재무·기술·AI 종합 리포트
 */
import { fetchScanCandles, loadStock } from "./stock-data.js";
import { detectDailyMa5OverMa20 } from "./ma-align-detect.js";
import { getActiveTechModelsSync } from "./picks-tech-models-store.js";
import { sumTechScoreWeights } from "./picks-tech-weights-store.js";
import { buildTechnicalStatusReport } from "./technical.js";
import { loadFinancialPeriods } from "./stock-financials.js";
import { loadFinancialStatementAnalysis } from "./stock-financials-analysis.js";
import { loadStockFundamentals } from "./stock-fundamentals.js";
import { fetchStockVaultMetaForItems } from "./stock-vault-meta.js";
import { getTossLedgerSnapshotCacheSync } from "./live-trade-toss-ledger.js";
import {
  getTossHoldingPlanSync,
  listTossHoldingPlansSync,
  upsertTossHoldingPlanSync,
} from "./toss-holdings-plans-store.js";
import { placeManualTossOrderForUser } from "./toss-trading-adapter.js";
import { getCredentialMetaSync } from "./user-credentials-store.js";

/**
 * @param {{
 *   holding?: object | null;
 *   industry?: string | null;
 *   fundamentals?: object | null;
 *   financialAnalysis?: object | null;
 *   technical?: object | null;
 *   plan?: object | null;
 * }} ctx
 */
function buildDeepAiReport(ctx) {
  const { holding, industry, fundamentals, financialAnalysis, technical, plan } = ctx;
  /** @type {string[]} */
  const bullets = [];

  if (industry) {
    bullets.push(`업종 분류: ${industry} — 동종 업계 비교·재무 해석의 기준 그룹입니다.`);
  }

  if (holding) {
    const qty = Number(holding.quantity);
    const avg = holding.avgBuyPrice != null ? Number(holding.avgBuyPrice) : null;
    const cur = holding.currentPrice != null ? Number(holding.currentPrice) : null;
    const ret = holding.returnPercent != null ? Number(holding.returnPercent) : null;
    if (Number.isFinite(qty) && qty > 0) {
      bullets.push(`보유 수량 ${qty}주${avg != null && Number.isFinite(avg) ? ` · 평균매입 ${Math.round(avg).toLocaleString("ko-KR")}` : ""}.`);
    }
    if (ret != null && Number.isFinite(ret)) {
      const tone = ret >= 0 ? "평가 이익" : "평가 손실";
      bullets.push(`현재 ${tone} ${ret >= 0 ? "+" : ""}${ret.toFixed(2)}%${cur != null ? ` (현재가 기준)` : ""}.`);
    }
    if (holding.marketValue != null) {
      bullets.push(
        `평가 금액 약 ${Math.round(Number(holding.marketValue)).toLocaleString("ko-KR")} ${holding.currency ?? "KRW"}.`,
      );
    }
  }

  if (fundamentals) {
    const parts = [];
    if (fundamentals.per != null) parts.push(`PER ${Number(fundamentals.per).toFixed(1)}배`);
    if (fundamentals.pbr != null) parts.push(`PBR ${Number(fundamentals.pbr).toFixed(2)}배`);
    if (fundamentals.roe != null)
      parts.push(`ROE ${(Number(fundamentals.roe) * 100).toFixed(1)}%`);
    if (fundamentals.profitMargin != null)
      parts.push(`순이익률 ${(Number(fundamentals.profitMargin) * 100).toFixed(1)}%`);
    if (fundamentals.revenueGrowth != null)
      parts.push(`매출 성장 ${(Number(fundamentals.revenueGrowth) * 100).toFixed(1)}%`);
    if (fundamentals.dividendYield != null && fundamentals.dividendYield > 0)
      parts.push(`배당수익률 ${(Number(fundamentals.dividendYield) * 100).toFixed(2)}%`);
    if (parts.length) bullets.push(`밸류에이션·수익성: ${parts.join(" · ")}.`);
    if (fundamentals.marketCap != null)
      bullets.push(
        `시가총액 ${Math.round(Number(fundamentals.marketCap)).toLocaleString("ko-KR")} ${fundamentals.currency ?? ""}.`,
      );
  }

  const finBullets = financialAnalysis?.aiOpinion?.bullets;
  if (Array.isArray(finBullets) && finBullets.length) {
    bullets.push(...finBullets.slice(0, 6));
  }

  const peer = financialAnalysis?.peerComparison;
  const pm = financialAnalysis?.periodMetrics;
  if (peer && pm?.per != null && peer.medianPer != null) {
    const diff = ((pm.per - peer.medianPer) / peer.medianPer) * 100;
    if (Math.abs(diff) >= 5) {
      bullets.push(
        diff > 0
          ? `${peer.peerGroup} 대비 PER이 중앙값보다 약 ${diff.toFixed(0)}% 높아 상대적으로 고평가 구간일 수 있습니다.`
          : `${peer.peerGroup} 대비 PER이 중앙값보다 약 ${Math.abs(diff).toFixed(0)}% 낮아 상대적 저평가 후보로 볼 수 있습니다.`,
      );
    }
  }

  if (technical) {
    if (technical.insufficientData) {
      bullets.push("기술 분석: 일봉 데이터가 부족해 신호를 산출하지 못했습니다.");
    } else {
      const met = technical.conditionsMet ?? 0;
      const total = technical.conditionsTotal ?? 12;
      const scoreLabel = technical.scorePctLabel ?? String(technical.score ?? 0);
      bullets.push(
        technical.buy
          ? `기술 분석: 매수 신호 충족 (${met}/${total} 조건, 가중 점수 ${scoreLabel}%).`
          : `기술 분석: 매수 신호 미충족 (${met}/${total} 조건, 가중 점수 ${scoreLabel}%).`,
      );
      const metSignals = (technical.signalBreakdown ?? [])
        .filter((s) => s.met)
        .map((s) => s.label)
        .slice(0, 5);
      if (metSignals.length) {
        bullets.push(`충족 신호: ${metSignals.join(", ")}${metSignals.length >= 5 ? " …" : ""}.`);
      }
    }
  }

  if (plan) {
  /** @type {string[]} */
    const planBits = [];
    if (plan.targetBuyPrice) planBits.push(`목표 매수가 ${plan.targetBuyPrice}`);
    if (plan.targetSellPrice) planBits.push(`목표 매도가 ${plan.targetSellPrice}`);
    if (plan.stopLossPrice) planBits.push(`손절가 ${plan.stopLossPrice}`);
    if (planBits.length) bullets.push(`설정한 매매 계획: ${planBits.join(" · ")}.`);
  }

  if (bullets.length < 3) {
    bullets.push(
      "공개 재무·시세 데이터를 바탕으로 한 참고 의견입니다. 실제 투자 결정 전 공시·리스크를 직접 확인하세요.",
    );
  }

  const name =
    holding?.name ??
    fundamentals?.name ??
    financialAnalysis?.symbol ??
    "종목";
  const summary = `${name} — ${industry ?? "업종 미분류"} · 보유·재무·기술 종합 분석`;

  return {
    summary,
    bullets: bullets.slice(0, 14),
    disclaimer:
      "AI 종합 의견은 공개 데이터·규칙 기반 자동 분석이며 투자 권유·매매 지시가 아닙니다.",
  };
}

/**
 * @param {string} symbol
 * @param {"kr"|"us"} market
 * @param {object} [holding]
 */
async function loadSymbolIntel(symbol, market, holding = null) {
  const sym = String(symbol ?? "").trim().toUpperCase();
  const mkt = market === "us" ? "us" : "kr";

  const [metaMap, fundamentals, periodsPayload, technicalBundle] = await Promise.all([
    fetchStockVaultMetaForItems([{ symbol: sym, market: mkt }]).catch(() => ({})),
    loadStockFundamentals(sym).catch(() => null),
    loadFinancialPeriods(sym).catch(() => null),
    (async () => {
      try {
        const [data, daily] = await Promise.all([
          fetchScanCandles(sym),
          loadStock(sym, "1d", { live: false }),
        ]);
        const model = getActiveTechModelsSync()[0];
        const weights = model?.weights;
        const report = buildTechnicalStatusReport(data.candles, weights, {
          dailyMa5OverMa20: detectDailyMa5OverMa20(daily?.candles ?? []),
        });
        return {
          symbol: data.symbol,
          techModelId: model?.id ?? "default",
          techModelName: model?.name ?? "기본",
          techModelMaxScore: model ? sumTechScoreWeights(model.weights) : report.maxScore,
          ...report,
        };
      } catch {
        return null;
      }
    })(),
  ]);

  const industry = metaMap?.[sym]?.industry ?? null;

  let financialAnalysis = null;
  const latestPeriod = periodsPayload?.periods?.[0];
  if (latestPeriod?.id) {
    try {
      financialAnalysis = await loadFinancialStatementAnalysis(sym, latestPeriod.id);
    } catch {
      financialAnalysis = null;
    }
  }

  const plan = null;

  const aiReport = buildDeepAiReport({
    holding,
    industry,
    fundamentals,
    financialAnalysis,
    technical: technicalBundle,
    plan,
  });

  return {
    symbol: sym,
    market: mkt,
    industry,
    fundamentals,
    financialPeriods: periodsPayload?.periods?.slice(0, 8) ?? [],
    financialAnalysis,
    technical: technicalBundle,
    aiReport,
  };
}

/**
 * @param {string} userId
 * @param {string} symbol
 * @param {object} [opts]
 */
export async function buildTossHoldingReportForUser(userId, symbol, opts = {}) {
  const uid = String(userId ?? "").trim();
  const sym = String(symbol ?? "").trim().toUpperCase();
  if (!uid) throw new Error("로그인이 필요합니다.");
  if (!sym) throw new Error("종목이 필요합니다.");

  const market =
    String(opts.market ?? "").trim().toLowerCase() === "us" ? "us" : "kr";

  const cache = getTossLedgerSnapshotCacheSync(uid);
  const holding =
    cache?.snapshot?.holdings?.find(
      (h) => String(h.symbol ?? "").toUpperCase() === sym,
    ) ?? null;

  const intel = await loadSymbolIntel(sym, market, holding);
  const plan = getTossHoldingPlanSync(uid, sym);
  intel.aiReport = buildDeepAiReport({
    holding,
    industry: intel.industry,
    fundamentals: intel.fundamentals,
    financialAnalysis: intel.financialAnalysis,
    technical: intel.technical,
    plan,
  });

  return {
    ok: true,
    holding,
    plan,
    ...intel,
    updatedAtMs: Date.now(),
  };
}

/**
 * @param {string} userId
 */
export async function buildTossHoldingsManageBoardForUser(userId) {
  const uid = String(userId ?? "").trim();
  if (!uid) throw new Error("로그인이 필요합니다.");

  const meta = getCredentialMetaSync(uid, "toss");
  const cache = getTossLedgerSnapshotCacheSync(uid);
  const holdings = Array.isArray(cache?.snapshot?.holdings)
    ? cache.snapshot.holdings
    : [];
  const plans = listTossHoldingPlansSync(uid);

  const summaries = await Promise.all(
    holdings.map(async (h) => {
      const sym = String(h.symbol ?? "").trim().toUpperCase();
      const market = h.market === "us" ? "us" : "kr";
      let industry = null;
      let fundamentals = null;
      try {
        const metaMap = await fetchStockVaultMetaForItems([{ symbol: sym, market }]);
        industry = metaMap?.[sym]?.industry ?? null;
      } catch {
        industry = null;
      }
      try {
        fundamentals = await loadStockFundamentals(sym);
      } catch {
        fundamentals = null;
      }
      return {
        ...h,
        industry,
        per: fundamentals?.per ?? null,
        pbr: fundamentals?.pbr ?? null,
        roe: fundamentals?.roe ?? null,
        plan: plans[sym] ?? null,
      };
    }),
  );

  return {
    ok: true,
    ready: meta.ready,
    messageKo: meta.messageKo,
    holdings: summaries,
    plans,
    updatedAtMs: Date.now(),
  };
}

/**
 * @param {string} userId
 * @param {string} symbol
 * @param {object} body
 */
export function saveTossHoldingPlanForUser(userId, symbol, body) {
  const plan = upsertTossHoldingPlanSync(userId, symbol, body ?? {});
  return { ok: true, plan };
}

/**
 * @param {string} userId
 * @param {string} symbol
 * @param {"buy"|"sell"|"stop"} action
 * @param {object} [body]
 */
export async function executeTossHoldingPlanOrderForUser(userId, symbol, action, body = {}) {
  const uid = String(userId ?? "").trim();
  const sym = String(symbol ?? "").trim().toUpperCase();
  if (!uid) throw new Error("로그인이 필요합니다.");

  const plan = getTossHoldingPlanSync(uid, sym);
  const market = String(body.market ?? plan?.market ?? "kr").trim().toLowerCase();
  const mkt = market === "us" ? "us" : "kr";

  if (action === "buy") {
    const price = Number(body.price ?? plan?.targetBuyPrice);
    const amount =
      mkt === "us"
        ? Number(body.amount ?? plan?.targetBuyAmountUsd)
        : Number(body.amount ?? plan?.targetBuyAmountKrw);
    if (!Number.isFinite(price) || price <= 0) {
      throw new Error("목표 매수가를 설정하세요.");
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error("매수 금액을 설정하세요.");
    }
    const result = await placeManualTossOrderForUser(uid, {
      symbol: sym,
      market: mkt,
      side: "buy",
      orderType: "limit",
      amount,
      price,
    });
    if (!result.ok) throw new Error(result.error ?? "매수 주문 실패");
    return { ok: true, action: "buy", ...result };
  }

  if (action === "sell" || action === "stop") {
    const price = Number(
      body.price ?? (action === "stop" ? plan?.stopLossPrice : plan?.targetSellPrice),
    );
    const quantity = Number(body.quantity);
    if (!Number.isFinite(price) || price <= 0) {
      throw new Error(action === "stop" ? "손절가를 설정하세요." : "목표 매도가를 설정하세요.");
    }
    let qty = quantity;
    if (!Number.isFinite(qty) || qty <= 0) {
      const cache = getTossLedgerSnapshotCacheSync(uid);
      const h = cache?.snapshot?.holdings?.find(
        (row) => String(row.symbol ?? "").toUpperCase() === sym,
      );
      qty = Number(h?.quantity ?? 0);
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      throw new Error("매도 수량이 없습니다.");
    }
    const result = await placeManualTossOrderForUser(uid, {
      symbol: sym,
      market: mkt,
      side: "sell",
      orderType: "limit",
      quantity: qty,
      price,
    });
    if (!result.ok) throw new Error(result.error ?? "매도 주문 실패");
    return { ok: true, action, ...result };
  }

  throw new Error("지원하지 않는 주문 유형입니다.");
}
