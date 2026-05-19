import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scheduleDevQueueDisplayRefresh } from "./ops-dev-queue-display-store.js";

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
 * 디스크 lease → 큐 카드(메모리 스냅샷에 없을 때 UI 즉시 표시용).
 * @param {Array<Record<string, unknown>>} memoryEntries
 * @returns {Array<Record<string, unknown>>}
 */
/**
 * 디스크 lease는 **실행 중 메모리 큐가 있을 때만** 보조 표시(즉시 UI용).
 * 메모리에 없으면 고아 lease — 새로고침·리다이렉트 시 유령 카드 방지.
 */
export function mergeIdeLeaseDiskIntoAgentEntries(memoryEntries) {
  const memIde = memoryEntries.filter(
    (e) => e.source === "ide" || e.requestIp === "cursor-ide",
  );
  if (memIde.length === 0) {
    clearIdeLeaseOnDisk();
    return memoryEntries;
  }

  const lease = readIdeLeaseDiskSync();
  if (!lease) return memoryEntries;

  const leaseId = String(lease.leaseId ?? lease.id ?? "").trim();
  const preview = String(
    lease.instructionPreview ?? lease.promptPreview ?? lease.prompt ?? "",
  ).trim();
  if (!preview && !leaseId) return memoryEntries;

  const id = leaseId || `ide-lease-${String(lease.sinceMs ?? Date.now())}`;
  if (memoryEntries.some((e) => String(e.id ?? "") === id)) {
    return memoryEntries;
  }

  if (
    memIde.some(
      (e) =>
        String(e.instructionPreview ?? "").trim() === preview ||
        (preview &&
          String(e.instructionBody ?? "")
            .trim()
            .startsWith(preview.slice(0, 80))),
    )
  ) {
    return memoryEntries;
  }

  const statusRaw = String(lease.queueStatus ?? "waiting").toLowerCase();
  const status = statusRaw === "running" ? "running" : "waiting";

  return [
    ...memoryEntries,
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
  scheduleDevQueueDisplayRefresh();
}

export function clearIdeLeaseOnDisk() {
  try {
    if (!fs.existsSync(IDE_LEASE_PATH)) return;
    fs.unlinkSync(IDE_LEASE_PATH);
  } catch {
    /* ignore */
  }
  scheduleDevQueueDisplayRefresh();
}
