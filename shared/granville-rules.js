/**
 * 그랜빌(Granville) 이동평균 8법칙 — 서버·클라이언트 공용 SSOT.
 * 매수 4 · 매도 4. 카드 요약 라벨과 말풍선 상세설명을 여기서 단일 정의한다.
 *
 * 표시 형식(예): "매수1 : 200선 전환 돌파"
 */

/** 기본 기준 이동평균 기간(일봉 200선) */
export const GRANVILLE_MA_PERIOD_DEFAULT = 200;

/** @typedef {"buy1"|"buy2"|"buy3"|"buy4"|"sell1"|"sell2"|"sell3"|"sell4"} GranvilleSignalId */
/** @typedef {"buy"|"sell"} GranvilleSide */

/**
 * @typedef {{
 *   id: GranvilleSignalId;
 *   side: GranvilleSide;
 *   num: 1|2|3|4;
 *   short: string;   // 카드 요약용 짧은 이름 (예: "전환 돌파")
 *   desc: string;    // 말풍선 상세 설명
 * }} GranvilleRule
 */

/** @type {GranvilleRule[]} */
export const GRANVILLE_RULES = [
  {
    id: "buy1",
    side: "buy",
    num: 1,
    short: "전환 돌파",
    desc: "이동평균선이 하락을 멈추고 횡보·상승으로 전환하는 국면에서 주가가 이평선을 아래에서 위로 상향 돌파. 추세 전환을 알리는 대표적 매수 신호.",
  },
  {
    id: "buy2",
    side: "buy",
    num: 2,
    short: "눌림목 지지",
    desc: "상승 중인 이동평균선 위에서 주가가 이평선 부근까지 눌렸다가, 이평선을 이탈하지 않고 다시 반등. 상승추세 지속 중의 눌림목 매수.",
  },
  {
    id: "buy3",
    side: "buy",
    num: 3,
    short: "지지 반등",
    desc: "상승 중인 이동평균선을 주가가 잠시 아래로 이탈했으나 곧바로 회복하며 이평선 위로 되돌아오는 자리. 지지 확인 후 매수.",
  },
  {
    id: "buy4",
    side: "buy",
    num: 4,
    short: "이격 반등",
    desc: "하락 중인 이동평균선에서 주가가 아래로 크게 벌어진(과대 이격) 뒤 나타나는 기술적 반등. 단기 저점 매수(리스크 큼).",
  },
  {
    id: "sell1",
    side: "sell",
    num: 1,
    short: "전환 이탈",
    desc: "이동평균선이 상승을 멈추고 횡보·하락으로 전환하는 국면에서 주가가 이평선을 위에서 아래로 하향 이탈. 추세 전환을 알리는 대표적 매도 신호.",
  },
  {
    id: "sell2",
    side: "sell",
    num: 2,
    short: "반등 실패",
    desc: "하락 중인 이동평균선 아래에서 주가가 이평선 부근까지 반등했으나 넘지 못하고 다시 하락. 하락추세 지속 중의 매도.",
  },
  {
    id: "sell3",
    side: "sell",
    num: 3,
    short: "일시 돌파",
    desc: "하락 중인 이동평균선을 주가가 잠시 위로 돌파했으나 안착하지 못하고 곧바로 되밀리는 자리. 반등 소진 후 매도.",
  },
  {
    id: "sell4",
    side: "sell",
    num: 4,
    short: "이격 조정",
    desc: "상승 중인 이동평균선에서 주가가 위로 크게 벌어진(과대 이격) 뒤 나타나는 단기 조정. 차익 실현 매도.",
  },
];

const BY_ID = /** @type {Record<GranvilleSignalId, GranvilleRule>} */ (
  Object.fromEntries(GRANVILLE_RULES.map((r) => [r.id, r]))
);

/** @param {string|null|undefined} id @returns {GranvilleRule|null} */
export function getGranvilleRule(id) {
  if (!id) return null;
  return BY_ID[/** @type {GranvilleSignalId} */ (id)] ?? null;
}

/** @param {GranvilleSide} side */
export function granvilleSideLabel(side) {
  return side === "buy" ? "매수" : "매도";
}

/**
 * 카드 요약 라벨 — 예: "매수1 : 200선 전환 돌파"
 * @param {string|null|undefined} id
 * @param {number} [maPeriod]
 */
export function granvilleSummaryLabel(id, maPeriod = GRANVILLE_MA_PERIOD_DEFAULT) {
  const rule = getGranvilleRule(id);
  if (!rule) return "";
  const period = Number.isFinite(maPeriod) && maPeriod > 0 ? maPeriod : GRANVILLE_MA_PERIOD_DEFAULT;
  return `${granvilleSideLabel(rule.side)}${rule.num} : ${period}선 ${rule.short}`;
}

/**
 * 말풍선 상세 설명 — 요약 라벨 + 상세 문장
 * @param {string|null|undefined} id
 * @param {number} [maPeriod]
 */
export function granvilleDescription(id, maPeriod = GRANVILLE_MA_PERIOD_DEFAULT) {
  const rule = getGranvilleRule(id);
  if (!rule) return "";
  return rule.desc;
}
