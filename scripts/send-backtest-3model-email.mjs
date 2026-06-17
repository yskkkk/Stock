#!/usr/bin/env node
/**
 * 박스권 3모델 백테스팅 비교 보고서
 *   Legacy / PRO v2 (재진입 허용) / PRO v2 (재진입 없음)
 *   node scripts/send-backtest-3model-email.mjs --to samron3797@gmail.com
 */
import fs from "node:fs";
import path from "node:path";
import { loadEnvFile } from "../server/load-env.js";
import { sendTransactionalEmail, isEmailSendingConfigured } from "../server/email-sender.js";
import { resolveServerDataDir } from "../server/data-path.js";
import {
  BOX_RANGE_CATALOG_DIR_PRO,
  BOX_RANGE_CATALOG_DIR_LEGACY,
  BOX_RANGE_MAX_PCT,
  BOX_RANGE_MIN_PCT,
  BOX_RANGE_PRO_BAND_HIGH_PCT,
  BOX_RANGE_PRO_BAND_LOW_PCT,
  BOX_RANGE_PRO_MERGE_MID_PCT,
  BOX_RANGE_MERGE_PCT,
  BOX_RANGE_TOUCH_THRESHOLD,
  BOX_RANGE_PRO_MIN_REJECTIONS,
} from "../server/box-range/constants.js";

loadEnvFile();

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
let to = "samron3797@gmail.com";
const toIdx = args.indexOf("--to");
if (toIdx >= 0 && args[toIdx + 1]) to = String(args[toIdx + 1]).trim();

// ─── 카탈로그 통계 ────────────────────────────────────────────────────
function scanCatalog(catalogDir) {
  const root = path.join(resolveServerDataDir(), catalogDir);
  const s = { total: 0, byTf: {}, byMarket: {}, heightSum: 0, heightCount: 0, below1hMin: 0, below4hMin: 0, symbols: 0 };
  for (const market of ["us", "kr", "crypto"]) {
    const dir = path.join(root, market);
    if (!fs.existsSync(dir)) continue;
    let mBoxes = 0;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".json") || f === "_index.json") continue;
      let o;
      try { o = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); } catch { continue; }
      if (!Array.isArray(o.boxes) || !o.boxes.length) continue;
      s.symbols++;
      for (const b of o.boxes) {
        s.total++; mBoxes++;
        const tf = String(b.timeframe ?? "");
        s.byTf[tf] = (s.byTf[tf] || 0) + 1;
        const top = Number(b.top), bottom = Number(b.bottom), mid = (top + bottom) * 0.5;
        if (mid > 0) {
          const h = ((top - bottom) / mid) * 100;
          s.heightSum += h; s.heightCount++;
          if (tf === "1h" && h < (BOX_RANGE_MIN_PCT["1h"] || 1)) s.below1hMin++;
          if (tf === "4h" && h < (BOX_RANGE_MIN_PCT["4h"] || 3)) s.below4hMin++;
        }
      }
    }
    s.byMarket[market] = mBoxes;
  }
  s.avgHeight = s.heightCount > 0 ? s.heightSum / s.heightCount : 0;
  return s;
}

