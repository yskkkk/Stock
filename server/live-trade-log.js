/** 실매매·동기화 콘솔 로그 — KST 시각 접두 */
import { formatLogTimestampKst } from "./log-kst.js";

function prefix(tag) {
  return `[${formatLogTimestampKst()}] ${tag}`;
}

/** @param {string} tag */
export function liveTradeLogInfo(tag, ...args) {
  console.info(prefix(tag), ...args);
}

/** @param {string} tag */
export function liveTradeLogWarn(tag, ...args) {
  console.warn(prefix(tag), ...args);
}
