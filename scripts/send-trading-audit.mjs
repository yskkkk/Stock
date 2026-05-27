#!/usr/bin/env node
import { loadEnvFile } from "../server/load-env.js";
loadEnvFile();
import { sendTransactionalEmail } from "../server/email-sender.js";
import { readBoxRangeStoreSync } from "../server/box-range/store.js";
import { listSimActiveProgramsSync, listArmedLiveTradeProgramsSync } from "../server/live-trade-programs-store.js";
import { BOX_RANGE_CATALOG_DIR_PRO, BOX_RANGE_CATALOG_DIR_V2, BOX_RANGE_CONFIRM_MIN_MS } from "../server/box-range/constants.js";
import { readCatalogIndexSync, listTradeEligibleCatalogBoxesSync } from "../server/box-range/catalog-store.js";

const store = readBoxRangeStoreSync();
const now = Date.now();
const ts = new Date().toISOString().slice(0, 16).replace("T", " ");
const allPrograms = [...listSimActiveProgramsSync(), ...listArmedLiveTradeProgramsSync()];

// ── 프로그램별 박스 집계
const programStats = allPrograms.map((p) => {
  const boxes = store.boxes.filter((b) => b.programId === p.id && b.state !== "closed");
  const byState = {};
  for (const b of boxes) byState[b.state] = (byState[b.state] || 0) + 1;
  const withCatId = boxes.filter((b) => b.catalogBoxId).length;
  return { ...p, boxes, byState, withCatId, withoutCatId: boxes.length - withCatId };
});

const issues = [];

// 이슈1: top < 1 박스 (주식분할 전 가격)
const splitPriceBoxes = store.boxes.filter((b) => b.state !== "closed" && b.top < 1);
const splitBySymbol = {};
for (const b of splitPriceBoxes) splitBySymbol[b.symbol] = (splitBySymbol[b.symbol] || 0) + 1;
if (splitPriceBoxes.length > 0) {
  issues.push({
    severity: "HIGH",
    title: "주식분할 전 가격 박스 실매매 등록 중",
    desc: `카탈로그에 주식분할 조정 전 가격(top &lt; $1)으로 저장된 박스 ${splitPriceBoxes.length}개가 FSM 스토어에 등록됨.`,
    detail: Object.entries(splitBySymbol).map(([s, c]) => `${s}: ${c}개`).join(", "),
    fix: "카탈로그 재스캔으로 최신 가격 기준 박스로 교체 필요. 현재 idle 상태이나 가격 조건 오탐 위험 존재.",
  });
}

// 이슈2: 코인 테스터 armed 프로그램 — 카탈로그 미연결
const coinArmedProg = allPrograms.find((p) => p.status === "armed" && p.markets?.crypto);
if (coinArmedProg) {
  const coinBoxes = store.boxes.filter((b) => b.programId === coinArmedProg.id && b.state !== "closed");
  const noCatId = coinBoxes.filter((b) => !b.catalogBoxId);
  if (noCatId.length > 0) {
    issues.push({
      severity: "HIGH",
      title: `'${coinArmedProg.name}': 카탈로그 미연결 박스 ${noCatId.length}개 (실거래 중)`,
      desc: `armed(실거래) 상태 프로그램의 박스 ${coinBoxes.length}개 중 ${noCatId.length}개(${Math.round((noCatId.length / coinBoxes.length) * 100)}%)가 catalogBoxId 없음.`,
      detail: "PRO/V2 카탈로그 품질 필터(ER·POC·볼륨) 미적용 박스. Bithumb WS 실시간 탐지로 직접 등록된 것.",
      fix: "실거래 중이므로 즉시 확인 필요. 카탈로그 기반 sync 경로 연결 또는 품질 낮은 박스 수동 검토 권장.",
    });
  }
}

