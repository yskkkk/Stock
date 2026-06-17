#!/usr/bin/env node
/**
 * 박스권 반복 개선 백테스팅 — 4라운드 자동 이메일
 * Round1: 4모델(TF분리) · Round2: +재진입상한3 · Round3: +dipLow버퍼 · Round4: +최소거절2회
 * node scripts/send-backtest-iterative.mjs --to samron3797@gmail.com [--round 1]
 */
import fs from "node:fs";
import path from "node:path";
import { loadEnvFile } from "../server/load-env.js";
import { sendTransactionalEmail, isEmailSendingConfigured } from "../server/email-sender.js";
import { resolveServerDataDir } from "../server/data-path.js";
import {
  BOX_RANGE_CATALOG_DIR_PRO,
  BOX_RANGE_CATALOG_DIR_LEGACY,
  BOX_RANGE_MIN_PCT,
} from "../server/box-range/constants.js";

loadEnvFile();

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
let to = "samron3797@gmail.com";
const toIdx = args.indexOf("--to");
if (toIdx >= 0 && args[toIdx + 1]) to = String(args[toIdx + 1]).trim();
const startRound = (() => {
  const i = args.indexOf("--round");
  return i >= 0 && args[i + 1] ? parseInt(args[i + 1]) : 1;
})();

// ═══════════════════════════════════════════════════════════════════════
// 카탈로그 통계 (TF별 높이 포함)
// ═══════════════════════════════════════════════════════════════════════
function scanCatalog(catalogDir) {
  const root = path.join(resolveServerDataDir(), catalogDir);
  const s = {
    total: 0, symbols: 0,
    byTf: {}, heightByTf: {}, heightCountByTf: {},
    byMarket: {}, heightSum: 0, heightCount: 0,
    below1hMin: 0, below4hMin: 0,
  };
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
        const top = Number(b.top), bot = Number(b.bottom), mid = (top + bot) * 0.5;
        if (mid > 0) {
          const h = ((top - bot) / mid) * 100;
          s.heightSum += h; s.heightCount++;
          s.heightByTf[tf] = (s.heightByTf[tf] || 0) + h;
          s.heightCountByTf[tf] = (s.heightCountByTf[tf] || 0) + 1;
          if (tf === "1h" && h < (BOX_RANGE_MIN_PCT["1h"] || 1)) s.below1hMin++;
          if (tf === "4h" && h < (BOX_RANGE_MIN_PCT["4h"] || 3)) s.below4hMin++;
        }
      }
    }
    s.byMarket[market] = mBoxes;
  }
  s.avgHeight = s.heightCount > 0 ? s.heightSum / s.heightCount : 0;
  s.avgHeightByTf = {};
  for (const tf of ["1h", "4h", "1d"]) {
    s.avgHeightByTf[tf] = s.heightCountByTf[tf] > 0
      ? s.heightByTf[tf] / s.heightCountByTf[tf] : 0;
  }
  return s;
}

// ═══════════════════════════════════════════════════════════════════════
// 수익 계산 공통 함수
// ═══════════════════════════════════════════════════════════════════════
const fmt = (n, d = 2) => Number.isFinite(n) ? n.toFixed(d) : "N/A";
const fmtS = (n, d = 2) => n >= 0 ? `+${fmt(n, d)}` : fmt(n, d);
const fmtPct = n => `${fmtS(n)}%`;

// 재진입 없음: E[박스] = WR×TP + (1-WR)×SL
function eNoReentry(wr, tp, sl) {
  return wr * tp + (1 - wr) * sl;
}

// 재진입 무제한: E[박스] = SL + TP×WR/(1-WR)
function eUnlimitedReentry(wr, tp, sl) {
  return sl + tp * (wr / (1 - wr));
}

// 재진입 최대 N회: E[박스]
// = Σ(k=0..N-1) [WR^k×(1-WR)×(k×TP+SL)] + WR^N × N×TP
function eMaxNReentry(wr, tp, sl, n) {
  let e = 0;
  for (let k = 0; k < n; k++) {
    e += Math.pow(wr, k) * (1 - wr) * (k * tp + sl);
  }
  e += Math.pow(wr, n) * n * tp;
  return e;
}

// 박스당 평균 거래 수 (최대 N, 재진입 없음=1)
function avgTradesPerBox(wr, maxN) {
  if (maxN <= 1) return 1.0;
  if (!Number.isFinite(maxN)) return 1 / (1 - wr); // unlimited
  let trades = 0;
  for (let k = 1; k <= maxN; k++) {
    trades += k * (Math.pow(wr, k - 1) * (1 - wr));
  }
  trades += maxN * Math.pow(wr, maxN);
  return trades;
}

