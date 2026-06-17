/**
 * KR DART 전 종목 연동 + 아카이브 갱신 결과 메일
 */
import { loadEnvFile } from "../server/load-env.js";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

loadEnvFile();

const { isDartEnabled, loadCorpIndex, resolveDartCorpCode } = await import("../server/dart.js");
const { loadFinancialPeriods } = await import("../server/stock-financials.js");

const samples = ["005930.KS", "000660.KS", "035420.KS", "051910.KS", "003410.KS"];
/** @type {string[]} */
const lines = [];

lines.push("국내 재무제표 DART 전 종목 연동 — 작업 결과");
lines.push("");
lines.push("## 구현 요약");
lines.push("- KR 종목: DART(CFS 연·분기) 우선, Naver는 전망·보조");
lines.push("- 실적 중복 시 dart > naver > yahoo (KR은 DART 있으면 Yahoo 생략)");
lines.push("- 아카이브 schema v2 — d: 기간 없는 구 캐시 무시");
lines.push("- KR 아카이브: 연간 10·분기 4 상세 저장, DART 연간 우선 선택");
lines.push("- DART corp index: 디스크 캐시 + 갱신 스크립트 선로드 + fetch 3회 재시도");
lines.push("");
lines.push(`OPENDART_API_KEY: ${isDartEnabled() ? "설정됨" : "없음"}`);

let corps = [];
try {
  corps = await loadCorpIndex(false);
  lines.push(`DART corp index (메모리/디스크): ${corps.length} 상장사`);
} catch (e) {
  lines.push(`DART corp index 로드 실패: ${e?.message ?? e}`);
  lines.push("(네트워크 차단 시 server/.data/dart-corp-index.json 생성 후 refresh 재실행)");
}

lines.push("");
lines.push("## 샘플 종목 (live)");
for (const sym of samples) {
  const corp = await resolveDartCorpCode(sym);
  try {
    const p = await loadFinancialPeriods(sym, { forceLive: true });
    const dartN = p.periods.filter((x) => x.source === "dart").length;
    const naverN = p.periods.filter((x) => x.source === "naver").length;
    lines.push(`- ${sym}: corp=${corp ? "O" : "X"}, dart=${dartN}, naver=${naverN}`);
  } catch (e) {
    lines.push(`- ${sym}: corp=${corp ? "O" : "X"}, ERROR ${e?.message ?? e}`);
  }
}

const archDir = path.join("server", ".data", "financials-archive");
let withD = 0;
let withoutD = 0;
if (fs.existsSync(archDir)) {
  for (const f of fs.readdirSync(archDir)) {
    if (!f.endsWith(".KS.json") && !f.endsWith(".KQ.json")) continue;
    const j = JSON.parse(fs.readFileSync(path.join(archDir, f), "utf8"));
    const n = j.periods?.periods?.filter((p) => String(p.id).startsWith("d:")).length ?? 0;
    if (n > 0) withD++;
    else withoutD++;
  }
}
lines.push("");
lines.push("## 아카이브 (로컬 disk)");
lines.push("- KR 111종 refresh: ok 110 / fail 1 (003410.KS 쌍용C&E — DART·Naver 모두 재무 없음)");
lines.push(`- d: 기간 포함 아카이브: ${withD}건 / Naver-only: ${withoutD}건`);
if (withoutD > 0) {
  lines.push("- Naver-only 다수: bulk refresh 당시 DART corp index API fetch 실패(ECONNRESET).");
  lines.push("  → corp index 디스크 캐시 패치 적용됨. 아래 명령으로 재갱신 필요:");
  lines.push("  node scripts/refresh-kr-financials-archive.mjs");
}

lines.push("");
lines.push("## 커밋");
lines.push("- 3b4921c KR 재무제표 전 종목 DART 우선·아카이브 v2 갱신");
lines.push("- (이후) dart corp index 디스크 캐시 패치 — push 예정");

const body = lines.join("\n");
const r = spawnSync(
  "node",
  ["scripts/send-agent-text-email.mjs", "KR 재무제표 DART 전 종목 연동 결과", "--stdin"],
  { input: body, encoding: "utf8", cwd: process.cwd() },
);
if (r.status !== 0) {
  console.error(r.stderr || r.stdout);
  process.exit(r.status ?? 1);
}
console.log("email sent");
