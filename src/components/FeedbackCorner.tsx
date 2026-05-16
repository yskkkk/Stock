import { useState } from "react";
import { postFeedbackMessage } from "../api";
import { ko } from "../i18n/ko";

export default function FeedbackCorner() {
  const [panel, setPanel] = useState<null | "submit">(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitOk, setSubmitOk] = useState(false);

  const closeAll = () => {
    setPanel(null);
    setError(null);
    setSubmitOk(false);
  };

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

  return (
    <>
      <div className="feedback-corner">
        <button
          type="button"
          className="feedback-corner__fab btn btn--secondary"
          aria-label={ko.feedback.cornerAria}
          onClick={() => {
            setSubmitOk(false);
            setError(null);
            setPanel("submit");
          }}
        >
          {ko.feedback.cornerButton}
        </button>
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
              <button type="button" className="btn btn--ghost" onClick={closeAll}>
                {ko.feedback.submitClose}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