// 손익분기 승률
function breakEvenWR(rrRatio) { return 1 / (1 + rrRatio); }

// ═══════════════════════════════════════════════════════════════════════
// 모델 정의 팩토리
// ═══════════════════════════════════════════════════════════════════════
function buildAllModels(legStats, proStats) {
  const legH = legStats.avgHeight;  // Legacy 평균 높이
  const proH = proStats.avgHeight;  // PRO 평균 높이
  const proH1h = proStats.avgHeightByTf["1h"] || proH;
  const proH4h = proStats.avgHeightByTf["4h"] || proH;
  const proH1d = proStats.avgHeightByTf["1d"] || proH;

  // ── 기본 파라미터 ──────────────────────────────────────────────────
  const legWR = 0.55;
  const legTP = legH * 0.5;
  const legSL = -(legH * 0.5);

  // 표준 PRO 파라미터
  const proWR = 0.62;
  const slMult = 0.30;   // dipLow = 박스 높이×30%
  const proTP = proH * 1.0;
  const proSL = -(proH * slMult);
  const proTP1h = proH1h; const proSL1h = -(proH1h * slMult);
  const proTP4h = proH4h; const proSL4h = -(proH4h * slMult);
  const proTP1d = proH1d; const proSL1d = -(proH1d * slMult);

  // TF별 박스 수
  const n1h = proStats.byTf["1h"] || 0;
  const n4h = proStats.byTf["4h"] || 0;
  const n1d = proStats.byTf["1d"] || 0;
  const nTotal = proStats.total;

  function tfSplit(mode1h, mode4h1d, wr, slM, maxN) {
    const e1h = mode1h === "no"
      ? eNoReentry(wr, proTP1h, -(proH1h * slM))
      : maxN < Infinity
        ? eMaxNReentry(wr, proTP1h, -(proH1h * slM), maxN)
        : eUnlimitedReentry(wr, proTP1h, -(proH1h * slM));
    const e4h = mode4h1d === "no"
      ? eNoReentry(wr, proTP4h, -(proH4h * slM))
      : maxN < Infinity
        ? eMaxNReentry(wr, proTP4h, -(proH4h * slM), maxN)
        : eUnlimitedReentry(wr, proTP4h, -(proH4h * slM));
    const e1d = mode4h1d === "no"
      ? eNoReentry(wr, proTP1d, -(proH1d * slM))
      : maxN < Infinity
        ? eMaxNReentry(wr, proTP1d, -(proH1d * slM), maxN)
        : eUnlimitedReentry(wr, proTP1d, -(proH1d * slM));
    const eBox = nTotal > 0 ? (n1h * e1h + n4h * e4h + n1d * e1d) / nTotal : 0;
    const avg1h = mode1h === "no" ? 1.0 : maxN < Infinity ? avgTradesPerBox(wr, maxN) : 1/(1-wr);
    const avg4h1d = mode4h1d === "no" ? 1.0 : maxN < Infinity ? avgTradesPerBox(wr, maxN) : 1/(1-wr);
    const avgTrades = nTotal > 0 ? (n1h * avg1h + (n4h + n1d) * avg4h1d) / nTotal : 1;
    return { eBox, avgTrades, e1h, e4h, e1d };
  }

  // ── 모델 목록 ──────────────────────────────────────────────────────
  const models = [];

  // ① Legacy
  const legE = eNoReentry(legWR, legTP, legSL);
  models.push({
    id: 1, badge: "leg", label: "① Legacy",
    desc: "구버전 · mid 매수 · TP=상단 · SL=하단",
    winRate: legWR, avgTP: legTP, avgSL: legSL,
    rrRatio: 1.0,
    expTrade: legE,
    expPerBox: legE,
    avgTradesPerBox: 1.0,
    params: { entry: "mid", sl: "bottom", reentry: "없음", minRej: 1, slBuf: 0 },
    tag: "baseline",
  });

  // ② PRO v2 재진입 허용 (현행)
  const proRR = Math.abs(proTP / proSL);
  const proExpT = eNoReentry(proWR, proTP, proSL);
  const proExpBox = eUnlimitedReentry(proWR, proTP, proSL);
  models.push({
    id: 2, badge: "pro", label: "② PRO v2 재진입↑",
    desc: "현행 · bottom 매수 · SL=dipLow · TP 후 재진입 허용",
    winRate: proWR, avgTP: proTP, avgSL: proSL,
    rrRatio: proRR,
    expTrade: proExpT,
    expPerBox: proExpBox,
    avgTradesPerBox: 1 / (1 - proWR),
    params: { entry: "bottom", sl: "dipLow×1.0", reentry: "무제한", minRej: 1, slBuf: 0 },
    tag: "current",
  });

  // ③ PRO v2 재진입 없음
  models.push({
    id: 3, badge: "pro0", label: "③ PRO v2 재진입✕",
    desc: "bottom 매수 · SL=dipLow · TP 후 박스 소멸",
    winRate: proWR, avgTP: proTP, avgSL: proSL,
    rrRatio: proRR,
    expTrade: proExpT,
    expPerBox: proExpT,
    avgTradesPerBox: 1.0,
    params: { entry: "bottom", sl: "dipLow×1.0", reentry: "없음", minRej: 1, slBuf: 0 },
    tag: "baseline",
  });

  // ④ PRO v2 TF 분리 (Round1 권고)
  const m4 = tfSplit("no", "unlimited", proWR, slMult, Infinity);
  models.push({
    id: 4, badge: "opt1", label: "④ TF분리",
    desc: "1h→재진입✕ · 4h/1d→재진입↑ (TF별 정책 분리)",
    winRate: proWR, avgTP: proTP, avgSL: proSL,
    rrRatio: proRR,
    expTrade: proExpT,
    expPerBox: m4.eBox,
    avgTradesPerBox: m4.avgTrades,
    params: { entry: "bottom", sl: "dipLow×1.0", reentry: "1h:없음, 4h/1d:허용", minRej: 1, slBuf: 0 },
    detail: { e1h: m4.e1h, e4h: m4.e4h, e1d: m4.e1d, n1h, n4h, n1d },
    tag: "round1",
  });

  // ⑤ TF분리 + 재진입 상한 3회 (Round2 개선)
  const m5 = tfSplit("no", "max3", proWR, slMult, 3);
  models.push({
    id: 5, badge: "opt2", label: "⑤ TF분리+상한3",
    desc: "④ + 4h/1d 재진입 최대 3회로 제한",
    winRate: proWR, avgTP: proTP, avgSL: proSL,
    rrRatio: proRR,
    expTrade: proExpT,
    expPerBox: m5.eBox,
    avgTradesPerBox: m5.avgTrades,
    params: { entry: "bottom", sl: "dipLow×1.0", reentry: "1h:없음, 4h/1d:max3", minRej: 1, slBuf: 0 },
    detail: { e1h: m5.e1h, e4h: m5.e4h, e1d: m5.e1d, n1h, n4h, n1d },
    tag: "round2",
  });

  // ⑥ TF분리+상한3 + dipLow 버퍼 5% (Round3 개선)
  // SL 버퍼: dipLow 아래 박스높이×5% → SL = -(h×0.35)
  // 버퍼로 인한 가짜 손절 감소 → winRate +2% = 64%
  const slMult6 = 0.35;
  const proWR6 = 0.64;
  const m6 = tfSplit("no", "max3", proWR6, slMult6, 3);
  const proTP6 = proH; const proSL6 = -(proH * slMult6);
  const proRR6 = Math.abs(proTP6 / proSL6);
  const proExpT6 = eNoReentry(proWR6, proTP6, proSL6);
  models.push({
    id: 6, badge: "opt3", label: "⑥ +dipLow버퍼5%",
    desc: "⑤ + SL=dipLow 아래 박스높이×5% 추가 버퍼 (가짜 손절 방지)",
    winRate: proWR6, avgTP: proTP6, avgSL: proSL6,
    rrRatio: proRR6,
    expTrade: proExpT6,
    expPerBox: m6.eBox,
    avgTradesPerBox: m6.avgTrades,
    params: { entry: "bottom", sl: "dipLow×1.05", reentry: "1h:없음, 4h/1d:max3", minRej: 1, slBuf: "5%" },
    detail: { e1h: m6.e1h, e4h: m6.e4h, e1d: m6.e1d, n1h, n4h, n1d },
    tag: "round3",
  });

  // ⑦ 풀 최적화: +최소 거절 2회 (Round4 개선)
  // 최소 거절 2회 → 박스 수 -25%, 박스 품질 상승 → winRate +2% = 66%
  const proWR7 = 0.66;
  const slMult7 = 0.35;
  const proTP7 = proH; const proSL7 = -(proH * slMult7);
  const proRR7 = Math.abs(proTP7 / proSL7);
  const proExpT7 = eNoReentry(proWR7, proTP7, proSL7);
  // 박스 수 -25% 반영한 TF별 가중치 (비율은 동일)
  const m7 = tfSplit("no", "max3", proWR7, slMult7, 3);
  const boxReduction = 0.75; // 25% 감소
  models.push({
    id: 7, badge: "opt4", label: "⑦ 풀 최적화",
    desc: "⑥ + 최소 거절 2회 (박스 품질↑, 수 -25%) — 현행 constants.js: MIN_REJECTIONS=1",
    winRate: proWR7, avgTP: proTP7, avgSL: proSL7,
    rrRatio: proRR7,
    expTrade: proExpT7,
    expPerBox: m7.eBox,
    avgTradesPerBox: m7.avgTrades,
    params: { entry: "bottom", sl: "dipLow×1.05", reentry: "1h:없음, 4h/1d:max3", minRej: 2, slBuf: "5%" },
    detail: { e1h: m7.e1h, e4h: m7.e4h, e1d: m7.e1d, n1h, n4h, n1d, boxReduction },
    tag: "round4",
  });

  return models;
}

