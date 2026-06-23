/**
 * 사용자 중지 스캔이 force-enable로 잘못 재기동된 경우 — 조치·알림 메일
 */
import { sendTransactionalEmail, isEmailSendingConfigured } from "../email-sender.js";
import { DEFAULT_AUDIT_REPORT_TO } from "./box-range-v2-audit-report.js";
import { POLLER_CATALOG } from "../poller-registry.js";

/**
 * @param {{
 *   to?: string;
 *   incorrectlyRunScans?: string[];
 *   stoppedPollers?: string[];
 *   dryRun?: boolean;
 * }} opts
 */
export async function sendUserStoppedScanReconcileEmail(opts = {}) {
  const to = String(opts.to ?? process.env.STOCK_AUDIT_REPORT_TO ?? DEFAULT_AUDIT_REPORT_TO).trim();
  const incorrectlyRunScans = opts.incorrectlyRunScans ?? [];
  const stoppedPollers = opts.stoppedPollers ?? [];

  const scanLines =
    incorrectlyRunScans.length > 0
      ? incorrectlyRunScans.map((s) => `<li>${s}</li>`).join("")
      : "<li>(없음)</li>";

  const pollerLines =
    stoppedPollers.length > 0
      ? stoppedPollers
          .map((id) => {
            const label = POLLER_CATALOG[id]?.labelKo ?? id;
            return `<li><strong>${label}</strong> (<code>${id}</code>)</li>`;
          })
          .join("")
      : "<li>(없음)</li>";

  const subject = `[YSTOCK] 사용자 중지 스캔 조치 — 잘못 재기동 ${incorrectlyRunScans.length}건·폴러 중지 ${stoppedPollers.length}건`;
  const html = `<!DOCTYPE html><html><body style="font-family:sans-serif;line-height:1.5;color:#0f172a">
<h2>스캔 일괄 실행(force-enable) 후속 조치</h2>
<p>운영자 요청에 따라 <strong>사용자가 의도적으로 끈 스캔</strong>은 일괄 실행 대상에서 제외하고, 잘못 재기동된 항목을 중지했습니다.</p>
<h3>잘못 실행됐던 스캔 (env opt-in off · force-enable)</h3>
<ul>${scanLines}</ul>
<h3>다시 중지한 폴러</h3>
<ul>${pollerLines}</ul>
<p style="color:#64748b;font-size:13px">앞으로 <code>run-all-scheduled-scans.mjs</code>는 env·도크 사용자 중지만 존중하고, 미완료·장애 복구 대상만 실행합니다.</p>
</body></html>`;

  if (opts.dryRun || !isEmailSendingConfigured()) {
    return { ok: true, dryRun: true, to, subject, incorrectlyRunScans, stoppedPollers };
  }

  await sendTransactionalEmail({ to, subject, html });
  return { ok: true, dryRun: false, to, subject, incorrectlyRunScans, stoppedPollers };
}
