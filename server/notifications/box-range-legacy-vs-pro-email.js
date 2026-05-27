/**
 * 박스권 Legacy vs PRO v2 — 탐지·카탈로그·매매 차이 상세 보고서
 */
import fs from "node:fs";
import path from "node:path";
import { sendTransactionalEmail, isEmailSendingConfigured } from "../email-sender.js";
import {
  BOX_RANGE_CATALOG_DIR_LEGACY,
  BOX_RANGE_CATALOG_DIR_PRO,
  BOX_RANGE_CATALOG_DIR_PINE,
  BOX_RANGE_MAX_PCT,
  BOX_RANGE_MIN_PCT,
  BOX_RANGE_MERGE_PCT,
  BOX_RANGE_MERGE_BARS_GAP,
  BOX_RANGE_SIMILAR_RANGE_PCT,
  BOX_RANGE_PRO_MERGE_MID_PCT,
  BOX_RANGE_PRO_MERGE_HEIGHT_DIFF_PCT,
  BOX_RANGE_PRO_BAND_HIGH_PCT,
  BOX_RANGE_PRO_BAND_LOW_PCT,
  BOX_RANGE_PRO_MIN_REJECTIONS,
  BOX_RANGE_TOUCH_THRESHOLD,
  BOX_RANGE_MIN_BARS,
  BOX_RANGE_MAX_EXPAND_BARS,
} from "../box-range/constants.js";
import { BOX_RANGE_SCENARIO_VERSION } from "../box-range/migrate-active-programs.js";
import { resolveServerDataDir } from "../data-path.js";
import { summarizeCatalogRootSync } from "../box-range/catalog-store.js";
import { getPinePreset } from "../box-range/detect-pine.js";

export const LEGACY_VS_PRO_REPORT_VERSION = "2026-05-27-legacy-pro-1";
export const DEFAULT_LEGACY_VS_PRO_TO = "samron3@naver.com";

function boxHeightPct(top, bottom) {
  const m = (Number(top) + Number(bottom)) * 0.5;
  if (!Number.isFinite(m) || m <= 0) return 0;
  return ((Number(top) - Number(bottom)) / m) * 100;
}

function scanCatalogStats(catalogRoot) {
  const root = path.join(resolveServerDataDir(), catalogRoot);
  /** @type {Record<string, number>} */
  const byTf = {};
  let total = 0;
  let below1h = 0;
  let below4h = 0;
  for (const m of ["us", "kr", "crypto"]) {
    const dir = path.join(root, m);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".json") || f === "_index.json") continue;
      let o;
      try {
        o = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
      } catch {
        continue;
      }
      for (const b of o.boxes ?? []) {
        total += 1;
        const tf = String(b.timeframe ?? "");
        byTf[tf] = (byTf[tf] || 0) + 1;
        const pct = boxHeightPct(b.top, b.bottom);
        if (tf === "1h" && pct < (BOX_RANGE_MIN_PCT["1h"] || 0)) below1h += 1;
        if (tf === "4h" && pct < (BOX_RANGE_MIN_PCT["4h"] || 0)) below4h += 1;
      }
    }
  }
  return { total, byTf, below1h, below4h };
}

function formatTfCounts(byTf) {
  return ["1h", "4h", "1d"]
    .map((tf) => `${tf} ${byTf[tf] ?? 0}`)
    .join(" · ");
}

