import type { TechModelRecord } from "../api";

/** @deprecated — 확인캔들 FSM 레거시 */
export const BOX_RANGE_MODEL_ID = "box-range";

export const BOX_RANGE_V2_MA_MODELS: readonly TechModelRecord[] = [
  {
    id: "box-range-v2-ma",
    name: "박스권 V2+MA (정배열·dipLow)",
    weights: {},
    maxTechScore: 0,
    createdAtMs: 0,
    updatedAtMs: 0,
  },
  {
    id: "box-range-v2-ma-relaxed",
    name: "박스권 V2+MA (5>20·dipLow)",
    weights: {},
    maxTechScore: 0,
    createdAtMs: 0,
    updatedAtMs: 0,
  },
  {
    id: "box-range-v2-ma-bottom-sl",
    name: "박스권 V2+MA (정배열·하단손절)",
    weights: {},
    maxTechScore: 0,
    createdAtMs: 0,
    updatedAtMs: 0,
  },
] as const;

export const BOX_RANGE_TECH_MODEL: TechModelRecord = {
  id: BOX_RANGE_MODEL_ID,
  name: "박스권 (1h·4h·일·확인캔들)",
  weights: {},
  maxTechScore: 0,
  createdAtMs: 0,
  updatedAtMs: 0,
};

const ALL_BOX_RANGE_MODELS: TechModelRecord[] = [
  BOX_RANGE_TECH_MODEL,
  ...BOX_RANGE_V2_MA_MODELS,
];

export function isBoxRangeModelId(modelId: string | null | undefined): boolean {
  const id = String(modelId ?? "").trim();
  return ALL_BOX_RANGE_MODELS.some((m) => m.id === id);
}

export function withBoxRangeTechModel(models: TechModelRecord[]): TechModelRecord[] {
  let out = [...models];
  for (const stub of ALL_BOX_RANGE_MODELS) {
    if (!out.some((m) => m.id === stub.id)) out = [...out, stub];
  }
  return out;
}
