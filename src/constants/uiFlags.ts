/**
 * @deprecated 런타임에는 useUiFeature() 사용. 기본값은 shared/ui-feature-catalog.js 와 동기화.
 */
import { uiFeatureDefaultEnabled } from "./uiFeatureDefaults";

export const SHOW_PROFIT_MODEL_BUTTON = uiFeatureDefaultEnabled("profitModelButton");
export const ENABLE_THEME_MODE_TOGGLE = uiFeatureDefaultEnabled("themeModeToggle");
export const SHOW_HOLDING_RATIONALE_ROW = uiFeatureDefaultEnabled("holdingRationaleRow");