export function buildBoxRangeLegacyVsProReportContent() {
  const proStats = scanCatalogStats(BOX_RANGE_CATALOG_DIR_PRO);
  const legacyStats = scanCatalogStats(BOX_RANGE_CATALOG_DIR_LEGACY);
  const pineUs = summarizeCatalogRootSync(BOX_RANGE_CATALOG_DIR_PINE, "us");
  const p1h = getPinePreset("1h");
  const p4h = getPinePreset("4h");
  const p1d = getPinePreset("1d");

  const subject = `[YSTOCK] 박스권 Legacy vs PRO v2 차이 상세 보고서 (${LEGACY_VS_PRO_REPORT_VERSION})`;

  const text = `YSTOCK — 박스권 Legacy vs PRO v2 상세 비교 보고서
버전: ${LEGACY_VS_PRO_REPORT_VERSION} · 시나리오 v${BOX_RANGE_SCENARIO_VERSION}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
0. 한 줄 요약
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

· **실매매·시뮬**은 항상 **PRO v2 FSM**(하단 이탈→하단 복귀 매수, 상단 익절, dipLow 손절)만 사용합니다.
· 앱 「박스권」 탭의 **Legacy**는 **과거 카탈로그 JSON**(box-range-catalog)을 **보기 전용**으로 불러옵니다. 자동 스캔·실매매 연동 대상이 아닙니다.
· **PRO v2**는 box-range-catalog-pro 를 30분마다 갱신하며, 탐지·최소 폭 필터·병합 규칙이 Legacy와 다릅니다.


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. 저장소·UI·실매매 연결
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

| 구분 | 폴더 | UI 전략 버튼 | 30분 스캔 | 실매매 프로그램 연동 |
|------|------|-------------|-----------|---------------------|
| **PRO v2** | box-range-catalog-pro | PRO v2 (기본) | ○ PRO 탐지 | ○ (SSOT) |
| **Legacy** | box-range-catalog | Legacy (overlap) | ✕ 갱신 안 함 | ✕ 보기만 |
| **Pine 엔진** | box-range-catalog-pine | (탭 없음) | 별도/실험 | ✕ |

현재 서버 데이터(박스 개수):
  · PRO: 총 ${proStats.total.toLocaleString()} (${formatTfCounts(proStats.byTf)})
      - 1h 폭 <1%: ${proStats.below1h}개 · 4h 폭 <3%: ${proStats.below4h}개
  · Legacy: 총 ${legacyStats.total.toLocaleString()} (${formatTfCounts(legacyStats.byTf)})
      - 1h 폭 <1%: ${legacyStats.below1h}개 · 4h 폭 <3%: ${legacyStats.below4h}개
  · Pine(US 샘플): 종목 ${pineUs.symbols} · 박스 ${pineUs.total}


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
2. 탐지 알고리즘 차이
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

【PRO v2 — box-range-pro-core.js · pine-box-range-pro.pine】
  · 상·하단: 종가 백분위 ${BOX_RANGE_PRO_BAND_HIGH_PCT}% / ${BOX_RANGE_PRO_BAND_LOW_PCT}%
  · 중심: 구간 VWAP (거래량 없으면 typical 중앙값)
  · 시드: 봉 고저 누적 폭이 TF별 상한 이내 (1h ${BOX_RANGE_MAX_PCT["1h"]}% / 4h ${BOX_RANGE_MAX_PCT["4h"]}% / 1d ${BOX_RANGE_MAX_PCT["1d"]}%)
  · 최소 박스 높이: 1h ≥${BOX_RANGE_MIN_PCT["1h"]}% · 4h ≥${BOX_RANGE_MIN_PCT["4h"]}% · 1d 제한 없음
  · 확장: 최대 ${BOX_RANGE_MAX_EXPAND_BARS}봉, 중심 이탈 %로 가로 확장 중단 (1h 38 / 4h 48 / 1d 58)
  · 거절: 상·하단 각 ${BOX_RANGE_PRO_MIN_REJECTIONS}회+ (터치 폭 ${Math.round(BOX_RANGE_TOUCH_THRESHOLD * 100)}%)
  · 병합: 중심 ${BOX_RANGE_PRO_MERGE_MID_PCT}% · 높이차 ${BOX_RANGE_PRO_MERGE_HEIGHT_DIFF_PCT}% · 시간 겹침(≈${BOX_RANGE_MERGE_BARS_GAP}봉) — **가격 35% 겹침 병합 없음**

【Legacy 카탈로그 — 과거 누적】
  · 초기에는 detect-pro + **가격대 overlap(약 ${BOX_RANGE_MERGE_PCT}% 겹침)·유사범위 ${BOX_RANGE_SIMILAR_RANGE_PCT}%·${BOX_RANGE_MERGE_BARS_GAP}봉** 으로 박스를 **적게** 합쳐 저장한 데이터가 남아 있음
  · **최소 폭(1h 1% / 4h 3%) 필터 미적용** → 얇은 1h 박스 ${legacyStats.below1h}개 등 잔존
  · 지금 서버 스캔은 이 폴더를 **다시 쓰지 않음** → Legacy 탭 숫자는 예전 기준 그대로

【Pine f_zoneEngine — detect-pine.js (참고, Legacy≠Pine)】
  · horizontal-box-zones 포팅: ATR·ER·시드 끊김 프리셋이 PRO와 다름
  · 1h 예: lookback ${p1h?.lb} · minBars ${p1h?.minB} · maxPct ${p1h?.maxPct}% · mergeMid ${p1h?.mergeMidPct}%
  · 4h: lb ${p4h?.lb} max ${p4h?.maxPct}% · 1d: lb ${p1d?.lb} max ${p1d?.maxPct}%
  · 카탈로그 병합 시 Legacy 폴더는 pineBoxesShouldMerge(중심 1~1.5% 근접)로 ID 유지


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
3. 매매 규칙 — Legacy vs PRO (중요)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

| 항목 | Legacy 탭(과거 데이터) | PRO v2 실매매 (runner-fsm.js) |
|------|------------------------|-------------------------------|
| 매수 트리거 | (과거 문서) 중심가 터치 매수 등 구버전 설명 잔존 가능 | 박스 **종료 후** 하단 **이탈** → 하단 **위 복귀** |
| 진입가 | — | **bottom** |
| 익절 | — | **top** (청산 후 idle, 재진입 가능) |
| 손절 | — | 이탈 구간 **dipLow** (1회 후 dead) |
| 시세 | — | lastPrice 틱 (종가 아님) |

※ TradingView pine-box-range-pro.pine 일부 구간에는 아직 「중심 터치 매수」 코드가 남아 있으나, **서버 실매매는 하단 복귀 매수로 통일**되어 있습니다.


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
4. 카탈로그 병합·ID 유지
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  · PRO 폴더: shouldMergeProBoxes (중심·높이·시간) — overlap % 병합 **안 함**
  · Legacy 폴더: pineBoxesShouldMerge (Pine 프리셋 mergeMid 1~1.5%) 양방향 매칭
  · 프로그램 state 병합(findMergeBoxIndex): **PRO 병합 규칙만** 사용 (실시간 코인 탐지 박스)


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
5. 왜 화면에서 박스 수·폭이 다르게 보이나
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  1) **다른 JSON** — Legacy는 예전 스캔, PRO는 현재 스캔
  2) **최소 폭** — PRO만 1h 1% / 4h 3% 적용 (Legacy 1h ${legacyStats.below1h}개는 1% 미만)
  3) **병합** — Legacy는 overlap으로 박스가 더 **합쳐져** 개수가 적을 수 있음
  4) **UI %** — 카드 TP/SL %는 중심→상·하 거리 (전체 박스 높이의 약 절반)
  5) **실매매** — Legacy 탭에서 본 박스가 곧바로 매매되지 않음 (PRO 카탈로그만 연동)


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
6. 권장 사용
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  · 일상 확인·실매매 기준: **PRO v2** 탭 + armed/sim 프로그램
  · Legacy: 과거 박스와 비교·검증용 (신규 데이터 없음)
  · Pine 카탈로그: TV horizontal zones 와 수량 비교용

문의: 앱 「문의」 — 종목·TF·PRO/Legacy 스크린샷

— YSTOCK · ${LEGACY_VS_PRO_REPORT_VERSION}`;

  const html = `<!DOCTYPE html>
<html lang="ko">
<head><meta charset="utf-8"><title>${subject}</title></head>
<body style="font-family:'Malgun Gothic',Apple SD Gothic Neo,sans-serif;line-height:1.65;color:#111;max-width:860px;margin:0 auto;padding:24px;">
<h1 style="font-size:1.2em;color:#1e40af;border-bottom:2px solid #2563eb;padding-bottom:8px;">박스권 Legacy vs PRO v2 상세 비교</h1>
<p style="color:#64748b;font-size:0.9em;"><code>${LEGACY_VS_PRO_REPORT_VERSION}</code> · 시나리오 v${BOX_RANGE_SCENARIO_VERSION}</p>

<h2 style="color:#1e40af;">한 줄 요약</h2>
<ul>
<li><strong>실매매</strong> = PRO v2 FSM만 (하단 복귀 매수 · dipLow 손절)</li>
<li><strong>Legacy 탭</strong> = 과거 <code>${BOX_RANGE_CATALOG_DIR_LEGACY}</code> 보기 전용, 스캔·매매 미연동</li>
<li><strong>PRO 탭</strong> = <code>${BOX_RANGE_CATALOG_DIR_PRO}</code> 30분 갱신 + 최소 폭 필터</li>
</ul>

<h2 style="color:#1e40af;">1. 저장소·연동</h2>
<table border="1" cellpadding="8" style="border-collapse:collapse;width:100%;font-size:0.9em;">
<tr style="background:#f1f5f9;"><th>구분</th><th>폴더</th><th>스캔</th><th>실매매</th></tr>
<tr><td><strong>PRO v2</strong></td><td>${BOX_RANGE_CATALOG_DIR_PRO}</td><td>○</td><td>○ SSOT</td></tr>
<tr><td><strong>Legacy</strong></td><td>${BOX_RANGE_CATALOG_DIR_LEGACY}</td><td>✕</td><td>✕ 보기만</td></tr>
<tr><td>Pine 엔진</td><td>${BOX_RANGE_CATALOG_DIR_PINE}</td><td>별도</td><td>✕</td></tr>
</table>
<p>현재 박스 수 — <strong>PRO</strong> ${proStats.total.toLocaleString()} (${formatTfCounts(proStats.byTf)}, 1h&lt;1%: ${proStats.below1h}) · <strong>Legacy</strong> ${legacyStats.total.toLocaleString()} (${formatTfCounts(legacyStats.byTf)}, 1h&lt;1%: ${legacyStats.below1h})</p>

<h2 style="color:#1e40af;">2. 탐지 차이</h2>
<table border="1" cellpadding="8" style="border-collapse:collapse;width:100%;font-size:0.88em;">
<tr style="background:#f1f5f9;"><th></th><th>PRO v2</th><th>Legacy (누적)</th></tr>
<tr><td>상·하단</td><td>종가 ${BOX_RANGE_PRO_BAND_HIGH_PCT}/${BOX_RANGE_PRO_BAND_LOW_PCT}% 밴드</td><td>구 detect-pro 시대 혼합</td></tr>
<tr><td>최소 높이</td><td>1h ${BOX_RANGE_MIN_PCT["1h"]}% · 4h ${BOX_RANGE_MIN_PCT["4h"]}%</td><td>필터 없음 (${legacyStats.below1h}개 1h&lt;1%)</td></tr>
<tr><td>병합</td><td>중심 ${BOX_RANGE_PRO_MERGE_MID_PCT}% · 높이 ${BOX_RANGE_PRO_MERGE_HEIGHT_DIFF_PCT}%</td><td>overlap ${BOX_RANGE_MERGE_PCT}% 등 구규칙</td></tr>
<tr><td>max 폭</td><td>1h ${BOX_RANGE_MAX_PCT["1h"]}% / 4h ${BOX_RANGE_MAX_PCT["4h"]}% / 1d ${BOX_RANGE_MAX_PCT["1d"]}%</td><td>동일 계열이나 데이터 구버전</td></tr>
</table>

<h2 style="color:#1e40af;">3. 매매 (실매매 = PRO만)</h2>
<table border="1" cellpadding="8" style="border-collapse:collapse;width:100%;font-size:0.9em;">
<tr style="background:#f1f5f9;"><th>단계</th><th>PRO v2 서버</th></tr>
<tr><td>트리거</td><td>박스 종료 후 하단 이탈 → armed</td></tr>
<tr><td>매수</td><td>하단 위 복귀 · 진입가=bottom</td></tr>
<tr><td>익절</td><td>top · 이후 재진입 가능</td></tr>
<tr><td>손절</td><td>dipLow · dead 후 재진입 불가</td></tr>
</table>
<p style="color:#b45309;font-size:0.9em;">TV Pine 스크립트 일부는 중심 매수 코드가 남아 있으나 서버는 하단 복귀로 통일.</p>

<h2 style="color:#1e40af;">4. 화면이 다른 이유</h2>
<ol>
<li>다른 JSON·스캔 시점</li>
<li>PRO만 최소 폭 필터</li>
<li>Legacy overlap 병합으로 개수·범위 차이</li>
<li>UI % = 중심→상·하 (전체 폭의 약 절반)</li>
</ol>

<p style="margin-top:24px;color:#888;font-size:0.88em;">YSTOCK · ${LEGACY_VS_PRO_REPORT_VERSION}</p>
</body></html>`;

  return { subject, text, html, stats: { pro: proStats, legacy: legacyStats } };
}

/**
 * @param {{ to?: string; dryRun?: boolean }} [opts]
 */
export async function sendBoxRangeLegacyVsProReportEmail(opts = {}) {
  const to = String(opts?.to ?? DEFAULT_LEGACY_VS_PRO_TO).trim();
  if (!to) throw new Error("수신 이메일 필요");
  const dryRun = Boolean(opts?.dryRun);
  if (!dryRun && !isEmailSendingConfigured()) {
    const err = new Error("SMTP 미설정 (.env SMTP_HOST 또는 EMAIL_VERIFY_MOCK=1)");
    err.code = "EMAIL_NOT_CONFIGURED";
    throw err;
  }
  const payload = buildBoxRangeLegacyVsProReportContent();
  if (dryRun) return { to, dryRun: true, subject: payload.subject, stats: payload.stats };
  await sendTransactionalEmail({
    to,
    subject: payload.subject,
    text: payload.text,
    html: payload.html,
  });
  return { to, dryRun: false, sent: true, subject: payload.subject, stats: payload.stats };
}