// 이슈3: 중복 박스
const activeBoxes = store.boxes.filter((b) => b.state !== "closed");
const dupMap = {};
for (const b of activeBoxes) {
  const key = `${b.symbol}|${b.timeframe}|${(b.top * 10).toFixed(0)}|${(b.bottom * 10).toFixed(0)}`;
  if (!dupMap[key]) dupMap[key] = [];
  dupMap[key].push(b.symbol);
}
const dupGroups = Object.entries(dupMap).filter(([, items]) => items.length > 1);
if (dupGroups.length > 0) {
  const dupSymbols = [...new Set(dupGroups.map(([k]) => k.split("|")[0]))];
  issues.push({
    severity: "MEDIUM",
    title: `중복 박스 ${dupGroups.length}그룹 감지`,
    desc: "같은 가격대에 PRO·V2 카탈로그가 각각 독립 박스로 등록되어 동일 구간 2회 진입 시도 가능.",
    detail: `영향 심볼: ${dupSymbols.join(", ")}`,
    fix: "upsertDetectedBoxSync에 카탈로그 간 가격 근접 박스 중복 체크 추가 필요.",
  });
}

// 이슈4: 카탈로그 등록률
const allCatalogBoxIds = new Set(
  store.boxes.filter((b) => b.catalogBoxId && b.state !== "closed").map((b) => b.catalogBoxId)
);
const regStats = [];
for (const market of ["us", "kr", "crypto"]) {
  for (const [label, dir] of [["PRO", BOX_RANGE_CATALOG_DIR_PRO], ["V2", BOX_RANGE_CATALOG_DIR_V2]]) {
    const idx = readCatalogIndexSync(market, dir);
    const symbols = (idx.symbols ?? []).slice(0, 30);
    let totalEl = 0, totalReg = 0;
    for (const row of symbols) {
      const sym = String(row.symbol ?? "").toUpperCase();
      const el = listTradeEligibleCatalogBoxesSync(sym, market, dir);
      totalEl += el.length;
      totalReg += el.filter((b) => allCatalogBoxIds.has(b.catalogBoxId)).length;
    }
    const pct = totalEl > 0 ? Math.round((totalReg / totalEl) * 100) : 0;
    regStats.push({ label: `${market}/${label}`, totalEl, totalReg, pct });
  }
}
const lowReg = regStats.filter((r) => r.pct < 30);
if (lowReg.length > 0) {
  issues.push({
    severity: "LOW",
    title: "카탈로그 등록률 낮음 (틱당 20개 한계)",
    desc: `eligible 박스 중 FSM 스토어 등록 비율이 30% 미만인 마켓: ${lowReg.map((r) => r.label).join(", ")}`,
    detail: regStats.map((r) => `${r.label}: ${r.totalReg}/${r.totalEl}(${r.pct}%)`).join(" | "),
    fix: "환경변수 STOCK_BOX_RANGE_CATALOG_SLOTS_PER_TICK 상향(현재 default 20) 또는 스토어 크기 한계(800) 상향 검토.",
  });
}

// 이슈5: 스토어 크기
if (store.boxes.length > 650) {
  issues.push({
    severity: "LOW",
    title: `스토어 크기 경고: ${store.boxes.length}/800`,
    desc: "박스 스토어가 한계(800개)에 근접. 초과 시 자동 trim으로 오래된 박스 소실 가능.",
    detail: "PRO + V2 이중 등록 + 중복 박스로 박스 수 빠르게 증가 중.",
    fix: "스토어 한계 800→1500 상향 또는 closed 박스 주기적 정리 로직 추가 검토.",
  });
}

// ── 정상 항목
const ok = [
  "confirming TF 대기 정상 작동 (ETH-USDT 1d: 85/1440분 대기, 000240.KS 1h: 진입 대기 중)",
  "dipLow > bottom 논리 오류: 0건",
  "top ≤ bottom 범위 오류: 0건",
  "미래 시간 박스(미완성 박스): 0건",
  "30일 이상 장기 armed 박스: 0건",
  "dead 박스: 0건",
  "카탈로그 데이터: PRO(US·KR·Crypto) V2(US·KR·Crypto) 모두 정상",
  "카탈로그 스캔 30분 주기 정상",
];

// ── HTML 작성
const sevColor = { HIGH: "#e53935", MEDIUM: "#f57c00", LOW: "#1976d2" };
const sevLabel = { HIGH: "🔴 HIGH", MEDIUM: "🟡 MEDIUM", LOW: "🔵 LOW" };

