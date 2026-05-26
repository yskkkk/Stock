/**
 * YSTOCK 서버 박스 탐지 → Pine 포팅 + 사용자 초기 Pine 첨부 메일
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sendTransactionalEmail, isEmailSendingConfigured } from "../email-sender.js";
import { getPinePreset, resolvePineDetectOpts } from "../box-range/detect-pine.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..", "..");

export const SERVER_PINE_PORT_REPORT_VERSION = "2026-05-26-server-pine-port-1";
export const DEFAULT_SERVER_PINE_PORT_TO = "samron3@naver.com";

/** Gmail: .pine/.js 첨부 차단 → .txt 확장자 */
const ATTACHMENTS = [
  {
    rel: "scripts/pine-horizontal-box-zones.pine",
    filename: "1-초기제공-pine-horizontal-box-zones.txt",
    desc: "초기 제공 · MTF(1H/4H/1D) · f_zoneEngine 원본 (TV에 붙여넣기)",
  },
  {
    rel: "scripts/pine-box-range-finder.pine",
    filename: "2-초기제공-pine-box-range-finder.txt",
    desc: "별도 알고리즘(ER·ADX) — YSTOCK 서버 미사용",
  },
  {
    rel: "scripts/pine-ystock-server-port.pine",
    filename: "3-YSTOCK서버포팅-pine-ystock-server-port.txt",
    desc: "detect-pine.js 동일 엔진 · 차트 TF 단일",
  },
  {
    rel: "server/box-range/detect-pine.js",
    filename: "4-서버참고-detect-pine.txt",
    desc: "Node 포팅 소스(라인 대조용)",
  },
];

function readRepoFile(rel) {
  const p = path.join(REPO_ROOT, rel);
  return fs.readFileSync(p, "utf8");
}

function buildAttachments() {
  return ATTACHMENTS.map((a) => ({
    filename: a.filename,
    content: readRepoFile(a.rel),
    contentType: "text/plain; charset=utf-8",
  }));
}

function diffTableRows() {
  const srv = resolvePineDetectOpts({});
  return [
    ["탐지 엔진", "f_zoneEngine (horizontal-box-zones)", "f_zoneEngine (detect-pine.js)", "ER/ADX Finder — 서버 미사용"],
    [
      "폭 % 제한",
      "기본 OFF (usePctLimit=false)",
      `기본 OFF (PCTLIMIT=${srv.pctLimit ? "1" : "0"})`,
      "Finder: maxBoxPct+필터 항상",
    ],
    ["ATR 이탈", "breakAtrMult 0.45", String(srv.breakAtrMult), "breakAtr 0.35"],
    ["저장 상한", "maxStore 40", String(srv.maxStore), "배열 무제한(표시만 제한)"],
    ["MTF", "request.security 1H/4H/1D", "캔들 배치 per TF", "현재 차트 TF만"],
    [
      "박스 종료 시각",
      "zT1=time (저장) · 그리기만 +extMs",
      "rightTime=t1 (extMs 미가산)",
      "doneT1=time[1]",
    ],
    [
      "미확정 봉",
      "HTF lookahead_off",
      "마지막 봉 1개 제외",
      "실시간 봉 포함",
    ],
    ["병합", "중심% + 시간(봉)", "동일 shouldMerge", "없음"],
  ];
}

