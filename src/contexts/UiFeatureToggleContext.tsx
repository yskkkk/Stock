import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { fetchUiFeatures } from "../api";
import {
  uiFeatureDefaultMap,
  type UiFeatureId,
} from "../lib/uiFeatureDefaults";

export const UI_FEATURES_CHANGED_EVENT = "ystock-ui-features-changed";

export function dispatchUiFeaturesChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(UI_FEATURES_CHANGED_EVENT));
}

type UiFeatureToggleContextValue = {
  ready: boolean;
  isEnabled: (id: UiFeatureId) => boolean;
  refresh: () => Promise<void>;
};

const UiFeatureToggleContext = createContext<UiFeatureToggleContextValue | null>(
  null,
);

const POLL_MS = 20_000;

export function UiFeatureToggleProvider({ children }: { children: ReactNode }) {
  const [features, setFeatures] = useState<Record<UiFeatureId, boolean>>(
    () => uiFeatureDefaultMap(),
  );
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const data = await fetchUiFeatures();
      setFeatures((prev) => ({ ...prev, ...data.features }));
      setReady(true);
    } catch {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onChanged = () => void refresh();
    window.addEventListener(UI_FEATURES_CHANGED_EVENT, onChanged);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, POLL_MS);
    return () => {
      window.removeEventListener(UI_FEATURES_CHANGED_EVENT, onChanged);
      window.removeEventListener("focus", onFocus);
      window.clearInterval(id);
    };
  }, [refresh]);

  const value = useMemo<UiFeatureToggleContextValue>(
    () => ({
      ready,
      isEnabled: (id) => features[id] ?? uiFeatureDefaultMap()[id] ?? false,
      refresh,
    }),
    [features, ready, refresh],
  );

  return (
    <UiFeatureToggleContext.Provider value={value}>
      {children}
    </UiFeatureToggleContext.Provider>
  );
}

export function useUiFeatureToggle(): UiFeatureToggleContextValue {
  const ctx = useContext(UiFeatureToggleContext);
  if (!ctx) {
    throw new Error("useUiFeatureToggle must be used within UiFeatureToggleProvider");
  }
  return ctx;
}

export function useUiFeature(id: UiFeatureId): boolean {
  return useUiFeatureToggle().isEnabled(id);
}
