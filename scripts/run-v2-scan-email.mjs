#!/usr/bin/env node
/**
 * V2 탐지(ER필터+POC+고저퍼센타일) 전종목 스캔 → 결과 이메일
 * 대상: S&P500 + 국장 시총 300 + BTC·ETH·SOL
 *
 * node scripts/run-v2-scan-email.mjs
 */
import { loadEnvFile }               from "../server/load-env.js";
import { sendTransactionalEmail }    from "../server/email-sender.js";
import { loadBoxRangeCatalogUniverse } from "../server/universe.js";
import { scanOneSymbolCatalogV2 }    from "../server/box-range/catalog-scan-shared.js";

loadEnvFile();

const TO  = "samron3797@gmail.com";
const ts  = new Date().toISOString().slice(0, 16).replace("T", " ");

const BATCH = { us: 6, kr: 6, crypto: 3 };
const DELAY = { us: 500, kr: 400, crypto: 200 };

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── 시장별 배치 스캔 ──────────────────────────────────────────────────
async function scanMarket(list, market) {
  const batchSize = BATCH[market] ?? 4;
  const delayMs   = DELAY[market] ?? 400;
  const results   = [];
  const total     = list.length;

  for (let i = 0; i < list.length; i += batchSize) {
    const batch = list.slice(i, i + batchSize);
    const res   = await Promise.all(batch.map(item => scanOneSymbolCatalogV2(item, market)));
    results.push(...res);
    const done = Math.min(i + batchSize, total);
    process.stdout.write(`\r  [${market.toUpperCase()}] ${done}/${total}`);
    if (i + batchSize < list.length) await sleep(delayMs);
  }
  process.stdout.write("\n");
  return results;
}

// ── 메인 ────────────────────────────────────────────────────────────
console.log(`[V2 스캔] ${ts} 시작`);

console.log("  유니버스 로딩...");
const uni  = await loadBoxRangeCatalogUniverse();
const usList     = uni.us     ?? [];
const krList     = uni.kr     ?? [];
const cryptoList = (uni.crypto ?? []).filter(c =>
  ["BTC-USDT","ETH-USDT","SOL-USDT"].includes(
    String(c.symbol ?? "").toUpperCase()
  )
);

console.log(`  US: ${usList.length}종목  KR: ${krList.length}종목  Crypto: ${cryptoList.length}종목`);

console.log("  크립토 스캔...");
const cryptoRes = await scanMarket(cryptoList, "crypto");

console.log("  미국 스캔...");
const usRes     = await scanMarket(usList, "us");

console.log("  국내 스캔...");
const krRes     = await scanMarket(krList, "kr");

const endTs = new Date().toISOString().slice(0, 16).replace("T", " ");

// ── 결과 집계 ────────────────────────────────────────────────────────
function tally(results) {
  return results
    .filter(r => r.ok && r.boxes > 0)
    .map(r => ({
      symbol: r.symbol,
      boxes:  r.boxes,
      byTf:   r.detectedByTf ?? {},
    }))
    .sort((a, b) => b.boxes - a.boxes);
}

const cryptoHit = tally(cryptoRes);
const usHit     = tally(usRes);
const krHit     = tally(krRes);

const totalScanned = cryptoList.length + usList.length + krList.length;
const totalHit     = cryptoHit.length + usHit.length + krHit.length;
const totalBoxes   = [...cryptoRes, ...usRes, ...krRes].reduce((s, r) => s + (r.boxes ?? 0), 0);

console.log(`\n[완료] 탐지 종목: ${totalHit}/${totalScanned}  박스 총합: ${totalBoxes}`);

// ── HTML 이메일 ──────────────────────────────────────────────────────
const CSS = `
body{font-family:-apple-system,Arial,sans-serif;background:#0f0f14;color:#e0e0e0;margin:0;padding:20px}
h1{color:#7eb8f7;font-size:18px;border-bottom:1px solid #2a3a5c;padding-bottom:8px}
h2{color:#a0b8d8;font-size:14px;margin:20px 0 8px}
.stat{display:inline-block;background:#1a2235;border:1px solid #2a3a5c;border-radius:6px;padding:10px 18px;margin:4px}
.stat-val{font-size:22px;font-weight:bold;color:#7eb8f7}
.stat-lbl{font-size:11px;color:#7a8fa8;margin-top:2px}
table{width:100%;border-collapse:collapse;font-size:12px;margin-bottom:20px}
th{background:#1a2235;color:#7a8fa8;text-align:left;padding:6px 10px;border-bottom:1px solid #2a3a5c}
td{padding:5px 10px;border-bottom:1px solid #1a2235}
tr:hover td{background:#1a2235}
.sym{font-weight:600;color:#e8e8e8}
.cnt{text-align:center;color:#7eb8f7;font-weight:bold}
.zero{text-align:center;color:#3a4a5c}
.badge-crypto{background:#c0812020;color:#e0a040;border-radius:3px;padding:1px 6px;font-size:10px}
.badge-us{background:#2040a020;color:#6090e0;border-radius:3px;padding:1px 6px;font-size:10px}
.badge-kr{background:#40200020;color:#e06060;border-radius:3px;padding:1px 6px;font-size:10px}
.none{color:#3a4a5c;font-style:italic}
`;

