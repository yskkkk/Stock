import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { postAdminServerRestart } from "../api";
import { ko } from "../i18n/ko";

type Phase = "idle" | "password";

export default function ServerRestartButton({
  linkClassName = "app-page-top__corner-text app-server-restart-trigger",
  textLink = false,
}: {
  linkClassName?: string;
  /** 푸터 등 — 버튼 크롬 없이 텍스트 링크처럼 */
  textLink?: boolean;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (phase === "password") inputRef.current?.focus();
  }, [phase]);

  useEffect(() => {
    if (phase !== "password") return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current?.contains(e.target as Node)) return;
      setPhase("idle");
      setPassword("");
      setError(null);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
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

  const openPassword = () => {
    setPhase("password");
    setError(null);
  };

  const onTextLinkKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openPassword();
    }
    if (e.key === "Escape" && phase === "password") cancel();
  };

  const triggerClass =
    phase === "password"
      ? `${linkClassName} app-server-restart-trigger--open`
      : linkClassName;

  const trigger = textLink ? (
    <span
      role="button"
      tabIndex={0}
      className={triggerClass}
      title={ko.app.serverRestartTitle}
      aria-expanded={phase === "password"}
      onClick={phase === "password" ? undefined : openPassword}
      onKeyDown={onTextLinkKeyDown}
    >
      {ko.app.serverRestart}
    </span>
  ) : (
    <button
      type="button"
      className={triggerClass}
      title={ko.app.serverRestartTitle}
      aria-expanded={phase === "password"}
      onClick={phase === "password" ? undefined : openPassword}
    >
      {ko.app.serverRestart}
    </button>
  );

  return (
    <span ref={wrapRef} className="app-server-restart">
      {trigger}
      {phase === "password" ? (
        <div
          className="app-server-restart-popover"
          role="dialog"
          aria-label={ko.app.serverRestart}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <input
            ref={inputRef}
            type="password"
            className="app-server-restart-popover__input"
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
          {error ? (
            <p className="app-server-restart-popover__err" role="alert">
              {error}
            </p>
          ) : null}
          <div className="app-server-restart-popover__actions">
            <button
              type="button"
              className="app-server-restart-popover__action app-server-restart-popover__action--primary"
              disabled={busy}
              onClick={() => void submit()}
            >
              {busy ? ko.app.serverRestarting : ko.app.serverRestartSubmit}
            </button>
            <span className="app-server-restart-popover__sep" aria-hidden>
              ·
            </span>
            <button
              type="button"
              className="app-server-restart-popover__action"
              disabled={busy}
              onClick={cancel}
            >
              {ko.app.serverRestartCancel}
            </button>
          </div>
        </div>
      ) : null}
    </span>
  );
}
