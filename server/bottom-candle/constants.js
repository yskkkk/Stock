/** 매매기법 선택 UI — 가상 tech model stub */

export const BOTTOM_CANDLE_MODEL_ID = "bottom_candle";

/** @returns {{ id: string; name: string; weights: Record<string, never>; createdAtMs: number; updatedAtMs: number }} */
export function getBottomCandleTechModelStub() {
  return {
    id: BOTTOM_CANDLE_MODEL_ID,
    name: "세력 바닥 캔들",
    weights: {},
    createdAtMs: 0,
    updatedAtMs: 0,
  };
}
