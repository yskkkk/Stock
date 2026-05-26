/**
 * 박스권 PRO v2 — 모델 검증·버그 리포트 (Pine SSOT 대비)
 */
import fs from "node:fs";
import path from "node:path";
import { sendTransactionalEmail, isEmailSendingConfigured } from "../email-sender.js";
import { readProgramsStoreSync } from "../live-trade-programs-store.js";
import {
  BOX_RANGE_MODEL_ID,
  BOX_RANGE_PRO_TIMEFRAMES,
  BOX_RANGE_CATALOG_DIR_PRO,
  isBoxRangeProgram,
} from "../box-range/constants.js";
import { resolveServerDataDir } from "../data-path.js";
import { readBoxRangeStoreSync } from "../box-range/store.js";
import { CATALOG_MARKETS } from "../box-range/catalog-store.js";

export const BOX_RANGE_PRO_V2_AUDIT_VERSION = "2026-05-27-pro-v2-verification";
export const DEFAULT_PRO_V2_AUDIT_TO = "samron3@naver.com";

function catalogProStatsSync() {
  /** @type {Record<string, { exists: boolean; count: number; boxes: number }>} */
  const out = {};
  for (const m of CATALOG_MARKETS) {
    const idx = path.join(
      resolveServerDataDir(),
      BOX_RANGE_CATALOG_DIR_PRO,
      m,
      "_index.json",
    );
    if (!fs.existsSync(idx)) {
      out[m] = { exists: false, count: 0, boxes: 0 };
      continue;
    }
    try {
      const o = JSON.parse(fs.readFileSync(idx, "utf8"));
      const symbols = Array.isArray(o.symbols) ? o.symbols : [];
      let boxCount = 0;
      for (const sym of symbols.slice(0, 50)) {
        const fp = path.join(
          resolveServerDataDir(),
          BOX_RANGE_CATALOG_DIR_PRO,
          m,
          `${sym}.json`,
        );
        if (!fs.existsSync(fp)) continue;
        try {
          const cat = JSON.parse(fs.readFileSync(fp, "utf8"));
          if (Array.isArray(cat?.boxes)) boxCount += cat.boxes.length;
        } catch {
          /* skip */
        }
      }
      out[m] = {
        exists: true,
        count: Number(o.count) || symbols.length,
        boxes: boxCount,
      };
    } catch {
      out[m] = { exists: false, count: 0, boxes: 0 };
    }
  }
  return out;
}

function analyzeRuntimeSync() {
  const programs = readProgramsStoreSync().programs ?? [];
  const boxPrograms = programs.filter(isBoxRangeProgram);
  const armed = boxPrograms.filter((p) => p.status === "armed");
  const sim = boxPrograms.filter((p) => p.status === "sim");
  const boxes = readBoxRangeStoreSync().boxes ?? [];
  const open = boxes.filter((b) => b.state !== "closed");
  const byState = {
    idle: open.filter((b) => b.state === "idle").length,
    armed: open.filter((b) => b.state === "armed").length,
    in_position: open.filter((b) => b.state === "in_position").length,
  };
  const deadOpen = open.filter((b) => b.dead === true).length;
  return {
    programs: boxPrograms.length,
    armed: armed.length,
    sim: sim.length,
    boxesTotal: boxes.length,
    open: open.length,
    byState,
    deadOpen,
  };
}

