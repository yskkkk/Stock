import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { opsIdePromptsMatch } from "./ops-ide-prompt-match.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
export const IDE_LEASE_FILE = ".stock-ops-ide-lease.json";
const IDE_LEASE_PATH = path.join(REPO_ROOT, IDE_LEASE_FILE);

const PREVIEW_MAX = 220;

/** 메모리 IDE 큐 없을 때 lease 고아 판정 (기본 90s) */
export const IDE_LEASE_ORPHAN_MS = (() => {
  const n = Number(process.env.STOCK_IDE_LEASE_ORPHAN_MS);
  if (Number.isFinite(n) && n >= 15_000) return Math.min(n, 30 * 60 * 1000);
  return 90_000;
})();

/** @param {Record<string, unknown> | null | undefined} lease */
export function ideLeaseAgeMs(lease) {
  if (!lease) return 0;
  const since =
    typeof lease.sinceMs === "number"
      ? lease.sinceMs
      : typeof lease.enqueuedAtMs === "number"
        ? lease.enqueuedAtMs
        : 0;
  return since > 0 ? Date.now() - since : 0;
}

/** @param {Array<Record<string, unknown>>} memoryEntries */
export function memoryHasIdeQueueEntries(memoryEntries) {
  const list = Array.isArray(memoryEntries) ? memoryEntries : [];
  return list.some(
    (e) =>
      e.source === "ide" ||
      e.requestIp === "cursor-ide" ||
      e.requestIp === "claude-code",
  );
}

/**
 * 메모리 FIFO에 IDE 항목이 없는데 lease만 남은 경우 — UI·텔레그램 고착 방지.
 * @param {Array<Record<string, unknown>>} [memoryEntries]
 * @returns {boolean} lease를 지웠으면 true
 */
export function clearOrphanIdeLeaseIfNeeded(memoryEntries = []) {
  if (memoryHasIdeQueueEntries(memoryEntries)) return false;

  const lease = readIdeLeaseDiskSync();
  if (!lease) return false;

  const age = ideLeaseAgeMs(lease);
  const hasLeaseId = Boolean(String(lease.leaseId ?? lease.id ?? "").trim());
  const stale =
    age >= IDE_LEASE_ORPHAN_MS ||
    age > 30 * 60 * 1000 ||
    (!hasLeaseId && age >= 120_000);
  if (!stale) return false;

  const prompt = String(
    lease.instructionBody ?? lease.instructionPreview ?? lease.prompt ?? "",
  ).trim();
  clearIdeLeaseOnDisk();
  if (prompt) {
    void import("./ops-dev-completion-coalesce.js")
      .then((m) => {
        m.clearOpsDevNotifyPendingSync();
      })
      .catch(() => {});
  }
  return true;
}

/** @param {unknown} instruction */
function previewInstruction(instruction) {
  const line =
    String(instruction ?? "")
      .split(/\r?\n/)
      .find((l) => String(l).trim().length > 0) ?? "";
  const t = line.trim();
  return t.length > PREVIEW_MAX ? `${t.slice(0, PREVIEW_MAX - 1)}…` : t;
}

/** @returns {Record<string, unknown> | null} */
export function readIdeLeaseDiskSync() {
  try {
    if (!fs.existsSync(IDE_LEASE_PATH)) return null;
    const data = JSON.parse(fs.readFileSync(IDE_LEASE_PATH, "utf8"));
    return data && typeof data === "object" ? data : null;
  } catch {
    return null;
  }
}

/**
 * 영속 표시 큐에 IDE lease 보조 카드 병합(dev 재시작 후에도 유지).
 * @param {Array<Record<string, unknown>>} entries
 */
