import {
  isStockChartUnavailableError,
  stockChartUnavailableReason,
} from "./errors.js";
import { liveTradeLogInfo, liveTradeLogWarn } from "./live-trade-log.js";

/**
 * vault 스캔 loadStock 실패 — 상장폐지·차트 없음은 skip(info), 그 외 warn
 * @param {string} tag 예: book-accum, golden-cross
 * @param {string} sym
 * @param {string} [tf]
 * @param {unknown} err
 */
export function logVaultScanLoadFailure(tag, sym, tf, err) {
  if (isStockChartUnavailableError(err)) {
    const reason = stockChartUnavailableReason(err);
    if (tf != null && String(tf).length) {
      liveTradeLogInfo(`[${tag}:scan] skip`, sym, tf, reason);
    } else {
      liveTradeLogInfo(`[${tag}:scan] skip`, sym, reason);
    }
    return;
  }
  const msg = err instanceof Error ? err.message : err;
  if (tf != null && String(tf).length) {
    liveTradeLogWarn(`[${tag}:scan]`, sym, tf, msg);
  } else {
    liveTradeLogWarn(`[${tag}:scan]`, sym, msg);
  }
}

/**
 * @param {string} tag
 * @param {string} sym
 * @param {string} [tf]
 * @param {unknown} err
 * @returns {{ ok: true; hit: null } | { ok: false; hit: null }}
 */
export function finishVaultScanSymbolOnLoadError(tag, sym, tf, err) {
  logVaultScanLoadFailure(tag, sym, tf, err);
  return isStockChartUnavailableError(err)
    ? { ok: true, hit: null }
    : { ok: false, hit: null };
}
