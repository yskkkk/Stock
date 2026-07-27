/**
 * 가상 사용자 세션 — 실주문(돈이 나가는 API) 이중 차단
 * 1) AsyncLocalStorage / X-Virtual-User 헤더
 * 2) Playwright route abort
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AsyncLocalStorage } from "async_hooks";

/** @type {AsyncLocalStorage<{ active: boolean }>} */
export const virtualUserAls = new AsyncLocalStorage();

export function isVirtualUserRequestActive() {
  return Boolean(virtualUserAls.getStore()?.active);
}

/**
 * Express: 가상 사용자 브라우저가 붙인 헤더를 ALS에 올림
 * @param {import("express").Request} req
 * @param {import("express").Response} _res
 * @param {import("express").NextFunction} next
 */
export function virtualUserRequestMiddleware(req, _res, next) {
  const hdr = String(req.get("x-virtual-user") ?? "")
    .trim()
    .toLowerCase();
  if (hdr === "1" || hdr === "true" || hdr === "yes") {
    virtualUserAls.run({ active: true }, () => next());
    return;
  }
  next();
}

/** 실주문·체결로 이어질 수 있는 API (브라우저 route 차단용) */
export const VIRTUAL_USER_BLOCKED_ORDER_PATHS = [
  /\/api\/live-trading\/toss\/rebalance-now(?:\?|$)/i,
  /\/api\/live-trading\/toss\/rebalance-schedule\/run(?:\?|$)/i,
  /\/api\/live-trading\/toss\/holdings\/[^/]+\/execute(?:\?|$)/i,
  /\/api\/live-trading\/toss\/.*order/i,
  /\/api\/live-trading\/bithumb\/.*order/i,
  /\/api\/live-trading\/.*\/place/i,
  /\/api\/toss\/.*order/i,
];

/** 서버 주문 어댑터 — rejectIfVirtualUserLiveOrder 호출 필수(정적 프로브) */
export const LIVE_ORDER_GUARD_ENTRYPOINTS = [
  { file: "toss-trading-adapter.js", fn: "placeManualTossOrderForUser" },
  { file: "toss-trading-adapter.js", fn: "executeLiveBuyOrder" },
  { file: "toss-trading-adapter.js", fn: "executeLiveSellOrder" },
  { file: "bithumb-trading-adapter.js", fn: "executeBithumbLiveBuyOrder" },
  { file: "bithumb-trading-adapter.js", fn: "executeBithumbLiveSellOrder" },
  { file: "bithumb-trading-adapter.js", fn: "executeBithumbMarketBuyKrw" },
  { file: "bithumb-trading-adapter.js", fn: "executeBithumbMarketBuyVolume" },
  { file: "toss-rebalance-schedule.js", fn: "runTossProportionalBuyNowForUser" },
  { file: "toss-rebalance-schedule.js", fn: "runTossRebalanceScheduleForUser" },
];

/**
 * @param {string} url
 * @param {string} [method]
 * @param {string} [postBody]
 */
export function shouldBlockVirtualUserMoneyRequest(url, method = "GET", postBody = "") {
  const u = String(url ?? "");
  const m = String(method ?? "GET").toUpperCase();
  if (m === "GET" || m === "HEAD" || m === "OPTIONS") return false;

  // dry-run 미리보기는 허용
  if (/\/rebalance-now/i.test(u) || /\/rebalance-schedule\/run/i.test(u)) {
    try {
      const body = postBody ? JSON.parse(postBody) : {};
      if (body && body.dryRun === true) return false;
    } catch {
      /* treat as block */
    }
    return true;
  }

  return VIRTUAL_USER_BLOCKED_ORDER_PATHS.some((re) => re.test(u));
}

/**
 * 정적 프로브 — 실주문 진입점에 ALS 가드가 빠졌는지 확인
 * @param {string} [serverDir]
 * @returns {string[]} 누락된 "file::fn" 목록
 */
export function findLiveOrderGuardGaps(serverDir) {
  const root = serverDir ?? path.dirname(fileURLToPath(import.meta.url));
  /** @type {string[]} */
  const gaps = [];
  for (const { file, fn } of LIVE_ORDER_GUARD_ENTRYPOINTS) {
    const fp = path.join(root, file);
    if (!fs.existsSync(fp)) {
      gaps.push(`${file}::${fn}`);
      continue;
    }
    const src = fs.readFileSync(fp, "utf8");
    const fnRe = new RegExp(
      `(?:export\\s+async\\s+function|async\\s+function|export\\s+function)\\s+${fn}\\s*\\(`,
    );
    const m = fnRe.exec(src);
    if (!m || m.index == null) {
      gaps.push(`${file}::${fn}`);
      continue;
    }
    const chunk = src.slice(m.index, m.index + 900);
    if (!chunk.includes("rejectIfVirtualUserLiveOrder")) {
      gaps.push(`${file}::${fn}`);
    }
  }
  return gaps;
}

/**
 * 서버 주문 어댑터에서 호출 — 가상 사용자면 무조건 거절
 * @returns {{ ok: false; error: string; blocked: true } | null}
 */
export function rejectIfVirtualUserLiveOrder() {
  if (!isVirtualUserRequestActive()) return null;
  return {
    ok: false,
    blocked: true,
    error:
      "가상 사용자 세션에서는 실주문이 차단됩니다. (돈이 나가는 주문은 수행하지 않습니다)",
  };
}
