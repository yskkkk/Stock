import { useCallback, useEffect, useRef, useState } from "react";
import { useModalDrag } from "../hooks/useModalDrag";
import {
  clearStoredAccessAdminToken,
  fetchAccessAdminLiveTradingRunning,
  fetchAccessAdminRequests,
  fetchFeedbackInbox,
  getStoredAccessAdminToken,
  persistAccessAdminToken,
  postAccessAdminAllowedMemo,
  postAccessAdminApprove,
  postAccessAdminGrantDelegate,
  postAccessAdminReject,
  postAccessAdminRevoke,
  postAccessAdminRevokeDelegate,
  postFeedbackAdminDelete,
  postFeedbackAdminReply,
  type AccessAdminLiveTradeProgram,
  type AccessAdminLiveTradingRunningResponse,
  type AccessAdminSnapshot,
  type AccessAllowedEntry,
  type AccessDeviceInfoPayload,
  type AccessRequestItem,
} from "../api";
import type { FeedbackInboxItem } from "../types";
import { ko } from "../i18n/ko";

type AdminTab = "access" | "feedback" | "telegram" | "liveTrade";

function liveTradeStatusLabel(status: AccessAdminLiveTradeProgram["status"]): string {
  if (status === "armed") return ko.app.liveTradeStatusArmed;
  if (status === "sim") return ko.app.liveTradeStatusSim;
  return status;
}

function formatAdminProgramMarkets(
  m: { kr?: boolean; us?: boolean; crypto?: boolean } | null | undefined,
): string {
  if (!m) return "—";
  const parts: string[] = [];
  if (m.kr) parts.push(ko.app.liveTradeMarketKr);
  if (m.us) parts.push(ko.app.liveTradeMarketUs);
  if (m.crypto) parts.push(ko.app.liveTradeMarketCrypto);
  return parts.length ? parts.join(" · ") : "—";
}

function formatAdminMs(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return "—";
  return new Date(ms).toLocaleString("ko-KR");
}

function formatDeviceInfoBlock(
  d: AccessDeviceInfoPayload | null | undefined,
): string {
  if (!d || typeof d !== "object") return "";
  const parts: string[] = [];
  if (d.platform) parts.push(`platform: ${d.platform}`);
  if (d.screen) parts.push(`screen: ${d.screen}`);
  if (d.viewport) parts.push(`viewport: ${d.viewport}`);
  if (d.timezone) parts.push(`timezone: ${d.timezone}`);
  if (d.language) parts.push(`language: ${d.language}`);
  if (d.languages) parts.push(`languages: ${d.languages}`);
  if (d.hardwareConcurrency != null)
    parts.push(`hardwareConcurrency: ${d.hardwareConcurrency}`);
  if (d.deviceMemory != null) parts.push(`deviceMemory(GB): ${d.deviceMemory}`);
  if (d.maxTouchPoints != null) parts.push(`maxTouchPoints: ${d.maxTouchPoints}`);
  if (d.cookieEnabled != null) parts.push(`cookieEnabled: ${d.cookieEnabled}`);
  return parts.join("\n");
}

