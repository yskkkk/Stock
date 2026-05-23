import { useEffect, useRef, useState } from "react";
import { postAdminServerRestart } from "../api";
import { ko } from "../i18n/ko";

type Phase = "idle" | "password";

export default function ServerRestartButton({
  linkClassName = "app-page-top__corner-text app-server-restart-trigger",
}: {
  linkClassName?: string;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (phase === "password") inputRef.current?.focus();
  }, [phase]);

  const cancel = () => {
    setPhase("idle");
    setPassword("");
    setError(null);
  };

  const submit = async () => {
    const pw = password.trim();
    if (!pw) {
      setError(ko.app.serverRestartPasswordRequired);
      return;
    }
    if (!window.confirm(ko.app.serverRestartConfirm)) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await postAdminServerRestart(pw);
      setPassword("");
      setPhase("idle");
      window.setTimeout(() => {
        window.location.reload();
      }, 4000);
    } catch (e) {
      setError(e instanceof Error ? e.message : ko.errors.request);
      setBusy(false);
    }
  };

  if (phase === "password") {
    return (
      <div className="app-server-restart-inline">
        <label className="app-server-restart-inline__label">
          <span className="app-page-top__corner-text app-server-restart-inline__title app-site-footer__link--active">
            {ko.app.serverRestart}
          </span>
          <input
            ref={inputRef}
            type="password"
            className="app-server-restart-inline__input"
            autoComplete="off"
            placeholder={ko.app.serverRestartPasswordPlaceholder}
            value={password}
            disabled={busy}
            onChange={(e) => {
              setPassword(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void submit();
              }
              if (e.key === "Escape") cancel();
            }}
          />
        </label>
        {error ? (
          <span className="app-server-restart-inline__err" role="alert">
            {error}
          </span>
        ) : null}
        <div className="app-server-restart-inline__actions">
          <button
            type="button"
            className="app-page-top__corner-text"
            disabled={busy}
            onClick={() => void submit()}
          >
            {busy ? ko.app.serverRestarting : ko.app.serverRestartSubmit}
          </button>
          <button
            type="button"
            className="app-page-top__corner-text"
            disabled={busy}
            onClick={cancel}
          >
            {ko.app.serverRestartCancel}
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      className={linkClassName}
      title={ko.app.serverRestartTitle}
      onClick={() => {
        setPhase("password");
        setError(null);
      }}
    >
      {ko.app.serverRestart}
    </button>
  );
}