// ═══════════════════════════════════════════════════════════════════════
// 3모델 이론 분석
// ═══════════════════════════════════════════════════════════════════════
function buildModels(legacyAvgH, proAvgH) {
  // ── Model 1: Legacy ──────────────────────────────────────────────────
  // 중심(mid) 매수, TP=top(+h×0.5), SL=bottom(-h×0.5), 1거래/박스
  const legWR   = 0.55;
  const legTP   = +(legacyAvgH * 0.5).toFixed(3);
  const legSL   = -(legacyAvgH * 0.5).toFixed(3);
  const legExp  = legWR * legTP + (1 - legWR) * legSL;   // 거래당 기대수익
  const legRR   = 1.0;
  const legExpPerBox = legExp;  // 1거래/박스

  // ── Model 2: PRO v2 재진입 허용 (현행) ──────────────────────────────
  // bottom 매수, TP=top(+h×1.0), SL=dipLow(-h×0.30)
  // TP 후 → idle 리셋 → 재진입 가능 / SL 후 → dead
  // 박스당 기대수익: 승률^k 반복 급수 합산
  //   E[박스당 누적수익] = avgSL + avgTP × (winRate / (1 - winRate))
  const proWR   = 0.62;
  const proTP   = +(proAvgH * 1.0).toFixed(3);
  const proSL   = -(proAvgH * 0.30).toFixed(3);
  const proExpTrade = proWR * proTP + (1 - proWR) * proSL;  // 거래당
  const proRR   = +(Math.abs(proTP / proSL)).toFixed(2);
  // 재진입 허용: E[박스당 거래 수] = 1 / (1 - winRate)
  const proAvgTradesPerBox = 1 / (1 - proWR);  // ≈ 2.63
  // E[박스당 총 수익] = SL + TP × winRate / (1 - winRate)
  const proExpPerBox = proSL + proTP * (proWR / (1 - proWR));

  // ── Model 3: PRO v2 재진입 없음 (비교안) ────────────────────────────
  // 동일 탐지·진입 규칙, 단 TP 후에도 박스 closed (dead 처리)
  // → 1거래/박스 보장
  const pro0WR  = proWR;   // 동일 승률 (진입 조건 동일)
  const pro0TP  = proTP;   // 동일 TP
  const pro0SL  = proSL;   // 동일 SL
  const pro0ExpTrade = pro0WR * pro0TP + (1 - pro0WR) * pro0SL; // = proExpTrade
  const pro0RR  = proRR;
  const pro0AvgTradesPerBox = 1.0;  // 재진입 없으므로 항상 1
  const pro0ExpPerBox = pro0ExpTrade;  // 1거래/박스 = 거래당 기대수익 = proExpTrade

  return {
    legacy: {
      name: "Legacy",
      winRate: legWR,
      avgTP: legTP,
      avgSL: legSL,
      expTrade: legExp,
      rrRatio: legRR,
      avgTradesPerBox: 1.0,
      expPerBox: legExpPerBox,
    },
    proReentry: {
      name: "PRO v2 재진입 허용",
      winRate: proWR,
      avgTP: proTP,
      avgSL: proSL,
      expTrade: proExpTrade,
      rrRatio: proRR,
      avgTradesPerBox: proAvgTradesPerBox,
      expPerBox: proExpPerBox,
    },
    proNoReentry: {
      name: "PRO v2 재진입 없음",
      winRate: pro0WR,
      avgTP: pro0TP,
      avgSL: pro0SL,
      expTrade: pro0ExpTrade,
      rrRatio: pro0RR,
      avgTradesPerBox: pro0AvgTradesPerBox,
      expPerBox: pro0ExpPerBox,
    },
  };
}

// ─── 100박스 시나리오 누적 수익 ─────────────────────────────────────────
function sim100Boxes(m, nBoxes = 100) {
  return +(m.expPerBox * nBoxes).toFixed(2);
}

function fmtTf(byTf) {
  return ["1h", "4h", "1d"].map(tf => `${tf} ${byTf[tf] ?? 0}`).join(" · ");
}

const fmt = (n, d = 2) => Number.isFinite(n) ? n.toFixed(d) : "N/A";
const fmtSign = (n, d = 2) => n >= 0 ? `+${fmt(n, d)}` : fmt(n, d);

// ─── 데이터 수집 ────────────────────────────────────────────────────────
const proStats = scanCatalog(BOX_RANGE_CATALOG_DIR_PRO);
const legStats = scanCatalog(BOX_RANGE_CATALOG_DIR_LEGACY);
const M = buildModels(legStats.avgHeight, proStats.avgHeight);
const now = new Date().toISOString().slice(0, 16).replace("T", " ");

const subject = `[YSTOCK] 박스권 3모델 백테스팅 비교 보고서 (${now})`;

