/**
 * 프로젝트 구조·요청 흐름·핵심 모듈 요약 메일
 */
import { sendTransactionalEmail, isEmailSendingConfigured } from "../email-sender.js";

export const PROJECT_ARCH_EMAIL_VERSION = "2026-05-27-arch-1";
export const DEFAULT_PROJECT_ARCH_TO = "samron3@naver.com";

/**
 * @param {{
 *   folderRoles: { path: string; role: string; confidence: "확신"|"추정"; note?: string }[];
 *   flow10: { line: string }[];
 *   coreModules: { module: string; imports: number; summary: string }[];
 * }} input
 */
export function buildProjectArchitectureEmailContent(input) {
  const subject = `[YSTOCK] 프로젝트 구조/흐름/핵심모듈 요약 (${PROJECT_ARCH_EMAIL_VERSION})`;

  const folderLines = input.folderRoles
    .map((r) => `- ${r.path} — ${r.role} (${r.confidence}${r.note ? ` · ${r.note}` : ""})`)
    .join("\n");

  const flowLines = input.flow10.map((x, i) => `${i + 1}. ${x.line}`).join("\n");

  const coreLines = input.coreModules
    .map(
      (m, i) =>
        `${i + 1}. ${m.module} (imports≈${m.imports})\n   ${m.summary.trim().replace(/\n+/g, "\n   ")}`,
    )
    .join("\n\n");

  const text = `프로젝트 구조/흐름/핵심모듈 요약입니다.
버전: ${PROJECT_ARCH_EMAIL_VERSION}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1) 폴더별 역할 (1줄 + 확신/추정)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${folderLines}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
2) 엔트리포인트→요청 처리 흐름 (10줄)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${flowLines}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
3) 핵심 모듈 TOP10 (임포트 빈도 후보)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${coreLines}
`;

  const folderHtml = input.folderRoles
    .map(
      (r) =>
        `<li><code>${r.path}</code> — ${r.role} <span style="color:#64748b;">(${r.confidence}${r.note ? ` · ${r.note}` : ""})</span></li>`,
    )
    .join("");

  const flowHtml = input.flow10
    .map((x, i) => `<li>${x.line}</li>`)
    .join("");

  const coreHtml = input.coreModules
    .map(
      (m) =>
        `<tr><td><code>${m.module}</code></td><td>${m.imports}</td><td style="white-space:pre-wrap;">${m.summary
          .replace(/</g, "&lt;")
          .trim()}</td></tr>`,
    )
    .join("");

  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"/><title>${subject}</title></head>
<body style="font-family:Malgun Gothic,Apple SD Gothic Neo,sans-serif;line-height:1.6;max-width:880px;margin:0 auto;padding:24px;color:#111;">
<h1 style="font-size:1.15em;color:#1e40af;">프로젝트 구조/흐름/핵심모듈 요약</h1>
<p><code>${PROJECT_ARCH_EMAIL_VERSION}</code></p>

<h2>1) 폴더별 역할</h2>
<ul>${folderHtml}</ul>

<h2>2) 요청 처리 흐름 (10줄)</h2>
<ol>${flowHtml}</ol>

<h2>3) 핵심 모듈 TOP10 (후보)</h2>
<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-size:0.9em;width:100%;">
<thead><tr><th>모듈</th><th>imports≈</th><th>역할 요약</th></tr></thead>
<tbody>${coreHtml}</tbody>
</table>

<p style="color:#64748b;margin-top:24px;font-size:0.9em;">임포트 빈도는 정규식 기반 근사치이며, 동적 import/require 및 경로 별칭은 누락될 수 있습니다.</p>
</body></html>`;

  return { subject, text, html };
}

/**
 * @param {{ to?: string; dryRun?: boolean } & Parameters<typeof buildProjectArchitectureEmailContent>[0]} opts
 */
export async function sendProjectArchitectureEmail(opts) {
  const to = String(opts?.to ?? DEFAULT_PROJECT_ARCH_TO).trim();
  if (!to) throw new Error("수신 이메일 필요");
  const dryRun = Boolean(opts?.dryRun);
  if (!dryRun && !isEmailSendingConfigured()) {
    const err = new Error("SMTP 미설정");
    err.code = "EMAIL_NOT_CONFIGURED";
    throw err;
  }
  const payload = buildProjectArchitectureEmailContent(opts);
  if (dryRun) return { to, dryRun: true, subject: payload.subject };
  await sendTransactionalEmail({ to, subject: payload.subject, text: payload.text, html: payload.html });
  return { to, dryRun: false, sent: true, subject: payload.subject };
}

