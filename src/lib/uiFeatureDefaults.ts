import { UI_FEATURE_CATALOG } from "../../shared/ui-feature-catalog.js";

export type UiFeatureId = (typeof UI_FEATURE_CATALOG)[number]["id"];

export function uiFeatureDefaultEnabled(id: UiFeatureId): boolean {
  const row = UI_FEATURE_CATALOG.find((f) => f.id === id);
  return row?.defaultEnabled ?? false;
}

export function uiFeatureDefaultMap(): Record<UiFeatureId, boolean> {
  return Object.fromEntries(
    UI_FEATURE_CATALOG.map((f) => [f.id, f.defaultEnabled]),
  ) as Record<UiFeatureId, boolean>;
}