export default function AccessAdminModal({
  open,
  onClose,
  adminIpBypassPassword = false,
  telegramNotify,
  telegramSentCount,
  onOpenTelegramSent,
  onResetTelegram,
  resettingTelegram,
}: {
  open: boolean;
  onClose: () => void;
  /** ACCESS_ADMIN_IPS 에 등록된 IP — 비밀번호 없이 전체 탭 이용 */
  adminIpBypassPassword?: boolean;
  telegramNotify: boolean;
  telegramSentCount: number;
  onOpenTelegramSent: () => void;
  onResetTelegram: () => void | Promise<void>;
  resettingTelegram: boolean;
}) {
  const [phase, setPhase] = useState<"password" | "admin">("password");
  const [tab, setTab] = useState<AdminTab>("access");
  const [passwordInput, setPasswordInput] = useState("");
  const [activeToken, setActiveToken] = useState("");
  const [snapshot, setSnapshot] = useState<AccessAdminSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);
  const [memoDrafts, setMemoDrafts] = useState<Record<string, string>>({});
  const [approveMemos, setApproveMemos] = useState<Record<string, string>>({});
  const [feedbackItems, setFeedbackItems] = useState<FeedbackInboxItem[]>([]);
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const [feedbackErr, setFeedbackErr] = useState<string | null>(null);
  const [feedbackRefreshKey, setFeedbackRefreshKey] = useState(0);
  const [feedbackReplyDrafts, setFeedbackReplyDrafts] = useState<Record<string, string>>({});
  const [liveTradeData, setLiveTradeData] =
    useState<AccessAdminLiveTradingRunningResponse | null>(null);
  const [liveTradeBusy, setLiveTradeBusy] = useState(false);
  const [liveTradeErr, setLiveTradeErr] = useState<string | null>(null);
  const [liveTradeRefreshKey, setLiveTradeRefreshKey] = useState(0);
  const passwordFieldRef = useRef<HTMLInputElement>(null);
  const passwordFocusTimerRef = useRef<number | null>(null);
  const { modalStyle, onDragHandlePointerDown } = useModalDrag([open, phase]);

  const schedulePasswordFocus = useCallback(() => {
    if (passwordFocusTimerRef.current != null) {
      window.clearTimeout(passwordFocusTimerRef.current);
    }
    passwordFocusTimerRef.current = window.setTimeout(() => {
      passwordFocusTimerRef.current = null;
      passwordFieldRef.current?.focus();
    }, 0);
  }, []);

  useEffect(() => {
    return () => {
      if (passwordFocusTimerRef.current != null) {
        window.clearTimeout(passwordFocusTimerRef.current);
        passwordFocusTimerRef.current = null;
      }
    };
  }, []);

  const authForApi = useCallback(() => activeToken.trim(), [activeToken]);

  const load = useCallback(
    async (token: string, options?: { silent?: boolean }) => {
      const silent = Boolean(options?.silent);
      const t = token.trim();
      if (!t && !adminIpBypassPassword) {
        if (!silent) {
          setError(null);
          setSnapshot(null);
        }
        return;
      }
      if (!silent) {
        setLoading(true);
        setError(null);
      }
      try {
        const data = await fetchAccessAdminRequests(t);
        setSnapshot(data);
      } catch (e) {
        if (!silent) {
          setSnapshot(null);
          setError(e instanceof Error ? e.message : ko.access.adminError);
        }
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [adminIpBypassPassword],
  );

  useEffect(() => {
    if (!open) return;
    setError(null);
    setMemoDrafts({});
    setApproveMemos({});
    setTab("access");
    setFeedbackItems([]);
    setFeedbackErr(null);
    setFeedbackRefreshKey(0);
    setLiveTradeData(null);
    setLiveTradeErr(null);
    setLiveTradeRefreshKey(0);
    if (adminIpBypassPassword) {
      setPhase("admin");
      setPasswordInput("");
      setActiveToken("");
      void load("");
      return;
    }
    const saved = getStoredAccessAdminToken();
    if (saved) {
      setPhase("admin");
      setActiveToken(saved);
      setSnapshot(null);
      setLoading(true);
      void fetchAccessAdminRequests(saved)
        .then((data) => {
          setSnapshot(data);
        })
        .catch(() => {
          clearStoredAccessAdminToken();
          setPhase("password");
          setActiveToken("");
          setSnapshot(null);
          setPasswordInput("");
        })
        .finally(() => setLoading(false));
    } else {
      setPhase("password");
      setPasswordInput("");
      setActiveToken("");
      setSnapshot(null);
    }
  }, [open, adminIpBypassPassword, load]);

  useEffect(() => {
    if (!open || phase !== "password" || adminIpBypassPassword) return;
    schedulePasswordFocus();
  }, [open, phase, adminIpBypassPassword, schedulePasswordFocus]);

  /** 폴링으로 스냅샷이 갱신돼도 입력 중인 메모 초기화 방지 — 서버와 같을 때만 동기 */
  useEffect(() => {
    if (!snapshot?.allowed) return;
    setMemoDrafts((prev) => {
      const next: Record<string, string> = { ...prev };
      const ips = new Set(snapshot.allowed.map((a) => a.ip));
      for (const a of snapshot.allowed) {
        const serverMemo = a.memo ?? "";
        if (next[a.ip] === undefined) next[a.ip] = serverMemo;
        else if (next[a.ip] === serverMemo) next[a.ip] = serverMemo;
      }
      for (const k of Object.keys(next)) {
        if (!ips.has(k)) delete next[k];
      }
      return next;
    });
  }, [snapshot]);

  useEffect(() => {
    if (!open || phase !== "admin" || tab !== "access") return;
    const id = window.setInterval(() => {
      void load(authForApi(), { silent: true });
    }, 2500);
    return () => window.clearInterval(id);
  }, [open, phase, tab, load, authForApi]);

  useEffect(() => {
    if (!open || phase !== "admin" || tab !== "feedback") return;
    let cancelled = false;
    setFeedbackBusy(true);
    setFeedbackErr(null);
    void fetchFeedbackInbox()
      .then((d) => {
        if (!cancelled) setFeedbackItems(d.items ?? []);
      })
      .catch((e) => {
        if (!cancelled) {
          setFeedbackErr(e instanceof Error ? e.message : ko.errors.request);
          setFeedbackItems([]);
        }
      })
      .finally(() => {
        if (!cancelled) setFeedbackBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, phase, tab, feedbackRefreshKey]);

  const reloadFeedback = () => setFeedbackRefreshKey((k) => k + 1);
  const reloadLiveTrade = () => setLiveTradeRefreshKey((k) => k + 1);

  const unlock = async () => {
    const p = passwordInput.trim();
    if (!p) {
      setError(null);
      schedulePasswordFocus();
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAccessAdminRequests(p);
      persistAccessAdminToken(p);
      setActiveToken(p);
      setSnapshot(data);
      setPhase("admin");
    } catch {
      setSnapshot(null);
      setError(ko.access.adminWrongPassword);
      setPasswordInput("");
      schedulePasswordFocus();
    } finally {
      setLoading(false);
    }
  };

  const lockAgain = () => {
    if (adminIpBypassPassword) return;
    clearStoredAccessAdminToken();
    setActiveToken("");
    setSnapshot(null);
    setPhase("password");
    setPasswordInput("");
    setError(null);
    setMemoDrafts({});
    setApproveMemos({});
  };

  const canUseAccessApi = () =>
    Boolean(authForApi().trim()) || adminIpBypassPassword;

  const runAction = async (fn: () => Promise<unknown>) => {
    if (!canUseAccessApi()) {
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await fn();
      await load(authForApi());
    } catch (e) {
      setError(e instanceof Error ? e.message : ko.access.adminError);
    } finally {
      setLoading(false);
      setActionId(null);
    }
  };

  const runFeedbackAdminAction = async (fn: () => Promise<unknown>) => {
    if (!canUseAccessApi()) return;
    setLoading(true);
    setFeedbackErr(null);
    try {
      await fn();
      const d = await fetchFeedbackInbox();
      setFeedbackItems(d.items ?? []);
    } catch (e) {
      setFeedbackErr(e instanceof Error ? e.message : ko.errors.request);
    } finally {
      setLoading(false);
      setActionId(null);
    }
  };

  const loadLiveTradeRunning = useCallback(async () => {
    if (!canUseAccessApi()) return;
    setLiveTradeBusy(true);
    setLiveTradeErr(null);
    try {
      const data = await fetchAccessAdminLiveTradingRunning(authForApi());
      setLiveTradeData(data);
    } catch (e) {
      setLiveTradeData(null);
      setLiveTradeErr(e instanceof Error ? e.message : ko.errors.request);
    } finally {
      setLiveTradeBusy(false);
    }
  }, [authForApi, adminIpBypassPassword]);

  useEffect(() => {
    if (!open || phase !== "admin" || tab !== "liveTrade") return;
    void loadLiveTradeRunning();
  }, [open, phase, tab, liveTradeRefreshKey, loadLiveTradeRunning]);

  useEffect(() => {
    if (!open || phase !== "admin" || tab !== "liveTrade") return;
    const id = window.setInterval(() => {
      void loadLiveTradeRunning();
    }, 5000);
    return () => window.clearInterval(id);
  }, [open, phase, tab, loadLiveTradeRunning]);

  if (!open) return null;

  return (
    <div
      className="access-admin-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="access-admin-modal card"
        style={modalStyle}
        role="dialog"
        aria-modal="true"
        aria-labelledby="access-admin-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div
          className="access-admin-head modal-drag-handle"
          onPointerDown={onDragHandlePointerDown}
        >
          <h2 id="access-admin-title" className="access-admin-title">
            {ko.access.adminConsoleTitle}
          </h2>
          <button type="button" className="btn btn--ghost access-admin-close" onClick={onClose}>
            {ko.access.adminClose}
          </button>
        </div>

        {phase === "password" ? (
          <>
            <div className="access-admin-token-row">
              <label className="access-admin-field">
                <span>{ko.access.adminPasswordLabel}</span>
                <input
                  ref={passwordFieldRef}
                  type="password"
                  autoComplete="current-password"
                  value={passwordInput}
                  disabled={loading}
                  onChange={(e) => setPasswordInput(e.target.value)}
                  placeholder={ko.access.adminTokenPlaceholder}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !loading) {
                      e.preventDefault();
                      void unlock();
                    }
                  }}
                />
              </label>
              <button
                type="button"
                className="btn btn--primary"
                disabled={loading}
                onClick={() => void unlock()}
              >
                {ko.access.adminConfirm}
              </button>
            </div>
            {error && (
              <p className="access-admin-error" role="alert">
                {error}
              </p>
            )}
            {loading && <p className="access-admin-muted">{ko.macro.loading}</p>}
          </>
        ) : (
          <>
            {adminIpBypassPassword ? (
              <p className="access-admin-muted access-admin-ip-banner" role="status">
                {ko.access.adminIpBanner}
              </p>
            ) : null}

            <div className="access-admin-tabs" role="tablist" aria-label={ko.access.adminTabListAria}>
              <button
                type="button"
                role="tab"
                aria-selected={tab === "access"}
                className={`access-admin-tab${tab === "access" ? " access-admin-tab--active" : ""}`}
                onClick={() => setTab("access")}
              >
                {ko.access.adminTabAccess}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === "feedback"}
                className={`access-admin-tab${tab === "feedback" ? " access-admin-tab--active" : ""}`}
                onClick={() => setTab("feedback")}
              >
                {ko.access.adminTabFeedback}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === "liveTrade"}
                className={`access-admin-tab${tab === "liveTrade" ? " access-admin-tab--active" : ""}`}
                onClick={() => setTab("liveTrade")}
              >
                {ko.access.adminTabLiveTrade}
              </button>
              {telegramNotify ? (
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === "telegram"}
                  className={`access-admin-tab${tab === "telegram" ? " access-admin-tab--active" : ""}`}
                  onClick={() => setTab("telegram")}
                >
                  {ko.access.adminTabTelegram}
                </button>
              ) : null}
            </div>

            <div className="access-admin-token-row">
              {tab === "feedback" ? (
                <button
                  type="button"
                  className="btn btn--secondary"
                  disabled={loading}
                  onClick={() => reloadFeedback()}
                >
                  {ko.feedback.inboxReload}
                </button>
              ) : null}
              {tab === "liveTrade" ? (
                <button
                  type="button"
                  className="btn btn--secondary"
                  disabled={liveTradeBusy}
                  onClick={() => reloadLiveTrade()}
                >
                  {ko.access.adminLiveTradeReload}
                </button>
              ) : null}
              {!adminIpBypassPassword ? (
                <button type="button" className="btn btn--ghost" onClick={lockAgain}>
                  {ko.access.adminLockAgain}
                </button>
              ) : null}
            </div>
            {error && tab === "access" && (
              <p className="access-admin-error" role="alert">
                {error}
              </p>
            )}
            {loading && tab === "access" && !snapshot && (
              <p className="access-admin-muted">{ko.macro.loading}</p>
            )}

            {tab === "access" && snapshot && (
              <div className="access-admin-body">
                <section className="access-admin-section">
                  <h3>{ko.access.adminPending}</h3>
                  {snapshot.pending.length === 0 ? (
                    <p className="access-admin-muted">{ko.access.adminEmptyPending}</p>
                  ) : (
                    <ul className="access-admin-list">
                      {snapshot.pending.map((r: AccessRequestItem) => (
                        <li key={r.id} className="access-admin-item">
                          <div className="access-admin-item-head">
                            <code>{r.ip}</code>
                            <span className="access-admin-muted">
                              {ko.access.adminRequestedAt}: {r.requestedAt}
                            </span>
                          </div>
                          {r.message ? <p className="access-admin-msg">{r.message}</p> : null}
                          <p className="access-admin-ua">
                            {ko.access.adminUa}: {r.userAgent}
                          </p>
                          {formatDeviceInfoBlock(r.deviceInfo) ? (
                            <pre className="access-admin-device">
                              {formatDeviceInfoBlock(r.deviceInfo)}
                            </pre>
                          ) : null}
                          <label className="access-admin-field access-admin-field--block">
                            <span>{ko.access.adminMemoLabel}</span>
                            <input
                              type="text"
                              maxLength={300}
                              value={approveMemos[r.id] ?? ""}
                              onChange={(e) =>
                                setApproveMemos((prev) => ({
                                  ...prev,
                                  [r.id]: e.target.value,
                                }))
                              }
                              placeholder={ko.access.adminMemoPlaceholder}
                            />
                          </label>
                          <div className="access-admin-item-actions">
                            <button
                              type="button"
                              className="btn btn--primary"
                              disabled={loading && actionId === `a-${r.id}`}
                              onClick={() => {
                                setActionId(`a-${r.id}`);
                                void runAction(() =>
                                  postAccessAdminApprove(
                                    authForApi(),
                                    r.id,
                                    approveMemos[r.id],
                                  ),
                                );
                              }}
                            >
                              {ko.access.adminApprove}
                            </button>
                            <button
                              type="button"
                              className="btn btn--secondary"
                              disabled={loading && actionId === `r-${r.id}`}
                              onClick={() => {
                                setActionId(`r-${r.id}`);
                                void runAction(() =>
                                  postAccessAdminReject(authForApi(), r.id),
                                );
                              }}
                            >
                              {ko.access.adminReject}
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section className="access-admin-section">
                  <h3>{ko.access.adminAllowed}</h3>
                  {snapshot.allowed.length === 0 ? (
                    <p className="access-admin-muted">{ko.access.adminEmptyAllowed}</p>
                  ) : (
                    <ul className="access-admin-list">
                      {snapshot.allowed.map((a: AccessAllowedEntry, i: number) => (
                        <li key={`${a.ip}-${i}`} className="access-admin-item">
                          <div className="access-admin-item-head">
                            <code>{a.ip}</code>
                            <span className="access-admin-muted">{a.addedAt}</span>
                          </div>
                          {a.requestMessage || a.note ? (
                            <p className="access-admin-muted access-admin-request-msg">
                              {ko.access.adminRequestMessage}:{" "}
                              {a.requestMessage ?? a.note}
                            </p>
                          ) : null}
                          <label className="access-admin-field access-admin-field--block">
                            <span>{ko.access.adminMemoLabel}</span>
                            <input
                              type="text"
                              maxLength={300}
                              value={memoDrafts[a.ip] ?? ""}
                              onChange={(e) =>
                                setMemoDrafts((prev) => ({
                                  ...prev,
                                  [a.ip]: e.target.value,
                                }))
                              }
                              placeholder={ko.access.adminMemoPlaceholder}
                            />
                          </label>
                          <div className="access-admin-item-actions">
                            <button
                              type="button"
                              className="btn btn--secondary"
                              disabled={loading && actionId === `m-${a.ip}`}
                              onClick={() => {
                                setActionId(`m-${a.ip}`);
                                void runAction(() =>
                                  postAccessAdminAllowedMemo(
                                    authForApi(),
                                    a.ip,
                                    (memoDrafts[a.ip] ?? "").trim(),
                                  ),
                                );
                              }}
                            >
                              {ko.access.adminMemoSave}
                            </button>
                            <button
                              type="button"
                              className="btn btn--ghost"
                              disabled={loading}
                              onClick={() => {
                                if (
                                  !window.confirm(
                                    ko.access.adminRevokeConfirm.replace("{ip}", a.ip),
                                  )
                                ) {
                                  return;
                                }
                                void runAction(() =>
                                  postAccessAdminRevoke(authForApi(), a.ip),
                                );
                              }}
                            >
                              {ko.access.adminRevoke}
                            </button>
                          </div>
                          <div className="access-admin-item-actions access-admin-item-actions--delegate">
                            {a.adminDelegate ? (
                              <span className="access-admin-delegate-badge">
                                {ko.feedback.accessDelegateBadge}
                              </span>
                            ) : null}
                            {!a.adminDelegate ? (
                              <button
                                type="button"
                                className="btn btn--secondary"
                                disabled={loading && actionId === `gd-${a.ip}`}
                                onClick={() => {
                                  if (!window.confirm(ko.feedback.accessDelegateConfirm)) return;
                                  setActionId(`gd-${a.ip}`);
                                  void runAction(() =>
                                    postAccessAdminGrantDelegate(authForApi(), a.ip),
                                  );
                                }}
                              >
                                {ko.feedback.accessGrantDelegate}
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="btn btn--secondary"
                                disabled={loading && actionId === `rd-${a.ip}`}
                                onClick={() => {
                                  if (!window.confirm(ko.feedback.accessRevokeDelegateConfirm)) return;
                                  setActionId(`rd-${a.ip}`);
                                  void runAction(() =>
                                    postAccessAdminRevokeDelegate(authForApi(), a.ip),
                                  );
                                }}
                              >
                                {ko.feedback.accessRevokeDelegate}
                              </button>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </div>
            )}

            {tab === "feedback" && (
              <div className="access-admin-body access-admin-body--feedback">
                {feedbackBusy ? (
                  <p className="access-admin-muted">{ko.telegramSent.loading}</p>
                ) : feedbackErr ? (
                  <p className="access-admin-error" role="alert">
                    {feedbackErr}
                  </p>
                ) : feedbackItems.length === 0 ? (
                  <p className="access-admin-muted">{ko.feedback.inboxEmpty}</p>
                ) : (
                  <ul className="access-admin-feedback-list">
                    {feedbackItems.map((it) => (
                      <li key={it.id} className="access-admin-feedback-item">
                        <div className="access-admin-feedback-meta">
                          <span>
                            <strong>{ko.feedback.inboxTime}</strong> {it.at}
                          </span>
                          <span>
                            <strong>{ko.feedback.inboxIp}</strong>{" "}
                            <code>{it.ip}</code>
                          </span>
                        </div>
                        <pre className="access-admin-feedback-msg">{it.message}</pre>
                        {it.userAgent ? (
                          <p className="access-admin-ua">
                            <strong>{ko.feedback.inboxUa}</strong> {it.userAgent}
                          </p>
                        ) : null}
                        {it.comments && it.comments.length > 0 ? (
                          <div className="access-admin-feedback-comments">
                            <strong className="access-admin-feedback-comments__title">
                              {ko.feedback.inboxReplies}
                            </strong>
                            <ul>
                              {it.comments.map((c) => (
                                <li key={c.id}>
                                  <span className="access-admin-muted">{c.at}</span>
                                  <pre className="access-admin-feedback-comment-msg">{c.message}</pre>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                        <label className="access-admin-field access-admin-field--block">
                          <span>{ko.feedback.inboxReplyFieldLabel}</span>
                          <input
                            type="text"
                            maxLength={2000}
                            value={feedbackReplyDrafts[it.id] ?? ""}
                            disabled={loading}
                            onChange={(e) =>
                              setFeedbackReplyDrafts((prev) => ({
                                ...prev,
                                [it.id]: e.target.value,
                              }))
                            }
                            placeholder={ko.feedback.inboxReplyPlaceholder}
                          />
                        </label>
                        <div className="access-admin-item-actions">
                          <button
                            type="button"
                            className="btn btn--primary"
                            disabled={loading && actionId === `fr-${it.id}`}
                            onClick={() => {
                              const msg = (feedbackReplyDrafts[it.id] ?? "").trim();
                              if (!msg) return;
                              setActionId(`fr-${it.id}`);
                              void runFeedbackAdminAction(() =>
                                postFeedbackAdminReply(authForApi(), it.id, msg),
                              ).then(() => {
                                setFeedbackReplyDrafts((prev) => {
                                  const next = { ...prev };
                                  delete next[it.id];
                                  return next;
                                });
                              });
                            }}
                          >
                            {ko.feedback.inboxReplySend}
                          </button>
                          <button
                            type="button"
                            className="btn btn--ghost"
                            disabled={loading && actionId === `fd-${it.id}`}
                            onClick={() => {
                              if (!window.confirm(ko.feedback.inboxDeleteConfirm)) return;
                              setActionId(`fd-${it.id}`);
                              void runFeedbackAdminAction(() =>
                                postFeedbackAdminDelete(authForApi(), it.id),
                              );
                            }}
                          >
                            {ko.feedback.inboxDelete}
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {tab === "liveTrade" && (
              <div className="access-admin-body access-admin-body--live-trade">
                {liveTradeData ? (
                  <p className="access-admin-muted access-admin-live-trade-summary">
                    {ko.access.adminLiveTradeSummary
                      .replace("{armed}", String(liveTradeData.armedCount))
                      .replace("{sim}", String(liveTradeData.simCount))}
                    {liveTradeData.totalPrograms > liveTradeData.programs.length
                      ? ` · 전체 등록 ${liveTradeData.totalPrograms}`
                      : null}
                  </p>
                ) : null}
                {liveTradeBusy && !liveTradeData ? (
                  <p className="access-admin-muted">{ko.macro.loading}</p>
                ) : liveTradeErr ? (
                  <p className="access-admin-error" role="alert">
                    {liveTradeErr}
                  </p>
                ) : !(liveTradeData?.programs?.length) ? (
                  <p className="access-admin-muted">{ko.access.adminLiveTradeEmpty}</p>
                ) : (
                  <ul className="access-admin-list access-admin-live-trade-list">
                    {(liveTradeData?.programs ?? []).map((p) => (
                      <li key={p.id} className="access-admin-item access-admin-live-trade-item">
                        <div className="access-admin-item-head">
                          <strong>{p.name}</strong>
                          <span
                            className={
                              p.status === "armed"
                                ? "access-admin-live-trade-badge access-admin-live-trade-badge--armed"
                                : "access-admin-live-trade-badge access-admin-live-trade-badge--sim"
                            }
                          >
                            {liveTradeStatusLabel(p.status)}
                          </span>
                        </div>
                        <dl className="access-admin-live-trade-meta">
                          <div>
                            <dt>{ko.access.adminLiveTradeUser}</dt>
                            <dd>
                              <code>{p.userId ?? "—"}</code>
                            </dd>
                          </div>
                          <div>
                            <dt>{ko.access.adminLiveTradeMarkets}</dt>
                            <dd>{formatAdminProgramMarkets(p.markets)}</dd>
                          </div>
                          <div>
                            <dt>{ko.access.adminLiveTradeModel}</dt>
                            <dd>
                              <code>{p.modelId}</code>
                            </dd>
                          </div>
                          <div>
                            <dt>{ko.access.adminLiveTradeProgramId}</dt>
                            <dd>
                              <code>{p.id}</code>
                            </dd>
                          </div>
                          <div>
                            <dt>{ko.access.adminLiveTradeArmedAt}</dt>
                            <dd>{formatAdminMs(p.armedAtMs)}</dd>
                          </div>
                          <div>
                            <dt>{ko.access.adminLiveTradeLastRun}</dt>
                            <dd>{formatAdminMs(p.lastRunAtMs)}</dd>
                          </div>
                        </dl>
                        {p.status === "armed" &&
                        (p.armedMarkets?.kr || p.armedMarkets?.crypto) ? (
                          <p className="access-admin-muted access-admin-live-trade-lanes">
                            {p.armedMarkets?.kr ? ko.app.liveTradeMarketKr : null}
                            {p.armedMarkets?.kr && p.armedMarkets?.crypto ? " · " : null}
                            {p.armedMarkets?.crypto ? ko.app.liveTradeMarketCrypto : null}
                          </p>
                        ) : null}
                        {p.lastError ? (
                          <p className="access-admin-error access-admin-live-trade-error">
                            {p.lastError}
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {tab === "telegram" && telegramNotify && (
              <div className="access-admin-body access-admin-body--telegram">
                <p className="access-admin-muted">
                  {ko.app.telegramListAria} · {telegramSentCount}
                </p>
                <div className="access-admin-item-actions">
                  <button
                    type="button"
                    className="btn btn--secondary"
                    onClick={() => {
                      onClose();
                      onOpenTelegramSent();
                    }}
                  >
                    {ko.access.adminTelegramOpenList}
                  </button>
                  <button
                    type="button"
                    className="btn btn--primary"
                    disabled={resettingTelegram}
                    onClick={() => void onResetTelegram()}
                  >
                    {ko.app.telegramResetLabel}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
