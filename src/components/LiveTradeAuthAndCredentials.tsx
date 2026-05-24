import { useCallback, useEffect, useState } from "react";
import {
  fetchAuthMe,
  fetchUserCredentials,
  loginAuth,
  registerAuth,
  saveUserCredential,
  testUserCredential,
  type AuthUser,
  type BithumbTestSnapshot,
  type UserCredentialMeta,
} from "../api";
import BithumbAccountSnapshotCard from "./BithumbAccountSnapshotCard";
import FieldValidationCallout from "./FieldValidationCallout";
import { ko } from "../i18n/ko";
import {
  validateAuthCredentials,
  validateBithumbCredentialPair,
} from "../lib/stock-input-validation";
import {
  LIVE_TRADE_AUTH_CHANGE,
  notifyLiveTradeAuthChange,
} from "../lib/liveTradeAuthEvents";

export { LIVE_TRADE_AUTH_CHANGE, notifyLiveTradeAuthChange };

export function useLiveTradeAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [registrationOpen, setRegistrationOpen] = useState(true);
  const [authChecked, setAuthChecked] = useState(false);

  const refreshAuth = useCallback(async () => {
    try {
      const me = await fetchAuthMe();
      setUser(me.user);
      setRegistrationOpen(me.registrationOpen !== false);
      return me.user;
    } catch {
      setUser(null);
      return null;
    } finally {
      setAuthChecked(true);
    }
  }, []);

  useEffect(() => {
    void refreshAuth();
  }, [refreshAuth]);

  useEffect(() => {
    const onChange = () => {
      void refreshAuth();
    };
    window.addEventListener(LIVE_TRADE_AUTH_CHANGE, onChange);
    return () => window.removeEventListener(LIVE_TRADE_AUTH_CHANGE, onChange);
  }, [refreshAuth]);

  return {
    user,
    setUser,
    registrationOpen,
    authChecked,
    refreshAuth,
  };
}

export function LiveTradeAuthSignedInCard({
  user,
  onLogout,
  variant = "inline",
}: {
  user: AuthUser;
  onLogout: () => void;
  variant?: "inline" | "rail";
}) {
  const rootClass =
    variant === "rail"
      ? "left-rail-auth left-rail-auth--signed"
      : "live-trading-tab__auth card live-trading-tab__auth--signed";

  return (
    <section className={rootClass} aria-live="polite">
      <div className="live-trading-tab__auth-signed">
        <div className="live-trading-tab__auth-signed-main">
          <span className="live-trading-tab__auth-avatar" aria-hidden>
            {user.email.slice(0, 1).toUpperCase()}
          </span>
          <div>
            <p className="live-trading-tab__auth-signed-label">
              {ko.app.liveTradeAuthSignedIn}
            </p>
            <p className="live-trading-tab__auth-signed-email">{user.email}</p>
          </div>
        </div>
        <button
          type="button"
          className="btn btn--secondary btn--sm live-trading-tab__auth-logout"
          onClick={onLogout}
        >
          {ko.app.liveTradeAuthLogout}
        </button>
      </div>
    </section>
  );
}