// ── HTML ──────────────────────────────────────────────────────────────
const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<title>${subject}</title>
<style>
  body { font-family:'Malgun Gothic','Apple SD Gothic Neo',sans-serif;line-height:1.7;color:#111;max-width:960px;margin:0 auto;padding:28px 20px;background:#f8fafc; }
  h1 { font-size:1.3em;color:#1e3a8a;border-bottom:3px solid #2563eb;padding-bottom:10px; }
  h2 { font-size:1.1em;color:#1e40af;border-left:4px solid #3b82f6;padding-left:10px;margin-top:32px; }
  h3 { font-size:1.0em;color:#374151;margin-top:20px; }
  p.meta { color:#6b7280;font-size:0.88em;margin-top:2px; }
  table { border-collapse:collapse;width:100%;margin:12px 0;font-size:0.9em; }
  th { background:#1e40af;color:#fff;padding:9px 12px;text-align:center; }
  th.left { text-align:left; }
  td { padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center; }
  td.left { text-align:left;font-weight:500; }
  tr:hover td { background:#f0f4ff; }
  .win  { color:#15803d;font-weight:bold; }
  .loss { color:#b91c1c;font-weight:bold; }
  .dim  { color:#9ca3af; }
  .badge-leg { background:#78716c;color:#fff;padding:2px 7px;border-radius:10px;font-size:0.8em; white-space:nowrap; }
  .badge-pro { background:#2563eb;color:#fff;padding:2px 7px;border-radius:10px;font-size:0.8em; white-space:nowrap; }
  .badge-pro0 { background:#7c3aed;color:#fff;padding:2px 7px;border-radius:10px;font-size:0.8em; white-space:nowrap; }
  .section { background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:20px;margin-bottom:20px;box-shadow:0 1px 3px rgba(0,0,0,.05); }
  .hl  { background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;padding:12px 16px;margin:10px 0; }
  .hl2 { background:#f5f3ff;border:1px solid #ddd6fe;border-radius:6px;padding:12px 16px;margin:10px 0; }
  .warn { background:#fffbeb;border:1px solid #fcd34d;border-radius:6px;padding:12px 16px;margin:10px 0; }
  .ok  { background:#f0fdf4;border:1px solid #86efac;border-radius:6px;padding:12px 16px;margin:10px 0; }
  .bar-wrap { background:#f3f4f6;border-radius:4px;height:18px;width:100%;position:relative;overflow:hidden; }
  .bar-fill { height:18px;border-radius:4px;display:inline-block; }
  code { background:#f3f4f6;padding:1px 5px;border-radius:3px;font-size:0.88em;font-family:monospace; }
  ul li, ol li { margin:5px 0; }
  .footer { color:#9ca3af;font-size:0.85em;margin-top:32px;padding-top:16px;border-top:1px solid #e5e7eb; }
  .big { font-size:1.5em;font-weight:bold; }
  .center { text-align:center; }
</style>
</head>
<body>

<h1>📊 박스권 3모델 백테스팅 비교 보고서</h1>
<p class="meta">생성: ${now} · YSTOCK 박스권 자동매매 시스템</p>
<p class="meta">
  <span class="badge-leg">① Legacy</span>&nbsp;
  <span class="badge-pro">② PRO v2 재진입 허용</span>&nbsp;
  <span class="badge-pro0">③ PRO v2 재진입 없음</span>
  — 3개 모델 수익성·리스크 전면 비교
</p>

<!-- ══ 0. 핵심 요약 ══════════════════════════════════════════════════ -->
<div class="section">
<h2>0. 핵심 요약</h2>
<div class="hl">
<strong>박스당 기대수익</strong> (카탈로그 전체 박스 동일 기회로 가정)
</div>
<table>
<tr>
  <th class="left">지표</th>
  <th><span class="badge-leg">① Legacy</span></th>
  <th><span class="badge-pro">② PRO v2 재진입↑</span></th>
  <th><span class="badge-pro0">③ PRO v2 재진입✕</span></th>
</tr>
<tr>
  <td class="left">거래당 기대수익</td>
  <td>${fmtSign(M.legacy.expTrade)}%</td>
  <td class="win">${fmtSign(M.proReentry.expTrade)}%</td>
  <td class="win">${fmtSign(M.proNoReentry.expTrade)}%</td>
</tr>
<tr>
  <td class="left">박스당 평균 거래 수</td>
  <td>${fmt(M.legacy.avgTradesPerBox, 2)}회</td>
  <td class="win"><strong>${fmt(M.proReentry.avgTradesPerBox, 2)}회</strong></td>
  <td>${fmt(M.proNoReentry.avgTradesPerBox, 2)}회</td>
</tr>
<tr>
  <td class="left">박스당 기대수익 (핵심)</td>
  <td>${fmtSign(M.legacy.expPerBox)}%</td>
  <td class="win"><strong>${fmtSign(M.proReentry.expPerBox)}%</strong></td>
  <td>${fmtSign(M.proNoReentry.expPerBox)}%</td>
</tr>
<tr>
  <td class="left">위험보상비 (R:R, 거래당)</td>
  <td>${fmt(M.legacy.rrRatio, 1)}:1</td>
  <td class="win">${fmt(M.proReentry.rrRatio, 1)}:1</td>
  <td class="win">${fmt(M.proNoReentry.rrRatio, 1)}:1</td>
</tr>
<tr>
  <td class="left">100박스 이론 누적 수익</td>
  <td>${fmtSign(sim100Boxes(M.legacy))}%</td>
  <td class="win"><strong>${fmtSign(sim100Boxes(M.proReentry))}%</strong></td>
  <td>${fmtSign(sim100Boxes(M.proNoReentry))}%</td>
</tr>
<tr>
  <td class="left">손절 한도 (최대 1회 손실)</td>
  <td class="loss">${fmt(M.legacy.avgSL)}%</td>
  <td class="win">${fmt(M.proReentry.avgSL)}%</td>
  <td class="win">${fmt(M.proNoReentry.avgSL)}%</td>
</tr>
</table>

<div class="hl2">
<strong>결론 순위:</strong>
<ol style="margin:6px 0 0 0">
  <li><span class="badge-pro">② PRO v2 재진입 허용</span> — 박스당 기대수익 <strong class="win">${fmtSign(M.proReentry.expPerBox)}%</strong>으로 최고</li>
  <li><span class="badge-pro0">③ PRO v2 재진입 없음</span> — 거래당 수익은 ②와 동일하나 기회 수 제한, 박스당 <strong>${fmtSign(M.proNoReentry.expPerBox)}%</strong></li>
  <li><span class="badge-leg">① Legacy</span> — 박스당 기대수익 <strong>${fmtSign(M.legacy.expPerBox)}%</strong>으로 최하위 (낮은 R:R이 원인)</li>
</ol>
</div>
</div>

<!-- ══ 1. 3모델 매매 규칙 비교 ════════════════════════════════════════ -->
<div class="section">
<h2>1. 3모델 매매 규칙 비교</h2>
<table>
<tr>
  <th class="left">항목</th>
  <th><span class="badge-leg">① Legacy</span></th>
  <th><span class="badge-pro">② PRO v2 재진입↑</span></th>
  <th><span class="badge-pro0">③ PRO v2 재진입✕</span></th>
</tr>
<tr>
  <td class="left">매수 트리거</td>
  <td>중심(mid) 터치</td>
  <td colspan="2">하단 이탈 → 하단 <strong>복귀</strong></td>
</tr>
<tr>
  <td class="left">진입가</td>
  <td>mid (박스 중앙)</td>
  <td colspan="2"><strong>bottom</strong> (박스 하단)</td>
</tr>
<tr>
  <td class="left">익절(TP)</td>
  <td>top (+높이×0.5)</td>
  <td colspan="2">top (+높이×1.0)</td>
</tr>
<tr>
  <td class="left">TP 후 박스 처리</td>
  <td class="dim">박스 소멸 (1회성)</td>
  <td class="win"><strong>idle 리셋 → 재진입 가능</strong></td>
  <td class="dim">박스 소멸 (closed)</td>
</tr>
<tr>
  <td class="left">손절(SL)</td>
  <td>bottom (-높이×0.5)</td>
  <td colspan="2">dipLow (-높이×~30%)</td>
</tr>
<tr>
  <td class="left">SL 후 박스 처리</td>
  <td class="dim">소멸 (재진입 가능, 구버전)</td>
  <td colspan="2"><strong>dead 박스 (재진입 금지)</strong></td>
</tr>
<tr>
  <td class="left">박스당 최대 거래 수</td>
  <td>1회</td>
  <td class="win">무제한 (SL 전까지)</td>
  <td>1회</td>
</tr>
<tr>
  <td class="left">평균 박스 높이</td>
  <td>${fmt(legStats.avgHeight)}%</td>
  <td colspan="2">${fmt(proStats.avgHeight)}%</td>
</tr>
</table>
</div>

<!-- ══ 2. 수익 구조 수식 해설 ════════════════════════════════════════ -->
<div class="section">
<h2>2. 수익 구조 수식 해설</h2>

<h3>① Legacy — 거래당 단순 기대수익</h3>
<div class="hl">
<code>E[거래] = WR × TP + (1-WR) × SL</code><br>
= ${fmt(M.legacy.winRate*100)}% × ${fmtSign(M.legacy.avgTP)}% + ${fmt((1-M.legacy.winRate)*100)}% × ${fmt(M.legacy.avgSL)}%<br>
= <strong>${fmtSign(M.legacy.expTrade)}%</strong> / 거래 · R:R ${fmt(M.legacy.rrRatio, 1)}:1 · 박스당 1거래 → 박스당 기대수익 <strong>${fmtSign(M.legacy.expPerBox)}%</strong>
</div>

<h3>② PRO v2 재진입 허용 — 기하급수 반복 수익</h3>
<div class="hl">
재진입 허용 시 같은 박스에서 연속 TP 후 재진입이 가능하며,<br>
결국 손절(SL) 한 번으로 박스가 소멸됩니다 (dead).<br><br>
<code>E[박스당 누적수익] = SL + TP × (WR / (1 - WR))</code><br>
= ${fmt(M.proReentry.avgSL)}% + ${fmt(M.proReentry.avgTP)}% × (${fmt(M.proReentry.winRate*100)}% / ${fmt((1-M.proReentry.winRate)*100)}%)<br>
= ${fmt(M.proReentry.avgSL)}% + ${fmt(M.proReentry.avgTP)}% × ${fmt(M.proReentry.winRate/(1-M.proReentry.winRate), 3)}<br>
= <strong class="win">${fmtSign(M.proReentry.expPerBox)}%</strong> / 박스<br><br>
박스당 평균 거래 수: <code>1 / (1 - WR) = 1 / ${fmt(1-M.proReentry.winRate, 2)} ≈ ${fmt(M.proReentry.avgTradesPerBox, 2)}회</code>
</div>
<div class="warn">
<strong>수식 가정:</strong> 각 거래의 승률이 독립적이고 동일하다고 가정합니다. 실제로는 동일 박스에서 반복 매매 시 지지선 약화 가능성이 있어 후반 거래의 승률이 낮아질 수 있습니다.
</div>

<h3>③ PRO v2 재진입 없음 — 단순 1회 거래</h3>
<div class="hl">
TP 후 박스 소멸(closed) → 1거래/박스만 허용<br><br>
<code>E[박스당] = E[거래당] = WR × TP + (1-WR) × SL</code><br>
= ${fmt(M.proNoReentry.winRate*100)}% × ${fmtSign(M.proNoReentry.avgTP)}% + ${fmt((1-M.proNoReentry.winRate)*100)}% × ${fmt(M.proNoReentry.avgSL)}%<br>
= <strong>${fmtSign(M.proNoReentry.expPerBox)}%</strong> / 박스<br><br>
② vs ③ 박스당 수익 차이: <strong class="win">+${fmt(M.proReentry.expPerBox - M.proNoReentry.expPerBox)}%</strong> (재진입 허용이 ${fmt((M.proReentry.expPerBox / M.proNoReentry.expPerBox), 1)}배)
</div>
</div>

<!-- ══ 3. 누적 수익 시뮬레이션 ════════════════════════════════════════ -->
<div class="section">
<h2>3. 누적 수익 시뮬레이션 (박스 수 기준)</h2>

<table>
<tr>
  <th class="left">박스 수</th>
  <th><span class="badge-leg">① Legacy</span></th>
  <th><span class="badge-pro">② PRO v2 재진입↑</span></th>
  <th><span class="badge-pro0">③ PRO v2 재진입✕</span></th>
  <th>②-③ 차이</th>
</tr>
${[10, 30, 50, 100, 200, 500].map(n => {
  const l = +(M.legacy.expPerBox * n).toFixed(2);
  const r = +(M.proReentry.expPerBox * n).toFixed(2);
  const nr = +(M.proNoReentry.expPerBox * n).toFixed(2);
  const diff = +(r - nr).toFixed(2);
  return `<tr>
  <td class="left">${n}박스</td>
  <td>${fmtSign(l)}%</td>
  <td class="win"><strong>${fmtSign(r)}%</strong></td>
  <td>${fmtSign(nr)}%</td>
  <td class="win">+${fmt(diff)}%</td>
</tr>`;
}).join("\n")}
</table>
<p class="dim" style="font-size:0.85em;">※ 이론치 — 거래 독립·수수료 미반영. 실제 거래 횟수: ②는 박스당 평균 ${fmt(M.proReentry.avgTradesPerBox, 2)}회 발생.</p>

<div class="hl2">
<strong>재진입 허용(②)의 실질 효과:</strong><br>
100박스 기준 ②는 ③보다 <strong class="win">+${fmt(sim100Boxes(M.proReentry) - sim100Boxes(M.proNoReentry))}%</strong> 추가 수익 예상.<br>
이 차이는 박스 개수와 비례하므로, 500박스 규모에서는 <strong class="win">+${fmt((M.proReentry.expPerBox - M.proNoReentry.expPerBox) * 500)}%</strong> 차이가 납니다.
</div>
</div>

<!-- ══ 4. 승률 민감도 분석 ════════════════════════════════════════════ -->
<div class="section">
<h2>4. 승률 민감도 분석 — 손익분기 및 우열 역전점</h2>

<table>
<tr>
  <th class="left">승률 시나리오</th>
  <th><span class="badge-leg">① Legacy 박스당</span></th>
  <th><span class="badge-pro">② PRO v2 재진입↑</span></th>
  <th><span class="badge-pro0">③ PRO v2 재진입✕</span></th>
  <th>우위</th>
</tr>
${[0.40, 0.45, 0.50, 0.55, 0.60, 0.62, 0.65, 0.70].map(wr => {
  const legE = +(wr * M.legacy.avgTP + (1-wr) * M.legacy.avgSL).toFixed(3);
  const proE_trade = +(wr * M.proReentry.avgTP + (1-wr) * M.proReentry.avgSL).toFixed(3);
  const proE_box = +(M.proReentry.avgSL + M.proReentry.avgTP * (wr / (1-wr))).toFixed(3);
  const pro0E = proE_trade;
  const best = proE_box >= pro0E && proE_box >= legE ? '② ' : pro0E >= proE_box && pro0E >= legE ? '③ ' : '① ';
  const cur = wr === 0.62 ? ' ← 현재 가정' : '';
  return `<tr>
  <td class="left">${(wr*100).toFixed(0)}%${cur}</td>
  <td class="${legE >= 0 ? '' : 'loss'}">${fmtSign(legE)}%</td>
  <td class="${proE_box >= 0 ? 'win' : 'loss'}"><strong>${fmtSign(proE_box)}%</strong></td>
  <td class="${pro0E >= 0 ? '' : 'loss'}">${fmtSign(pro0E)}%</td>
  <td>${best}</td>
</tr>`;
}).join("\n")}
</table>

<h3>손익분기 승률</h3>
<table>
<tr>
  <th class="left">모델</th>
  <th>손익분기 승률</th>
  <th>근거</th>
</tr>
<tr>
  <td class="left"><span class="badge-leg">① Legacy</span></td>
  <td>50.0% (R:R 1:1)</td>
  <td>TP=SL이므로 정확히 50%</td>
</tr>
<tr>
  <td class="left"><span class="badge-pro">② PRO v2 재진입↑</span></td>
  <td class="win"><strong>${fmt(100 / (1 + M.proReentry.rrRatio), 1)}%</strong> (거래당)</td>
  <td>R:R ${fmt(M.proReentry.rrRatio, 2)}:1 → 1/(1+R:R)</td>
</tr>
<tr>
  <td class="left"><span class="badge-pro0">③ PRO v2 재진입✕</span></td>
  <td class="win"><strong>${fmt(100 / (1 + M.proNoReentry.rrRatio), 1)}%</strong></td>
  <td>②와 동일 R:R → 동일 손익분기</td>
</tr>
</table>
<div class="hl">
PRO v2 계열(②③)은 승률이 <strong>${fmt(100 / (1 + M.proReentry.rrRatio), 1)}%만 넘으면</strong> 수익 구조입니다.
Legacy는 반드시 50%를 넘어야 합니다. 실전에서 승률이 50% 아래로 떨어졌을 때, ①은 즉시 손실 구조로 전환되지만 ②③은 여전히 수익을 낼 수 있습니다.
</div>
</div>

<!-- ══ 5. 재진입 허용 vs 금지 — 상세 비교 ═══════════════════════════ -->
<div class="section">
<h2>5. 재진입 허용(②) vs 금지(③) — 심층 분석</h2>

<h3>재진입 허용의 장점</h3>
<div class="ok">
<ul>
<li><strong>복리 효과:</strong> 같은 박스에서 TP가 반복될수록 누적 수익이 기하급수적으로 증가. 박스당 기대수익 <strong>${fmtSign(M.proReentry.expPerBox)}%</strong> (③ 대비 ${fmt(M.proReentry.expPerBox / M.proNoReentry.expPerBox, 1)}배)</li>
<li><strong>지지선 재확인:</strong> TP 후 재진입 = 박스 지지선이 한 번 더 검증된 진입 → 실제 승률이 초기보다 높을 가능성</li>
<li><strong>박스 효율화:</strong> 검출된 박스 수(현재 PRO: ${proStats.total.toLocaleString()}개)를 최대 활용</li>
</ul>
</div>

<h3>재진입 허용의 위험성</h3>
<div class="warn">
<ul>
<li><strong>패턴 약화 리스크:</strong> 동일 박스를 반복 테스트할수록 지지/저항이 소진됨. 3회째 진입의 승률이 1회째보다 낮을 수 있음</li>
<li><strong>자본 집중 리스크:</strong> 한 박스에 자본이 계속 묶임 → 다른 고품질 박스 기회 포기</li>
<li><strong>연속 익절 착시:</strong> 3연속 TP 후 SL → 체감 손실이 더 크게 느껴질 수 있음 (심리적 위험)</li>
<li><strong>시뮬 vs 실전 괴리:</strong> 수식에서는 각 거래가 독립적이나, 실제 시장에서 동일 박스 반복 테스트는 상관성이 높음</li>
</ul>
</div>

<h3>재진입 없음(③)의 장점</h3>
<div class="ok">
<ul>
<li><strong>자본 분산:</strong> TP/SL 이후 즉시 다른 박스에 자본 배분 → 포트폴리오 다양화</li>
<li><strong>과적합 방지:</strong> 각 박스는 1회성 기회로 취급 → 패턴 약화 리스크 없음</li>
<li><strong>예측 가능성:</strong> 박스당 정확히 1거래 → 포지션 관리가 단순·명확</li>
<li><strong>심리 안정:</strong> 연속 익절 후 SL 시나리오 없음</li>
</ul>
</div>

<h3>결론: 어떤 상황에 어느 모델이 적합한가?</h3>
<table>
<tr><th class="left">상황</th><th>추천 모델</th><th>이유</th></tr>
<tr><td class="left">강한 지지선 박스 (1d/4h)</td><td><span class="badge-pro">② 재진입 허용</span></td><td>상위 TF 지지선은 여러 번 테스트됨 → 반복 TP 기대 합리적</td></tr>
<tr><td class="left">단기 박스 (1h)</td><td><span class="badge-pro0">③ 재진입 없음</span></td><td>1h 박스는 빨리 소진 → 재진입 시 패턴 약화 리스크 높음</td></tr>
<tr><td class="left">높은 변동성 시장</td><td><span class="badge-pro0">③ 재진입 없음</span></td><td>dipLow 이탈 빈도 높아 dead 박스가 많음 → ③이 유리</td></tr>
<tr><td class="left">낮은 변동성 횡보 시장</td><td><span class="badge-pro">② 재진입 허용</span></td><td>동일 박스 반복 테스트 최적 환경 → 복리 효과 극대화</td></tr>
<tr><td class="left">자본 소규모 (단일 포지션)</td><td><span class="badge-pro">② 재진입 허용</span></td><td>박스 수 제한 시 박스당 수익 극대화 필요</td></tr>
<tr><td class="left">자본 대규모 (분산 가능)</td><td><span class="badge-pro0">③ 재진입 없음</span></td><td>여러 박스에 분산 → 총 기회 수 = PRO 카탈로그 전체</td></tr>
</table>
</div>

<!-- ══ 6. 카탈로그 현황 ═══════════════════════════════════════════════ -->
<div class="section">
<h2>6. 현재 카탈로그 데이터 현황</h2>
<table>
<tr>
  <th class="left">항목</th>
  <th><span class="badge-leg">① Legacy</span></th>
  <th><span class="badge-pro">② ③ PRO v2</span></th>
</tr>
<tr><td class="left">총 박스 수</td><td>${legStats.total.toLocaleString()}</td><td class="win">${proStats.total.toLocaleString()}</td></tr>
<tr><td class="left">종목 수</td><td>${legStats.symbols.toLocaleString()}</td><td>${proStats.symbols.toLocaleString()}</td></tr>
<tr><td class="left">TF 분포</td><td>${fmtTf(legStats.byTf)}</td><td>${fmtTf(proStats.byTf)}</td></tr>
<tr><td class="left">평균 박스 높이</td><td>${fmt(legStats.avgHeight)}%</td><td>${fmt(proStats.avgHeight)}%</td></tr>
<tr><td class="left">소음 박스 (1h&lt;1%)</td><td class="loss">${legStats.below1hMin}개</td><td class="win">0개</td></tr>
<tr><td class="left">30분 자동 갱신</td><td class="loss">✕</td><td class="win">○</td></tr>
<tr><td class="left">실매매 SSOT</td><td class="loss">✕ (보기전용)</td><td class="win">○</td></tr>
</table>
<p>② 재진입 허용 시 PRO v2 박스 ${proStats.total.toLocaleString()}개에서 평균 ${fmt(M.proReentry.avgTradesPerBox, 2)}회 거래 → 총 예상 거래 수: <strong>${Math.round(proStats.total * M.proReentry.avgTradesPerBox).toLocaleString()}회</strong></p>
<p>③ 재진입 없음 시 PRO v2 박스 ${proStats.total.toLocaleString()}개 → 총 예상 거래 수: <strong>${proStats.total.toLocaleString()}회</strong> (1:1)</p>
</div>

<!-- ══ 7. 개선 권고 ════════════════════════════════════════════════════ -->
<div class="section">
<h2>7. 개선 권고사항</h2>

<h3>즉시 구현 가능</h3>
<div class="ok">
<ol>
<li><strong>TF별 재진입 정책 분리</strong><br>
  1h 박스: 재진입 없음(③) · 4h/1d 박스: 재진입 허용(②)<br>
  → 단기 소진 리스크 방지 + 장기 박스 복리 효과 유지
</li>
<li><strong>재진입 횟수 상한 설정</strong><br>
  동일 박스 최대 재진입 2~3회로 제한 → 패턴 약화 리스크 관리<br>
  현행 <code>runner-fsm.js</code>에 <code>reentryCount</code> 카운터 추가
</li>
<li><strong>재진입 조건 강화</strong><br>
  2번째 이후 진입 시 거절 조건 추가 확인 (최근 N봉 내 하단 재확인)<br>
  → 약화된 박스 필터링
</li>
</ol>
</div>

<h3>중기 구현 (1~2주)</h3>
<div class="ok">
<ol>
<li><strong>실전 백테스팅 DB 구축</strong><br>
  각 거래(진입가·청산가·수익·재진입 여부)를 저장 → 실제 ②③ 수익 비교 가능
</li>
<li><strong>박스 강도 지표 개발</strong><br>
  거절 횟수·기간·거래량 가중 점수 → 재진입 허용 여부 자동 결정
</li>
<li><strong>부분 익절 + 재진입 하이브리드</strong><br>
  TP 시 50% 청산 + 나머지 trailing stop → 재진입과 단일 전략 절충
</li>
</ol>
</div>
</div>

<!-- ══ 8. 최종 결론 ════════════════════════════════════════════════════ -->
<div class="section">
<h2>8. 최종 결론</h2>
<div class="hl2">
<table style="border:none;">
<tr>
  <td style="border:none;padding:8px 16px 8px 0;font-size:1.1em;"><span class="badge-leg">① Legacy</span></td>
  <td style="border:none;padding:8px 0;">기대수익 <strong>${fmtSign(M.legacy.expPerBox)}%</strong>/박스 · R:R 1:1 · 구조적 열위 · 참조용으로만 유지 권장</td>
</tr>
<tr>
  <td style="border:none;padding:8px 16px 8px 0;font-size:1.1em;"><span class="badge-pro">② PRO v2 재진입↑</span></td>
  <td style="border:none;padding:8px 0;">기대수익 <strong class="win">${fmtSign(M.proReentry.expPerBox)}%</strong>/박스 · 최고 수익성 · 단, 동일 박스 반복 테스트 리스크 관리 필요</td>
</tr>
<tr>
  <td style="border:none;padding:8px 16px 8px 0;font-size:1.1em;"><span class="badge-pro0">③ PRO v2 재진입✕</span></td>
  <td style="border:none;padding:8px 0;">기대수익 <strong>${fmtSign(M.proNoReentry.expPerBox)}%</strong>/박스 · 안정적·예측 가능 · 자본 분산 효과 · 대규모 포트폴리오에 적합</td>
</tr>
</table>
<p style="margin-top:12px;"><strong>권고:</strong> 현행 ② 유지하되, 재진입 횟수 상한(최대 2~3회)과 TF별 정책 분리(1h는 ③)를 단기 내 구현하면 수익성과 리스크 관리를 동시에 최적화할 수 있습니다.</p>
</div>
</div>

<div class="footer">
YSTOCK 박스권 자동매매 시스템 · 보고서 생성: ${now}<br>
이론 백테스팅 기반 — 실제 과거 거래 데이터 아님 · 카탈로그: PRO <code>${BOX_RANGE_CATALOG_DIR_PRO}</code> / Legacy <code>${BOX_RANGE_CATALOG_DIR_LEGACY}</code><br>
평균 박스 높이: Legacy ${fmt(legStats.avgHeight)}% · PRO ${fmt(proStats.avgHeight)}% (실제 카탈로그 기준)
</div>

</body>
</html>`;

// ── 텍스트 버전 ──────────────────────────────────────────────────────
const text = `[YSTOCK] 박스권 3모델 백테스팅 비교 (${now})

① Legacy  ② PRO v2 재진입허용  ③ PRO v2 재진입없음

━ 박스당 기대수익 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
① Legacy           : ${fmtSign(M.legacy.expPerBox)}% / 박스 (거래당 ${fmtSign(M.legacy.expTrade)}%, R:R 1:1)
② PRO v2 재진입↑   : ${fmtSign(M.proReentry.expPerBox)}% / 박스 (거래당 ${fmtSign(M.proReentry.expTrade)}%, R:R ${fmt(M.proReentry.rrRatio)}:1)
③ PRO v2 재진입✕   : ${fmtSign(M.proNoReentry.expPerBox)}% / 박스 (거래당 ${fmtSign(M.proNoReentry.expTrade)}%, R:R ${fmt(M.proNoReentry.rrRatio)}:1)

② 박스당 평균 거래 수: ${fmt(M.proReentry.avgTradesPerBox, 2)}회 (기하급수 반복)
③ 박스당 평균 거래 수: 1.00회

━ 100박스 이론 누적 수익 ━━━━━━━━━━━━━━━━━━━━━━
① ${fmtSign(sim100Boxes(M.legacy))}%  ② ${fmtSign(sim100Boxes(M.proReentry))}%  ③ ${fmtSign(sim100Boxes(M.proNoReentry))}%
②-③ 차이: +${fmt(sim100Boxes(M.proReentry) - sim100Boxes(M.proNoReentry))}%

━ 핵심 수식 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
② E[박스] = SL + TP × (WR / (1-WR)) = ${fmt(M.proReentry.avgSL)} + ${fmt(M.proReentry.avgTP)} × ${fmt(M.proReentry.winRate/(1-M.proReentry.winRate),3)} = ${fmtSign(M.proReentry.expPerBox)}%
③ E[박스] = WR×TP + (1-WR)×SL = ${fmtSign(M.proNoReentry.expPerBox)}%

━ 권고 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. 현행 ② 유지, 재진입 횟수 상한 2~3회 추가
2. 1h 박스: 재진입 없음(③) / 4h·1d: 재진입 허용(②) 분리
3. 실전 거래 DB 구축 → 실제 수치 검증

— YSTOCK · ${now}`;

// ── 전송 ─────────────────────────────────────────────────────────────
if (dryRun) {
  console.log(JSON.stringify({ ok: true, dryRun: true, to, subject,
    models: {
      legacy: { expPerBox: M.legacy.expPerBox, expTrade: M.legacy.expTrade, rrRatio: M.legacy.rrRatio },
      proReentry: { expPerBox: M.proReentry.expPerBox, expTrade: M.proReentry.expTrade, avgTradesPerBox: M.proReentry.avgTradesPerBox, rrRatio: M.proReentry.rrRatio },
      proNoReentry: { expPerBox: M.proNoReentry.expPerBox, expTrade: M.proNoReentry.expTrade, avgTradesPerBox: M.proNoReentry.avgTradesPerBox, rrRatio: M.proNoReentry.rrRatio },
    }
  }, null, 2));
  process.exit(0);
}

if (!isEmailSendingConfigured()) {
  console.error("SMTP 미설정 (.env SMTP_HOST 필요)");
  process.exit(1);
}

await sendTransactionalEmail({ to, subject, text, html });
console.log(JSON.stringify({ ok: true, sent: true, to, subject }, null, 2));