function tableRows(hits, badge) {
  if (!hits.length) return `<tr><td colspan="5" class="none">탐지된 박스권 없음</td></tr>`;
  return hits.map(h => {
    const h1 = h.byTf?.["1h"] ?? 0;
    const h4 = h.byTf?.["4h"] ?? 0;
    const hd = h.byTf?.["1d"] ?? 0;
    return `<tr>
      <td class="sym">${h.symbol} <span class="${badge}">${badge.replace("badge-","").toUpperCase()}</span></td>
      <td class="cnt">${h1 || '<span class="zero">—</span>'}</td>
      <td class="cnt">${h4 || '<span class="zero">—</span>'}</td>
      <td class="cnt">${hd || '<span class="zero">—</span>'}</td>
      <td class="cnt">${h.boxes}</td>
    </tr>`;
  }).join("");
}

const html = `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8">
<title>V2 박스권 스캔 결과</title><style>${CSS}</style></head><body>
<h1>📦 V2 박스권 스캔 결과 — ${ts}</h1>

<div>
  <div class="stat"><div class="stat-val">${totalScanned}</div><div class="stat-lbl">전체 스캔 종목</div></div>
  <div class="stat"><div class="stat-val">${totalHit}</div><div class="stat-lbl">박스 탐지 종목</div></div>
  <div class="stat"><div class="stat-val">${totalBoxes}</div><div class="stat-lbl">탐지 박스 합계</div></div>
  <div class="stat"><div class="stat-val">${cryptoHit.length}</div><div class="stat-lbl">크립토</div></div>
  <div class="stat"><div class="stat-val">${usHit.length}</div><div class="stat-lbl">미국(S&amp;P500)</div></div>
  <div class="stat"><div class="stat-val">${krHit.length}</div><div class="stat-lbl">국내(시총300)</div></div>
</div>

<p style="color:#5a7a9a;font-size:11px">탐지 방식: V2 (ER≤0.40 · 고가80%/저가20% 퍼센타일 · POC mid · 거절점수≥0.5)<br>
저장 경로: box-range-catalog-v2 · 스캔 완료: ${endTs}</p>

<h2>🪙 크립토 (BTC · ETH · SOL)</h2>
<table>
  <tr><th>종목</th><th>1h</th><th>4h</th><th>1d</th><th>합계</th></tr>
  ${tableRows(cryptoHit, "badge-crypto")}
</table>

<h2>🇺🇸 미국 S&P500 — 상위 탐지 종목 (최대 50개)</h2>
<table>
  <tr><th>종목</th><th>1h</th><th>4h</th><th>1d</th><th>합계</th></tr>
  ${tableRows(usHit.slice(0, 50), "badge-us")}
</table>
${usHit.length > 50 ? `<p style="color:#5a7a9a;font-size:11px">외 ${usHit.length - 50}개 종목 탐지됨</p>` : ""}

<h2>🇰🇷 국내 시총 300 — 상위 탐지 종목 (최대 50개)</h2>
<table>
  <tr><th>종목</th><th>1h</th><th>4h</th><th>1d</th><th>합계</th></tr>
  ${tableRows(krHit.slice(0, 50), "badge-kr")}
</table>
${krHit.length > 50 ? `<p style="color:#5a7a9a;font-size:11px">외 ${krHit.length - 50}개 종목 탐지됨</p>` : ""}

<p style="color:#3a4a5c;font-size:11px;margin-top:30px">YSTOCK V2 박스권 스캔 · ${ts}</p>
</body></html>`;

const subject = `[YSTOCK] V2 박스권 스캔 — ${totalHit}종목 ${totalBoxes}박스 탐지 (${ts})`;
const text    = `[YSTOCK] V2 박스권 스캔 결과 (${ts})\n\n스캔: ${totalScanned}종목  탐지: ${totalHit}종목  박스: ${totalBoxes}개\n\n크립토: ${cryptoHit.map(h=>h.symbol+"("+h.boxes+")").join(", ") || "없음"}\n미국: ${usHit.length}종목  국내: ${krHit.length}종목`;

await sendTransactionalEmail({ to: TO, subject, text, html });
console.log(`✓ 이메일 전송 → ${TO}`);
