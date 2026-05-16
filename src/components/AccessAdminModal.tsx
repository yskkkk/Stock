import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchAccessAdminRequests,
  postAccessAdminAllowedMemo,
  postAccessAdminApprove,
  postAccessAdminReject,
  postAccessAdminRevoke,
  type AccessAdminSnapshot,
  type AccessAllowedEntry,
  type AccessDeviceInfoPayload,
  type AccessRequestItem,
} from "../api";
import { ko } from "../i18n/ko";

const TOKEN_KEY = "stock_access_admin_token";

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
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<"password" | "admin">("password");
  const [passwordInput, setPasswordInput] = useState("");
  const [activeToken, setActiveToken] = useState("");
  const [snapshot, setSnapshot] = useState<AccessAdminSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);
  const [memoDrafts, setMemoDrafts] = useState<Record<string, string>>({});
  const [approveMemos, setApproveMemos] = useState<Record<string, string>>({});
  const passwordFieldRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async (token: string) => {
    const t = token.trim();
    if (!t) {
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
  }, []);

  useEffect(() => {
    if (!open) return;
    setPhase("password");
    setPasswordInput("");
    setActiveToken("");
    setSnapshot(null);
    setError(null);
    setMemoDrafts({});
    setApproveMemos({});
  }, [open]);

  useEffect(() => {
    if (!snapshot?.allowed) return;
    const m: Record<string, string> = {};
    for (const a of snapshot.allowed) {
      m[a.ip] = a.memo ?? "";
    }
    setMemoDrafts(m);
  }, [snapshot]);

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

  const runAction = async (fn: () => Promise<unknown>) => {
    const t = activeToken.trim();
    if (!t) {
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await fn();
      await load(t);
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
            {ko.access.adminTitle}
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
            <div className="access-admin-token-row">
              <button
                type="button"
                className="btn btn--secondary"
                disabled={loading}
                onClick={() => void load(activeToken)}
              >
                {ko.access.adminLoad}
              </button>
              <button type="button" className="btn btn--ghost" onClick={lockAgain}>
                {ko.access.adminLockAgain}
              </button>
            </div>
            {error && (
              <p className="access-admin-error" role="alert">
                {error}
              </p>
            )}
            {loading && !snapshot && <p className="access-admin-muted">{ko.macro.loading}</p>}
            {snapshot && (
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
                                    activeToken,
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
                                void runAction(() => postAccessAdminReject(activeToken, r.id));
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
                                    activeToken,
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
                                  postAccessAdminRevoke(activeToken, a.ip),
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
          </>
        )}
      </div>
    </div>
  );
}
