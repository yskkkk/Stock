import { useCallback, useEffect, useMemo, useState } from "react";
import {
  backupVirtualFeedback,
  deleteVirtualFeedback,
  fetchCodeVersions,
  fetchVirtualUsers,
  implementVirtualFeedback,
  patchVirtualPersona,
  patchVirtualUserContinuous,
  rollbackCodeVersion,
  runVirtualUsers,
  setVirtualFeedbackStatus,
  type CodeVersion,
  type VirtualFeedback,
  type VirtualPersona,
  type VirtualUserContinuous,
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

function formatLastTick(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  try {
    return new Date(ms).toLocaleString("ko-KR", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "—";
  }
}

function versionKindLabel(k: CodeVersion["kind"]): string {
  if (k === "baseline") return ko.access.vuVersionBaseline;
  if (k === "pre-feedback") return "피드백 직전";
  if (k === "post-agent") return "에이전트 후";
  if (k === "rollback") return "롤백 결과";
  return "수동";
}

export default function VirtualUsersAdminPanel({
  adminToken,
}: {
  adminToken: string;
}) {
  const [personas, setPersonas] = useState<VirtualPersona[]>([]);
  const [feedback, setFeedback] = useState<VirtualFeedback[]>([]);
  const [continuous, setContinuous] = useState<VirtualUserContinuous | null>(
    null,
  );
  const [versions, setVersions] = useState<CodeVersion[]>([]);
  const [baselineId, setBaselineId] = useState<string | null>(null);
  const [busyPoller, setBusyPoller] = useState(false);
  const [satLabels, setSatLabels] = useState<Record<string, string>>({});
  const [narrative, setNarrative] = useState<{
    discomfortCount: number;
    waitingCount?: number;
    runningCount?: number;
    queuedCount: number;
    improvedCount: number;
    total: number;
  } | null>(null);
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
    const ac = new AbortController();
    const timer = window.setTimeout(() => ac.abort(), 20_000);
    try {
      // 코드 버전(git)과 Promise.all 하지 않음 — git lock 시 목록이 영원히 로딩됨
      const res = await fetchVirtualUsers(adminToken, ac.signal);
      setPersonas(res.personas ?? []);
      setFeedback(res.feedback ?? []);
      setContinuous(res.continuous ?? null);
      setBusyPoller(Boolean(res.busy));
      setSatLabels(res.satisfactionLabels ?? {});
      setNarrative(res.narrative ?? null);
      const fromVu = res.codeVersions;
      if (fromVu?.versions?.length) {
        setVersions(fromVu.versions);
        setBaselineId(fromVu.baselineId ?? null);
      }
      // 버전 상세는 백그라운드 (실패해도 피드백 목록 유지)
      void fetchCodeVersions(adminToken)
        .then((ver) => {
          if (ver?.ok && (ver.versions?.length ?? 0) > 0) {
            setVersions(ver.versions ?? []);
            setBaselineId(ver.baselineId ?? null);
          }
        })
        .catch(() => {});
    } catch (e) {
      const msg =
        e instanceof Error && e.name === "AbortError"
          ? "불러오기 시간 초과 — 다시 새로고침 해 주세요."
          : e instanceof Error
            ? e.message
            : String(e);
      setErr(msg);
    } finally {
      window.clearTimeout(timer);
      setBusy(false);
    }
  }, [adminToken]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!continuous?.enabled) return;
    const t = window.setInterval(() => {
      void reload();
    }, 20_000);
    return () => window.clearInterval(t);
  }, [continuous?.enabled, reload]);

  const visible = useMemo(() => {
    if (filter === "all") return feedback;
    return feedback.filter((f) => f.status === filter);
  }, [feedback, filter]);

  const onToggleContinuous = async () => {
    if (!continuous) return;
    setActionId("continuous");
    setErr(null);
    try {
      const res = await patchVirtualUserContinuous(
        { enabled: !continuous.enabled },
        adminToken,
      );
      if (res.continuous) setContinuous(res.continuous);
      setBusyPoller(Boolean(res.busy));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setActionId(null);
    }
  };

  const onToggleAutoImplement = async () => {
    if (!continuous) return;
    setActionId("auto-impl");
    setErr(null);
    try {
      const res = await patchVirtualUserContinuous(
        { autoImplement: continuous.autoImplement === false },
        adminToken,
      );
      if (res.continuous) setContinuous(res.continuous);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setActionId(null);
    }
  };

  const onRollback = async (v: CodeVersion) => {
    if (!window.confirm(ko.access.vuVersionRollbackConfirm)) return;
    setActionId(`rb-${v.id}`);
    setErr(null);
    setMsg(null);
    try {
      const res = await rollbackCodeVersion(v.id, adminToken);
      if (!res.ok) {
        setErr(res.error || ko.access.vuVersionRollbackFail);
        return;
      }
      setMsg(
        ko.access.vuVersionRollbackOk.replace(
          "{sha}",
          res.resultVersion?.commitShort || res.head?.slice(0, 10) || v.commitShort,
        ),
      );
      if (res.versions) setVersions(res.versions);
      else await reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setActionId(null);
    }
  };

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
      const esc = res.escalations?.length
        ? ` · 만족도 상승 ${res.escalations.length}명`
        : "";
      setMsg(
        `${ko.access.vuRunOk.replace("{n}", String(res.createdCount ?? 0))}${warn}${esc}${
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

      <section className="vu-admin__section" aria-label={ko.access.vuContinuous}>
        <div className="vu-admin__section-head">
          <h3>{ko.access.vuContinuous}</h3>
          <button
            type="button"
            className={
              continuous?.enabled
                ? "vu-admin__persona-toggle is-on"
                : "vu-admin__persona-toggle is-off"
            }
            disabled={!continuous || actionId === "continuous"}
            onClick={() => void onToggleContinuous()}
          >
            {busyPoller
              ? ko.access.vuContinuousBusy
              : continuous?.enabled
                ? ko.access.vuContinuousOn
                : ko.access.vuContinuousOff}
          </button>
        </div>
        <p className="vu-admin__hint">{ko.access.vuContinuousHint}</p>
        {continuous?.pausedByApiExhaustion ? (
          <p className="vu-admin__paused" role="status">
            {ko.access.vuContinuousPausedApi}
            {continuous.pausedReason
              ? ` (${continuous.pausedReason.slice(0, 120)})`
              : ""}
          </p>
        ) : null}
        {continuous ? (
          <div className="vu-admin__continuous-row">
            <button
              type="button"
              className={
                continuous.autoImplement !== false
                  ? "vu-admin__persona-toggle is-on"
                  : "vu-admin__persona-toggle is-off"
              }
              disabled={actionId === "auto-impl"}
              onClick={() => void onToggleAutoImplement()}
            >
              {continuous.autoImplement !== false
                ? ko.access.vuAutoImplementOn
                : ko.access.vuAutoImplementOff}
            </button>
            <p className="vu-admin__meta">
              {ko.access.vuContinuousLast}:{" "}
              {formatLastTick(continuous.lastTickAtMs)}
              {continuous.lastCreatedCount > 0
                ? ` · ${ko.access.vuContinuousCreated.replace(
                    "{n}",
                    String(continuous.lastCreatedCount),
                  )}`
                : ""}
              {continuous.lastError ? ` · ${continuous.lastError}` : ""}
            </p>
          </div>
        ) : null}
      </section>

      <section className="vu-admin__section" aria-label={ko.access.vuVersions}>
        <div className="vu-admin__section-head">
          <h3>{ko.access.vuVersions}</h3>
        </div>
        <p className="vu-admin__hint">{ko.access.vuVersionsHint}</p>
        {versions.length === 0 ? (
          <p className="access-admin-muted">{ko.access.vuVersionEmpty}</p>
        ) : (
          <ul className="vu-admin__version-list">
            {versions.slice(0, 24).map((v) => (
              <li key={v.id} className="vu-admin__version-item">
                <div className="vu-admin__version-body">
                  <strong>
                    {v.id === baselineId ? (
                      <span className="vu-admin__baseline-badge">
                        {ko.access.vuVersionBaseline}
                      </span>
                    ) : null}{" "}
                    {v.label}
                  </strong>
                  <span>
                    {versionKindLabel(v.kind)} · {v.commitShort}
                    {v.branch ? ` · ${v.branch}` : ""}
                  </span>
                </div>
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  disabled={actionId === `rb-${v.id}`}
                  onClick={() => void onRollback(v)}
                >
                  {ko.access.vuVersionRollback}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

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
          {personas.map((p) => {
            const sat = p.satisfactionLevel ?? 1;
            const satLabel = satLabels[String(sat)] || String(sat);
            return (
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
                    {p.skill} · {p.device} · {ko.access.vuSatisfaction} {sat}/5 (
                    {satLabel})
                  </span>
                  {p.traits ? <em>{p.traits}</em> : null}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="vu-admin__section" aria-label={ko.access.vuNarrative}>
        <div className="vu-admin__section-head">
          <h3>{ko.access.vuNarrative}</h3>
        </div>
        <p className="vu-admin__hint">{ko.access.vuNarrativeHint}</p>
        <div className="vu-admin__narrative-stats">
          <span className="vu-admin__stat vu-admin__stat--discomfort">
            {ko.access.vuNarrativeDiscomfort.replace(
              "{n}",
              String(narrative?.discomfortCount ?? feedback.length),
            )}
          </span>
          <span className="vu-admin__stat vu-admin__stat--queued">
            {(ko.access.vuNarrativeWaiting ?? "개발 대기 {n}").replace(
              "{n}",
              String(
                narrative?.waitingCount ??
                  feedback.filter((f) => f.status === "new").length,
              ),
            )}
          </span>
          <span className="vu-admin__stat vu-admin__stat--queued">
            {ko.access.vuNarrativeQueued.replace(
              "{n}",
              String(
                narrative?.runningCount ??
                  feedback.filter((f) => f.status === "queued").length,
              ),
            )}
          </span>
          <span className="vu-admin__stat vu-admin__stat--improved">
            {ko.access.vuNarrativeImproved.replace(
              "{n}",
              String(
                narrative?.improvedCount ??
                  feedback.filter((f) => f.status === "done").length,
              ),
            )}
          </span>
        </div>
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
        {busy && feedback.length === 0 && !err ? (
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

                  <div className="vu-admin__block vu-admin__block--discomfort">
                    <strong>{ko.access.vuBlockDiscomfort}</strong>
                    <p>
                      {(it.discomfort || it.detail || it.title || "").trim() ||
                        "—"}
                    </p>
                  </div>
                  {it.suggestion ? (
                    <div className="vu-admin__block vu-admin__block--suggest">
                      <strong>{ko.access.vuBlockSuggestion}</strong>
                      <p>{it.suggestion}</p>
                    </div>
                  ) : null}
                  <div className="vu-admin__block vu-admin__block--improve">
                    <strong>{ko.access.vuBlockImprovement}</strong>
                    <p>
                      {it.improvementSummary?.trim()
                        ? it.improvementSummary
                        : it.status === "done"
                          ? ko.access.vuImprovementPending
                          : it.status === "queued"
                            ? "구현 대기 중 — 프롬프트를 열어 에이전트에 준 내용을 확인할 수 있습니다."
                            : ko.access.vuImprovementPending}
                    </p>
                  </div>

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
                    <div className="vu-admin__block vu-admin__block--prompt">
                      <strong>{ko.access.vuBlockPrompt}</strong>
                      <pre className="vu-admin__prompt">
                        {it.prompt?.trim()
                          ? it.prompt
                          : ko.access.vuPromptEmpty}
                      </pre>
                    </div>
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
