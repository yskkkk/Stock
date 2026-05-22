import { useCallback, useEffect, useState } from "react";
import { fetchConfig } from "../api";
import { ko } from "../i18n/ko";
import {
  ensureMobileApiBase,
  getApiBaseUrl,
  hasMobileApiBaseConfigured,
  normalizeMobileApiBaseInput,
  persistMobileApiBase,
} from "../lib/apiBase";
import { useMobileBackHandler } from "../hooks/useMobileBackHandler";
import { MOBILE_BACK_PRIORITY } from "../lib/mobileBackStack";
import { isNativeApp } from "../lib/isNativeApp";
import { isNativeServingRemoteStockApp } from "../lib/apiBase";

type Props = {
  children: React.ReactNode;
};

/**
 * Capacitor: server.url 고정이면 웹과 동일 origin — 입력 없음. 로컬 번들만 수동 URL.
 */
export default function MobileServerGate({ children }: Props) {
  const native = isNativeApp();
  const remoteShell = native && isNativeServingRemoteStockApp();
  const [ready, setReady] = useState(
    !native || remoteShell || hasMobileApiBaseConfigured(),
  );
  const [showManual, setShowManual] = useState(false);
  const [input, setInput] = useState(() => getApiBaseUrl());
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  useMobileBackHandler(
    native && showManual,
    MOBILE_BACK_PRIORITY.SERVER_GATE,
    () => setShowManual(false),
  );

  const tryAutoConnect = useCallback(async () => {
    if (!native) return true;
    if (isNativeServingRemoteStockApp()) {
      ensureMobileApiBase();
      setReady(true);
      setShowManual(false);
      return true;
    }
    ensureMobileApiBase();
    if (!hasMobileApiBaseConfigured()) return false;
    try {
      await fetchConfig();
      setReady(true);
      setShowManual(false);
      setError(null);
      return true;
    } catch {
      persistMobileApiBase("");
      return false;
    }
  }, [native]);

  useEffect(() => {
    if (!native) return;
    let cancelled = false;
    setChecking(true);
    void tryAutoConnect().then((ok) => {
      if (cancelled) return;
      if (!ok) setShowManual(true);
      setChecking(false);
    });
    return () => {
      cancelled = true;
    };
  }, [native, tryAutoConnect]);

  const handleSave = useCallback(async () => {
    setError(null);
    const base = persistMobileApiBase(input);
    if (!base) {
      setError(ko.mobile.serverUrlInvalid);
      return;
    }
    setChecking(true);
    try {
      await fetchConfig();
      setReady(true);
      setShowManual(false);
      window.location.reload();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : ko.mobile.serverConnectFailed,
      );
      persistMobileApiBase("");
      setReady(false);
    } finally {
      setChecking(false);
    }
  }, [input]);

  if (!native || ready) {
    return <>{children}</>;
  }

  if (checking && !showManual) {
    return (
      <div className="mobile-server-gate">
        <div className="mobile-server-gate__card card">
          <p className="mobile-server-gate__hint">{ko.mobile.serverChecking}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mobile-server-gate">
      <div className="mobile-server-gate__card card">
        <h1 className="mobile-server-gate__title">{ko.mobile.serverSetupTitle}</h1>
        <p className="mobile-server-gate__hint">{ko.mobile.serverSetupHint}</p>
        <label className="mobile-server-gate__label">
          {ko.mobile.serverUrlLabel}
          <input
            type="url"
            className="input"
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            placeholder={ko.mobile.serverUrlPlaceholder}
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
        </label>
        {error ? (
          <p className="mobile-server-gate__err" role="alert">
            {error}
          </p>
        ) : null}
        <button
          type="button"
          className="btn btn--primary mobile-server-gate__save"
          disabled={checking || !normalizeMobileApiBaseInput(input)}
          onClick={() => void handleSave()}
        >
          {checking ? ko.mobile.serverChecking : ko.mobile.serverSave}
        </button>
      </div>
    </div>
  );
}
