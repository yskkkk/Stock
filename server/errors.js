export const SYMBOL_NOT_FOUND = "SYMBOL_NOT_FOUND";

export function chartNotFoundError(symbol, description) {
  const desc = String(description ?? "").trim();
  const msg = desc || `종목 데이터 없음: ${symbol}`;
  const err = new Error(msg);
  err.code = SYMBOL_NOT_FOUND;
  return err;
}

export function isSymbolNotFound(err) {
  return err?.code === SYMBOL_NOT_FOUND;
}

/** @param {unknown} err */
function stockErrorMessage(err) {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && "message" in err) {
    return String(/** @type {{ message?: unknown }} */ (err).message ?? "");
  }
  return String(err ?? "");
}

/** Yahoo·빗썸 차트 없음·상장폐지 — 스캔 skip 대상 */
export function isStockChartUnavailableError(err) {
  if (isSymbolNotFound(err)) return true;
  const msg = stockErrorMessage(err).toLowerCase();
  return (
    /no data found|symbol may be delisted|delisted/.test(msg) ||
    (/종목 데이터/.test(msg) &&
      /delisted|no data found|not found|없습니다|없음/.test(msg))
  );
}

/** @param {unknown} err */
export function stockChartUnavailableReason(err) {
  const msg = stockErrorMessage(err).toLowerCase();
  if (/delisted/.test(msg)) return "delisted";
  if (/no data found|not found|없음|없습니다/.test(msg)) return "no_chart";
  return "no_chart";
}

/** API·UI용 짧은 메시지 */
export function stockChartUnavailableUserMessage(symbol) {
  const sym = String(symbol ?? "").trim().toUpperCase();
  return sym
    ? `${sym} — 상장폐지되었거나 차트 데이터가 없습니다.`
    : "상장폐지되었거나 차트 데이터가 없는 종목입니다.";
}
