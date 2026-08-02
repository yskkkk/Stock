/**
 * 토스 월별 비중 유지 매수 — 현금(국내=원화·미국=달러)을 현재 보유 비율로 배분
 */
import { getTossLedgerSnapshotCacheSync, refreshTossLedgerSnapshotForUserAsync } from "./live-trade-toss-ledger.js";
import { placeManualTossOrderForUser } from "./toss-trading-adapter.js";
import {
  getTossRebalanceScheduleSync,
  upsertTossRebalanceScheduleSync,
} from "./toss-rebalance-schedule-store.js";
import { liveTradeLogInfo, liveTradeLogWarn } from "./live-trade-log.js";
import { isMarketOpenBySchedule } from "./market-hours.js";
import { getKstParts, isKrBusinessDay } from "./kr-business-day.js";
import { rejectIfVirtualUserLiveOrder } from "./virtual-user-order-guard.js";

const MIN_BUY_KRW = 1_000;
const MIN_BUY_USD = 1;

const REGULAR_HOURS_HINT =
  "즉시 매수는 정규장에만 가능합니다 (국내 09:00–15:30 KST · 미국 09:30–16:00 ET). 시간외·애프터에서는 소수점 매수가 되지 않습니다.";

/**
 * 즉시 매수용 정규장 여부 (KR은 영업일도 확인)
 * @param {"kr"|"us"} market
 * @param {Date} [now]
 */
export function isRebalanceRegularSession(market, now = new Date()) {
  if (!isMarketOpenBySchedule(market, now)) return false;
  if (market === "kr") {
    return isKrBusinessDay(getKstParts(now).dateKey);
  }
  return true;
}

/**
 * @param {Array<"kr"|"us">} markets
 * @param {Date} [now]
 */
export function splitMarketsByRegularSession(markets, now = new Date()) {
  const open = [];
  const closed = [];
  for (const m of markets) {
    if (m !== "kr" && m !== "us") continue;
    if (isRebalanceRegularSession(m, now)) open.push(m);
    else closed.push(m);
  }
  return { open, closed };
}

/**
 * @param {number} [ms]
 */
export function kstYmd(ms = Date.now()) {
  return new Date(ms).toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
}

/**
 * @param {number} [ms]
 */
export function kstDayOfMonth(ms = Date.now()) {
  const d = Number(
    new Date(ms).toLocaleString("en-US", {
      timeZone: "Asia/Seoul",
      day: "numeric",
    }),
  );
  return Number.isFinite(d) ? d : 0;
}

/**
 * @param {object | null | undefined} snapshot
 * @param {"kr" | "us"} market
 */
function holdingsForMarket(snapshot, market) {
  const rows = Array.isArray(snapshot?.holdings) ? snapshot.holdings : [];
  return rows.filter((h) => {
    const m = String(h?.market ?? "").toLowerCase();
    if (m !== market) return false;
    const qty = Number(h?.quantity);
    return Number.isFinite(qty) && qty > 0;
  });
}

/**
 * @param {object} h
 * @param {"kr" | "us"} market
 */
function holdingNativeValue(h, market) {
  const mv = Number(h?.marketValue);
  if (Number.isFinite(mv) && mv > 0) return mv;
  const px = Number(h?.currentPrice);
  const qty = Number(h?.quantity);
  if (Number.isFinite(px) && px > 0 && Number.isFinite(qty) && qty > 0) {
    return px * qty;
  }
  return 0;
}

/**
 * @param {object | null | undefined} snapshot
 * @param {"kr" | "us"} market
 * @param {number} cashUsePct
 */
export function buildProportionalBuyPlan(snapshot, market, cashUsePct = 100) {
  const cashAll =
    market === "us"
      ? Number(snapshot?.cash?.usd)
      : Number(snapshot?.cash?.krw);
  const pct = Math.min(100, Math.max(1, Number(cashUsePct) || 100)) / 100;
  const cash =
    Number.isFinite(cashAll) && cashAll > 0 ? cashAll * pct : 0;
  const currency = market === "us" ? "USD" : "KRW";
  const minAmt = market === "us" ? MIN_BUY_USD : MIN_BUY_KRW;
  const holdings = holdingsForMarket(snapshot, market);
  const weighted = holdings
    .map((h) => ({
      symbol: String(h.symbol ?? "").trim().toUpperCase(),
      name: String(h.name ?? "").trim(),
      market,
      weight: holdingNativeValue(h, market),
    }))
    .filter((h) => h.symbol && h.weight > 0);

  const weightSum = weighted.reduce((s, h) => s + h.weight, 0);
  if (!(cash > 0) || !(weightSum > 0)) {
    return {
      market,
      currency,
      cashAvailable: Number.isFinite(cashAll) ? cashAll : 0,
      cashToSpend: cash,
      holdingsCount: weighted.length,
      orders: /** @type {Array<{ symbol: string; name: string; market: string; amount: number; weightPct: number }>} */ ([]),
    };
  }

  /** @type {Array<{ symbol: string; name: string; market: string; amount: number; weightPct: number }>} */
  const orders = [];
  let allocated = 0;
  for (let i = 0; i < weighted.length; i++) {
    const h = weighted[i];
    const isLast = i === weighted.length - 1;
    let amount = isLast
      ? Math.max(0, cash - allocated)
      : (cash * h.weight) / weightSum;
    if (market === "kr") amount = Math.floor(amount);
    else amount = Math.round(amount * 100) / 100;
    if (amount < minAmt) continue;
    allocated += amount;
    orders.push({
      symbol: h.symbol,
      name: h.name || h.symbol,
      market,
      amount,
      weightPct: (h.weight / weightSum) * 100,
    });
  }

  return {
    market,
    currency,
    cashAvailable: Number.isFinite(cashAll) ? cashAll : 0,
    cashToSpend: cash,
    holdingsCount: weighted.length,
    orders,
  };
}

