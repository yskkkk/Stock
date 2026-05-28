/**
 * 박스권 PRO V2 + 일봉 MA — TradingView `pine-box-range-pro-v2-ma-strategy.pine` SSOT
 * @see scripts/pine-box-range-pro-v2-ma-strategy.pine
 */

/** @typedef {"dipLow"|"bottom"} BoxRangeV2MaStopMode */

/**
 * @typedef {{
 *   id: string;
 *   name: string;
 *   maStrict: boolean;
 *   stopMode: BoxRangeV2MaStopMode;
 *   partialTpPct: number;
 *   trailPct: number;
 * }} BoxRangeV2MaProfile
 */

/** @type {readonly BoxRangeV2MaProfile[]} */
export const BOX_RANGE_V2_MA_PROFILES = [
  {
    id: "box-range-v2-ma",
    name: "박스권 V2+MA (정배열·dipLow)",
    maStrict: true,
    stopMode: "dipLow",
    partialTpPct: 50,
    trailPct: 2,
  },
  {
    id: "box-range-v2-ma-relaxed",
    name: "박스권 V2+MA (5>20·dipLow)",
    // @see scripts/pine-box-range-pro-v2-ma-strategy-relaxed.pine
    maStrict: false,
    stopMode: "dipLow",
    partialTpPct: 50,
    trailPct: 2,
  },
  {
    id: "box-range-v2-ma-bottom-sl",
    name: "박스권 V2+MA (정배열·하단손절)",
    maStrict: true,
    stopMode: "bottom",
    partialTpPct: 50,
    trailPct: 2,
  },
];

/** @deprecated — 기존 프로그램 호환 */
export const BOX_RANGE_LEGACY_MODEL_ID = "box-range";

const PROFILE_BY_ID = new Map(
  BOX_RANGE_V2_MA_PROFILES.map((p) => [p.id, p]),
);

/** @param {string} [modelId] */
export function getBoxRangeV2MaProfile(modelId) {
  const id = String(modelId ?? "").trim();
  return PROFILE_BY_ID.get(id) ?? null;
}

/** @param {string} [modelId] */
export function isBoxRangeV2MaModelId(modelId) {
  return getBoxRangeV2MaProfile(modelId) != null;
}

/** @param {{ modelId?: string } | null | undefined} program */
export function isBoxRangeV2MaProgram(program) {
  return isBoxRangeV2MaModelId(program?.modelId);
}

/** @param {string} [modelId] */
export function isAnyBoxRangeModelId(modelId) {
  const id = String(modelId ?? "").trim();
  return (
    id === BOX_RANGE_LEGACY_MODEL_ID || isBoxRangeV2MaModelId(id)
  );
}

/** @param {{ modelId?: string } | null | undefined} program */
export function isAnyBoxRangeProgram(program) {
  return isAnyBoxRangeModelId(program?.modelId);
}

/** @param {BoxRangeV2MaProfile} profile */
export function boxRangeV2MaTechModelStub(profile) {
  const now = Date.now();
  return {
    id: profile.id,
    name: profile.name,
    weights: {},
    createdAtMs: now,
    updatedAtMs: now,
  };
}

export function listBoxRangeV2MaTechModelStubs() {
  return BOX_RANGE_V2_MA_PROFILES.map(boxRangeV2MaTechModelStub);
}
