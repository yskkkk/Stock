/**
 * Yahoo quoteSummary — 주식 수량·보유 구조 (KR·US 공통 보조 소스)
 */

/** @param {unknown} v */
export function yahooNumField(v) {
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "object") {
    const raw = /** @type {{ raw?: unknown }} */ (v).raw;
    if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  }
  return null;
}

/**
 * @param {unknown} holders
 */
export function sumInsiderHolderShares(holders) {
  if (!Array.isArray(holders) || holders.length === 0) return null;
  let sum = 0;
  let has = false;
  for (const row of holders) {
    if (!row || typeof row !== "object") continue;
    const direct = yahooNumField(/** @type {{ positionDirect?: unknown }} */ (row).positionDirect);
    const indirect = yahooNumField(
      /** @type {{ positionIndirect?: unknown }} */ (row).positionIndirect,
    );
    if (direct != null) {
      sum += direct;
      has = true;
    }
    if (indirect != null) {
      sum += indirect;
      has = true;
    }
  }
  return has ? Math.round(sum) : null;
}

/**
 * @param {number | null} total
 * @param {number | null} floatShares
 * @param {number | null} floatPctHint
 */
export function deriveFloatPctFromShares(total, floatShares, floatPctHint) {
  if (total != null && floatShares != null && total > 0) {
    return (floatShares / total) * 100;
  }
  if (floatPctHint != null && Number.isFinite(floatPctHint)) return floatPctHint;
  return null;
}

/**
 * @param {number | null} total
 * @param {number | null} floatShares
 * @param {number | null} insiderShares
 */
export function deriveOtherNonFloatFromTotal(total, floatShares, insiderShares) {
  if (total == null || floatShares == null || total <= 0) return null;
  const accounted = floatShares + (insiderShares ?? 0);
  const other = Math.round(total - accounted);
  return other > 0 ? other : null;
}

/**
 * @param {unknown} resultRow quoteSummary.result[0]
 */
export function parseYahooShareStructure(resultRow) {
  const stats = /** @type {Record<string, unknown> | undefined} */ (
    resultRow?.defaultKeyStatistics
  );
  const breakdown = /** @type {Record<string, unknown> | undefined} */ (
    resultRow?.majorHoldersBreakdown
  );
  const holders = /** @type {{ holders?: unknown }} */ (
    resultRow?.insiderHolders
  )?.holders;

  const totalShares =
    yahooNumField(stats?.sharesOutstanding) ??
    yahooNumField(stats?.impliedSharesOutstanding);
  if (totalShares == null || totalShares <= 0) return null;

  const floatShares = yahooNumField(stats?.floatShares);
  const insiderPct = yahooNumField(stats?.heldPercentInsiders);
  const insiderFromPct =
    insiderPct != null && insiderPct >= 0 ? Math.round(totalShares * insiderPct) : null;
  const insiderFromList = sumInsiderHolderShares(holders);
  const majorShareholderShares =
    insiderFromPct != null && insiderFromList != null
      ? Math.max(insiderFromPct, insiderFromList)
      : insiderFromPct ?? insiderFromList;

  const instFloatPct =
    yahooNumField(breakdown?.institutionsFloatPercentHeld) ??
    yahooNumField(stats?.heldPercentInstitutions);
  const instTotalPct =
    yahooNumField(breakdown?.institutionsPercentHeld) ??
    yahooNumField(stats?.heldPercentInstitutions);

  let institutionalShares = null;
  if (floatShares != null && instFloatPct != null && instFloatPct > 0 && instFloatPct <= 1) {
    institutionalShares = Math.round(floatShares * instFloatPct);
  } else if (
    totalShares != null &&
    instTotalPct != null &&
    instTotalPct > 0 &&
    instTotalPct <= 1
  ) {
    institutionalShares = Math.round(totalShares * instTotalPct);
  }

  const sharesShort = yahooNumField(stats?.sharesShort);
  const shortPctOfFloat = yahooNumField(stats?.shortPercentOfFloat);
  const institutionCount = yahooNumField(breakdown?.institutionsCount);

  const institutionalTotalPct =
    instTotalPct != null && Number.isFinite(instTotalPct) ? instTotalPct * 100 : null;
  const institutionalFloatPct =
    instFloatPct != null && Number.isFinite(instFloatPct) ? instFloatPct * 100 : null;
  const shortPctDisplay =
    shortPctOfFloat != null && Number.isFinite(shortPctOfFloat)
      ? shortPctOfFloat * 100
      : null;

  const otherNonFloatShares = deriveOtherNonFloatFromTotal(
    totalShares,
    floatShares,
    majorShareholderShares,
  );

  return {
    totalShares,
    majorShareholderShares,
    institutionalShares,
    institutionalTotalPct,
    institutionalFloatPct,
    sharesShort,
    shortPctOfFloat: shortPctDisplay,
    institutionCount:
      institutionCount != null ? Math.round(institutionCount) : null,
    otherNonFloatShares,
    floatShares,
    floatPct: deriveFloatPctFromShares(totalShares, floatShares, null),
  };
}

export const YAHOO_SHARE_STRUCTURE_MODULES =
  "defaultKeyStatistics,majorHoldersBreakdown,insiderHolders";