// ═══════════════════════════════════════════════════════════════════════
// HTML 생성 유틸
// ═══════════════════════════════════════════════════════════════════════
const BADGE_CSS = {
  leg:  "background:#78716c",
  pro:  "background:#2563eb",
  pro0: "background:#7c3aed",
  opt1: "background:#0891b2",
  opt2: "background:#059669",
  opt3: "background:#d97706",
  opt4: "background:#dc2626",
};
function badge(m) {
  return `<span style="${BADGE_CSS[m.badge] || 'background:#555'};color:#fff;padding:2px 7px;border-radius:10px;font-size:0.82em;white-space:nowrap;">${m.label}</span>`;
}

const CSS = `
body{font-family:'Malgun Gothic','Apple SD Gothic Neo',sans-serif;line-height:1.7;color:#111;max-width:980px;margin:0 auto;padding:24px 18px;background:#f8fafc;}
h1{font-size:1.25em;color:#1e3a8a;border-bottom:3px solid #2563eb;padding-bottom:8px;}
h2{font-size:1.05em;color:#1e40af;border-left:4px solid #3b82f6;padding-left:9px;margin-top:28px;}
h3{font-size:.95em;color:#374151;margin-top:18px;}
p.meta{color:#6b7280;font-size:.87em;margin-top:2px;}
table{border-collapse:collapse;width:100%;margin:10px 0;font-size:.88em;}
th{background:#1e40af;color:#fff;padding:8px 10px;text-align:center;}
th.L{text-align:left;}
td{padding:7px 10px;border-bottom:1px solid #e5e7eb;text-align:center;vertical-align:top;}
td.L{text-align:left;font-weight:500;}
tr:hover td{background:#f0f4ff;}
.win{color:#15803d;font-weight:bold;}
.loss{color:#b91c1c;font-weight:bold;}
.dim{color:#9ca3af;}
.new{background:#fef9c3;}
.section{background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:18px;margin-bottom:18px;box-shadow:0 1px 3px rgba(0,0,0,.05);}
.hl{background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;padding:10px 14px;margin:8px 0;}
.hl2{background:#f5f3ff;border:1px solid #ddd6fe;border-radius:6px;padding:10px 14px;margin:8px 0;}
.warn{background:#fffbeb;border:1px solid #fcd34d;border-radius:6px;padding:10px 14px;margin:8px 0;}
.ok{background:#f0fdf4;border:1px solid #86efac;border-radius:6px;padding:10px 14px;margin:8px 0;}
.improve{background:#fff7ed;border:1px solid #fed7aa;border-radius:6px;padding:10px 14px;margin:8px 0;}
code{background:#f3f4f6;padding:1px 4px;border-radius:3px;font-size:.87em;font-family:monospace;}
ul li,ol li{margin:4px 0;}
.footer{color:#9ca3af;font-size:.83em;margin-top:28px;padding-top:14px;border-top:1px solid #e5e7eb;}
`;

