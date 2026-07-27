/**
 * 코드 버전 목록 SSOT — server/.data/code-versions.json
 * baseline = 최초 기준점 (현재 HEAD로 한 번 고정)
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  commitDirtyWorktreeIfNeeded,
  getCodeBranch,
  getCodeHeadSha,
  getCodeHeadShort,
  getCodeWorktreeState,
  restoreCodeTreeFromCommit,
  tryCreateGitTag,
} from "./code-version-git.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, ".data");
const STORE_PATH = path.join(DATA_DIR, "code-versions.json");
const MAX_VERSIONS = 80;

/**
 * @typedef {{
 *   id: string;
 *   label: string;
 *   kind: "baseline"|"pre-feedback"|"post-agent"|"manual"|"rollback";
 *   commitSha: string;
 *   commitShort: string;
 *   branch: string;
 *   feedbackId: string | null;
 *   jobId: string | null;
 *   createdAtMs: number;
 *   note: string;
 * }} CodeVersion
 */

/**
 * @typedef {{
 *   version: number;
 *   baselineId: string | null;
 *   versions: CodeVersion[];
 * }} CodeVersionStore
 */

function ensureDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

/** @returns {CodeVersionStore} */
function emptyStore() {
  return { version: 1, baselineId: null, versions: [] };
}

/** @param {unknown} raw @returns {CodeVersion | null} */
function normalizeVersion(raw) {
  if (!raw || typeof raw !== "object") return null;
  const o = /** @type {Record<string, unknown>} */ (raw);
  const id = String(o.id ?? "").trim();
  const commitSha = String(o.commitSha ?? "").trim();
  if (!id || !commitSha) return null;
  const kindRaw = String(o.kind ?? "manual");
  /** @type {CodeVersion["kind"]} */
  const kind =
    kindRaw === "baseline" ||
    kindRaw === "pre-feedback" ||
    kindRaw === "post-agent" ||
    kindRaw === "rollback"
      ? kindRaw
      : "manual";
  const createdAtMs = Number(o.createdAtMs);
  return {
    id,
    label: String(o.label ?? "").slice(0, 120) || commitSha.slice(0, 10),
    kind,
    commitSha,
    commitShort: String(o.commitShort ?? commitSha.slice(0, 10)).slice(0, 16),
    branch: String(o.branch ?? "").slice(0, 80),
    feedbackId:
      o.feedbackId == null || o.feedbackId === ""
        ? null
        : String(o.feedbackId).slice(0, 80),
    jobId:
      o.jobId == null || o.jobId === "" ? null : String(o.jobId).slice(0, 80),
    createdAtMs: Number.isFinite(createdAtMs) ? createdAtMs : Date.now(),
    note: String(o.note ?? "").slice(0, 400),
  };
}

/** @returns {CodeVersionStore} */
export function readCodeVersionStoreSync() {
  try {
    if (!fs.existsSync(STORE_PATH)) return emptyStore();
    const raw = JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
    if (!raw || typeof raw !== "object") return emptyStore();
    const versions = Array.isArray(raw.versions)
      ? raw.versions.map(normalizeVersion).filter(Boolean)
      : [];
    const baselineId =
      raw.baselineId == null || raw.baselineId === ""
        ? null
        : String(raw.baselineId);
    return {
      version: 1,
      baselineId,
      versions: /** @type {CodeVersion[]} */ (versions).slice(0, MAX_VERSIONS),
    };
  } catch {
    return emptyStore();
  }
}

