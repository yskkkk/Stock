import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import {
  fetchAuthMe,
  fetchUserCredentials,
  loginAuth,
  registerAuth,
  sendAuthEmailVerificationCode,
  deleteUserCredential,
  saveUserCredential,
  testUserCredential,
  verifyAccountPassword,
  type AuthUser,
  type BithumbTestSnapshot,
  type UserCredentialMeta,
} from "../api";
import BithumbAccountSnapshotCard from "./BithumbAccountSnapshotCard";
import FieldValidationCallout from "./FieldValidationCallout";
import { ko } from "../i18n/ko";
import {
  validateAuthCredentials,
  validateAuthEmail,
  validateBithumbCredentialPair,
  validateTossCredentialSet,
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

type ApiCardVariant = "ready" | "partial" | "off";

function apiCardVariantClass(variant: ApiCardVariant): string {
  if (variant === "ready") return "live-trade-api-card--ready";
  if (variant === "partial") return "live-trade-api-card--partial";
  return "live-trade-api-card--off";
}

function LiveTradeCardModal({
  open,
  title,
  onClose,
  encryptNote,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  encryptNote?: boolean;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="live-trade-card-modal-backdrop"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="live-trade-card-modal card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="live-trade-card-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="live-trade-card-modal__head">
          <h2 id="live-trade-card-modal-title" className="live-trade-card-modal__title">
            {title}
          </h2>
          <button
            type="button"
            className="live-trade-card-modal__close"
            onClick={onClose}
            aria-label={ko.app.liveTradeCardModalClose}
          >
            ×
          </button>
        </header>
        <div className="live-trade-card-modal__body live-trade-api-card__body">
          {encryptNote ? (
            <p className="live-trade-api-card__encrypt-note">
              {ko.app.liveTradeApiEncryptedNote}
            </p>
          ) : null}
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}

type LiveTradeSidePanelState = { id: string; title: string } | null;

type LiveTradeSidePanelContextValue = {
  panel: LiveTradeSidePanelState;
  openPanel: (id: string, title: string) => void;
  closePanel: () => void;
  bodyHostRef: RefObject<HTMLDivElement | null>;
};

const LiveTradeSidePanelContext =
  createContext<LiveTradeSidePanelContextValue | null>(null);

export function LiveTradeCardSidePanelProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [panel, setPanel] = useState<LiveTradeSidePanelState>(null);
  const bodyHostRef = useRef<HTMLDivElement>(null);
  const openPanel = useCallback((id: string, title: string) => {
    setPanel({ id, title });
  }, []);
  const closePanel = useCallback(() => setPanel(null), []);
  const value = useMemo(
    () => ({ panel, openPanel, closePanel, bodyHostRef }),
    [panel, openPanel, closePanel],
  );

  return (
    <LiveTradeSidePanelContext.Provider value={value}>
      {children}
    </LiveTradeSidePanelContext.Provider>
  );
}

export function useLiveTradeCardSidePanel(): LiveTradeSidePanelContextValue {
  const ctx = useContext(LiveTradeSidePanelContext);
  if (!ctx) {
    throw new Error("useLiveTradeCardSidePanel requires LiveTradeCardSidePanelProvider");
  }
  return ctx;
}

function useLiveTradeCardSidePanelOptional(): LiveTradeSidePanelContextValue | null {
  return useContext(LiveTradeSidePanelContext);
}

export function LiveTradeCardSidePanel() {
  const { panel, closePanel, bodyHostRef } = useLiveTradeCardSidePanel();

  useEffect(() => {
    if (!panel) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePanel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [panel, closePanel]);

  const open = Boolean(panel);

  return (
    <>
      {open ? (
        <button
          type="button"
          className="live-trading-tab__detail-panel-backdrop"
          aria-label={ko.app.liveTradeCardModalClose}
          onClick={closePanel}
        />
      ) : null}
      <aside
        className={`live-trading-tab__detail-panel${
          open ? " live-trading-tab__detail-panel--open" : ""
        }`}
        aria-hidden={!open}
      >
        {panel ? (
          <header className="live-trading-tab__detail-panel-head">
            <h2 className="live-trading-tab__detail-panel-title">{panel.title}</h2>
            <button
              type="button"
              className="live-trading-tab__detail-panel-close"
              onClick={closePanel}
              aria-label={ko.app.liveTradeCardModalClose}
            >
              ×
            </button>
          </header>
        ) : null}
        <div
          ref={bodyHostRef}
          className="live-trading-tab__detail-panel-body live-trade-api-card__body"
        />
      </aside>
    </>
  );
}

function LiveTradeSidePanelPortal({
  active,
  hostRef,
  children,
}: {
  active: boolean;
  hostRef: RefObject<HTMLDivElement | null>;
  children: ReactNode;
}) {
  const [target, setTarget] = useState<HTMLElement | null>(null);

  useLayoutEffect(() => {
    if (!active) {
      setTarget(null);
      return;
    }
    const el = hostRef.current;
    if (el) setTarget(el);
    else {
      const id = requestAnimationFrame(() => {
        setTarget(hostRef.current);
      });
      return () => cancelAnimationFrame(id);
    }
  }, [active, hostRef]);

  if (!active || !target) return null;
  return createPortal(children, target);
}

export function LiveTradeCollapsibleCard({
  title,
  summary,
  children,
  defaultOpen = false,
  variant,
  className = "",
  encryptNote = false,
  ariaLabel,
  sidePanelId,
}: {
  title: string;
  summary: string;
  children: ReactNode;
  defaultOpen?: boolean;
  variant?: ApiCardVariant;
  className?: string;
  encryptNote?: boolean;
  ariaLabel?: string;
  /** 설정 시 중앙 모달 대신 실매매 탭 우측 패널에 표시 */
  sidePanelId?: string;
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const sidePanel = useLiveTradeCardSidePanelOptional();
  const useSidePanel = Boolean(sidePanelId && sidePanel);
  const isSideActive =
    useSidePanel && sidePanel!.panel?.id === sidePanelId;
  const variantClass = variant ? apiCardVariantClass(variant) : "";

  useEffect(() => {
    if (!defaultOpen) return;
    if (useSidePanel && sidePanelId && sidePanel) {
      sidePanel.openPanel(sidePanelId, title);
    } else {
      setModalOpen(true);
    }
  }, [defaultOpen, useSidePanel, sidePanelId, title, sidePanel]);

  const onHeadClick = () => {
    if (useSidePanel && sidePanelId) {
      if (isSideActive) sidePanel!.closePanel();
      else sidePanel!.openPanel(sidePanelId, title);
      return;
    }
    setModalOpen(true);
  };

  const toggleLabel =
    useSidePanel && isSideActive
      ? ko.app.liveTradeCardModalClose
      : ko.app.liveTradeApiExpand;

  return (
    <>
      <section
        className={`live-trade-api-card card ${variantClass}${
          isSideActive ? " live-trade-api-card--side-open" : ""
        }${className ? ` ${className}` : ""}`}
        aria-label={ariaLabel}
      >
        <button
          type="button"
          className="live-trade-api-card__head"
          aria-haspopup={useSidePanel ? undefined : "dialog"}
          aria-expanded={useSidePanel ? isSideActive : modalOpen}
          onClick={onHeadClick}
        >
          <span className="live-trade-api-card__head-main">
            <span className="live-trade-api-card__title">{title}</span>
            <span className="live-trade-api-card__summary">{summary}</span>
          </span>
          <span className="live-trade-api-card__toggle" aria-hidden>
            {toggleLabel}
          </span>
        </button>
      </section>
      {useSidePanel ? (
        <LiveTradeSidePanelPortal
          active={isSideActive}
          hostRef={sidePanel!.bodyHostRef}
        >
          {encryptNote ? (
            <p className="live-trade-api-card__encrypt-note">
              {ko.app.liveTradeApiEncryptedNote}
            </p>
          ) : null}
          {children}
        </LiveTradeSidePanelPortal>
      ) : (
        <LiveTradeCardModal
          open={modalOpen}
          title={title}
          encryptNote={encryptNote}
          onClose={() => setModalOpen(false)}
        >
          {children}
        </LiveTradeCardModal>
      )}
    </>
  );
}

export function LiveTradeApiCollapsibleCard({
  title,
  variant,
  summary,
  children,
  defaultOpen = false,
}: {
  title: string;
  variant: ApiCardVariant;
  summary: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <LiveTradeCollapsibleCard
      title={title}
      variant={variant}
      summary={summary}
      defaultOpen={defaultOpen}
      encryptNote
    >
      {children}
    </LiveTradeCollapsibleCard>
  );
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

type CredPasswordGate = "edit" | "delete";

function CredAccountPasswordPopover({
  password,
  onPasswordChange,
  error,
  busy,
  onConfirm,
  onCancel,
  inputRef,
  danger,
}: {
  password: string;
  onPasswordChange: (value: string) => void;
  error: string | null;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  inputRef: RefObject<HTMLInputElement | null>;
  danger?: boolean;
}) {
  return (
    <div
      className="live-trade-cred-password-popover"
      role="dialog"
      aria-label={ko.app.liveTradeCredAccountPasswordAria}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <input
        ref={inputRef}
        type="password"
        className="live-trade-cred-password-popover__input"
        autoComplete="current-password"
        placeholder={ko.app.liveTradeCredAccountPasswordPlaceholder}
        value={password}
        disabled={busy}
        onChange={(e) => onPasswordChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onConfirm();
          }
          if (e.key === "Escape") onCancel();
        }}
      />
      {error ? (
        <p className="live-trade-cred-password-popover__err" role="alert">
          {error}
        </p>
      ) : null}
      <div className="live-trade-cred-password-popover__actions">
        <button
          type="button"
          className={
            danger
              ? "live-trade-cred-password-popover__action live-trade-cred-password-popover__action--danger"
              : "live-trade-cred-password-popover__action live-trade-cred-password-popover__action--primary"
          }
          disabled={busy}
          onClick={onConfirm}
        >
          {ko.app.liveTradeCredAccountPasswordConfirm}
        </button>
        <span className="live-trade-cred-password-popover__sep" aria-hidden>
          ·
        </span>
        <button
          type="button"
          className="live-trade-cred-password-popover__action"
          disabled={busy}
          onClick={onCancel}
        >
          {ko.app.liveTradeCredAccountPasswordCancel}
        </button>
      </div>
    </div>
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
  const [accountId, setAccountId] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [apiKeyErr, setApiKeyErr] = useState<string | null>(null);
  const [secretKeyErr, setSecretKeyErr] = useState<string | null>(null);
  const [accountIdErr, setAccountIdErr] = useState<string | null>(null);
  const [testSnapshot, setTestSnapshot] = useState<BithumbTestSnapshot | null>(null);
  const [testTradingFees, setTestTradingFees] = useState<{
    bidFee: number;
    askFee: number;
    roundTripFeeRate: number;
  } | null>(null);
  const [editingKeys, setEditingKeys] = useState(false);
  const [pwdGate, setPwdGate] = useState<CredPasswordGate | null>(null);
  const [pwdGateValue, setPwdGateValue] = useState("");
  const [pwdGateErr, setPwdGateErr] = useState<string | null>(null);
  const [pwdGateBusy, setPwdGateBusy] = useState(false);
  const [verifiedAccountPassword, setVerifiedAccountPassword] = useState<
    string | null
  >(null);
  const pwdInputRef = useRef<HTMLInputElement>(null);

  const isToss = exchange === "toss";
  const keysSaved =
    meta?.source === "user"
      ? Boolean(meta?.configured)
      : !isToss
        ? meta !== undefined
          ? Boolean(meta?.configured)
          : keysReady
        : Boolean(meta?.configured);
  const showKeyFields = !keysSaved || editingKeys;
  const envConfigured = meta?.source === "env";

  useEffect(() => {
    if (keysSaved) {
      setEditingKeys(false);
      setVerifiedAccountPassword(null);
      setApiKey("");
      setSecretKey("");
      setAccountId("");
      setApiKeyErr(null);
      setSecretKeyErr(null);
      setAccountIdErr(null);
    } else {
      setEditingKeys(true);
    }
  }, [keysSaved]);

  const closePwdGate = useCallback(() => {
    setPwdGate(null);
    setPwdGateValue("");
    setPwdGateErr(null);
    setPwdGateBusy(false);
  }, []);

  useEffect(() => {
    if (!pwdGate) return;
    pwdInputRef.current?.focus();
  }, [pwdGate]);

  useEffect(() => {
    if (!pwdGate) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if ((t as Element).closest?.(".live-trade-cred-password-popover")) return;
      if ((t as Element).closest?.(".live-trading-tab__cred-btn--edit")) return;
      if ((t as Element).closest?.(".live-trading-tab__cred-btn--danger")) return;
      closePwdGate();
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [pwdGate, closePwdGate]);

  const closeKeyEdit = () => {
    setEditingKeys(false);
    setVerifiedAccountPassword(null);
    closePwdGate();
    setApiKey("");
    setSecretKey("");
    setAccountId("");
    setApiKeyErr(null);
    setSecretKeyErr(null);
    setAccountIdErr(null);
  };

  const openPwdGate = (gate: CredPasswordGate) => {
    setPwdGate(gate);
    setPwdGateValue("");
    setPwdGateErr(null);
  };

  const confirmPwdGate = async () => {
    const pw = pwdGateValue.trim();
    if (!pw) {
      setPwdGateErr(ko.app.liveTradeCredAccountPasswordRequired);
      return;
    }
    setPwdGateBusy(true);
    setPwdGateErr(null);
    try {
      if (pwdGate === "edit") {
        await verifyAccountPassword(pw);
        setVerifiedAccountPassword(pw);
        setEditingKeys(true);
        closePwdGate();
        return;
      }
      if (pwdGate === "delete") {
        setBusy(true);
        setErr(null);
        setMsg(null);
        setTestSnapshot(null);
        setTestTradingFees(null);
        try {
          await deleteUserCredential(exchange, pw);
          closeKeyEdit();
          setEditingKeys(true);
          setMsg(ko.app.liveTradeCredDeleted);
          onSaved();
          closePwdGate();
        } catch (e) {
          setPwdGateErr(e instanceof Error ? e.message : String(e));
        } finally {
          setBusy(false);
        }
        return;
      }
    } catch (e) {
      setPwdGateErr(e instanceof Error ? e.message : String(e));
    } finally {
      setPwdGateBusy(false);
    }
  };

  const pwdPopover = pwdGate ? (
    <CredAccountPasswordPopover
      password={pwdGateValue}
      onPasswordChange={(v) => {
        setPwdGateValue(v);
        setPwdGateErr(null);
      }}
      error={pwdGateErr}
      busy={pwdGateBusy || busy}
      onConfirm={() => void confirmPwdGate()}
      onCancel={closePwdGate}
      inputRef={pwdInputRef}
      danger={pwdGate === "delete"}
    />
  ) : null;

  const applyValidationError = (
    checked: { ok: false; error: string; field?: string } | { ok: true },
  ) => {
    if (checked.ok) return true;
    if (checked.field === "API Key") setApiKeyErr(checked.error);
    else if (checked.field === "Secret Key") setSecretKeyErr(checked.error);
    else if (checked.field === "계좌 번호") setAccountIdErr(checked.error);
    else setErr(checked.error);
    return false;
  };

  const handleSave = async () => {
    setBusy(true);
    setErr(null);
    setMsg(null);
    setApiKeyErr(null);
    setSecretKeyErr(null);
    setAccountIdErr(null);
    try {
      if (!cryptoReady) {
        throw new Error(ko.app.liveTradeCredNoMasterKey);
      }
      if (!apiKey.trim() && !secretKey.trim() && !accountId.trim()) {
        if (keysSaved) {
          setMsg(ko.app.liveTradeCredNoChange);
          return;
        }
      }
      if (isToss) {
        const checked = validateTossCredentialSet(apiKey, secretKey, accountId, {
          configured: keysSaved,
        });
        if (!checked.ok) {
          applyValidationError(checked);
          return;
        }
        await saveUserCredential(exchange, {
          apiKey: checked.value.apiKey,
          secretKey: checked.value.secretKey || undefined,
          accountId: checked.value.accountId || undefined,
          accountPassword: verifiedAccountPassword ?? undefined,
        });
      } else {
        const checked = validateBithumbCredentialPair(apiKey, secretKey, {
          configured: keysSaved,
        });
        if (!checked.ok) {
          applyValidationError(checked);
          return;
        }
        await saveUserCredential(exchange, {
          apiKey: checked.value.apiKey,
          secretKey: checked.value.secretKey || undefined,
          accountPassword: verifiedAccountPassword ?? undefined,
        });
      }
      setApiKey("");
      setSecretKey("");
      setAccountId("");
      setEditingKeys(false);
      setVerifiedAccountPassword(null);
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
    setTestSnapshot(null);
    setTestTradingFees(null);
    setApiKeyErr(null);
    setSecretKeyErr(null);
    setAccountIdErr(null);
    try {
      const useStored =
        !apiKey.trim() && !secretKey.trim() && !accountId.trim() && keysSaved;
      let out;
      if (useStored) {
        out = await testUserCredential(exchange);
      } else {
        if (isToss) {
          const checked = validateTossCredentialSet(apiKey, secretKey, accountId, {
            configured: keysSaved,
          });
          if (!checked.ok) {
            applyValidationError(checked);
            return;
          }
          out = await testUserCredential(exchange, {
            apiKey: checked.value.apiKey,
            secretKey: checked.value.secretKey,
            accountId: checked.value.accountId,
          });
        } else {
          const checked = validateBithumbCredentialPair(apiKey, secretKey, {
            configured: keysSaved,
          });
          if (!checked.ok) {
            applyValidationError(checked);
            return;
          }
          out = await testUserCredential(exchange, {
            apiKey: checked.value.apiKey,
            secretKey: checked.value.secretKey,
          });
        }
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

  return (
    <div className="live-trading-tab__cred-form">
      {envConfigured ? (
        <p className="live-trading-tab__hint live-trading-tab__cred-hint live-trading-tab__cred-env-banner">
          {ko.app.liveTradeCredEnvTossHint}
        </p>
      ) : null}
      {keysSaved && !editingKeys ? (
        <div
          className="live-trading-tab__cred-toolbar"
          role="group"
          aria-label={ko.app.liveTradeCredToolbarAria}
        >
          <span className="live-trading-tab__cred-password-anchor">
            <button
              type="button"
              className="live-trading-tab__cred-btn live-trading-tab__cred-btn--edit"
              disabled={busy || pwdGateBusy}
              aria-expanded={pwdGate === "edit"}
              onClick={() => openPwdGate("edit")}
            >
              {ko.app.liveTradeCredChangeApi}
            </button>
            {pwdGate === "edit" ? pwdPopover : null}
          </span>
          <button
            type="button"
            className="live-trading-tab__cred-btn live-trading-tab__cred-btn--test"
            disabled={busy}
            onClick={() => void handleTest()}
          >
            {ko.app.liveTradeCredTest}
          </button>
          <span className="live-trading-tab__cred-password-anchor">
            <button
              type="button"
              className="live-trading-tab__cred-btn live-trading-tab__cred-btn--danger"
              disabled={busy || pwdGateBusy}
              aria-expanded={pwdGate === "delete"}
              onClick={() => openPwdGate("delete")}
            >
              {ko.app.liveTradeCredDelete}
            </button>
            {pwdGate === "delete" ? pwdPopover : null}
          </span>
        </div>
      ) : null}
      {showKeyFields ? (
        <>
          {keysSaved ? (
            <div className="live-trading-tab__cred-keys-edit-head">
              <button
                type="button"
                className="live-trading-tab__cred-btn live-trading-tab__cred-btn--ghost"
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
          {isToss ? (
            <label className="live-trading-tab__field live-trading-tab__field--full">
              <span className="live-trading-tab__label">
                {ko.app.liveTradeTossAccountLabel}
              </span>
              <input
                type="text"
                className="input live-trading-tab__input"
                autoComplete="off"
                placeholder={
                  meta?.hasAccount
                    ? ko.app.liveTradeTossAccountPlaceholder
                    : ""
                }
                value={accountId}
                onChange={(e) => {
                  setAccountId(e.target.value);
                  if (accountIdErr) setAccountIdErr(null);
                }}
                maxLength={64}
                spellCheck={false}
                aria-invalid={accountIdErr ? true : undefined}
                aria-describedby={
                  accountIdErr ? "cred-account-id-err" : undefined
                }
              />
              {accountIdErr ? (
                <FieldValidationCallout
                  id="cred-account-id-err"
                  message={accountIdErr}
                />
              ) : null}
            </label>
          ) : null}
        </>
      ) : null}
      {showKeyFields || !keysSaved ? (
        <div
          className="live-trading-tab__cred-toolbar live-trading-tab__cred-toolbar--form"
          role="group"
          aria-label={ko.app.liveTradeCredToolbarAria}
        >
          <button
            type="button"
            className="live-trading-tab__cred-btn live-trading-tab__cred-btn--test"
            disabled={busy}
            onClick={() => void handleTest()}
          >
            {ko.app.liveTradeCredTest}
          </button>
          {showKeyFields ? (
            <button
              type="button"
              className="live-trading-tab__cred-btn live-trading-tab__cred-btn--save"
              disabled={busy || !cryptoReady}
              onClick={() => void handleSave()}
            >
              {ko.app.liveTradeCredSave}
            </button>
          ) : null}
          {keysSaved ? (
            <span className="live-trading-tab__cred-password-anchor">
              <button
                type="button"
                className="live-trading-tab__cred-btn live-trading-tab__cred-btn--danger"
                disabled={busy || pwdGateBusy}
                aria-expanded={pwdGate === "delete"}
                onClick={() => openPwdGate("delete")}
              >
                {ko.app.liveTradeCredDelete}
              </button>
              {pwdGate === "delete" ? pwdPopover : null}
            </span>
          ) : null}
        </div>
      ) : null}
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
  const [verificationCode, setVerificationCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [codeMsg, setCodeMsg] = useState<string | null>(null);
  const [sendCodeBusy, setSendCodeBusy] = useState(false);
  const [sendCooldownSec, setSendCooldownSec] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [emailErr, setEmailErr] = useState<string | null>(null);
  const [passwordErr, setPasswordErr] = useState<string | null>(null);
  const [codeErr, setCodeErr] = useState<string | null>(null);

  useEffect(() => {
    if (!registrationOpen && mode === "register") {
      setMode("login");
      setEmail("");
      setPassword("");
      setVerificationCode("");
      setCodeSent(false);
      setCodeMsg(null);
      setErr(null);
    }
  }, [registrationOpen, mode]);

  useEffect(() => {
    if (sendCooldownSec <= 0) return;
    const id = window.setInterval(() => {
      setSendCooldownSec((s) => (s <= 1 ? 0 : s - 1));
    }, 1000);
    return () => window.clearInterval(id);
  }, [sendCooldownSec]);

  const switchMode = (next: "login" | "register") => {
    if (next === mode) return;
    setMode(next);
    setEmail("");
    setPassword("");
    setVerificationCode("");
    setCodeSent(false);
    setCodeMsg(null);
    setSendCooldownSec(0);
    setErr(null);
    setEmailErr(null);
    setPasswordErr(null);
    setCodeErr(null);
  };

  const sendVerificationCode = async () => {
    setSendCodeBusy(true);
    setErr(null);
    setEmailErr(null);
    setCodeErr(null);
    setCodeMsg(null);
    try {
      const checked = validateAuthEmail(email);
      if (!checked.ok) {
        setEmailErr(checked.error);
        return;
      }
      const res = await sendAuthEmailVerificationCode(checked.value);
      setCodeSent(true);
      setSendCooldownSec(60);
      setCodeMsg(
        res.devCode
          ? `${ko.app.liveTradeAuthSendCodeDone} (개발: ${res.devCode})`
          : ko.app.liveTradeAuthSendCodeDone,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("잠시")) setSendCooldownSec(60);
      setErr(msg);
    } finally {
      setSendCodeBusy(false);
    }
  };

  const submit = async () => {
    setBusy(true);
    setErr(null);
    setEmailErr(null);
    setPasswordErr(null);
    setCodeErr(null);
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
        const code = verificationCode.trim().replace(/\s/g, "");
        if (!/^\d{6}$/.test(code)) {
          setCodeErr(ko.app.liveTradeAuthVerificationRequired);
          return;
        }
        if (!codeSent) {
          setCodeErr(ko.app.liveTradeAuthVerificationRequired);
          return;
        }
        await registerAuth(
          checked.value.email,
          checked.value.password,
          code,
        );
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
              setCodeSent(false);
              setCodeMsg(null);
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

        {mode === "register" ? (
          <>
            <div className="live-trading-tab__auth-code-row">
              <label className="live-trading-tab__field live-trading-tab__field--code">
                <span className="live-trading-tab__label">
                  {ko.app.liveTradeAuthVerificationCode}
                </span>
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  className="input live-trading-tab__input live-trading-tab__input--code"
                  placeholder="000000"
                  value={verificationCode}
                  onChange={(e) => {
                    setVerificationCode(
                      e.target.value.replace(/\D/g, "").slice(0, 6),
                    );
                    if (codeErr) setCodeErr(null);
                  }}
                  maxLength={6}
                  aria-invalid={codeErr ? true : undefined}
                  aria-describedby={codeErr ? "auth-code-err" : undefined}
                />
                {codeErr ? (
                  <FieldValidationCallout id="auth-code-err" message={codeErr} />
                ) : null}
              </label>
              <button
                type="button"
                className="btn btn--secondary btn--sm live-trading-tab__auth-send-code"
                disabled={
                  sendCodeBusy ||
                  sendCooldownSec > 0 ||
                  !email.trim()
                }
                onClick={() => void sendVerificationCode()}
              >
                {sendCodeBusy
                  ? "…"
                  : sendCooldownSec > 0
                    ? `${sendCooldownSec}${ko.app.liveTradeAuthSendCodeCooldown}`
                    : codeSent
                      ? ko.app.liveTradeAuthSendCodeAgain
                      : ko.app.liveTradeAuthSendCode}
              </button>
            </div>
            {codeMsg ? (
              <p className="live-trading-tab__auth-code-msg" role="status">
                {codeMsg}
              </p>
            ) : null}
          </>
        ) : null}

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
  userId,
  bithumbReady,
  cryptoReady,
  onUpdated,
}: {
  userId: string;
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
    setMeta(undefined);
    void reload();
  }, [reload, bithumbReady, userId]);

  useEffect(() => {
    const onAuth = () => {
      setMeta(undefined);
      void reload();
    };
    window.addEventListener(LIVE_TRADE_AUTH_CHANGE, onAuth);
    return () => window.removeEventListener(LIVE_TRADE_AUTH_CHANGE, onAuth);
  }, [reload]);

  return (
    <CredentialExchangeForm
      key={`bithumb-${userId}`}
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

export function LiveTradeTossCredentialForm({
  userId,
  tossReady,
  cryptoReady,
  onUpdated,
}: {
  userId: string;
  tossReady: boolean;
  cryptoReady: boolean;
  onUpdated: () => void;
}) {
  const [meta, setMeta] = useState<UserCredentialMeta | undefined>();

  const reload = useCallback(async () => {
    try {
      const c = await fetchUserCredentials();
      setMeta(c.toss);
    } catch {
      setMeta(undefined);
    }
  }, []);

  useEffect(() => {
    setMeta(undefined);
    void reload();
  }, [reload, tossReady, userId]);

  useEffect(() => {
    const onAuth = () => {
      setMeta(undefined);
      void reload();
    };
    window.addEventListener(LIVE_TRADE_AUTH_CHANGE, onAuth);
    return () => window.removeEventListener(LIVE_TRADE_AUTH_CHANGE, onAuth);
  }, [reload]);

  return (
    <CredentialExchangeForm
      key={`toss-${userId}`}
      exchange="toss"
      meta={meta}
      keysReady={tossReady}
      cryptoReady={cryptoReady}
      onSaved={() => {
        void reload();
        onUpdated();
      }}
    />
  );
}
