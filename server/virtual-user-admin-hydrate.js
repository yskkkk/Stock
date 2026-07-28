/**
 * 관리자 목록 API용 — 무거운 enrich/git를 요청 경로 밖에서 1회 수행
 */
import { enrichVirtualFeedbackNarrativesSync } from "./virtual-user-feedback-enrich.js";
import {
  ensureBaselineCodeVersionSync,
  migrateBaselineToPreVirtualUserSync,
} from "./code-version-store.js";
import { appendServerEventLog } from "./access-log.js";

let hydrated = false;
let running = false;

export function scheduleVirtualUserAdminHydration() {
  if (hydrated || running) return;
  running = true;
  setImmediate(() => {
    try {
      enrichVirtualFeedbackNarrativesSync();
      migrateBaselineToPreVirtualUserSync();
      ensureBaselineCodeVersionSync();
      hydrated = true;
      appendServerEventLog("virtual-user", "admin hydration ok");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      appendServerEventLog("virtual-user", `admin hydration fail ${msg}`);
    } finally {
      running = false;
    }
  });
}
