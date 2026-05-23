import { useCallback, useEffect, useState } from "react";
import {
  fetchAuthMe,
  fetchUserCredentials,
  loginAuth,
  logoutAuth,
  registerAuth,
  saveUserCredential,
  testUserCredential,
  type AuthUser,
  type UserCredentialMeta,
} from "../api";
import { ko } from "../i18n/ko";

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

  return {
    user,
    setUser,
    registrationOpen,
    authChecked,
    refreshAuth,
  };
}

function CredentialExchangeForm({
  exchange,
  meta,
  cryptoReady,
  onSaved,
}: {
  exchange: "bithumb" | "toss";
  meta: UserCredentialMeta | undefined;
  cryptoReady: boolean;
  onSaved: () => void;
}) {
  const [apiKey, setApiKey] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [liveOrders, setLiveOrders] = useState(meta?.liveOrdersEnabled ?? false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setLiveOrders(meta?.liveOrdersEnabled ?? false);
  }, [meta?.liveOrdersEnabled]);

  const handleSave = async () => {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      if (!cryptoReady) {
        throw new Error(ko.app.liveTradeCredNoMasterKey);
      }
      await saveUserCredential(exchange, {
        apiKey: apiKey.trim(),
        secretKey: secretKey.trim() || undefined,
        liveOrdersEnabled: liveOrders,
      });
      setApiKey("");
      setSecretKey("");
      setMsg(ko.app.liveTradeCredSaved);
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleTest = async () => {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const out = await testUserCredential(exchange, {
        apiKey: apiKey.trim() || undefined,
        secretKey: secretKey.trim() || undefined,
      });
      setMsg(out.messageKo);
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
      <label className="live-trading-tab__field live-trading-tab__field--full">
        <span className="live-trading-tab__label">API Key</span>
        <input
          type="password"
          className="input live-trading-tab__input"
          autoComplete="off"
          placeholder={meta?.configured ? ko.app.liveTradeCredKeyPlaceholder : ""}
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
        />
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
          onChange={(e) => setSecretKey(e.target.value)}
        />
      </label>
      <label className="live-trading-tab__check">
        <input
          type="checkbox"
          checked={liveOrders}
          onChange={(e) => setLiveOrders(e.target.checked)}
        />
        <span>{ko.app.liveTradeCredLiveOrders}</span>
      </label>
      <div className="live-trading-tab__cred-actions">
        <button
          type="button"
          className="btn btn--secondary btn--sm"
          disabled={busy}
          onClick={() => void handleTest()}
        >
          {ko.app.liveTradeCredTest}
        </button>
        <button
          type="button"
          className="btn btn--primary btn--sm"
          disabled={busy || !cryptoReady}
          onClick={() => void handleSave()}
        >
          {ko.app.liveTradeCredSave}
        </button>
      </div>
      {msg ? (
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

  useEffect(() => {
    if (!registrationOpen && mode === "register") {
      setMode("login");
    }
  }, [registrationOpen, mode]);

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      if (mode === "register") {
        await registerAuth(email, password);
      } else {
        await loginAuth(email, password);
      }
      onAuthChange();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (user) {
    return (
      <section
        className="live-trading-tab__auth card live-trading-tab__auth--signed"
        aria-live="polite"
      >
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
            onClick={() => void logoutAuth().then(onAuthChange)}
          >
            {ko.app.liveTradeAuthLogout}
          </button>
        </div>
      </section>
    );
  }

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
            onClick={() => {
              setMode("login");
              setErr(null);
            }}
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
            onClick={() => {
              setMode("register");
              setErr(null);
            }}
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
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label className="live-trading-tab__field live-trading-tab__field--full">
          <span className="live-trading-tab__label">{ko.app.liveTradeAuthEmail}</span>
          <input
            type="email"
            className="input live-trading-tab__input"
            autoComplete="email"
            placeholder="name@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
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
            onChange={(e) => setPassword(e.target.value)}
          />
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
      cryptoReady={cryptoReady}
      onSaved={() => {
        void reload();
        onUpdated();
      }}
    />
  );
}
