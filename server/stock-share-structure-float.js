/**
 * KR 유동주식 수·비율 — KRX(지수산정주식수) 기준, 비유동 구성요소 합산
 */

/** @param {number | null | undefined} v */
function posNum(v) {
  return v != null && Number.isFinite(v) && v > 0 ? v : null;
}

/**
 * FnGuide 발행주식수 파싱 오류 보정 — 유동주식수를 발행주식수로 잡은 경우·Naver 시총/종가 교차검증
 * @param {{
 *   totalShares?: number | null;
 *   publishedFloatShares?: number | null;
 *   publishedFloatPct?: number | null;
 * }} input
 * @param {number | null} [naverListed]
 */
export function reconcileKrIssuedShares(input, naverListed = null) {
  let totalShares = posNum(input.totalShares);
  const publishedFloat = posNum(input.publishedFloatShares);
  let publishedFloatPct =
    input.publishedFloatPct != null && Number.isFinite(input.publishedFloatPct)
      ? input.publishedFloatPct
      : null;
  if (!isPlausibleKrFloatPct(publishedFloatPct)) {
    publishedFloatPct = null;
  }

  if (totalShares != null && publishedFloat != null) {
    const ratio = totalShares / publishedFloat;
    if (ratio > 0.9 && ratio < 1.1) {
      if (naverListed != null) totalShares = naverListed;
      else if (publishedFloatPct != null) {
        totalShares = deriveIndexAdjustmentShares(
          publishedFloat,
          publishedFloatPct,
          null,
        );
      }
    }
  }

  if (
    totalShares != null &&
    publishedFloat != null &&
    totalShares < publishedFloat
  ) {
    if (naverListed != null) totalShares = naverListed;
    else if (publishedFloatPct != null) {
      totalShares = deriveIndexAdjustmentShares(
        publishedFloat,
        publishedFloatPct,
        null,
      );
    }
  }

  if (naverListed != null && totalShares != null) {
    const gap = Math.abs(totalShares - naverListed) / naverListed;
    if (gap > 0.12) totalShares = naverListed;
  }

  return {
    ...input,
    totalShares,
    publishedFloatPct,
  };
}

/**
 * @param {number | null | undefined} total
 * @param {number | null | undefined} floatShares
 */
export function isSuspiciousKrShareTotals(total, floatShares) {
  const totalN = posNum(total);
  const floatN = posNum(floatShares);
  if (totalN == null || floatN == null) return false;
  if (totalN < floatN) return true;
  if (Math.abs(totalN - floatN) / floatN < 0.05) return true;
  if (totalN / floatN > 2.5) return true;
  return false;
}

/** @param {Array<number | null | undefined>} vals */
function sumPos(vals) {
  let sum = 0;
  let has = false;
  for (const v of vals) {
    const n = posNum(v);
    if (n != null) {
      sum += n;
      has = true;
    }
  }
  return has ? sum : null;
}

/**
 * @param {number | null} publishedFloat
 * @param {number | null} publishedFloatPct
 * @param {number | null} totalShares
 */
export function isPlausibleKrFloatPct(publishedFloatPct) {
  return (
    publishedFloatPct != null &&
    Number.isFinite(publishedFloatPct) &&
    publishedFloatPct >= 25 &&
    publishedFloatPct <= 95
  );
}

/**
 * @param {number | null} publishedFloat
 * @param {number | null} publishedFloatPct
 * @param {number | null} totalShares
 */
export function deriveIndexAdjustmentShares(
  publishedFloat,
  publishedFloatPct,
  totalShares,
) {
  if (
    publishedFloat != null &&
    isPlausibleKrFloatPct(publishedFloatPct)
  ) {
    return Math.round(publishedFloat / (publishedFloatPct / 100));
  }
  return totalShares;
}

const STRATEGIC_REPORT_RE =
  /전략|경영|지배|사업\s*협력|협력|참여|인수|합병|M&A|경쟁력/i;
const FI_ONLY_REPORT_RE = /단순\s*투자|재무적\s*투자|수익\s*추구|투자\s*목적.*이익/i;

/**
 * DART 대량보유 상황보고 — 전략적 투자자(SI) 추정 합계
 * @param {unknown} majorstockList
 */
export function sumStrategicInvestorSharesFromDart(majorstockList) {
  if (!Array.isArray(majorstockList) || majorstockList.length === 0) return null;

  /** @type {Map<string, { dt: string; shares: number }>} */
  const latestByReporter = new Map();

  for (const row of majorstockList) {
    if (!row || typeof row !== "object") continue;
    const reporter = String(/** @type {{ repror?: string }} */ (row).repror ?? "").trim();
    if (!reporter) continue;
    const reportText = `${/** @type {{ report_tp?: string; report_resn?: string }} */ (row).report_tp ?? ""} ${/** @type {{ report_resn?: string }} */ (row).report_resn ?? ""}`;
    if (FI_ONLY_REPORT_RE.test(reportText) && !STRATEGIC_REPORT_RE.test(reportText)) {
      continue;
    }
    if (!STRATEGIC_REPORT_RE.test(reportText)) continue;

    const rawQty = String(
      /** @type {{ stkqy?: string | number }} */ (row).stkqy ?? "",
    ).replace(/,/g, "");
    const shares = Number(rawQty);
    if (!Number.isFinite(shares) || shares <= 0) continue;

    const dt = String(/** @type {{ rcept_dt?: string }} */ (row).rcept_dt ?? "");
    const prev = latestByReporter.get(reporter);
    if (!prev || dt >= prev.dt) {
      latestByReporter.set(reporter, { dt, shares });
    }
  }

  let total = 0;
  for (const v of latestByReporter.values()) total += v.shares;
  return total > 0 ? Math.round(total) : null;
}