/** @param {CodeVersionStore} store */
export function writeCodeVersionStoreSync(store) {
  ensureDir();
  const payload = {
    version: 1,
    baselineId: store.baselineId,
    versions: store.versions.slice(0, MAX_VERSIONS),
  };
  const tmp = `${STORE_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), "utf8");
  fs.renameSync(tmp, STORE_PATH);
}

export function listCodeVersionsSync() {
  return readCodeVersionStoreSync().versions;
}

/**
 * @param {{
 *   label: string;
 *   kind?: CodeVersion["kind"];
 *   feedbackId?: string | null;
 *   jobId?: string | null;
 *   note?: string;
 *   commitIfDirty?: boolean;
 *   dirtyCommitMessage?: string;
 * }} input
 */
export function createCodeVersionSync(input) {
  if (input.commitIfDirty) {
    commitDirtyWorktreeIfNeeded(
      input.dirtyCommitMessage ||
        `chore(version): snapshot before ${input.label}`.slice(0, 200),
    );
  }
  const head = getCodeHeadSha();
  if (!head) {
    return { ok: false, error: "git HEAD를 읽을 수 없습니다." };
  }
  const store = readCodeVersionStoreSync();
  // 동일 SHA+kind 연속 중복 방지(짧은 간격)
  const last = store.versions[0];
  if (
    last &&
    last.commitSha === head &&
    last.kind === (input.kind || "manual") &&
    Date.now() - last.createdAtMs < 5_000
  ) {
    return { ok: true, version: last, deduped: true, store };
  }

  /** @type {CodeVersion} */
  const item = {
    id: randomUUID(),
    label: String(input.label ?? "").slice(0, 120) || getCodeHeadShort(),
    kind: input.kind || "manual",
    commitSha: head,
    commitShort: head.slice(0, 10),
    branch: getCodeBranch(),
    feedbackId: input.feedbackId ?? null,
    jobId: input.jobId ?? null,
    createdAtMs: Date.now(),
    note: String(input.note ?? "").slice(0, 400),
  };
  store.versions = [item, ...store.versions].slice(0, MAX_VERSIONS);
  writeCodeVersionStoreSync(store);
  return { ok: true, version: item, deduped: false, store };
}

/**
 * 최초 기준점 — 없으면 현재 HEAD로 고정
 * @param {{ force?: boolean }} [opts]
 */
export function ensureBaselineCodeVersionSync(opts = {}) {
  const store = readCodeVersionStoreSync();
  if (!opts.force && store.baselineId) {
    const existing = store.versions.find((v) => v.id === store.baselineId);
    if (existing) return { ok: true, version: existing, created: false };
  }

  const { dirty } = getCodeWorktreeState();
  if (dirty) {
    commitDirtyWorktreeIfNeeded(
      "chore(version): baseline snapshot of current server code",
    );
  }

  const created = createCodeVersionSync({
    label: "최초 기준 (baseline)",
    kind: "baseline",
    note: "가상 사용자 자동 개선 전 최초 서버 코드 기준점",
  });
  if (!created.ok || !created.version) {
    return { ok: false, error: created.error || "baseline 생성 실패" };
  }

  const next = readCodeVersionStoreSync();
  next.baselineId = created.version.id;
  // baseline을 목록 맨 앞에 유지
  next.versions = [
    created.version,
    ...next.versions.filter((v) => v.id !== created.version.id),
  ].slice(0, MAX_VERSIONS);
  writeCodeVersionStoreSync(next);

  tryCreateGitTag(
    `ystock-baseline-${created.version.commitShort}`,
    created.version.commitSha,
    "YSTOCK code baseline",
  );

  return { ok: true, version: created.version, created: true };
}

/**
 * @param {string} versionId
 * @param {{ pushNote?: string }} [opts]
 */
export function rollbackToCodeVersionSync(versionId, opts = {}) {
  const store = readCodeVersionStoreSync();
  const target = store.versions.find((v) => v.id === versionId);
  if (!target) return { ok: false, error: "버전을 찾을 수 없습니다." };

  const msg =
    opts.pushNote ||
    `revert(version): restore tree to ${target.label} (${target.commitShort})`;

  const restored = restoreCodeTreeFromCommit(target.commitSha, msg);
  if (!restored.ok) {
    return { ok: false, error: restored.error || "롤백 실패", target };
  }

  const snap = createCodeVersionSync({
    label: `롤백 결과 ← ${target.label}`,
    kind: "rollback",
    note: `restored from ${target.id} @ ${target.commitShort}`,
  });

  return {
    ok: true,
    target,
    head: restored.head,
    resultVersion: snap.ok ? snap.version : null,
    warning: restored.error || null,
  };
}
