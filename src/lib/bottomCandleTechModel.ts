import type { TechModelRecord } from "../api";

export const BOTTOM_CANDLE_MODEL_ID = "bottom_candle";

export const BOTTOM_CANDLE_TECH_MODEL: TechModelRecord = {
  id: BOTTOM_CANDLE_MODEL_ID,
  name: "세력 바닥 캔들",
  weights: {},
  maxTechScore: 0,
  createdAtMs: 0,
  updatedAtMs: 0,
};

export function isBottomCandleModelId(modelId: string | null | undefined): boolean {
  return String(modelId ?? "").trim() === BOTTOM_CANDLE_MODEL_ID;
}

export function withBottomCandleTechModel(models: TechModelRecord[]): TechModelRecord[] {
  if (models.some((m) => m.id === BOTTOM_CANDLE_MODEL_ID)) return models;
  return [...models, BOTTOM_CANDLE_TECH_MODEL];
}