function CredentialExchangeForm({
  exchange,
  meta,
  keysReady,
  cryptoReady,
  onSaved,
}: {
  exchange: "bithumb" | "toss";
  meta: UserCredentialMeta | undefined;
  /** 상위 실거래 status(bithumb.ready) — meta 로드 전에도 저장 키 있음을 반영 */
  keysReady: boolean;
  cryptoReady: boolean;
  onSaved: () => void;
}) {
  const [apiKey, setApiKey] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [liveOrders, setLiveOrders] = useState(meta?.liveOrdersEnabled ?? false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [apiKeyErr, setApiKeyErr] = useState<string | null>(null);
  const [secretKeyErr, setSecretKeyErr] = useState<string | null>(null);
  const [testSnapshot, setTestSnapshot] = useState<BithumbTestSnapshot | null>(null);
  const [testTradingFees, setTestTradingFees] = useState<{
    bidFee: number;
    askFee: number;
    roundTripFeeRate: number;
  } | null>(null);
  const [editingKeys, setEditingKeys] = useState(false);

  useEffect(() => {
    setLiveOrders(meta?.liveOrdersEnabled ?? false);
  }, [meta?.liveOrdersEnabled]);

  const keysSaved = Boolean(meta?.configured) || keysReady;
  const showKeyFields = !keysSaved || editingKeys;

  useEffect(() => {
    if (!keysSaved) setEditingKeys(true);
  }, [keysSaved]);

  const closeKeyEdit = () => {
    setEditingKeys(false);
    setApiKey("");
    setSecretKey("");
    setApiKeyErr(null);
    setSecretKeyErr(null);
  };

  const persistLiveOrders = async (enabled: boolean) => {
    if (!cryptoReady) {
      throw new Error(ko.app.liveTradeCredNoMasterKey);
    }
    await saveUserCredential(exchange, {
      liveOrdersEnabled: enabled,
    });
    setMsg(ko.app.liveTradeCredOrderModeSaved);
    onSaved();
  };

  const handleSave = async () => {
    setBusy(true);
    setErr(null);
    setMsg(null);
    setApiKeyErr(null);
    setSecretKeyErr(null);
    try {
      if (!cryptoReady) {
        throw new Error(ko.app.liveTradeCredNoMasterKey);
      }
      if (!apiKey.trim() && !secretKey.trim()) {
        if (keysSaved) {
          await persistLiveOrders(liveOrders);
          return;
        }
      }
      const checked = validateBithumbCredentialPair(apiKey, secretKey, {
        configured: keysSaved,
      });
      if (!checked.ok) {
        if (checked.field === "API Key") setApiKeyErr(checked.error);
        else if (checked.field === "Secret Key") setSecretKeyErr(checked.error);
        else setErr(checked.error);
        return;
      }
      await saveUserCredential(exchange, {
        apiKey: checked.value.apiKey,
        secretKey: checked.value.secretKey || undefined,
        liveOrdersEnabled: liveOrders,
      });
      setApiKey("");
      setSecretKey("");
      setEditingKeys(false);
      setMsg(ko.app.liveTradeCredSaved);
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleOrderMode = (enabled: boolean) => {
    setLiveOrders(enabled);
    if (!keysSaved) return;
    setBusy(true);
    setErr(null);
    setMsg(null);
    void persistLiveOrders(enabled).catch((e) => {
      setErr(e instanceof Error ? e.message : String(e));
      setLiveOrders(meta?.liveOrdersEnabled ?? false);
    }).finally(() => setBusy(false));
  };

  const handleTest = async () => {
    setBusy(true);
    setErr(null);
    setMsg(null);
    setTestSnapshot(null);
    setTestTradingFees(null);
    setApiKeyErr(null);
    setSecretKeyErr(null);
    try {
      const useStored =
        !apiKey.trim() && !secretKey.trim() && keysSaved;
      let out;
      if (useStored) {
        out = await testUserCredential(exchange);
      } else {
        const checked = validateBithumbCredentialPair(apiKey, secretKey, {
          configured: keysSaved,
        });
        if (!checked.ok) {
          if (checked.field === "API Key") setApiKeyErr(checked.error);
          else if (checked.field === "Secret Key") setSecretKeyErr(checked.error);
          else setErr(checked.error);
          return;
        }
        out = await testUserCredential(exchange, {
          apiKey: checked.value.apiKey,
          secretKey: checked.value.secretKey,
        });
      }
      setMsg(out.messageKo);
      if (exchange === "bithumb") {
        if (out.bithumbSnapshot) setTestSnapshot(out.bithumbSnapshot);
        if (out.tradingFees) setTestTradingFees(out.tradingFees);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (meta?.source === "env") {
    return (
      <p className="live-trading-tab__hint live-trading-tab__cred-hint">
        {ko.app.liveTradeCredEnvTossHint}
      </p>
    );
  }

  return (
    <div className="live-trading-tab__cred-form">
      {keysSaved && !editingKeys ? (
        <div className="live-trading-tab__cred-keys-bar">
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            disabled={busy}
            onClick={() => setEditingKeys(true)}
          >
            {ko.app.liveTradeCredChangeApi}
          </button>
        </div>
      ) : null}
      {showKeyFields ? (
        <>
          {keysSaved ? (
            <div className="live-trading-tab__cred-keys-edit-head">
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                disabled={busy}
                onClick={closeKeyEdit}
              >
                {ko.app.liveTradeCancelEdit}
              </button>
            </div>
          ) : null}
          <label className="live-trading-tab__field live-trading-tab__field--full">
            <span className="live-trading-tab__label">API Key</span>
            <input
              type="password"
              className="input live-trading-tab__input"
              autoComplete="off"
              placeholder={
                meta?.configured ? ko.app.liveTradeCredKeyPlaceholder : ""
              }
              value={apiKey}
              onChange={(e) => {
                setApiKey(e.target.value);
                if (apiKeyErr) setApiKeyErr(null);
              }}
              maxLength={128}
              spellCheck={false}
              aria-invalid={apiKeyErr ? true : undefined}
              aria-describedby={apiKeyErr ? "cred-api-key-err" : undefined}
            />
            {apiKeyErr ? (
              <FieldValidationCallout id="cred-api-key-err" message={apiKeyErr} />
            ) : null}
          </label>
          <label className="live-trading-tab__field live-trading-tab__field--full">
            <span className="live-trading-tab__label">Secret Key</span>
            <input
              type="password"
              className="input live-trading-tab__input"
              autoComplete="off"
              placeholder={
                meta?.hasSecret ? ko.app.liveTradeCredSecretPlaceholder : ""
              }
              value={secretKey}
              onChange={(e) => {
                setSecretKey(e.target.value);
                if (secretKeyErr) setSecretKeyErr(null);
              }}
              maxLength={128}
              spellCheck={false}
              aria-invalid={secretKeyErr ? true : undefined}
              aria-describedby={secretKeyErr ? "cred-secret-key-err" : undefined}
            />
            {secretKeyErr ? (
              <FieldValidationCallout
                id="cred-secret-key-err"
                message={secretKeyErr}
              />
            ) : null}
          </label>
        </>
      ) : null}
      <fieldset className="live-trading-tab__cred-mode">
        <legend className="live-trading-tab__label">
          {ko.app.liveTradeCredOrderModeTitle}
        </legend>
        <p className="live-trading-tab__cred-mode-hint">
          {ko.app.liveTradeCredOrderModeHint}
        </p>
        <div
          className="live-trading-tab__segment live-trading-tab__cred-mode-segment"
          role="group"
          aria-label={ko.app.liveTradeCredOrderModeTitle}
        >
          <button
            type="button"
            className={`live-trading-tab__segment-btn ${
              !liveOrders ? "live-trading-tab__segment-btn--on" : ""
            }`}
            disabled={busy}
            onClick={() => handleOrderMode(false)}
          >
            {ko.app.liveTradeCredOrderModeSim}
          </button>
          <button
            type="button"
            className={`live-trading-tab__segment-btn ${
              liveOrders ? "live-trading-tab__segment-btn--on" : ""
            }`}
            disabled={busy || !keysSaved}
            onClick={() => handleOrderMode(true)}
            title={
              keysSaved
                ? undefined
                : "API Key·Secret 저장 후 실주문을 허용할 수 있습니다."
            }
          >
            {ko.app.liveTradeCredOrderModeLive}
          </button>
        </div>
        {!keysSaved ? (
          <label className="live-trading-tab__check live-trading-tab__cred-mode-check">
            <input
              type="checkbox"
              checked={liveOrders}
              onChange={(e) => setLiveOrders(e.target.checked)}
            />
            <span>{ko.app.liveTradeCredLiveOrders}</span>
          </label>
        ) : null}
      </fieldset>
      <div className="live-trading-tab__cred-actions">
        <button
          type="button"
          className="btn btn--secondary btn--sm"
          disabled={busy}
          onClick={() => void handleTest()}
        >
          {ko.app.liveTradeCredTest}
        </button>
        {showKeyFields ? (
          <button
            type="button"
            className="btn btn--primary btn--sm"
            disabled={busy || !cryptoReady}
            onClick={() => void handleSave()}
          >
            {ko.app.liveTradeCredSave}
          </button>
        ) : null}
      </div>
      {(msg || testSnapshot || testTradingFees) && exchange === "bithumb" ? (
        <div className="live-trading-tab__cred-test-row">
          {msg ? (
            <p className="live-trading-tab__hint live-trading-tab__cred-test-msg" role="status">
              {msg}
            </p>
          ) : null}
          {testSnapshot ? (
            <BithumbAccountSnapshotCard
              snapshot={testSnapshot}
              tradingFees={testTradingFees}
              variant="inline"
            />
          ) : null}
        </div>
      ) : msg ? (
        <p className="live-trading-tab__hint" role="status">
          {msg}
        </p>
      ) : null}
      {err ? (
        <p className="alert alert--error" role="alert">
          {err}
        </p>
      ) : null}
    </div>
  );
}

export default function LiveTradeAuthPanel({
  user,
  registrationOpen,
  onAuthChange,
}: {
  user: AuthUser | null;
  registrationOpen: boolean;
  onAuthChange: () => void;
}) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [emailErr, setEmailErr] = useState<string | null>(null);
  const [passwordErr, setPasswordErr] = useState<string | null>(null);

  useEffect(() => {
    if (!registrationOpen && mode === "register") {
      setMode("login");
      setEmail("");
      setPassword("");
      setErr(null);
    }
  }, [registrationOpen, mode]);

  const switchMode = (next: "login" | "register") => {
    if (next === mode) return;
    setMode(next);
    setEmail("");
    setPassword("");
    setErr(null);
    setEmailErr(null);
    setPasswordErr(null);
  };

  const submit = async () => {
    setBusy(true);
    setErr(null);
    setEmailErr(null);
    setPasswordErr(null);
    try {
      const checked = validateAuthCredentials(email, password, {
        register: mode === "register",
      });
      if (!checked.ok) {
        if (checked.field === "이메일") setEmailErr(checked.error);
        else if (checked.field === "비밀번호") setPasswordErr(checked.error);
        else setErr(checked.error);
        return;
      }
      if (mode === "register") {
        await registerAuth(checked.value.email, checked.value.password);
      } else {
        await loginAuth(checked.value.email, checked.value.password);
      }
      onAuthChange();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (user) return null;

  const showRegister = registrationOpen;

  return (
    <section
      className="live-trading-tab__auth card"
      aria-label={ko.app.liveTradeAuthTitle}
    >
      <header className="live-trading-tab__auth-head">
        <h3 className="live-trading-tab__auth-title">{ko.app.liveTradeAuthTitle}</h3>
        <p className="live-trading-tab__auth-lead">{ko.app.liveTradeAuthHint}</p>
      </header>

      {showRegister ? (
        <div
          className="live-trading-tab__segment live-trading-tab__auth-segment"
          role="tablist"
          aria-label={ko.app.liveTradeAuthTitle}
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === "login"}
            className={`live-trading-tab__segment-btn ${
              mode === "login" ? "live-trading-tab__segment-btn--on" : ""
            }`}
            onClick={() => switchMode("login")}
          >
            {ko.app.liveTradeAuthLogin}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "register"}
            className={`live-trading-tab__segment-btn ${
              mode === "register" ? "live-trading-tab__segment-btn--on" : ""
            }`}
            onClick={() => switchMode("register")}
          >
            {ko.app.liveTradeAuthRegister}
          </button>
        </div>
      ) : (
        <p className="live-trading-tab__auth-notice" role="status">
          {ko.app.liveTradeAuthRegistrationClosed}
        </p>
      )}

      <form
        className="live-trading-tab__auth-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label className="live-trading-tab__field live-trading-tab__field--full">
          <span className="live-trading-tab__label">{ko.app.liveTradeAuthEmail}</span>
          <input
            type="text"
            inputMode="email"
            autoCapitalize="off"
            autoCorrect="off"
            className="input live-trading-tab__input"
            autoComplete="email"
            placeholder="name@example.com"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (emailErr) setEmailErr(null);
            }}
            maxLength={254}
            spellCheck={false}
            aria-invalid={emailErr ? true : undefined}
            aria-describedby={emailErr ? "auth-email-err" : undefined}
          />
          {emailErr ? (
            <FieldValidationCallout id="auth-email-err" message={emailErr} />
          ) : null}
        </label>
        <label className="live-trading-tab__field live-trading-tab__field--full">
          <span className="live-trading-tab__label">
            {ko.app.liveTradeAuthPassword}
          </span>
          <input
            type="password"
            className="input live-trading-tab__input"
            autoComplete={
              mode === "register" ? "new-password" : "current-password"
            }
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (passwordErr) setPasswordErr(null);
            }}
            maxLength={128}
            aria-invalid={passwordErr ? true : undefined}
            aria-describedby={passwordErr ? "auth-password-err" : undefined}
          />
          {passwordErr ? (
            <FieldValidationCallout id="auth-password-err" message={passwordErr} />
          ) : null}
        </label>

        {err ? (
          <div
            className="live-trading-tab__auth-alert"
            role="alert"
          >
            {err}
          </div>
        ) : null}

        <button
          type="submit"
          className="btn btn--primary live-trading-tab__auth-submit"
          disabled={busy || (mode === "register" && !showRegister)}
        >
          {busy
            ? "…"
            : mode === "register"
              ? ko.app.liveTradeAuthRegisterSubmit
              : ko.app.liveTradeAuthLoginSubmit}
        </button>
      </form>
    </section>
  );
}

export function LiveTradeBithumbCredentialForm({
  bithumbReady,
  cryptoReady,
  onUpdated,
}: {
  bithumbReady: boolean;
  cryptoReady: boolean;
  onUpdated: () => void;
}) {
  const [meta, setMeta] = useState<UserCredentialMeta | undefined>();

  const reload = useCallback(async () => {
    try {
      const c = await fetchUserCredentials();
      setMeta(c.bithumb);
    } catch {
      setMeta(undefined);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload, bithumbReady]);

  return (
    <CredentialExchangeForm
      exchange="bithumb"
      meta={meta}
      keysReady={bithumbReady}
      cryptoReady={cryptoReady}
      onSaved={() => {
        void reload();
        onUpdated();
      }}
    />
  );
}