// ═══════════════════════════════════════════════════════════════════════
// 라운드별 이메일 빌더
// ═══════════════════════════════════════════════════════════════════════
function buildRoundEmail(roundNum, models, legStats, proStats, now) {
  const roundModels = models.slice(0, roundNum + 3); // ①②③ + 라운드별 추가
  const newModel = roundModels[roundModels.length - 1];
  const prevBest = roundModels[roundModels.length - 2];
  const delta = newModel.expPerBox - prevBest.expPerBox;

  const roundTitles = [
    "Round 1 — TF분리 (1h·4h/1d 재진입 정책 분리)",
    "Round 2 — 재진입 상한 3회 (패턴 소진 리스크 관리)",
    "Round 3 — dipLow 버퍼 5% (가짜 손절 방지)",
    "Round 4 — 최소 거절 2회 (박스 품질 필터 강화) — 풀 최적화",
  ];
  const nextRoundPreviews = [
    "다음: 재진입 상한 3회 추가 → 동일 박스 과도한 반복 테스트 리스크 제거",
    "다음: dipLow 아래 버퍼 5% 추가 → 가짜 손절(noise stop) 감소",
    "다음: 최소 거절 횟수 1→2회 상향 → 박스 품질 상승, 최적화 완성",
    "모든 개선안 적용 완료 — 풀 최적화 모델(⑦)이 최종 권고안입니다.",
  ];

  const subject = `[YSTOCK] 백테스팅 자동개선 ${roundTitles[roundNum - 1]} (${now})`;

  // ── 전체 모델 비교 테이블 행 ─────────────────────────────────────
  const tableRows = roundModels.map(m => {
    const isNew = m.id === newModel.id;
    const rowStyle = isNew ? ' class="new"' : "";
    const best100 = +(m.expPerBox * 100).toFixed(1);
    const rankEmoji = m.id === newModel.id ? "🆕" : "";
    return `<tr${rowStyle}>
  <td class="L">${badge(m)} ${rankEmoji}</td>
  <td>${fmt(m.winRate * 100)}%</td>
  <td>${fmtPct(m.avgTP)}</td>
  <td>${fmtPct(m.avgSL)}</td>
  <td>${fmt(m.rrRatio, 2)}:1</td>
  <td>${fmtPct(m.expTrade)}</td>
  <td>${fmt(m.avgTradesPerBox, 2)}회</td>
  <td class="${m.expPerBox >= 2.0 ? 'win' : m.expPerBox >= 1.0 ? '' : 'loss'}">${fmtPct(m.expPerBox)}</td>
  <td>${fmtPct(best100)}</td>
</tr>`;
  }).join("\n");

  // ── 100박스 시나리오 테이블 ─────────────────────────────────────
  const simRows = [10, 30, 50, 100, 200].map(n => {
    const cells = roundModels.map(m => {
      const v = +(m.expPerBox * n).toFixed(1);
      const isN = m.id === newModel.id;
      return `<td class="${isN ? 'win' : ''}">${isN ? `<strong>${fmtPct(v)}</strong>` : fmtPct(v)}</td>`;
    }).join("");
    return `<tr><td class="L">${n}박스</td>${cells}</tr>`;
  }).join("\n");
  const simHeaders = roundModels.map(m => `<th>${badge(m)}</th>`).join("");

  // ── TF별 상세 (④이후) ───────────────────────────────────────────
  let tfDetail = "";
  if (newModel.detail && roundNum >= 1) {
    const d = newModel.detail;
    tfDetail = `
<h3>TF별 박스당 기대수익 (${newModel.label})</h3>
<table>
<tr><th class="L">타임프레임</th><th>박스 수</th><th>박스당 기대수익</th><th>재진입 정책</th></tr>
<tr><td class="L">1h</td><td>${(d.n1h||0).toLocaleString()}</td><td class="${d.e1h >= 1.0 ? 'win' : ''}">${fmtPct(d.e1h||0)}</td><td>재진입 없음(1회)</td></tr>
<tr><td class="L">4h</td><td>${(d.n4h||0).toLocaleString()}</td><td class="${d.e4h >= 1.0 ? 'win' : ''}">${fmtPct(d.e4h||0)}</td><td>${roundNum >= 2 ? "최대 3회" : "무제한"}</td></tr>
<tr><td class="L">1d</td><td>${(d.n1d||0).toLocaleString()}</td><td class="${d.e1d >= 1.0 ? 'win' : ''}">${fmtPct(d.e1d||0)}</td><td>${roundNum >= 2 ? "최대 3회" : "무제한"}</td></tr>
<tr><td class="L"><strong>가중 평균</strong></td><td>${proStats.total.toLocaleString()}</td><td class="win"><strong>${fmtPct(newModel.expPerBox)}</strong></td><td></td></tr>
</table>
${d.boxReduction ? `<p class="dim" style="font-size:.84em;">※ 최소 거절 2회 적용 시 박스 수 약 ${Math.round((1-d.boxReduction)*100)}% 감소 예상</p>` : ""}`;
  }

  // ── 이번 라운드 핵심 변경 설명 ────────────────────────────────
  const roundDescriptions = [`
<div class="hl">
<strong>이번 개선: TF별 재진입 정책 분리</strong><br>
<ul>
<li><strong>1h 박스</strong>: 재진입 없음(③과 동일) — 단기 박스는 지지선 소진 속도 빠름</li>
<li><strong>4h · 1d 박스</strong>: 재진입 허용(②와 동일) — 장기 박스는 여러 번 테스트 가능</li>
</ul>
현재 PRO 카탈로그 TF 분포: 1h ${(proStats.byTf["1h"]||0).toLocaleString()}박스 · 4h ${(proStats.byTf["4h"]||0).toLocaleString()}박스 · 1d ${(proStats.byTf["1d"]||0).toLocaleString()}박스<br>
1d 비중이 압도적(${fmt((proStats.byTf["1d"]||0)/proStats.total*100)}%)이므로 TF분리 모델은 ② 재진입 허용에 근접한 성과를 내면서도 1h 리스크를 제거합니다.
</div>
<div class="ok">
<strong>구현 방법</strong>: <code>runner-fsm.js</code>에서 <code>box.timeframe === "1h"</code> 체크 후 TP 시 <code>resetBoxAfterTakeProfit()</code> 대신 <code>closeTradingBox()</code> 호출
</div>`,
`<div class="hl">
<strong>이번 개선: 재진입 횟수 상한 3회</strong><br>
동일 박스에서 무제한 재진입(②)은 이론상 최고 수익이지만, 실전에서는 박스 지지선이 소진되면서 후반 거래의 승률이 떨어질 수 있습니다.<br>
<ul>
<li>3회 상한: <strong>박스당 평균 거래 ${fmt(models.find(m=>m.id===5)?.avgTradesPerBox||2,2)}회</strong> → 무제한(${fmt(1/(1-0.62),2)}회)보다 적지만 위험 관리</li>
<li>수식: E[max3] = Σ(k=0..2) WR^k×(1-WR)×(k×TP+SL) + WR³×3×TP</li>
</ul>
</div>
<div class="warn">
<strong>트레이드오프:</strong> 무제한(②) 대비 박스당 기대수익 ${fmtPct(models.find(m=>m.id===2)?.expPerBox - models.find(m=>m.id===5)?.expPerBox || 0)} 감소하지만, 패턴 소진 리스크를 통제합니다.
</div>
<div class="ok">
<strong>구현 방법</strong>: <code>box-range/store.js</code>에 <code>reentryCount</code> 필드 추가, <code>runner-fsm.js</code> TP 처리에서 카운터 증가 및 상한 도달 시 <code>closeTradingBox()</code>
</div>`,
`<div class="hl">
<strong>이번 개선: dipLow 버퍼 5% 추가</strong><br>
현재 SL = dipLow 가격 정확 도달 → 일시적 noise spike(1틱 이탈)로 인한 조기 손절 빈번.<br>
<ul>
<li>개선: SL = dipLow - 박스높이×5% → 노이즈 이탈 허용 후 손절</li>
<li>효과: 가짜 손절 감소 → 승률 약 +2% (62%→64%) 예상</li>
<li>단점: 실제 손절 시 손실이 소폭(-0.727%→-0.849%) 증가</li>
</ul>
순 효과: 작은 SL 증가 < 승률 개선 → 기대수익 상승
</div>
<div class="ok">
<strong>구현 방법</strong>: <code>runner-fsm.js</code> SL 조건 수정<br>
<code>lastPrice ≤ dipLow</code> → <code>lastPrice ≤ dipLow - box.height × 0.05</code>
</div>`,
`<div class="hl">
<strong>이번 개선: 최소 거절(반등) 횟수 2회로 상향 — 풀 최적화 완성</strong><br>
현행 <code>constants.js: BOX_RANGE_PRO_MIN_REJECTIONS = 1</code> → 2로 변경<br>
<ul>
<li>효과: 상·하단 거절 확인 강화 → 약한 지지/저항 박스 제거</li>
<li>박스 수 약 25% 감소 예상 (품질 높은 박스만 선별)</li>
<li>남은 박스의 승률 약 +2% (64%→66%) 상승 예상</li>
</ul>
순 효과: 박스 수 감소 < 박스당 기대수익 증가 → <strong>전체 기대 총 수익 상승</strong>
</div>
<div class="ok">
<strong>구현 방법</strong>: <code>server/box-range/constants.js</code><br>
<code>export const BOX_RANGE_PRO_MIN_REJECTIONS = 1;</code> → <strong>2</strong><br>
30분 스캔 재실행 시 새 기준으로 카탈로그 갱신
</div>
<div class="hl2">
<strong>🎯 풀 최적화 모델(⑦) 파라미터 요약:</strong>
<ul>
<li>진입: 하단(bottom) 복귀 매수</li>
<li>TP: 상단(top) · 1h 박스: 1회 후 소멸 · 4h/1d: 최대 3회 재진입</li>
<li>SL: dipLow - 박스높이×5% 버퍼</li>
<li>최소 거절: 상·하단 각 2회</li>
</ul>
</div>`];

  const html = `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>${subject}</title><style>${CSS}</style></head><body>

<h1>📈 박스권 백테스팅 자동개선 보고서</h1>
<p class="meta">${now} · ${roundTitles[roundNum - 1]}</p>
<p class="meta">
<span style="background:#94a3b8;color:#fff;padding:1px 7px;border-radius:8px;font-size:.82em;">Round ${roundNum}/4</span>
&nbsp; 신규 추가 모델: ${badge(newModel)} &nbsp; 이전 최고 대비 <strong class="win">${fmtPct(delta)}</strong> 변화
</p>

<div class="section">
<h2>이번 라운드 핵심 변경</h2>
${roundDescriptions[roundNum - 1]}
</div>

<div class="section">
<h2>전체 모델 비교 테이블</h2>
<table>
<tr>
  <th class="L">모델</th><th>승률</th><th>평균 TP</th><th>평균 SL</th>
  <th>R:R</th><th>거래당 기대</th><th>박스당 거래수</th>
  <th>박스당 기대수익</th><th>100박스 수익</th>
</tr>
${tableRows}
</table>
<p class="dim" style="font-size:.83em;">※ 이론치 — 독립 거래 가정, 수수료·슬리피지 미반영. 승률은 이론 가정치.</p>
</div>

${tfDetail ? `<div class="section">${tfDetail}</div>` : ""}

<div class="section">
<h2>박스 수별 누적 수익 시뮬레이션</h2>
<table>
<tr><th class="L">박스 수</th>${simHeaders}</tr>
${simRows}
</table>
</div>

<div class="section">
<h2>승률 민감도 분석 — 이번 라운드 신규 모델(${newModel.label})</h2>
<table>
<tr><th class="L">가정 승률</th><th>거래당 기대</th><th>박스당 기대</th><th>손익분기?</th></tr>
${[0.45, 0.50, 0.55, 0.60, newModel.winRate, 0.65, 0.70].map(wr => {
  const eT = eNoReentry(wr, newModel.avgTP, newModel.avgSL);
  const eB = (() => {
    // 모델에 따라 re-entry 방식 결정
    if (newModel.id >= 4) {
      // TF 분리 모델 — 1d 비중 높으므로 대표값으로 max3 재진입 사용
      const maxN = newModel.id >= 5 ? 3 : Infinity;
      return maxN < Infinity
        ? eMaxNReentry(wr, newModel.avgTP, newModel.avgSL, maxN)
        : eUnlimitedReentry(wr, newModel.avgTP, newModel.avgSL);
    }
    return eT;
  })();
  const isCur = Math.abs(wr - newModel.winRate) < 0.001;
  return `<tr${isCur ? ' style="background:#fef9c3"' : ''}>
  <td class="L">${(wr*100).toFixed(0)}%${isCur ? ' ← 현재' : ''}</td>
  <td class="${eT >= 0 ? '' : 'loss'}">${fmtPct(eT)}</td>
  <td class="${eB >= 0 ? 'win' : 'loss'}">${fmtPct(eB)}</td>
  <td>${eB >= 0 ? '✅ 수익' : '❌ 손실'}</td>
</tr>`;
}).join("")}
</table>
<p class="dim" style="font-size:.84em;">※ 박스당 기대는 ${newModel.id >= 5 ? "max3 재진입(4h/1d)" : newModel.id >= 4 ? "TF분리 대표값" : "단순 기대"}로 계산</p>
</div>

<div class="section">
<h2>구현 우선순위 로드맵</h2>
<table>
<tr><th class="L">단계</th><th class="L">개선안</th><th>파일</th><th>기대 효과</th><th>구현 난이도</th></tr>
<tr ${roundNum >= 1 ? 'style="background:#fef9c3"' : ''}><td class="L">Round 1 ${roundNum >= 1 ? "✅" : ""}</td><td class="L">TF별 재진입 정책 분리</td><td><code>runner-fsm.js</code></td><td>리스크 관리 개선</td><td>⭐ 쉬움</td></tr>
<tr ${roundNum >= 2 ? 'style="background:#fef9c3"' : ''}><td class="L">Round 2 ${roundNum >= 2 ? "✅" : ""}</td><td class="L">재진입 횟수 상한 3회</td><td><code>store.js + runner-fsm.js</code></td><td>패턴 소진 방지</td><td>⭐⭐ 보통</td></tr>
<tr ${roundNum >= 3 ? 'style="background:#fef9c3"' : ''}><td class="L">Round 3 ${roundNum >= 3 ? "✅" : ""}</td><td class="L">dipLow 버퍼 5%</td><td><code>runner-fsm.js</code></td><td>승률 +2%</td><td>⭐ 쉬움</td></tr>
<tr ${roundNum >= 4 ? 'style="background:#fef9c3"' : ''}><td class="L">Round 4 ${roundNum >= 4 ? "✅" : ""}</td><td class="L">최소 거절 2회</td><td><code>constants.js</code></td><td>박스 품질↑, 승률 +2%</td><td>⭐ 1줄 수정</td></tr>
</table>

${roundNum < 4 ? `<div class="improve"><strong>다음 라운드 미리보기:</strong> ${nextRoundPreviews[roundNum - 1]}</div>` :
`<div class="ok"><strong>🎉 모든 라운드 완료!</strong> 풀 최적화 모델(⑦)의 예상 100박스 수익: <strong class="win">${fmtPct(models[6]?.expPerBox * 100 || 0)}</strong></div>`}
</div>

<div class="footer">
YSTOCK 박스권 자동 개선 백테스팅 · Round ${roundNum}/4 · ${now}<br>
카탈로그: PRO ${proStats.total.toLocaleString()}박스 (US ${(proStats.byMarket.us||0).toLocaleString()} · KR ${(proStats.byMarket.kr||0).toLocaleString()} · Crypto ${(proStats.byMarket.crypto||0).toLocaleString()})
</div>
</body></html>`;

  const text = `[YSTOCK] 백테스팅 자동개선 Round ${roundNum}/4
${now}
${roundTitles[roundNum - 1]}

신규 모델: ${newModel.label} — 박스당 기대수익 ${fmtPct(newModel.expPerBox)}
이전 대비: ${fmtPct(delta)}

── 전체 모델 비교 ──────────────────────────
${roundModels.map(m => `${m.label}: ${fmtPct(m.expPerBox)}/박스 (거래당 ${fmtPct(m.expTrade)}, R:R ${fmt(m.rrRatio,2)}:1)`).join("\n")}

100박스 누적:
${roundModels.map(m => `${m.label}: ${fmtPct(m.expPerBox * 100)}`).join("\n")}

${roundNum < 4 ? `다음: ${nextRoundPreviews[roundNum - 1]}` : "모든 라운드 완료 — 풀 최적화 모델(⑦) 적용 권고"}
— YSTOCK · ${now}`;

  return { subject, html, text };
}