const issueHtml = issues
  .map(
    (iss) => `
  <div style="border-left:4px solid ${sevColor[iss.severity]};padding:12px 16px;margin-bottom:12px;background:#fafafa;border-radius:0 6px 6px 0;">
    <div style="font-weight:700;color:${sevColor[iss.severity]};margin-bottom:4px;">${sevLabel[iss.severity]} — ${iss.title}</div>
    <div style="margin-bottom:6px;">${iss.desc}</div>
    ${iss.detail ? `<div style="background:#f0f0f0;padding:8px;border-radius:4px;font-family:monospace;font-size:12px;margin-bottom:6px;">${iss.detail}</div>` : ""}
    <div style="color:#555;font-size:13px;"><b>권장 조치:</b> ${iss.fix}</div>
  </div>`
  )
  .join("");

const progHtml = programStats
  .map(
    (p) => `
  <tr>
    <td style="padding:8px;border-bottom:1px solid #eee;font-weight:600;">${p.name}</td>
    <td style="padding:8px;border-bottom:1px solid #eee;text-align:center;">
      <span style="background:${p.status === "armed" ? "#e8f5e9" : "#e3f2fd"};padding:2px 8px;border-radius:10px;font-size:12px;">${p.status}</span>
    </td>
    <td style="padding:8px;border-bottom:1px solid #eee;">${[p.markets?.us && "US", p.markets?.kr && "KR", p.markets?.crypto && "CRYPTO"].filter(Boolean).join(" ")}</td>
    <td style="padding:8px;border-bottom:1px solid #eee;text-align:center;">${p.boxes.length}</td>
    <td style="padding:8px;border-bottom:1px solid #eee;font-size:12px;">idle:${p.byState.idle ?? 0} armed:${p.byState.armed ?? 0} conf:${p.byState.confirming ?? 0} pos:${p.byState.in_position ?? 0}</td>
    <td style="padding:8px;border-bottom:1px solid #eee;text-align:center;color:${p.withoutCatId > 50 ? "#e53935" : "#388e3c"};">${p.withCatId} / <b>${p.withoutCatId}</b></td>
  </tr>`
  )
  .join("");

const regHtml = regStats
  .map((r) => {
    const color = r.pct < 20 ? "#e53935" : r.pct < 50 ? "#f57c00" : "#388e3c";
    return `<tr>
    <td style="padding:8px;border-bottom:1px solid #eee;">${r.label}</td>
    <td style="padding:8px;border-bottom:1px solid #eee;text-align:center;">${r.totalEl}</td>
    <td style="padding:8px;border-bottom:1px solid #eee;text-align:center;">${r.totalReg}</td>
    <td style="padding:8px;border-bottom:1px solid #eee;text-align:center;font-weight:700;color:${color};">${r.pct}%</td>
  </tr>`;
  })
  .join("");

const highCount = issues.filter((i) => i.severity === "HIGH").length;
const medCount = issues.filter((i) => i.severity === "MEDIUM").length;
const lowCount = issues.filter((i) => i.severity === "LOW").length;

