/**
 * 버핏식 미래 EPS 할인 — 순수 계산 (외부 API 없음)
 */

/** @param {number} eps @param {number} discountRate */
export function calcSimpleFairPrice(eps, discountRate) {
  if (!Number.isFinite(eps) || eps <= 0) return null;
  if (!Number.isFinite(discountRate) || discountRate <= 0) return null;
  return eps / discountRate;
}

/**
 * @param {number} eps0
 * @param {number} growthRate
 * @param {number} years
 * @param {number} discountRate
 */
export function calcExplicitPhasePv(eps0, growthRate, years, discountRate) {
  if (!Number.isFinite(eps0) || eps0 <= 0) return null;
  if (!Number.isFinite(discountRate) || discountRate <= 0) return null;
  const g = Number.isFinite(growthRate) ? growthRate : 0;
  const n = Math.max(1, Math.min(30, Math.floor(years)));

  /** @type {{ year: number; eps: number; pv: number }[]} */
  const yearly = [];
  let totalPv = 0;
  let eps = eps0;

  for (let t = 1; t <= n; t++) {
    eps = t === 1 ? eps0 * (1 + g) : eps * (1 + g);
    const pv = eps / (1 + discountRate) ** t;
    yearly.push({ year: t, eps, pv });
    totalPv += pv;
  }

  return { yearly, totalPv, epsAtEnd: eps };
}

/**
 * @param {number} epsAtEnd N년차 EPS
 * @param {number} growthTerminal
 * @param {number} years
 * @param {number} discountRate
 */
export function calcTerminalPv(epsAtEnd, growthTerminal, years, discountRate) {
  if (!Number.isFinite(epsAtEnd) || epsAtEnd <= 0) return null;
  if (!Number.isFinite(discountRate) || discountRate <= 0) return null;
  const g = Number.isFinite(growthTerminal) ? growthTerminal : 0;
  const gap = discountRate - g;
  if (gap <= 0.005) return null;

  const epsNext = epsAtEnd * (1 + g);
  const terminal = epsNext / gap;
  const pv = terminal / (1 + discountRate) ** years;
  return { terminal, pv, epsNext, gapWarning: gap < 0.03 };
}

/**
 * @param {{
 *   eps0: number;
 *   growth10y: number;
 *   growthTerminal?: number | null;
 *   years?: number;
 *   discountRate: number;
 *   debtPerShare?: number | null;
 * }} input
 */
export function calcFullIntrinsic(input) {
  const years = input.years ?? 10;
  const explicit = calcExplicitPhasePv(
    input.eps0,
    input.growth10y,
    years,
    input.discountRate,
  );
  if (!explicit) return null;

  let terminalPv = null;
  let terminalDetail = null;
  if (input.growthTerminal != null && Number.isFinite(input.growthTerminal)) {
    terminalDetail = calcTerminalPv(
      explicit.epsAtEnd,
      input.growthTerminal,
      years,
      input.discountRate,
    );
    terminalPv = terminalDetail?.pv ?? null;
  }

  const debt = Number.isFinite(input.debtPerShare) ? input.debtPerShare : 0;
  const intrinsic =
    explicit.totalPv + (terminalPv ?? 0) - Math.max(0, debt);

  return {
    explicitPv: explicit.totalPv,
    terminalPv,
    terminalDetail,
    yearly: explicit.yearly,
    intrinsicPerShare: intrinsic > 0 ? intrinsic : null,
  };
}

/** @param {number} eps @param {number} price */
export function calcImpliedYield(eps, price) {
  if (!Number.isFinite(eps) || eps <= 0) return null;
  if (!Number.isFinite(price) || price <= 0) return null;
  return eps / price;
}

/** @param {number} intrinsic @param {number} margin */
export function calcMarginOfSafetyPrice(intrinsic, margin = 0.25) {
  if (!Number.isFinite(intrinsic) || intrinsic <= 0) return null;
  const m = Number.isFinite(margin) ? Math.max(0, Math.min(0.5, margin)) : 0.25;
  return intrinsic * (1 - m);
}

/** @param {number[]} epsValues */
export function calcEpsVolatility(epsValues) {
  const vals = epsValues.filter((v) => Number.isFinite(v) && v > 0);
  if (vals.length < 3) return null;
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  if (mean <= 0) return null;
  const variance =
    vals.reduce((acc, v) => acc + (v - mean) ** 2, 0) / vals.length;
  const cv = Math.sqrt(variance) / mean;
  return Number.isFinite(cv) ? cv : null;
}
