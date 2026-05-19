import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeDevQueueDisplayMirrorFromRuntime } from "./ops-dev-queue-live-store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
export const IDE_LEASE_FILE = ".stock-ops-ide-lease.json";
const IDE_LEASE_PATH = path.join(REPO_ROOT, IDE_LEASE_FILE);

const PREVIEW_MAX = 220;

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

  if (
    entries.some(
      (e) =>
        (e.source === "ide" || e.requestIp === "cursor-ide") &&
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
      requestIp: "cursor-ide",
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
  const body = {
    leaseId: input.leaseId ?? null,
    sessionId: input.sessionId ?? null,
    instructionPreview: preview,
    instructionTooltip: preview,
    instructionBody: prompt.slice(0, 16_000),
    promptPreview: preview,
    enqueuedAtMs: now,
    sinceMs: now,
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
  /* 훅·enqueue API 전에 display JSON에 즉시 반영(비동기 sync만으면 빈 채로 보일 수 있음) */
  writeDevQueueDisplayMirrorFromRuntime(mergeIdeLeaseIntoDisplayEntries([]));
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