/**
 * @param {string} userId
 * @param {{ markets?: string[]; cashUsePct?: number } | null} [schedule]
 * @param {{ forceRefresh?: boolean }} [opts]
 */
export async function previewTossRebalanceScheduleForUser(
  userId,
  schedule = null,
  opts = {},
) {
  const uid = String(userId ?? "").trim();
  const sched = schedule ?? getTossRebalanceScheduleSync(uid);
  const forceRefresh = Boolean(opts?.forceRefresh);
  let cache = getTossLedgerSnapshotCacheSync(uid);
  // GET 미리보기는 캐시 우선 — 계좌 탭 진입 시 토스 원장 전체 갱신을 막음
  if (forceRefresh || !cache?.snapshot) {
    try {
      await refreshTossLedgerSnapshotForUserAsync(uid);
    } catch {
      /* use cache */
    }
    cache = getTossLedgerSnapshotCacheSync(uid);
  }
  const snapshot = cache?.snapshot ?? null;
  const markets = (sched?.markets?.length ? sched.markets : ["kr", "us"]).filter(
    (m) => m === "kr" || m === "us",
  );
  const cashUsePct = sched?.cashUsePct ?? 100;
  const plans = markets.map((m) =>
    buildProportionalBuyPlan(snapshot, /** @type {"kr"|"us"} */ (m), cashUsePct),
  );
  const { open: regularOpenMarkets, closed: regularClosedMarkets } =
    splitMarketsByRegularSession(/** @type {Array<"kr"|"us">} */ (markets));
  return {
    ok: true,
    ready: Boolean(snapshot),
    schedule: sched,
    syncedAtMs: cache?.syncedAtMs ?? null,
    plans,
    regularOpen: {
      kr: isRebalanceRegularSession("kr"),
      us: isRebalanceRegularSession("us"),
    },
    regularOpenMarkets,
    regularClosedMarkets,
  };
}

/**
 * @param {string} userId
 * @param {{ dryRun?: boolean; force?: boolean }} [opts]
 */
export async function runTossRebalanceScheduleForUser(userId, opts = {}) {
  const uid = String(userId ?? "").trim();
  if (!uid) return { ok: false, error: "로그인이 필요합니다." };

  const dryRun = Boolean(opts.dryRun);
  if (!dryRun) {
    const blocked = rejectIfVirtualUserLiveOrder();
    if (blocked) return blocked;
  }
  const force = Boolean(opts.force);
  const schedule = getTossRebalanceScheduleSync(uid);
  if (!schedule?.enabled && !force) {
    return { ok: false, error: "스케줄이 비활성입니다." };
  }

  const today = kstYmd();
  const day = kstDayOfMonth();
  const dayOfMonth = schedule?.dayOfMonth ?? day;
  if (!force && day !== dayOfMonth) {
    return {
      ok: false,
      skipped: true,
      reason: "day_mismatch",
      today,
      day,
      dayOfMonth,
    };
  }
  if (!force && schedule?.lastRunYmd === today) {
    return {
      ok: false,
      skipped: true,
      reason: "already_run",
      today,
      lastRunYmd: schedule.lastRunYmd,
    };
  }

  const preview = await previewTossRebalanceScheduleForUser(uid, schedule, {
    forceRefresh: true,
  });
  if (!preview.ready) {
    const result = { ok: false, error: "계좌 스냅샷을 불러오지 못했습니다.", today };
    if (!dryRun) {
      upsertTossRebalanceScheduleSync(uid, {
        lastRunYmd: today,
        lastRunAtMs: Date.now(),
        lastResult: result,
      });
    }
    return result;
  }

  /** @type {Array<object>} */
  const placed = [];
  /** @type {Array<object>} */
  const errors = [];

  for (const plan of preview.plans) {
    for (const row of plan.orders) {
      if (dryRun) {
        placed.push({ ...row, dryRun: true });
        continue;
      }
      const res = await placeManualTossOrderForUser(uid, {
        symbol: row.symbol,
        market: row.market,
        side: "buy",
        orderType: "market",
        amount: row.amount,
      });
      if (res.ok) {
        placed.push({
          ...row,
          orderId: res.orderId ?? null,
          fillPrice: res.fillPrice ?? null,
        });
      } else {
        errors.push({
          ...row,
          error: res.error ?? "주문 실패",
        });
      }
    }
  }

  const result = {
    ok: errors.length === 0,
    dryRun,
    today,
    dayOfMonth,
    placed,
    errors,
    plans: preview.plans,
  };

  if (!dryRun) {
    upsertTossRebalanceScheduleSync(uid, {
      lastRunYmd: today,
      lastRunAtMs: Date.now(),
      lastResult: {
        ok: result.ok,
        placedCount: placed.length,
        errorCount: errors.length,
        errors: errors.slice(0, 20),
        placed: placed.slice(0, 40),
      },
    });
    liveTradeLogInfo(
      "[toss-rebalance]",
      `user=${uid} day=${dayOfMonth} placed=${placed.length} errors=${errors.length}`,
    );
    if (errors.length) {
      liveTradeLogWarn(
        "[toss-rebalance] errors",
        errors.map((e) => `${e.symbol}:${e.error}`).join(", "),
      );
    }
  }

  return result;
}

