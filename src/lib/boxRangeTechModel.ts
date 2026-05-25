import type { TechModelRecord } from "../api";

export const BOX_RANGE_MODEL_ID = "box-range";

export const BOX_RANGE_TECH_MODEL: TechModelRecord = {
  id: BOX_RANGE_MODEL_ID,
  name: "박스권 (1h·4h·일)",
  weights: {},
  maxTechScore: 0,
  createdAtMs: 0,
  updatedAtMs: 0,
};

export function withBoxRangeTechModel(models: TechModelRecord[]): TechModelRecord[] {
  if (models.some((m) => m.id === BOX_RANGE_MODEL_ID)) return models;
  return [...models, BOX_RANGE_TECH_MODEL];
}
