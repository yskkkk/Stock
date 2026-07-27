import { useCallback, useEffect, useMemo, useState } from "react";
import {
  backupVirtualFeedback,
  deleteVirtualFeedback,
  fetchVirtualUsers,
  implementVirtualFeedback,
  patchVirtualPersona,
  runVirtualUsers,
  setVirtualFeedbackStatus,
  type VirtualFeedback,
  type VirtualPersona,
} from "../api";
import { ko } from "../i18n/ko";
import "./virtual-users-admin.css";

function severityLabel(s: VirtualFeedback["severity"]): string {
  if (s === "blocker") return ko.access.vuSeverityBlocker;
  if (s === "major") return ko.access.vuSeverityMajor;
  if (s === "nit") return ko.access.vuSeverityNit;
  return ko.access.vuSeverityMinor;
}

function statusLabel(s: VirtualFeedback["status"]): string {
  if (s === "queued") return ko.access.vuStatusQueued;
  if (s === "done") return ko.access.vuStatusDone;
  if (s === "dismissed") return ko.access.vuStatusDismissed;
  return ko.access.vuStatusNew;
}

export default function VirtualUsersAdminPanel({
  adminToken,
}: {
  adminToken: string;
}) {
  const [personas, setPersonas] = useState<VirtualPersona[]>([]);
  const [feedback, setFeedback] = useState<VirtualFeedback[]>([]);
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "new" | "queued" | "done">("all");

  const reload = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetchVirtualUsers(adminToken);
      setPersonas(res.personas ?? []);
      setFeedback(res.feedback ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [adminToken]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const visible = useMemo(() => {
    if (filter === "all") return feedback;
    return feedback.filter((f) => f.status === filter);
  }, [feedback, filter]);

  const onRun = async () => {
    if (running) return;
    setRunning(true);
    setErr(null);
    setMsg(null);
    try {
      const res = await runVirtualUsers(
        { notifyTelegram: true, useBrowser: true },
        adminToken,
      );
      if (!res.ok) {
        setErr(res.error || ko.access.vuRunFail);
        return;
      }
      const warn =
        res.warnings?.length
          ? ` · 경고 ${res.warnings.length}건`
          : "";
      setMsg(
        `${ko.access.vuRunOk.replace("{n}", String(res.createdCount ?? 0))}${warn}${
          res.mode ? ` (${res.mode})` : ""
        }`,
      );
      await reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  const onTogglePersona = async (p: VirtualPersona) => {
    setActionId(`p-${p.id}`);
    try {
      const res = await patchVirtualPersona(
        p.id,
        { enabled: !p.enabled },
        adminToken,
      );
      if (res.personas) setPersonas(res.personas);
      else await reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setActionId(null);
    }
  };

  const onImplement = async (id: string) => {
    if (!window.confirm(ko.access.vuImplementConfirm)) return;
    setActionId(`impl-${id}`);
    setErr(null);
    setMsg(null);
    try {
      const res = await implementVirtualFeedback(id, adminToken);
      if (!res.ok) {
        setErr(res.error || ko.access.vuImplementFail);
        return;
      }
      setMsg(res.message || ko.access.vuImplementOk);
      if (res.item) {
        setFeedback((prev) => prev.map((f) => (f.id === id ? res.item! : f)));
      } else {
        await reload();
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setActionId(null);
    }
  };

  const onBackup = async (id: string) => {
    setActionId(`bak-${id}`);
    setErr(null);
    setMsg(null);
    try {
      const res = await backupVirtualFeedback(id, adminToken);
      if (!res.ok) {
        setErr(res.error || ko.access.vuBackupFail);
        return;
      }
      setMsg(
        ko.access.vuBackupOk.replace("{path}", res.dir || res.backupId || ""),
      );
      if (res.item) {
        setFeedback((prev) => prev.map((f) => (f.id === id ? res.item! : f)));
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setActionId(null);
    }
  };

  const onDone = async (id: string) => {
    setActionId(`done-${id}`);
    try {
      const res = await setVirtualFeedbackStatus(id, "done", adminToken);
      if (res.item) {
        setFeedback((prev) => prev.map((f) => (f.id === id ? res.item! : f)));
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setActionId(null);
    }
  };

  const onDelete = async (id: string) => {
    if (!window.confirm(ko.access.vuDeleteConfirm)) return;
    setActionId(`del-${id}`);
    try {
      await deleteVirtualFeedback(id, adminToken);
      setFeedback((prev) => prev.filter((f) => f.id !== id));
      if (expandedId === id) setExpandedId(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setActionId(null);
    }
  };

  return (
    <div className="vu-admin">
      <p className="vu-admin__intro">{ko.access.vuIntro}</p>

      <section className="vu-admin__section" aria-label={ko.access.vuPersonas}>
        <div className="vu-admin__section-head">
          <h3>{ko.access.vuPersonas}</h3>
          <div className="vu-admin__actions">
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              disabled={busy || running}
              onClick={() => void reload()}
            >
              {ko.access.vuReload}
            </button>
            <button
              type="button"
              className="btn btn--primary btn--sm"
              disabled={busy || running}
              onClick={() => void onRun()}
            >
              {running ? ko.access.vuRunning : ko.access.vuRun}
            </button>
          </div>
        </div>
        <ul className="vu-admin__persona-list">
          {personas.map((p) => (
            <li key={p.id} className={p.enabled ? "" : "is-off"}>
              <button
                type="button"
                className={
                  p.enabled
                    ? "vu-admin__persona-toggle is-on"
                    : "vu-admin__persona-toggle is-off"
                }
                disabled={actionId === `p-${p.id}`}
                onClick={() => void onTogglePersona(p)}
              >
                {p.enabled ? ko.access.vuPersonaOn : ko.access.vuPersonaOff}
              </button>
              <div className="vu-admin__persona-body">
                <strong>{p.name}</strong>
                <span>
                  {p.skill} · {p.device}
                </span>
                {p.traits ? <em>{p.traits}</em> : null}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="vu-admin__section" aria-label={ko.access.vuFeedback}>
        <div className="vu-admin__section-head">
          <h3>
            {ko.access.vuFeedback}{" "}
            <span className="vu-admin__count">{visible.length}</span>
          </h3>
          <div className="vu-admin__filters" role="group">
            {(["all", "new", "queued", "done"] as const).map((f) => (
              <button
                key={f}
                type="button"
                className={
                  filter === f
                    ? "vu-admin__filter is-active"
                    : "vu-admin__filter"
                }
                onClick={() => setFilter(f)}
              >
                {f === "all"
                  ? ko.access.vuFilterAll
                  : f === "new"
                    ? ko.access.vuStatusNew
                    : f === "queued"
                      ? ko.access.vuStatusQueued
                      : ko.access.vuStatusDone}
              </button>
            ))}
          </div>
        </div>

        {err ? (
          <p className="access-admin-error" role="alert">
            {err}
          </p>
        ) : null}
        {msg ? (
          <p className="vu-admin__msg" role="status">
            {msg}
          </p>
        ) : null}
        {busy && feedback.length === 0 ? (
          <p className="access-admin-muted">{ko.access.vuLoading}</p>
        ) : visible.length === 0 ? (
          <p className="access-admin-muted">{ko.access.vuFeedbackEmpty}</p>
        ) : (
          <ul className="vu-admin__feedback-list">
            {visible.map((it) => {
              const open = expandedId === it.id;
              return (
                <li key={it.id} className="vu-admin__feedback-item">
                  <div className="vu-admin__feedback-top">
                    <span
                      className={`vu-admin__sev vu-admin__sev--${it.severity}`}
                    >
                      {severityLabel(it.severity)}
                    </span>
                    <span className="vu-admin__status">
                      {statusLabel(it.status)}
                    </span>
                    <span className="vu-admin__meta">
                      {it.personaName} · {it.area}
                    </span>
                    <time dateTime={it.at}>
                      {new Date(it.createdAtMs).toLocaleString("ko-KR")}
                    </time>
                  </div>
                  <h4 className="vu-admin__title">{it.title}</h4>
                  <p className="vu-admin__detail">{it.detail}</p>
                  {it.suggestion ? (
                    <p className="vu-admin__suggest">
                      <strong>{ko.access.vuSuggestion}</strong> {it.suggestion}
                    </p>
                  ) : null}

                  <div className="vu-admin__item-actions">
                    <button
                      type="button"
                      className="btn btn--primary btn--sm"
                      disabled={actionId === `impl-${it.id}` || it.status === "queued"}
                      onClick={() => void onImplement(it.id)}
                    >
                      {actionId === `impl-${it.id}`
                        ? ko.access.vuImplementing
                        : ko.access.vuImplement}
                    </button>
                    <button
                      type="button"
                      className="btn btn--secondary btn--sm"
                      disabled={actionId === `bak-${it.id}`}
                      onClick={() => void onBackup(it.id)}
                    >
                      {actionId === `bak-${it.id}`
                        ? ko.access.vuBackingUp
                        : ko.access.vuBackup}
                    </button>
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() =>
                        setExpandedId(open ? null : it.id)
                      }
                    >
                      {open ? ko.access.vuHidePrompt : ko.access.vuShowPrompt}
                    </button>
                    {it.status !== "done" ? (
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        disabled={actionId === `done-${it.id}`}
                        onClick={() => void onDone(it.id)}
                      >
                        {ko.access.vuMarkDone}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      disabled={actionId === `del-${it.id}`}
                      onClick={() => void onDelete(it.id)}
                    >
                      {ko.access.vuDelete}
                    </button>
                  </div>

                  {it.implementJobId ? (
                    <p className="vu-admin__job">
                      {ko.access.vuJobId}: <code>{it.implementJobId}</code>
                      {it.backupCount > 0
                        ? ` · ${ko.access.vuBackupCount.replace("{n}", String(it.backupCount))}`
                        : ""}
                    </p>
                  ) : it.backupCount > 0 ? (
                    <p className="vu-admin__job">
                      {ko.access.vuBackupCount.replace(
                        "{n}",
                        String(it.backupCount),
                      )}
                    </p>
                  ) : null}

                  {open ? (
                    <pre className="vu-admin__prompt">{it.prompt}</pre>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
