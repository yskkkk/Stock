export const SYMBOL_NOT_FOUND = "SYMBOL_NOT_FOUND";

export function chartNotFoundError(symbol, description) {
  const err = new Error(description ?? `종목 데이터 없음: ${symbol}`);
  err.code = SYMBOL_NOT_FOUND;
  return err;
}

export function isSymbolNotFound(err) {
  return err?.code === SYMBOL_NOT_FOUND;
}
