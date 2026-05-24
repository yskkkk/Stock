import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useState,
} from "react";
import { useModalDrag } from "../hooks/useModalDrag";
import {
  fetchFeedbackInbox,
  getStoredAccessAdminToken,
  postFeedbackAdminDelete,
  postFeedbackAdminReply,
  postFeedbackMessage,
} from "../api";
import { ko } from "../i18n/ko";
import type { FeedbackInboxItem } from "../types";

export type FeedbackSubmitKind = "issue" | "inquiry";

export type FeedbackCornerHandle = {
  openSubmit: (kind?: FeedbackSubmitKind) => void;
  openInbox: () => void;
};

type FeedbackCornerProps = {
  accessAdmin: boolean;
  /** false면 하단 푸터 링크만 사용 */
  showTrigger?: boolean;
  /** 우측 고정 레일형 트리거(데스크톱) */
  triggerLayout?: "inline" | "edge";
  onSubmitPanelChange?: (state: { kind: FeedbackSubmitKind } | null) => void;
};

function FeedbackEdgeIcon() {
  return (
    <svg
      className="feedback-edge-fab__icon"
      viewBox="0 0 24 24"
      width="20"
      height="20"
      aria-hidden
    >
      <path
        d="M12 3c4.42 0 8 2.69 8 6.01 0 1.74-.87 3.31-2.29 4.49L20 21l-5.25-2.63c-.98.28-2.02.43-3.1.43-4.42 0-8-2.69-8-6.01S7.58 3 12 3z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
      <path
        d="M8.5 10.5h7M8.5 13.5h4.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}

const FeedbackCorner = forwardRef<FeedbackCornerHandle, FeedbackCornerProps>(
  function FeedbackCorner(
    { accessAdmin, showTrigger = false, triggerLayout = "inline", onSubmitPanelChange },
    ref,
  ) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [panel, setPanel] = useState<null | "submit" | "inbox">(null);
  const [submitKind, setSubmitKind] = useState<FeedbackSubmitKind>("issue");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitOk, setSubmitOk] = useState(false);
  const [inboxItems, setInboxItems] = useState<FeedbackInboxItem[]>([]);
  const [inboxBusy, setInboxBusy] = useState(false);
  const [inboxErr, setInboxErr] = useState<string | null>(null);
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});

  const drag = useModalDrag([panel]);

  const closeAll = () => {
    setMenuOpen(false);
    setPanel(null);
    setError(null);
    setSubmitOk(false);
    setInboxErr(null);
  };

  useEffect(() => {
    if (panel === "submit") {
      onSubmitPanelChange?.({ kind: submitKind });
      return;
    }
    onSubmitPanelChange?.(null);
  }, [panel, submitKind, onSubmitPanelChange]);

  useImperativeHandle(ref, () => ({
    openSubmit: (kind: FeedbackSubmitKind = "issue") => {
      setMenuOpen(false);
      setSubmitKind(kind);
      setSubmitOk(false);
      setError(null);
      setPanel("submit");
    },
    openInbox: () => {
      setMenuOpen(false);
      setPanel("inbox");
    },
  }));

  const loadInbox = useCallback(async () => {
    setInboxBusy(true);
    setInboxErr(null);
    try {
      const d = await fetchFeedbackInbox();
      setInboxItems(d.items ?? []);
    } catch (e) {
      setInboxErr(e instanceof Error ? e.message : ko.errors.request);
      setInboxItems([]);
    } finally {
      setInboxBusy(false);
    }
  }, []);

  useEffect(() => {
    if (panel !== "inbox") return;
    void loadInbox();
  }, [panel, loadInbox]);

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

  const authTok = () => getStoredAccessAdminToken();

  const runInboxAdmin = async (fn: () => Promise<unknown>) => {
    if (!accessAdmin) {
      throw new Error(ko.errors.request);
    }
    setBusy(true);
    setInboxErr(null);
    try {
      await fn();
      await loadInbox();
    } catch (e) {
      const msg = e instanceof Error ? e.message : ko.errors.request;
      setInboxErr(msg);
      throw e;
    } finally {
      setBusy(false);
    }
  };

  const submitTitle = ko.app.footerFeedbackTitle;
  const submitPlaceholder = ko.app.footerFeedbackPlaceholder;

  return (
    <>
      {showTrigger && triggerLayout === "edge" ? (
        <div className="feedback-corner feedback-corner--edge">
          <button
            type="button"
            className={
              panel === "submit"
                ? "feedback-edge-fab feedback-edge-fab--on"
                : "feedback-edge-fab"
            }
            aria-label={ko.app.footerFeedback}
            title={ko.app.footerFeedback}
            onClick={() => {
              setMenuOpen(false);
              setSubmitKind("issue");
              setSubmitOk(false);
              setError(null);
              setPanel("submit");
            }}
          >
            <FeedbackEdgeIcon />
            <span className="feedback-edge-fab__label">{ko.app.footerFeedback}</span>
          </button>
        </div>
      ) : null}
      {showTrigger && triggerLayout === "inline" ? (
        <div className="feedback-corner">
          <button
            type="button"
            className="feedback-corner__fab app-page-top__corner-text"
            aria-label={ko.feedback.cornerAria}
            aria-expanded={menuOpen}
            onClick={() => {
              setMenuOpen((o) => !o);
              setSubmitOk(false);
              setError(null);
            }}
          >
            {ko.feedback.cornerButton}
          </button>
          {menuOpen ? (
            <div className="feedback-corner__menu" role="menu">
              <button
                type="button"
                className="feedback-corner__menu-item"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  setSubmitKind("issue");
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
                onClick={() => {
                  setMenuOpen(false);
                  setPanel("inbox");
                }}
              >
                {ko.feedback.menuInbox}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

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
            style={drag.modalStyle}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h2 id="feedback-submit-title" className="feedback-modal__title">
              {submitTitle}
            </h2>
            <textarea
              className="feedback-modal__textarea"
              rows={5}
              value={message}
              disabled={busy}
              placeholder={submitPlaceholder}
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
              <button type="button" className="btn btn--ghost" onClick={closeAll}>
                {ko.feedback.submitClose}
              </button>
            </div>
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
            aria-labelledby="feedback-inbox-title"
            style={drag.modalStyle}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="feedback-modal__head">
              <h2 id="feedback-inbox-title" className="feedback-modal__title">
                {ko.feedback.inboxTitle}
              </h2>
              <div className="feedback-modal__head-actions">
                <button
                  type="button"
                  className="btn btn--secondary"
                  disabled={inboxBusy}
                  onClick={() => void loadInbox()}
                >
                  {ko.feedback.inboxReload}
                </button>
                <button type="button" className="btn btn--ghost" onClick={closeAll}>
                  {ko.feedback.inboxClose}
                </button>
              </div>
            </div>
            {inboxBusy ? (
              <p className="feedback-modal__muted">{ko.macro.loading}</p>
            ) : inboxErr ? (
              <p className="feedback-modal__err" role="alert">
                {inboxErr}
              </p>
            ) : inboxItems.length === 0 ? (
              <p className="feedback-modal__muted">{ko.feedback.inboxEmpty}</p>
            ) : (
              <div className="feedback-inbox-list">
                <ul>
                  {inboxItems.map((it) => (
                    <li key={it.id} className="feedback-inbox-item">
                      <div className="feedback-inbox-item__meta">
                        <span>
                          <strong>{ko.feedback.inboxTime}</strong> {it.at}
                        </span>
                        <span>
                          <strong>{ko.feedback.inboxIp}</strong> <code>{it.ip}</code>
                        </span>
                      </div>
                      <pre className="feedback-inbox-item__msg">{it.message}</pre>
                      {it.userAgent ? (
                        <p className="feedback-inbox-item__ua">
                          <strong>{ko.feedback.inboxUa}</strong> {it.userAgent}
                        </p>
                      ) : null}
                      {it.comments && it.comments.length > 0 ? (
                        <div className="feedback-inbox-item__replies">
                          <strong>{ko.feedback.inboxReplies}</strong>
                          <ul>
                            {it.comments.map((c) => (
                              <li key={c.id}>
                                <span className="feedback-modal__muted">{c.at}</span>
                                <pre className="feedback-inbox-item__msg">{c.message}</pre>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      {accessAdmin ? (
                        <>
                          <label className="feedback-modal__field">
                            <span>{ko.feedback.inboxReplyFieldLabel}</span>
                            <input
                              type="text"
                              maxLength={2000}
                              value={replyDrafts[it.id] ?? ""}
                              disabled={busy}
                              placeholder={ko.feedback.inboxReplyPlaceholder}
                              onChange={(e) =>
                                setReplyDrafts((p) => ({ ...p, [it.id]: e.target.value }))
                              }
                            />
                          </label>
                          <div className="feedback-modal__actions feedback-modal__actions--inline">
                            <button
                              type="button"
                              className="btn btn--primary"
                              disabled={busy}
                              onClick={() => {
                                const msg = (replyDrafts[it.id] ?? "").trim();
                                if (!msg) return;
                                void (async () => {
                                  try {
                                    await runInboxAdmin(() =>
                                      postFeedbackAdminReply(authTok(), it.id, msg),
                                    );
                                    setReplyDrafts((p) => {
                                      const n = { ...p };
                                      delete n[it.id];
                                      return n;
                                    });
                                  } catch {
                                    /* inboxErr set */
                                  }
                                })();
                              }}
                            >
                              {ko.feedback.inboxReplySend}
                            </button>
                            <button
                              type="button"
                              className="btn btn--ghost"
                              disabled={busy}
                              onClick={() => {
                                if (!window.confirm(ko.feedback.inboxDeleteConfirm)) return;
                                void (async () => {
                                  try {
                                    await runInboxAdmin(() =>
                                      postFeedbackAdminDelete(authTok(), it.id),
                                    );
                                  } catch {
                                    /* inboxErr set */
                                  }
                                })();
                              }}
                            >
                              {ko.feedback.inboxDelete}
                            </button>
                          </div>
                        </>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
},
);

export default FeedbackCorner;
