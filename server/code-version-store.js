/**
 * 코드 버전 목록 SSOT — server/.data/code-versions.json
 * baseline = 가상 사용자 도입 직전 커밋 (서버 재기동·현재 HEAD와 무관, 한 번 고정)
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
  resolveCommitSha,
  resolvePreVirtualUserCommitSha,
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
 *   lockedBaselineSha: string | null;
 *   versions: CodeVersion[];
 * }} CodeVersionStore
 */

function ensureDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

/** @returns {CodeVersionStore} */
function emptyStore() {
  return {
    version: 2,
    baselineId: null,
    lockedBaselineSha: null,
    versions: [],
  };
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
    const lockedBaselineSha =
      raw.lockedBaselineSha == null || raw.lockedBaselineSha === ""
        ? null
        : String(raw.lockedBaselineSha);
    return {
      version: 2,
      baselineId,
      lockedBaselineSha,
      versions: /** @type {CodeVersion[]} */ (versions).slice(0, MAX_VERSIONS),
    };
  } catch {
    return emptyStore();
  }
}

/**
 * baseline 항목은 항상 목록에 남김 (MAX 슬라이스에 밀려 사라지지 않게)
 * @param {CodeVersionStore} store
 */
function persistStoreKeepingBaseline(store) {
  ensureDir();
  const baseline =
    (store.baselineId &&
      store.versions.find((v) => v.id === store.baselineId)) ||
    store.versions.find((v) => v.kind === "baseline") ||
    null;
  let versions = store.versions.slice(0, MAX_VERSIONS);
  if (baseline && !versions.some((v) => v.id === baseline.id)) {
    versions = [baseline, ...versions.filter((v) => v.id !== baseline.id)].slice(
      0,
      MAX_VERSIONS,
    );
  }
  const payload = {
    version: 2,
    baselineId: store.baselineId,
    lockedBaselineSha: store.lockedBaselineSha,
    versions,
  };
  const tmp = `${STORE_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), "utf8");
  fs.renameSync(tmp, STORE_PATH);
}

/** @param {CodeVersionStore} store */
export function writeCodeVersionStoreSync(store) {
  persistStoreKeepingBaseline(store);
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
 *   commitSha?: string | null;
 * }} input
 */
export function createCodeVersionSync(input) {
  if (input.commitIfDirty) {
    commitDirtyWorktreeIfNeeded(
      input.dirtyCommitMessage ||
        `chore(version): snapshot before ${input.label}`.slice(0, 200),
    );
  }
  let head = String(input.commitSha ?? "").trim() || getCodeHeadSha();
  if (input.commitSha) {
    const resolved = resolveCommitSha(input.commitSha);
    if (!resolved.ok || !resolved.sha) {
      return { ok: false, error: `커밋을 찾을 수 없습니다: ${input.commitSha}` };
    }
    head = resolved.sha;
  }
  if (!head) {
    return { ok: false, error: "git HEAD를 읽을 수 없습니다." };
  }
  const store = readCodeVersionStoreSync();
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
    label: String(input.label ?? "").slice(0, 120) || head.slice(0, 10),
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
 * @param {string} sha
 * @param {string} label
 * @param {string} note
 * @returns {CodeVersion}
 */
function makeBaselineItem(sha, label, note) {
  return {
    id: randomUUID(),
    label,
    kind: "baseline",
    commitSha: sha,
    commitShort: sha.slice(0, 10),
    branch: getCodeBranch(),
    feedbackId: null,
    jobId: null,
    createdAtMs: Date.now(),
    note,
  };
}

/**
 * 가상 사용자 도입 직전 기준점.
 * - 서버 재기동해도 현재 HEAD로 다시 잡지 않음
 * - lockedBaselineSha 또는 git 히스토리(pre-VU)로 고정
 * @param {{ force?: boolean; pinToPreVirtualUser?: boolean }} [opts]
 */
export function ensureBaselineCodeVersionSync(opts = {}) {
  const store = readCodeVersionStoreSync();
  const pinToPreVu = opts.pinToPreVirtualUser !== false;

  // 1) 이미 잠긴 SHA + 목록에 baseline 있으면 유지 (재기동 무시)
  if (!opts.force && store.baselineId) {
    const existing = store.versions.find((v) => v.id === store.baselineId);
    if (existing) {
      if (!store.lockedBaselineSha) {
        store.lockedBaselineSha = existing.commitSha;
        writeCodeVersionStoreSync(store);
      }
      return { ok: true, version: existing, created: false };
    }
    // baselineId는 있는데 항목이 목록에서 밀림 → locked SHA로 복구
    const locked = store.lockedBaselineSha || existing?.commitSha;
    if (locked) {
      const resolved = resolveCommitSha(locked);
      if (resolved.ok && resolved.sha) {
        const restored = makeBaselineItem(
          resolved.sha,
          "가상 사용자 도입 직전 기준",
          "목록에서 유실된 baseline을 lockedBaselineSha로 복구 (재기동 HEAD 아님)",
        );
        store.versions = [
          restored,
          ...store.versions.filter((v) => v.kind !== "baseline"),
        ];
        store.baselineId = restored.id;
        store.lockedBaselineSha = resolved.sha;
        writeCodeVersionStoreSync(store);
        return { ok: true, version: restored, created: true, restored: true };
      }
    }
  }

  // 2) locked SHA만 있으면 그것으로 재구성
  if (!opts.force && store.lockedBaselineSha) {
    const resolved = resolveCommitSha(store.lockedBaselineSha);
    if (resolved.ok && resolved.sha) {
      const item = makeBaselineItem(
        resolved.sha,
        "가상 사용자 도입 직전 기준",
        "lockedBaselineSha에서 복구",
      );
      store.versions = [
        item,
        ...store.versions.filter((v) => v.kind !== "baseline"),
      ];
      store.baselineId = item.id;
      store.lockedBaselineSha = resolved.sha;
      writeCodeVersionStoreSync(store);
      return { ok: true, version: item, created: true, restored: true };
    }
  }

  // 3) 신규 생성: 가상 사용자 도입 직전 커밋 우선 (현재 HEAD 아님)
  let targetSha = "";
  if (pinToPreVu) {
    targetSha = resolvePreVirtualUserCommitSha();
  }
  if (!targetSha) {
    const { dirty } = getCodeWorktreeState();
    if (dirty) {
      commitDirtyWorktreeIfNeeded(
        "chore(version): snapshot before locking pre-virtual-user baseline",
      );
    }
    targetSha = getCodeHeadSha();
  }
  const resolved = resolveCommitSha(targetSha);
  if (!resolved.ok || !resolved.sha) {
    return { ok: false, error: "baseline 커밋을 결정할 수 없습니다." };
  }

  const item = makeBaselineItem(
    resolved.sha,
    "가상 사용자 도입 직전 기준",
    pinToPreVu && targetSha === resolvePreVirtualUserCommitSha()
      ? "가상 사용자 기능 커밋 직전 트리. 서버 재기동·현재 HEAD와 무관하게 고정."
      : "baseline 잠금 (pre-VU SHA를 못 찾아 당시 HEAD 사용). 이후 재기동으로 덮지 않음.",
  );

  // 중복 baseline 정리
  store.versions = [
    item,
    ...store.versions.filter((v) => v.kind !== "baseline"),
  ].slice(0, MAX_VERSIONS);
  store.baselineId = item.id;
  store.lockedBaselineSha = resolved.sha;
  writeCodeVersionStoreSync(store);

  tryCreateGitTag(
    `ystock-baseline-pre-vu-${item.commitShort}`,
    item.commitSha,
    "YSTOCK pre-virtual-user baseline",
  );

  return { ok: true, version: item, created: true };
}

/**
 * 기존 baseline이 가상 사용자 도입 이후면 pre-VU로 재고정 (force와 별도·안전한 마이그레이션)
 */
export function migrateBaselineToPreVirtualUserSync() {
  const pre = resolvePreVirtualUserCommitSha();
  if (!pre) return { ok: false, error: "pre-VU 커밋을 찾지 못했습니다." };
  const resolved = resolveCommitSha(pre);
  if (!resolved.ok || !resolved.sha) {
    return { ok: false, error: "pre-VU SHA 해석 실패" };
  }

  const store = readCodeVersionStoreSync();
  const current = store.baselineId
    ? store.versions.find((v) => v.id === store.baselineId)
    : null;

  // 이미 같은 SHA면 locked만 보강
  if (current && current.commitSha === resolved.sha) {
    store.lockedBaselineSha = resolved.sha;
    if (current.label.includes("최초 기준")) {
      current.label = "가상 사용자 도입 직전 기준";
      current.note =
        "가상 사용자 기능 커밋 직전 트리. 서버 재기동·현재 HEAD와 무관하게 고정.";
    }
    writeCodeVersionStoreSync(store);
    return { ok: true, version: current, migrated: false };
  }

  const item = makeBaselineItem(
    resolved.sha,
    "가상 사용자 도입 직전 기준",
    "가상 사용자 기능 커밋 직전 트리로 재고정. 서버 재기동으로 덮지 않음.",
  );
  store.versions = [
    item,
    ...store.versions.filter((v) => v.kind !== "baseline"),
  ].slice(0, MAX_VERSIONS);
  store.baselineId = item.id;
  store.lockedBaselineSha = resolved.sha;
  writeCodeVersionStoreSync(store);
  tryCreateGitTag(
    `ystock-baseline-pre-vu-${item.commitShort}`,
    item.commitSha,
    "YSTOCK pre-virtual-user baseline",
  );
  return { ok: true, version: item, migrated: true };
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