/**
 * 즉시 비중 유지 매수 — 스케줄 날짜·당일 실행 여부와 무관. lastRunYmd를 갱신하지 않음.
 * @param {string} userId
 * @param {{
 *   dryRun?: boolean;
 *   markets?: Array<"kr"|"us">;
 *   cashUsePct?: number;
 * }} [opts]
 */
export async function runTossProportionalBuyNowForUser(userId, opts = {}) {
  const dryRun = Boolean(opts.dryRun);
  if (!dryRun) {
    const blocked = rejectIfVirtualUserLiveOrder();
    if (blocked) return blocked;
  }
  const uid = String(userId ?? "").trim();
  if (!uid) return { ok: false, error: "로그인이 필요합니다." };

  const schedule = getTossRebalanceScheduleSync(uid);
  const marketsRaw = Array.isArray(opts.markets) ? opts.markets : schedule?.markets;
  const markets = (marketsRaw?.length ? marketsRaw : ["kr", "us"]).filter(
    (m) => m === "kr" || m === "us",
  );
  const cashUsePct =
    opts.cashUsePct != null
      ? Number(opts.cashUsePct)
      : (schedule?.cashUsePct ?? 100);

  const { open: openMarkets, closed: closedMarkets } =
    splitMarketsByRegularSession(/** @type {Array<"kr"|"us">} */ (markets));

  // 실주문은 정규장만 — 시간외·애프터는 소수점 매수 불가
  const marketsForRun = dryRun ? markets : openMarkets;
  if (!dryRun && marketsForRun.length === 0) {
    return {
      ok: false,
      error: REGULAR_HOURS_HINT,
      reason: "outside_regular_hours",
      closedMarkets,
      regularOpen: {
        kr: isRebalanceRegularSession("kr"),
        us: isRebalanceRegularSession("us"),
      },
    };
  }

  const preview = await previewTossRebalanceScheduleForUser(
    uid,
    {
      ...(schedule ?? {}),
      markets: marketsForRun,
      cashUsePct,
    },
    { forceRefresh: true },
  );
  if (!preview.ready) {
    return { ok: false, error: "계좌 스냅샷을 불러오지 못했습니다." };
  }

  /** @type {Array<object>} */
  const placed = [];
  /** @type {Array<object>} */
  const errors = [];

  for (const plan of preview.plans) {
    for (const row of plan.orders) {
      if (dryRun) {
        placed.push({ ...row, dryRun: true });
        continue;
      }
      const res = await placeManualTossOrderForUser(uid, {
        symbol: row.symbol,
        market: row.market,
        side: "buy",
        orderType: "market",
        amount: row.amount,
      });
      if (res.ok) {
        placed.push({
          ...row,
          orderId: res.orderId ?? null,
          fillPrice: res.fillPrice ?? null,
        });
      } else {
        errors.push({
          ...row,
          error: res.error ?? "주문 실패",
        });
      }
    }
  }

  const result = {
    ok: errors.length === 0,
    dryRun,
    immediate: true,
    placed,
    errors,
    plans: preview.plans,
    skippedMarkets: dryRun ? [] : closedMarkets,
    regularOpen: preview.regularOpen,
  };

  if (!dryRun && closedMarkets.length) {
    liveTradeLogInfo(
      "[toss-rebalance-now]",
      `skipped outside regular hours: ${closedMarkets.join(",")}`,
    );
  }

  if (!dryRun) {
    liveTradeLogInfo(
      "[toss-rebalance-now]",
      `user=${uid} markets=${marketsForRun.join("+")} cashUsePct=${cashUsePct} placed=${placed.length} errors=${errors.length}`,
    );
    if (errors.length) {
      liveTradeLogWarn(
        "[toss-rebalance-now] errors",
        errors.map((e) => `${e.symbol}:${e.error}`).join(", "),
      );
    }
  }

  return result;
}