export function mergeIdeLeaseIntoDisplayEntries(entries) {
  const mem = Array.isArray(entries) ? entries : [];
  if (clearOrphanIdeLeaseIfNeeded(mem)) return mem;

  const lease = readIdeLeaseDiskSync();
  if (!lease) return entries;

  const leaseId = String(lease.leaseId ?? lease.id ?? "").trim();
  const preview = String(
    lease.instructionPreview ?? lease.promptPreview ?? lease.prompt ?? "",
  ).trim();
  if (!preview && !leaseId) return entries;

  const id = leaseId || `ide-lease-${String(lease.sinceMs ?? Date.now())}`;
  if (entries.some((e) => String(e.id ?? "") === id)) {
    return entries;
  }

  const leaseRequestIp = String(lease.requestIp ?? "cursor-ide").trim() || "cursor-ide";

  if (
    entries.some(
      (e) =>
        (e.source === "ide" || e.requestIp === "cursor-ide" || e.requestIp === "claude-code") &&
        (String(e.instructionPreview ?? "").trim() === preview ||
          (preview &&
            String(e.instructionBody ?? "")
              .trim()
              .startsWith(preview.slice(0, 80)))),
    )
  ) {
    return entries;
  }

  const statusRaw = String(lease.queueStatus ?? "waiting").toLowerCase();
  const status = statusRaw === "running" ? "running" : "waiting";

  return [
    ...entries,
    {
      id,
      requestIp: leaseRequestIp,
      instructionPreview: preview || "—",
      instructionTooltip: preview || "—",
      instructionBody: String(lease.instructionBody ?? preview ?? "").slice(0, 16_000),
      enqueuedAtMs:
        typeof lease.enqueuedAtMs === "number"
          ? lease.enqueuedAtMs
          : typeof lease.sinceMs === "number"
            ? lease.sinceMs
            : Date.now(),
      source: "ide",
      status,
      fromDiskLease: true,
    },
  ];
}

/** @param {Array<Record<string, unknown>>} memoryEntries */
export function mergeIdeLeaseDiskIntoAgentEntries(memoryEntries) {
  return mergeIdeLeaseIntoDisplayEntries(memoryEntries);
}

/**
 * @param {{
 *   prompt: string;
 *   sessionId?: string | null;
 *   leaseId?: string | null;
 *   queueStatus?: "waiting" | "running";
 * }} input
 */
export function writeIdeLeaseDiskImmediate(input) {
  const prompt = String(input.prompt ?? "").trim();
  if (!prompt) return;
  const now = Date.now();
  const preview = previewInstruction(prompt);
  const statusRaw = String(input.queueStatus ?? "waiting").toLowerCase();
  const queueStatus = statusRaw === "running" ? "running" : "waiting";
  const existing = readIdeLeaseDiskSync();
  const sameTurn =
    existing &&
    (opsIdePromptsMatch(
      existing.instructionBody ?? existing.instructionPreview ?? existing.prompt,
      prompt,
    ) ||
      (input.leaseId &&
        String(input.leaseId).trim() &&
        String(input.leaseId).trim() === String(existing.leaseId ?? "").trim()));
  const enqueuedAtMs =
    sameTurn && typeof existing.enqueuedAtMs === "number"
      ? existing.enqueuedAtMs
      : now;
  const sinceMs =
    sameTurn && typeof existing.sinceMs === "number" ? existing.sinceMs : now;
  const body = {
    leaseId: input.leaseId ?? (sameTurn ? existing.leaseId : null) ?? null,
    sessionId: input.sessionId ?? (sameTurn ? existing.sessionId : null) ?? null,
    instructionPreview: preview,
    instructionTooltip: preview,
    instructionBody: prompt.slice(0, 16_000),
    promptPreview: preview,
    enqueuedAtMs,
    sinceMs,
    queueStatus,
    source: "ide",
  };
  const line = `${JSON.stringify(body, null, 2)}\n`;
  try {
    if (fs.existsSync(IDE_LEASE_PATH) && fs.readFileSync(IDE_LEASE_PATH, "utf8") === line) {
      return;
    }
  } catch {
    /* write */
  }
  fs.writeFileSync(IDE_LEASE_PATH, line, "utf8");
  void import("./ops-dev-queue-display-sync.js")
    .then((m) => m.requestDevQueueDisplaySyncNow())
    .catch(() => {});
}

export function clearIdeLeaseOnDisk() {
  try {
    if (!fs.existsSync(IDE_LEASE_PATH)) return;
    fs.unlinkSync(IDE_LEASE_PATH);
  } catch {
    /* ignore */
  }
  void import("./ops-dev-queue-display-sync.js")
    .then((m) => m.requestDevQueueDisplaySyncNow())
    .catch(() => {});
}