export function buildServerPinePortReportContent() {
  const preset1h = getPinePreset("1h");
  const preset4h = getPinePreset("4h");
  const preset1d = getPinePreset("1d");
  const srvOpts = resolvePineDetectOpts({});

  const diffRows = diffTableRows();
  const diffText = diffRows
    .map(([k, orig, server, finder]) => `  ${k}\n    · 초기 horizontal: ${orig}\n    · YSTOCK 서버: ${server}\n    · box-range-finder: ${finder}`)
    .join("\n\n");

  const attachList = ATTACHMENTS.map(
    (a, i) => `${i + 1}. ${a.filename}\n   ${a.desc}`,
  ).join("\n");

  const text = `YSTOCK — 서버 박스 로직 Pine 변환 + 초기 Pine 비교 (${SERVER_PINE_PORT_REPORT_VERSION})

■ 목적
TradingView에서 YSTOCK(server/detect-pine.js)과 동일 엔진으로 점검할 수 있게 Pine 스크립트를 첨부했습니다.

■ 첨부 파일 (4개)
${attachList}

■ TV에 붙이는 순서 (첨부 .txt 내용을 Pine Editor에 붙여넣기)
1) 비교 A — 초기 시드와 동일 MTF UI: «1-초기제공-pine-horizontal-box-zones.txt»
   · 1H 차트 → 1H 박스만 표시 (vis1H). 4H/일봉은 해당 TF 차트에서 확인.
2) 비교 B — YSTOCK 서버와 1:1: «3-YSTOCK서버포팅-pine-ystock-server-port.txt»
   · 같은 차트 TF에서 horizontal 과 나란히 올려 박스 개수·구간 대조.
   · 인풋 «YSTOCK 서버 동기화» 기본값 = 서버 env 미설정 시와 동일.
3) «2-초기제공-pine-box-range-finder.txt» 은 ER/ADX 버전 — 서버와 다르면 정상입니다.

■ 서버 1H·4H·1D 프리셋 (detect-pine PRESET)
1h: ${JSON.stringify(preset1h)}
4h: ${JSON.stringify(preset4h)}
1d: ${JSON.stringify(preset1d)}

■ 서버 런타임 옵션 (resolvePineDetectOpts)
${JSON.stringify(srvOpts, null, 2)}

■ 항목별 차이 (요약)
${diffText}

■ still 다를 수 있는 이유
· 캔들 소스: YSTOCK=Yahoo/빗썸 vs TV 거래소
· 일봉 시각: normalizeBoxUnixTime(KST) vs TV bar_time
· 앱 표시: 카탈로그 eligible·차트 오버레이 24개 상한
· 서버 배치는 마지막 미확정 봉 제외 — Pine «서버: 확정 봉만» 켜고 비교

■ detect-pine.js 핵심
· f_zoneEngine 상태머신 + pushMerged + PRESET
· export detectBoxRangesPineOnCandles → catalog-scan, detect.js

— YSTOCK 자동 발송
`;

  const diffHtml = diffRows
    .map(
      ([k, orig, server, finder]) =>
        `<tr><td>${k}</td><td>${orig}</td><td><strong>${server}</strong></td><td>${finder}</td></tr>`,
    )
    .join("");

  const html = `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"/>
<title>YSTOCK 서버 Pine 포팅</title></head>
<body style="font-family:Malgun Gothic,sans-serif;line-height:1.55;color:#111;max-width:920px;">
<h1>서버 박스 로직 → Pine + 초기 스크립트</h1>
<p>첨부 <strong>4개</strong>: 초기 horizontal · 초기 Finder · <strong>YSTOCK 서버 포팅 Pine</strong> · detect-pine.js</p>

<h2>TV 비교 방법</h2>
<ol>
<li><code>1-초기제공-pine-horizontal-box-zones.txt</code> — 제공하신 MTF 원본 (붙여넣기)</li>
<li><code>3-YSTOCK서버포팅-pine-ystock-server-port.txt</code> — 서버와 동일 f_zoneEngine (단일 TF)</li>
<li>동일 종목·동일 TF(예: BTC 1H)에서 박스 구간·개수 대조</li>
<li>Finder(2번)는 ER/ADX라 서버와 다름 — 혼동 방지용</li>
</ol>

<h2>프리셋</h2>
<pre style="background:#f1f5f9;padding:12px;font-size:0.85em;">1h ${JSON.stringify(preset1h)}
4h ${JSON.stringify(preset4h)}
1d ${JSON.stringify(preset1d)}
서버 opts ${JSON.stringify(srvOpts)}</pre>

<h2>차이 표</h2>
<table border="1" cellpadding="8" cellspacing="0" style="border-collapse:collapse;font-size:0.88em;width:100%;">
<tr><th>항목</th><th>horizontal (초기)</th><th>YSTOCK 서버</th><th>Finder</th></tr>
${diffHtml}
</table>

<h2>첨부 목록</h2>
<ul>${ATTACHMENTS.map((a) => `<li><strong>${a.filename}</strong> — ${a.desc}</li>`).join("")}</ul>

<p style="color:#64748b;font-size:0.9em;">${SERVER_PINE_PORT_REPORT_VERSION}</p>
</body></html>`;

  const subject = `[YSTOCK] 서버 박스→Pine 변환 + 초기 Pine 비교 (${SERVER_PINE_PORT_REPORT_VERSION})`;
  return { subject, text, html, attachments: buildAttachments() };
}

/**
 * @param {{ to?: string; dryRun?: boolean }} [opts]
 */
export async function sendServerPinePortReportEmail(opts = {}) {
  const to = String(opts.to ?? DEFAULT_SERVER_PINE_PORT_TO).trim();
  if (!to) throw new Error("수신 이메일 필요");
  const dryRun = Boolean(opts.dryRun);
  if (!dryRun && !isEmailSendingConfigured()) {
    const err = new Error("SMTP 미설정");
    err.code = "EMAIL_NOT_CONFIGURED";
    throw err;
  }
  const payload = buildServerPinePortReportContent();
  if (dryRun) return { to, dryRun: true, ...payload, attachmentCount: payload.attachments.length };
  await sendTransactionalEmail({
    to,
    subject: payload.subject,
    text: payload.text,
    html: payload.html,
    attachments: payload.attachments,
  });
  return {
    to,
    dryRun: false,
    sent: true,
    subject: payload.subject,
    attachmentCount: payload.attachments.length,
  };
}