export function buildBoxRangeProV2AuditReportContent() {
  const rt = analyzeRuntimeSync();
  const catalog = catalogProStatsSync();
  const subject =
    "[YSTOCK] 박스권 PRO v2 모델 검증·버그 리포트 (2026-05-27)";

  const text = `안녕하세요.

박스권 PRO v2(Pine pine-box-range-pro-v2.pine) 서버 구현 검증 보고서입니다.
(보고서 ID: ${BOX_RANGE_PRO_V2_AUDIT_VERSION})

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. PRO v2 매매 전략 요약 (Pine SSOT)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

【박스권 형성 — 탐지】
· 종가 88/12 백분위 밴드로 상·하단 산출, VWAP(거래량 없으면 typical median) 중심
· 시드: 최근 구간 고저폭이 TF별 max_box_pct 이내(1h 4% / 4h 6.5% / 1d 18%)
· 좌우 확장: bar_in_band + bar_near_mid(중심 이탈 % — 1h 38 / 4h 48 / 1d 58)
· 확장 끊김: 연속 3봉 이탈 시 중단 · 최소 10봉 · 상·하단 거절 터치 각 1회+
· 병합: 중심 2.5% · 높이차 35% · 시간 겹침 8봉 이내 (dead 박스 제외)

【매매 FSM — PRO v2】
1) 트리거(idle→armed): 저가 ≤ 박스 하단 (하단 이탈)
2) dipLow 추적: 트리거 후 이탈 구간 최저 저가 (손절 기준)
3) 매수(armed→in_position): 이탈 후 종가 ≥ 하단 (하단 복귀) → 진입가 = bottom
   · 중심(mid) 매수 없음 (구 legacy와 차이)
4) 익절(TP): 고가 ≥ 상단 → 포지션 청산, triggered/dipLow 리셋, 동일 박스 재진입 가능
5) 손절(SL): 저가 ≤ dipLow → 포지션 청산, dead=true (박스 소멸·재진입 금지)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
2. 서버 구현 매핑 (runner-fsm.js)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

· 탐지 SSOT: server/box-range/box-range-pro-core.js (= Pine 탐지 함수)
· FSM 입력: WebSocket/폴러 lastPrice (틱 단위)
· idle→armed: afterBox(박스 rightTime 경과) + lastPrice ≤ bottom
· armed: dipLow = armed 구간 lastPrice 최저 · lastPrice ≥ bottom → 매수 @ bottom
· in_position: lastPrice ≥ top → TP · lastPrice ≤ dipLow → SL
· 카탈로그: box-range-catalog-pro/{kr|us|crypto} JSON · UI 전략 드롭다운 pro-v2/legacy

【Pine vs 서버 차이 — 의도적 적응】
· Pine: 봉 OHLC(low/high/close) · 서버: 실시간 lastPrice
· Pine: 박스 확장 중에도 FSM 동작 · 서버: rightTime(박스 종료) 이후만 armed
  → 실매매 안전장치. 급락 틱 1회로 armed 되는 것 방지.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
3. 이번 점검에서 수정한 버그
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[BUG-1 · 높음] 익절(TP) 후 박스 즉시 closed + 카탈로그 consumed
  · Pine: TP 후 triggered/dipLow만 리셋, 동일 박스 재매매 가능
  · 서버(수정 전): closeTradingBox → 재진입 불가
  · 수정: resetBoxAfterTakeProfit() — idle 리셋, 카탈로그 유지
  · SL만 dead + close + catalog consumed

[BUG-2 · 중간] dipLow 갱신이 lastPrice≤bottom 일 때만
  · Pine: trig 상태에서 매 bar low 최저 갱신
  · 수정: armed 중 lastPrice < dipLow 이면 항상 갱신

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
4. 잔여 리스크·개선안 (전략 변경 없음)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[높음] US live armed gate
  · isProgramArmedForMarket("us")가 toss arm 미확인 → US FSM live 매수 가능
  · 개선: toss-ready + armedMarkets.us 확인

[높음] default modelId 프로그램 armed
  · box-range FSM 미적용, 스크리너/ATR 경로 → 혼선
  · 개선: box-range 전환 또는 disarm

[중간] 틱 vs 봉 OHLC
  · lastPrice는 bar low/high wick 미반영 → dipLow·트리거 타이밍 Pine과 ±1틱 차이
  · 개선(선택): FSM에 현재봉 high/low 캐시 병합 (전략 동일, 정밀도만)

[중간] idle→armed: lastPrice 한 틱 ≤ bottom
  · Pine은 봉 저가 기준 · 서버는 틱 1회면 armed
  · 개선(선택): armed 전환에 N틱 또는 현재봉 low 확인

[중간] 매수 실패 시 텔레그램 1회만 (midNotifiedAtMs)
  · FSM은 armed 유지·재시도 함 · 알림만 없음

[중간] sim US/KR 매수 targets 미기록
  · live만 targetSellPrice/stopLossPrice 저장

[낮음] 카탈로그 슬롯 틱당 제한 → eligible 박스 연결 지연

[낮음] catalogMarket 없는 레거시 박스 + US/KR 동시 → 시장 오분류 가능

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
5. 런타임 스냅샷
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

· box-range 프로그램: ${rt.programs} (armed ${rt.armed} / sim ${rt.sim})
· 박스 state: 총 ${rt.boxesTotal} · 미청산 ${rt.open}
  idle ${rt.byState.idle} / armed ${rt.byState.armed} / in_position ${rt.byState.in_position}
· dead 플래그(미청산): ${rt.deadOpen}

PRO v2 카탈로그 (box-range-catalog-pro):
· US: ${catalog.us.exists ? `${catalog.us.count}종목 (샘플 박스 ${catalog.us.boxes})` : "없음"}
· KR: ${catalog.kr.exists ? `${catalog.kr.count}종목 (샘플 박스 ${catalog.kr.boxes})` : "없음"}
· crypto: ${catalog.crypto.exists ? `${catalog.crypto.count}종목 (샘플 박스 ${catalog.crypto.boxes})` : "없음"}

지원 TF: ${BOX_RANGE_PRO_TIMEFRAMES.join(", ")}
modelId: ${BOX_RANGE_MODEL_ID}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
6. 검증 방법
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

· node --test server/box-range/detect-pro.test.js (탐지)
· node --test server/box-range/runner-fsm.test.js (FSM 의사결정)
· TradingView pine-box-range-pro-v2.pine vs 서버 카탈로그 JSON top/bottom/mid 비교
· sim 프로그램: [box-range:sim-buy] → TP 후 idle 복귀 → 재 armed 확인

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
7. 매수/매도 타이밍 체크리스트
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

□ 박스 rightTime 이후에만 하단 이탈 감시 시작
□ 하단 이탈 → dipLow 기록 → 하단 위 복귀 시 bottom 가격 매수
□ 보유 중 상단 도달 → TP (박스 유지, 재진입 가능)
□ dipLow 재터치 → SL + dead (재진입 불가)
□ SL 후 동일 catalogBoxId 재연결 안 됨 (consumed)

자동 검증 보고서 · YSTOCK · ${BOX_RANGE_PRO_V2_AUDIT_VERSION}`;

  const html = `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>${subject}</title></head>
<body style="font-family:'Malgun Gothic',Apple SD Gothic Neo,sans-serif;line-height:1.65;color:#1a1a1a;max-width:780px;margin:0 auto;padding:24px;">
<h1 style="font-size:1.25em;color:#1e40af;">박스권 PRO v2 모델 검증·버그 리포트</h1>
<p><code>${BOX_RANGE_PRO_V2_AUDIT_VERSION}</code></p>

<h2>1. 매매 전략 (Pine SSOT)</h2>
<ul>
<li><strong>탐지</strong>: 88/12 밴드 · VWAP 중심 · TF별 확장/병합</li>
<li><strong>매수</strong>: 하단 이탈 → 하단 복귀 @ bottom (중심 매수 없음)</li>
<li><strong>익절</strong>: 상단 터치 · 박스 유지·재진입 가능</li>
<li><strong>손절</strong>: dipLow 재터치 · dead=박스 소멸</li>
</ul>

<h2>2. 수정한 버그</h2>
<ol>
<li><strong>TP 후 closed</strong> → idle 리셋으로 재진입 허용 (Pine 일치)</li>
<li><strong>dipLow</strong> armed 중 최저 lastPrice 항상 추적</li>
</ol>

<h2>3. 잔여 리스크</h2>
<ul>
<li>US armed gate / default armed 프로그램</li>
<li>틱 lastPrice vs Pine OHLC (wick 미반영)</li>
<li>afterBox(rightTime) 대기 — Pine보다 보수적</li>
</ul>

<h2>4. 런타임</h2>
<p>프로그램 ${rt.programs} · open 박스 ${rt.open} (idle ${rt.byState.idle} / armed ${rt.byState.armed} / pos ${rt.byState.in_position})<br>
카탈로그 PRO: US ${catalog.us.count} / KR ${catalog.kr.count} / crypto ${catalog.crypto.count}</p>

<p style="color:#64748b;font-size:0.9em;margin-top:32px;">YSTOCK · ${BOX_RANGE_PRO_V2_AUDIT_VERSION}</p>
</body></html>`;

  return { subject, text, html, rt, catalog };
}

/**
 * @param {{ to?: string; dryRun?: boolean }} opts
 */
export async function sendBoxRangeProV2AuditReportEmail(opts = {}) {
  const to = String(opts.to ?? DEFAULT_PRO_V2_AUDIT_TO).trim();
  if (!to) throw new Error("수신 이메일 필요");
  const dryRun = Boolean(opts.dryRun);
  if (!dryRun && !isEmailSendingConfigured()) {
    const err = new Error("SMTP 미설정");
    err.code = "EMAIL_NOT_CONFIGURED";
    throw err;
  }
  const { subject, text, html, rt, catalog } = buildBoxRangeProV2AuditReportContent();
  if (dryRun) return { to, dryRun: true, subject, rt, catalog };
  await sendTransactionalEmail({ to, subject, text, html });
  return { to, dryRun: false, subject, sent: true, rt, catalog };
}