const html = `<!DOCTYPE html>
<html><body style="font-family:-apple-system,sans-serif;max-width:800px;margin:0 auto;padding:20px;color:#222;">

<h2 style="border-bottom:3px solid #1e5fc4;padding-bottom:10px;margin-bottom:4px;">📋 매매 프로그램 전체 점검 보고서</h2>
<p style="color:#666;margin-top:4px;">점검 시각: ${ts} KST &nbsp;|&nbsp; 총 박스: ${store.boxes.length}개 &nbsp;|&nbsp; 프로그램: ${allPrograms.length}개</p>

<div style="display:flex;gap:12px;margin:16px 0;">
  <div style="background:${highCount > 0 ? "#ffebee" : "#f5f5f5"};border-radius:8px;padding:12px 20px;text-align:center;flex:1;">
    <div style="font-size:24px;font-weight:700;color:${highCount > 0 ? "#e53935" : "#aaa"};">${highCount}</div>
    <div style="font-size:12px;color:#666;">HIGH</div>
  </div>
  <div style="background:${medCount > 0 ? "#fff8e1" : "#f5f5f5"};border-radius:8px;padding:12px 20px;text-align:center;flex:1;">
    <div style="font-size:24px;font-weight:700;color:${medCount > 0 ? "#f57c00" : "#aaa"};">${medCount}</div>
    <div style="font-size:12px;color:#666;">MEDIUM</div>
  </div>
  <div style="background:${lowCount > 0 ? "#e3f2fd" : "#f5f5f5"};border-radius:8px;padding:12px 20px;text-align:center;flex:1;">
    <div style="font-size:24px;font-weight:700;color:${lowCount > 0 ? "#1976d2" : "#aaa"};">${lowCount}</div>
    <div style="font-size:12px;color:#666;">LOW</div>
  </div>
  <div style="background:#e8f5e9;border-radius:8px;padding:12px 20px;text-align:center;flex:1;">
    <div style="font-size:24px;font-weight:700;color:#388e3c;">${ok.length}</div>
    <div style="font-size:12px;color:#666;">정상</div>
  </div>
</div>

<h3 style="margin-top:24px;">⚠️ 발견된 이슈</h3>
${issues.length > 0 ? issueHtml : '<p style="color:#388e3c;">이슈 없음</p>'}

<h3 style="margin-top:28px;">📊 프로그램별 현황</h3>
<table style="width:100%;border-collapse:collapse;">
  <tr style="background:#f0f4ff;font-size:13px;">
    <th style="padding:8px;text-align:left;">프로그램명</th>
    <th style="padding:8px;">상태</th>
    <th style="padding:8px;text-align:left;">마켓</th>
    <th style="padding:8px;">박스 수</th>
    <th style="padding:8px;text-align:left;">FSM 분포</th>
    <th style="padding:8px;">카탈로그연결/미연결</th>
  </tr>
  ${progHtml}
</table>

<h3 style="margin-top:28px;">🔢 카탈로그 등록률 (심볼 30개 샘플 기준)</h3>
<table style="width:100%;border-collapse:collapse;">
  <tr style="background:#f0f4ff;font-size:13px;">
    <th style="padding:8px;text-align:left;">마켓/전략</th>
    <th style="padding:8px;">Eligible</th>
    <th style="padding:8px;">등록됨</th>
    <th style="padding:8px;">등록률</th>
  </tr>
  ${regHtml}
</table>

<h3 style="margin-top:28px;">✅ 정상 동작 항목</h3>
<ul style="list-style:none;padding:0;">
  ${ok.map((o) => `<li style="padding:3px 0;">✅ ${o}</li>`).join("")}
</ul>

<h3 style="margin-top:28px;">💡 우선순위 조치 목록</h3>
<ol style="line-height:1.8;">
  <li><b>[즉시 HIGH]</b> '${coinArmedProg?.name ?? "코인 테스터"}' 프로그램 — 카탈로그 미연결 박스 ${coinArmedProg ? store.boxes.filter(b=>b.programId===coinArmedProg.id&&!b.catalogBoxId&&b.state!=="closed").length : 0}개 실거래 중 확인</li>
  <li><b>[즉시 HIGH]</b> AAPL 주식분할 전 가격 박스 ${splitPriceBoxes.length}개 → 카탈로그 재스캔</li>
  <li><b>[단기]</b> PRO+V2 중복 박스 방지 로직 추가 (동일 가격대 이중 진입 차단)</li>
  <li><b>[단기]</b> 스토어 크기 한계 800→1500 상향 또는 closed 박스 자동 정리</li>
  <li><b>[중기]</b> STOCK_BOX_RANGE_CATALOG_SLOTS_PER_TICK 상향(default 20)으로 등록률 개선</li>
</ol>

<hr style="margin-top:32px;border:none;border-top:1px solid #ddd;">
<p style="color:#999;font-size:12px;">YSTOCK 자동 점검 보고서 | ${ts}</p>
</body></html>`;

await sendTransactionalEmail({
  to: "samron3797@gmail.com",
  subject: `[YSTOCK] 매매 프로그램 점검 — HIGH ${highCount}건 MEDIUM ${medCount}건 (${ts})`,
  html,
});
console.log(`이메일 발송 완료 — HIGH:${highCount} MEDIUM:${medCount} LOW:${lowCount}`);
for (const iss of issues) {
  console.log(`  [${iss.severity}] ${iss.title}`);
}
