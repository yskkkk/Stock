/**
 * 큐 슬롯 파일 기반 영속 저장소.
 * SSOT = server/.data/ops-dev-queue-slots.json
 * display 파일과 완전히 분리 — 복구 전용.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readJsonStoreSync, writeJsonStoreSync } from "./store-json.js";

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), ".data");
const SLOTS_FILE = path.join(DATA_DIR, "ops-dev-queue-slots.json");
const SLOTS_STORE_FILE = "ops-dev-queue-slots.json";

const MAX_SLOT_AGE_MS = 4 * 60 * 60 * 1000; // 4시간 이상된 슬롯은 stale

/**
 * 메모리 큐 슬롯 → 파일 (atomic write).
 * @param {Array<import("./ops-agent-job-queue.js").QueueSlot>} slots
 * @param {string | null} runningId 현재 실행 중인 슬롯 ID
 */
export function persistQueueSlots(slots, runningId) {
  try {
    const now = Date.now();
    writeJsonStoreSync(SLOTS_STORE_FILE, {
      v: 1,
      savedAtMs: now,
      runningId: runningId ?? null,
      slots: slots.map((s) => ({
        id: s.id,
        source: s.source ?? "ide",
        requestIp: String(s.meta?.requestIp ?? "").trim() || "unknown",
        prompt: String(s.meta?.instructionBody ?? s.meta?.instructionPreview ?? "").trim(),
        enqueuedAtMs: s.meta?.enqueuedAtMs ?? now,
        sessionId: s.sessionId ?? null,
      })),
    });
  } catch {
    /* 디스크 오류 — non-fatal */
  }
}

/**
 * 저장된 슬롯 읽기.
 * @returns {{ slots: Array<object>; runningId: string | null; savedAtMs: number }}
 */
export function loadPersistedQueueSlots() {
  const now = Date.now();
  return readJsonStoreSync(
    SLOTS_STORE_FILE,
    (d) => {
      const slots = (Array.isArray(d?.slots) ? d.slots : []).filter((s) => {
        const age = now - (s.enqueuedAtMs ?? 0);
        return age < MAX_SLOT_AGE_MS;
      });
      return {
        slots,
        runningId: d?.runningId ?? null,
        savedAtMs: d?.savedAtMs ?? 0,
      };
    },
    () => ({ slots: [], runningId: null, savedAtMs: 0 }),
  );
}

/** 파일 삭제 (큐 전체 비울 때) */
export function clearPersistedQueueSlots() {
  try {
    if (fs.existsSync(SLOTS_FILE)) fs.unlinkSync(SLOTS_FILE);
  } catch {
    /* ignore */
  }
}
