import { useCallback, useEffect, useState } from "react";
import {
  fetchAccessAdminRequests,
  postAccessAdminApprove,
  postAccessAdminReject,
  postAccessAdminRevoke,
  type AccessAdminSnapshot,
  type AccessAllowedEntry,
  type AccessRequestItem,
} from "../api";
import { ko } from "../i18n/ko";

const TOKEN_KEY = "stock_access_admin_token";

function readStoredToken() {
  try {
    return sessionStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

export default function AccessAdminModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [tokenInput, setTokenInput] = useState("");
  const [activeToken, setActiveToken] = useState("");
  const [snapshot, setSnapshot] = useState<AccessAdminSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTokenInput(readStoredToken());
    setActiveToken(readStoredToken());
    setError(null);
    setSnapshot(null);
  }, [open]);

  const load = useCallback(async (token: string) => {
    const t = token.trim();
    if (!t) {
      setError(ko.access.adminNoToken);
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
    if (!open || !activeToken.trim()) return;
    void load(activeToken);
  }, [open, activeToken, load]);

  const applyToken = () => {
    const t = tokenInput.trim();
    if (!t) {
      setError(ko.access.adminNoToken);
      return;
    }
    try {
      sessionStorage.setItem(TOKEN_KEY, t);
    } catch {
      /* ignore */
    }
    setActiveToken(t);
    setError(null);
  };

  const runAction = async (fn: () => Promise<unknown>) => {
    const t = activeToken.trim() || tokenInput.trim();
    if (!t) {
      setError(ko.access.adminNoToken);
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

        <div className="access-admin-token-row">
          <label className="access-admin-field">
            <span>{ko.access.adminTokenLabel}</span>
            <input
              type="password"
              autoComplete="off"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              placeholder={ko.access.adminTokenPlaceholder}
            />
          </label>
          <button type="button" className="btn btn--secondary" onClick={applyToken}>
            {ko.access.adminSaveToken}
          </button>
          <button
            type="button"
            className="btn btn--secondary"
            disabled={loading}
            onClick={() => void load(activeToken.trim() || tokenInput.trim())}
          >
            {ko.access.adminLoad}
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
                      <div className="access-admin-item-actions">
                        <button
                          type="button"
                          className="btn btn--primary"
                          disabled={loading && actionId === `a-${r.id}`}
                          onClick={() => {
                            setActionId(`a-${r.id}`);
                            void runAction(() =>
                              postAccessAdminApprove(activeToken.trim() || tokenInput.trim(), r.id),
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
                              postAccessAdminReject(activeToken.trim() || tokenInput.trim(), r.id),
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
                    <li key={`${a.ip}-${i}`} className="access-admin-item access-admin-item--row">
                      <code>{a.ip}</code>
                      <span className="access-admin-muted">{a.addedAt}</span>
                      <button
                        type="button"
                        className="btn btn--ghost"
                        disabled={loading}
                        onClick={() =>
                          void runAction(() =>
                            postAccessAdminRevoke(activeToken.trim() || tokenInput.trim(), a.ip),
                          )
                        }
                      >
                        {ko.access.adminRevoke}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
