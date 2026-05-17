/**
 * Node 20 초반 등에서 `Symbol.dispose` / `Symbol.asyncDispose` 가 없으면
 * @cursor/sdk 스트림 종료 시 "Symbol.dispose is not defined" 형태의
 * unhandledRejection 이 날 수 있어, SDK 로드 전에 보조 심볼만 정의한다.
 */
const S = globalThis.Symbol;
if (S && typeof S.dispose !== "symbol") {
  try {
    Object.defineProperty(S, "dispose", {
      value: S("cursor.stock.dispose"),
      writable: false,
      enumerable: false,
      configurable: true,
    });
  } catch {
    /* 이미 정의됨 등 */
  }
}
if (S && typeof S.asyncDispose !== "symbol") {
  try {
    Object.defineProperty(S, "asyncDispose", {
      value: S("cursor.stock.asyncDispose"),
      writable: false,
      enumerable: false,
      configurable: true,
    });
  } catch {
    /* ignore */
  }
}