/**
 * @param {string} html
 * @param {string} needle
 */
export function parseFnGuideTitledShareRow(html, needle) {
  const esc = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `title="[^"]*${esc}[^"]*"[^>]*>[\\s\\S]*?<td class="r">[^<]*<\\/td>\\s*<td class="r">([\\d,]+)<\\/td>`,
    "i",
  );
  const m = html.match(re);
  if (!m) return null;
  const n = Number(String(m[1]).replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * @param {string} html
 * @param {string} label
 */
export function parseFnGuideLabelShareRow(html, label) {
  const titled = parseFnGuideTitledShareRow(html, label);
  if (titled != null) return titled;
  const esc = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `<div>${esc}<\\/div><\\/th>\\s*<td class="r">([\\d,]+)<\\/td>`,
    "i",
  );
  const m = html.match(re);
  if (!m) return null;
  const n = Number(String(m[1]).replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * @param {{
 *   totalShares?: number | null;
 *   publishedFloatShares?: number | null;
 *   publishedFloatPct?: number | null;
 *   majorShareholderShares?: number | null;
 *   treasuryShares?: number | null;
 *   employeeStockShares?: number | null;
 *   lockupShares?: number | null;
 *   governmentShares?: number | null;
 *   overseasDrShares?: number | null;
 *   strategicInvestorShares?: number | null;
 * }} input
 */
export function finalizeKrFloatShares(input) {
  const reconciled = reconcileKrIssuedShares(input);
  const totalShares = posNum(reconciled.totalShares);
  const publishedFloat = posNum(reconciled.publishedFloatShares);
  const publishedFloatPct = isPlausibleKrFloatPct(reconciled.publishedFloatPct)
    ? reconciled.publishedFloatPct
    : null;

  const indexAdjustmentShares = deriveIndexAdjustmentShares(
    publishedFloat,
    publishedFloatPct,
    totalShares,
  );

  const majorShareholderShares = posNum(input.majorShareholderShares);
  const treasuryShares = posNum(input.treasuryShares);
  const employeeStockShares = posNum(input.employeeStockShares);
  const lockupShares = posNum(input.lockupShares);
  const governmentShares = posNum(input.governmentShares);
  const overseasDrShares = posNum(input.overseasDrShares);
  const strategicInvestorShares = posNum(input.strategicInvestorShares);

  const nonFloatSum = sumPos([
    majorShareholderShares,
    treasuryShares,
    employeeStockShares,
    lockupShares,
    governmentShares,
    overseasDrShares,
    strategicInvestorShares,
  ]);

  const nonFloatCount = [
    majorShareholderShares,
    treasuryShares,
    employeeStockShares,
    lockupShares,
    governmentShares,
    overseasDrShares,
    strategicInvestorShares,
  ].filter((v) => v != null).length;

  let floatShares = null;
  let floatPct = null;
  let otherNonFloatShares = null;

  const indexBase = indexAdjustmentShares ?? totalShares;

  if (indexBase != null && indexBase > 0 && nonFloatSum != null && nonFloatCount >= 2) {
    const computed = Math.max(0, Math.round(indexBase - nonFloatSum));
    if (publishedFloat != null) {
      const gap = Math.abs(computed - publishedFloat) / indexBase;
      floatShares = gap <= 0.03 ? computed : publishedFloat;
    } else {
      floatShares = computed;
    }
  } else if (publishedFloat != null) {
    floatShares = publishedFloat;
  }

  if (floatShares != null && indexBase != null && indexBase > 0) {
    floatPct =
      publishedFloat != null &&
      floatShares === publishedFloat &&
      publishedFloatPct != null
        ? publishedFloatPct
        : (floatShares / indexBase) * 100;
  }

  if (indexBase != null && floatShares != null && nonFloatSum != null) {
    otherNonFloatShares = Math.max(0, Math.round(indexBase - floatShares - nonFloatSum));
  }

  return {
    totalShares,
    indexAdjustmentShares: indexBase,
    majorShareholderShares,
    treasuryShares,
    employeeStockShares,
    lockupShares,
    governmentShares,
    overseasDrShares,
    strategicInvestorShares,
    otherNonFloatShares:
      otherNonFloatShares != null && otherNonFloatShares > 0
        ? otherNonFloatShares
        : null,
    floatShares,
    floatPct,
  };
}
