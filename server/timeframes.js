/** @typedef {'1m'|'5m'|'15m'|'1h'|'4h'|'1d'} ChartTimeframe */

/** @type {Record<ChartTimeframe, { label: string, interval: string, range?: string, days?: number, aggregate?: number, displayInterval: string }>} */
export const TIMEFRAME_MAP = {
  "1m": {
    label: "1분",
    interval: "1m",
    range: "7d",
    displayInterval: "1m",
  },
  "5m": {
    label: "5분",
    interval: "5m",
    days: 60,
    displayInterval: "5m",
  },
  "15m": {
    label: "15분",
    interval: "15m",
    days: 60,
    displayInterval: "15m",
  },
  "1h": {
    label: "1시간",
    interval: "60m",
    // Yahoo 60m: range must be strictly within last 730 days (730 fails)
    days: 729,
    displayInterval: "1h",
  },
  "4h": {
    label: "4시간",
    interval: "60m",
    days: 729,
    aggregate: 4,
    displayInterval: "4h",
  },
  "1d": {
    label: "일봉",
    interval: "1d",
    // Yahoo는 range=max + interval=1d 조합에서 1mo/3mo 등으로 자동 다운샘플링한다.
    // 표시(일봉)와 실제 봉 간격이 어긋나지 않도록 긴 고정 구간만 사용한다.
    range: "50y",
    displayInterval: "1d",
  },
};

export const TIMEFRAME_LIST = Object.entries(TIMEFRAME_MAP).map(
  ([value, cfg]) => ({
    value,
    label: cfg.label,
  }),
);