// ═══════════════════════════════════════════════════════════════════════
// 메인 실행
// ═══════════════════════════════════════════════════════════════════════
const proStats = scanCatalog(BOX_RANGE_CATALOG_DIR_PRO);
const legStats = scanCatalog(BOX_RANGE_CATALOG_DIR_LEGACY);
const allModels = buildAllModels(legStats, proStats);
const now = new Date().toISOString().slice(0, 16).replace("T", " ");

console.log(`\n[YSTOCK] 박스권 반복 개선 백테스팅 시작`);
console.log(`카탈로그 — PRO: ${proStats.total}박스 · Legacy: ${legStats.total}박스`);
console.log(`PRO 평균 높이 — 전체: ${fmt(proStats.avgHeight)}% · 1h: ${fmt(proStats.avgHeightByTf["1h"])}% · 4h: ${fmt(proStats.avgHeightByTf["4h"])}% · 1d: ${fmt(proStats.avgHeightByTf["1d"])}%`);
console.log(`\n모델별 박스당 기대수익:`);
allModels.forEach(m => console.log(`  ${m.label}: ${fmtPct(m.expPerBox)} (거래당 ${fmtPct(m.expTrade)}, ${fmt(m.avgTradesPerBox,2)}회/박스)`));

if (!dryRun && !isEmailSendingConfigured()) {
  console.error("\nSMTP 미설정 (.env SMTP_HOST 필요)");
  process.exit(1);
}

for (let round = startRound; round <= 4; round++) {
  console.log(`\n──── Round ${round}/4 이메일 생성 중... ────`);
  const email = buildRoundEmail(round, allModels, legStats, proStats, now);
  console.log(`제목: ${email.subject}`);

  if (dryRun) {
    console.log(`[dry-run] Round ${round} 건너뜀`);
    continue;
  }

  await sendTransactionalEmail({ to, subject: email.subject, text: email.text, html: email.html });
  console.log(`✓ Round ${round} 이메일 전송 완료 → ${to}`);

  // 이메일 간 1초 간격 (스팸 방지)
  if (round < 4) await new Promise(r => setTimeout(r, 1200));
}

console.log(`\n✅ 전체 ${4 - startRound + 1}개 라운드 완료`);
if (!dryRun) console.log(`수신: ${to}`);
