import { useCallback, useEffect, useRef, useState } from "react";
import { fetchFeedbackInbox, postFeedbackMessage } from "../api";
import { ko } from "../i18n/ko";
import type { FeedbackInboxItem } from "../types";

const TOKEN_KEY = "stock_feedback_inbox_token";

export default function FeedbackCorner({
  inboxEnabled,
}: {
  inboxEnabled: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [panel, setPanel] = useState<
    null | "submit" | "inbox-unlock" | "inbox"
  >(null);
  const [message, setMessage] = useState("");
  const [password, setPassword] = useState("");
  const [items, setItems] = useState<FeedbackInboxItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitOk, setSubmitOk] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const readStoredToken = () => {
    try {
      return sessionStorage.getItem(TOKEN_KEY) ?? "";
    } catch {
      return "";
    }
  };

  const saveToken = (t: string) => {
    try {
      sessionStorage.setItem(TOKEN_KEY, t.trim());
    } catch {
      /* ignore */
    }
  };

  const clearToken = () => {
    try {
      sessionStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
  };

  const closeAll = () => {
    setMenuOpen(false);
    setPanel(null);
    setError(null);
    setSubmitOk(false);
    setPassword("");
  };

  useEffect(() => {
    if (!menuOpen) return;
    const fn = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", fn);
    return () => window.removeEventListener("mousedown", fn);
  }, [menuOpen]);

  const loadInbox = useCallback(async (token: string) => {
    setBusy(true);
    setError(null);
    try {
      const data = await fetchFeedbackInbox(token);
      setItems(data.items ?? []);
      saveToken(token);
      setPanel("inbox");
    } catch (e) {
      clearToken();
      setError(e instanceof Error ? e.message : ko.errors.request);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (panel !== "inbox-unlock" || !inboxEnabled) return;
    const t = readStoredToken();
    if (!t) return;
    void loadInbox(t);
  }, [panel, inboxEnabled, loadInbox]);

  const handleSubmitFeedback = async () => {
    const text = message.trim();
    if (!text) return;
    setBusy(true);
    setError(null);
    try {
      await postFeedbackMessage(text);
      setSubmitOk(true);
      setMessage("");
    } catch (e) {
      setError(e instanceof Error ? e.message : ko.errors.request);
    } finally {
      setBusy(false);
    }
  };

  const handleUnlock = () => {
    const t = password.trim();
    if (!t) return;
    void loadInbox(t);
  };

  const handleInboxLock = () => {
    clearToken();
    setPassword("");
    setItems([]);
    setPanel(null);
    setMenuOpen(false);
  };

  return (
    <>
      <div className="feedback-corner" ref={menuRef}>
        <button
          type="button"
          className="feedback-corner__fab btn btn--secondary"
          aria-expanded={menuOpen}
          aria-haspopup="true"
          aria-label={ko.feedback.cornerAria}
          onClick={() => setMenuOpen((o) => !o)}
        >
          {ko.feedback.cornerButton}
        </button>
        {menuOpen && (
          <div className="feedback-corner__menu card" role="menu">
            <button
              type="button"
              className="feedback-corner__menu-item"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                setSubmitOk(false);
                setError(null);
                setPanel("submit");
              }}
            >
              {ko.feedback.menuSubmit}
            </button>
            <button
              type="button"
              className="feedback-corner__menu-item"
              role="menuitem"
              disabled={!inboxEnabled}
              title={
                !inboxEnabled ? ko.feedback.inboxHintNoServer : undefined
              }
              onClick={() => {
                if (!inboxEnabled) return;
                setMenuOpen(false);
                setError(null);
                setPassword("");
                setPanel("inbox-unlock");
              }}
            >
              {ko.feedback.menuInbox}
            </button>
          </div>
        )}
      </div>

      {panel === "submit" && (
        <div
          className="feedback-modal-backdrop"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeAll();
          }}
        >
          <div
            className="feedback-modal card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="feedback-submit-title"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h2 id="feedback-submit-title" className="feedback-modal__title">
              {ko.feedback.submitTitle}
            </h2>
            <textarea
              className="feedback-modal__textarea"
              rows={5}
              value={message}
              disabled={busy}
              placeholder={ko.feedback.submitPlaceholder}
              onChange={(e) => setMessage(e.target.value)}
            />
            {error && (
              <p className="feedback-modal__err" role="alert">
                {error}
              </p>
            )}
            {submitOk && (
              <p className="feedback-modal__ok" role="status">
                {ko.feedback.submitOk}
              </p>
            )}
            <div className="feedback-modal__actions">
              <button
                type="button"
                className="btn btn--primary"
                disabled={busy || !message.trim()}
                onClick={() => void handleSubmitFeedback()}
              >
                {ko.feedback.submitSend}
              </button>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={closeAll}
              >
                {ko.feedback.submitClose}
              </button>
            </div>
          </div>
        </div>
      )}

      {panel === "inbox-unlock" && (
        <div
          className="feedback-modal-backdrop"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeAll();
          }}
        >
          <div
            className="feedback-modal card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="feedback-inbox-title"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h2 id="feedback-inbox-title" className="feedback-modal__title">
              {ko.feedback.inboxTitle}
            </h2>
            {busy && !error ? (
              <p className="feedback-modal__muted">{ko.telegramSent.loading}</p>
            ) : (
              <>
                <label className="feedback-modal__field">
                  <span>{ko.feedback.inboxPasswordLabel}</span>
                  <input
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    disabled={busy}
                    placeholder={ko.feedback.inboxPasswordPlaceholder}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !busy) handleUnlock();
                    }}
                  />
                </label>
                {error && (
                  <p className="feedback-modal__err" role="alert">
                    {error}
                  </p>
                )}
                <div className="feedback-modal__actions">
                  <button
                    type="button"
                    className="btn btn--primary"
                    disabled={busy || !password.trim()}
                    onClick={() => void handleUnlock()}
                  >
                    {ko.feedback.inboxUnlock}
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost"
                    onClick={closeAll}
                  >
                    {ko.feedback.inboxClose}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {panel === "inbox" && (
        <div
          className="feedback-modal-backdrop"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeAll();
          }}
        >
          <div
            className="feedback-modal feedback-modal--wide card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="feedback-inbox-list-title"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="feedback-modal__head">
              <h2 id="feedback-inbox-list-title" className="feedback-modal__title">
                {ko.feedback.inboxTitle}
              </h2>
              <div className="feedback-modal__head-actions">
                <button
                  type="button"
                  className="btn btn--secondary"
                  disabled={busy}
                  onClick={() => {
                    const t = readStoredToken();
                    if (t) void loadInbox(t);
                  }}
                >
                  {ko.feedback.inboxReload}
                </button>
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={handleInboxLock}
                >
                  {ko.feedback.inboxLock}
                </button>
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={closeAll}
                >
                  {ko.feedback.inboxClose}
                </button>
              </div>
            </div>
            {error && (
              <p className="feedback-modal__err" role="alert">
                {error}
              </p>
            )}
            <div className="feedback-inbox-list">
              {items.length === 0 ? (
                <p className="feedback-modal__muted">{ko.feedback.inboxEmpty}</p>
              ) : (
                <ul>
                  {items.map((it) => (
                    <li key={it.id} className="feedback-inbox-item">
                      <div className="feedback-inbox-item__meta">
                        <span>
                          <strong>{ko.feedback.inboxTime}</strong> {it.at}
                        </span>
                        <span>
                          <strong>{ko.feedback.inboxIp}</strong>{" "}
                          <code>{it.ip}</code>
                        </span>
                      </div>
                      <pre className="feedback-inbox-item__msg">{it.message}</pre>
                      {it.userAgent ? (
                        <p className="feedback-inbox-item__ua">
                          <strong>{ko.feedback.inboxUa}</strong> {it.userAgent}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
