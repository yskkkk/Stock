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
      <section className="live-trading-tab__auth card" aria-live="polite">
        <p className="live-trading-tab__auth-user">
          {ko.app.liveTradeAuthSignedIn}{" "}
          <strong>{user.email}</strong>
        </p>
        <button
          type="button"
          className="btn btn--secondary btn--sm"
          onClick={() => void logoutAuth().then(onAuthChange)}
        >
          {ko.app.liveTradeAuthLogout}
        </button>
      </section>
    );
  }

  return (
    <section className="live-trading-tab__auth card" aria-label={ko.app.liveTradeAuthTitle}>
      <h3 className="live-trading-tab__section-title">{ko.app.liveTradeAuthTitle}</h3>
      <p className="live-trading-tab__hint">{ko.app.liveTradeAuthHint}</p>
      <div className="live-trading-tab__auth-tabs">
        <button
          type="button"
          className={`btn btn--sm ${mode === "login" ? "btn--primary" : "btn--secondary"}`}
          onClick={() => setMode("login")}
        >
          {ko.app.liveTradeAuthLogin}
        </button>
        {registrationOpen ? (
          <button
            type="button"
            className={`btn btn--sm ${mode === "register" ? "btn--primary" : "btn--secondary"}`}
            onClick={() => setMode("register")}
          >
            {ko.app.liveTradeAuthRegister}
          </button>
        ) : null}
      </div>
      <label className="live-trading-tab__field live-trading-tab__field--full">
        <span className="live-trading-tab__label">{ko.app.liveTradeAuthEmail}</span>
        <input
          type="email"
          className="input live-trading-tab__input"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>
      <label className="live-trading-tab__field live-trading-tab__field--full">
        <span className="live-trading-tab__label">{ko.app.liveTradeAuthPassword}</span>
        <input
          type="password"
          className="input live-trading-tab__input"
          autoComplete={mode === "register" ? "new-password" : "current-password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      <button
        type="button"
        className="btn btn--primary"
        disabled={busy}
        onClick={() => void submit()}
      >
        {mode === "register"
          ? ko.app.liveTradeAuthRegisterSubmit
          : ko.app.liveTradeAuthLoginSubmit}
      </button>
      {err ? (
        <div className="alert alert--error" role="alert">
          {err}
        </div>
      ) : null}
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
