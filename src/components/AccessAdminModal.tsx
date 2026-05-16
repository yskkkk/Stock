import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchAccessAdminRequests,
  fetchFeedbackInbox,
  postAccessAdminAllowedMemo,
  postAccessAdminApprove,
  postAccessAdminReject,
  postAccessAdminRevoke,
  type AccessAdminSnapshot,
  type AccessAllowedEntry,
  type AccessDeviceInfoPayload,
  type AccessRequestItem,
} from "../api";
import type { FeedbackInboxItem } from "../types";
import { ko } from "../i18n/ko";

const TOKEN_KEY = "stock_access_admin_token";

type AdminTab = "access" | "feedback" | "telegram";

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
  const passwordFieldRef = useRef<HTMLInputElement>(null);

  const authForApi = useCallback(() => activeToken.trim(), [activeToken]);

  const load = useCallback(
    async (token: string) => {
      const t = token.trim();
      if (!t && !adminIpBypassPassword) {
        setError(null);
        setSnapshot(null);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const data = await fetchAccessAdminRequests(t);
        setSnapshot(data);
      } catch (e) {
        setSnapshot(null);
        setError(e instanceof Error ? e.message : ko.access.adminError);
      } finally {
        setLoading(false);
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
    if (adminIpBypassPassword) {
      setPhase("admin");
      setPasswordInput("");
      setActiveToken("");
      void load("");
    } else {
      setPhase("password");
      setPasswordInput("");
      setActiveToken("");
      setSnapshot(null);
    }
  }, [open, adminIpBypassPassword, load]);

  useEffect(() => {
    if (!snapshot?.allowed) return;
    const m: Record<string, string> = {};
    for (const a of snapshot.allowed) {
      m[a.ip] = a.memo ?? "";
    }
    setMemoDrafts(m);
  }, [snapshot]);

  useEffect(() => {
    if (!open || phase !== "admin" || tab !== "feedback") return;
    let cancelled = false;
    setFeedbackBusy(true);
    setFeedbackErr(null);
    const tok = authForApi() || undefined;
    void fetchFeedbackInbox(tok)
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
  }, [open, phase, tab, authForApi, feedbackRefreshKey]);

  const reloadFeedback = () => setFeedbackRefreshKey((k) => k + 1);

  const unlock = async () => {
    const p = passwordInput.trim();
    if (!p) {
      setError(null);
      window.setTimeout(() => {
        passwordFieldRef.current?.focus();
      }, 0);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAccessAdminRequests(p);
      try {
        sessionStorage.setItem(TOKEN_KEY, p);
      } catch {
        /* ignore */
      }
      setActiveToken(p);
      setSnapshot(data);
      setPhase("admin");
    } catch {
      setSnapshot(null);
      setError(ko.access.adminWrongPassword);
      setPasswordInput("");
      window.setTimeout(() => {
        passwordFieldRef.current?.focus();
      }, 0);
    } finally {
      setLoading(false);
    }
  };

  const lockAgain = () => {
    if (adminIpBypassPassword) {
      setError(null);
      void load("");
      return;
    }
    try {
      sessionStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
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
        role="dialog"
        aria-modal="true"
        aria-labelledby="access-admin-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="access-admin-head">
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
              {tab !== "telegram" ? (
                <button
                  type="button"
                  className="btn btn--secondary"
                  disabled={loading}
                  onClick={() => {
                    if (tab === "access") void load(authForApi());
                    else reloadFeedback();
                  }}
                >
                  {tab === "feedback" ? ko.feedback.inboxReload : ko.access.adminLoad}
                </button>
              ) : null}
              <button type="button" className="btn btn--ghost" onClick={lockAgain}>
                {ko.access.adminLockAgain}
              </button>
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
                              onClick={() =>
                                void runAction(() =>
                                  postAccessAdminRevoke(authForApi(), a.ip),
                                )
                              }
                            >
                              {ko.access.adminRevoke}
                            </button>
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
