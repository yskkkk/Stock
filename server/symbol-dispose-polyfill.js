/**
 * Node 20 초반 등에서 `Symbol.dispose` / `Symbol.asyncDispose` 가 없으면
 * @cursor/sdk 스트림 종료 시 "Symbol.dispose is not defined" 형태의
 * unhandledRejection 이 날 수 있어, SDK 로드 전에 보조 심볼만 정의한다.
 *
 * 반대로 런타임에 심볼이 있으면 ReadableStream 어댑터 async iterator에
 * `[Symbol.asyncDispose]` 가 없을 때 "asyncDispose is not a function" 이
 * 날 수 있어 `cursor-ops-agent.js` 의 `asAsyncIterableStream` 에서 구현한다.
 */
const S = globalThis.Symbol;
/** well-known 심볼이 아직 없을 때만 보조 정의 (typeof !== "symbol" 은 잘못된 타입이 있을 때 오판 가능) */
if (S && typeof S.dispose === "undefined") {
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
if (S && typeof S.asyncDispose === "undefined") {
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
