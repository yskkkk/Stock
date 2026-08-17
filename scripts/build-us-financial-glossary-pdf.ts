/**
 * 미국 재무제표·SEC 단어책 PDF 생성.
 * 서버 기동 없음. 사전 데이터는 src/lib/usFinancialStatementGlossary.ts.
 *
 *   node --experimental-strip-types --no-warnings scripts/build-us-financial-glossary-pdf.ts
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, copyFileSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  GLOSSARY_SECTIONS,
  US_FINANCIAL_GLOSSARY,
  type GlossaryEntry,
} from "../src/lib/usFinancialStatementGlossary.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DOCS_PDF = path.join(ROOT, "docs", "미국-재무제표-SEC-단어책.pdf");
const DOWNLOADS_PDF = path.join(homedir(), "Downloads", "미국_재무제표_SEC_단어책.pdf");

function esc(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function findChromium(): string | null {
  const candidates = [
    process.env.MSEDGE_PATH,
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    process.env.CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ].filter(Boolean) as string[];
  return candidates.find((p) => existsSync(p)) ?? null;
}

function renderHtml(): string {
  const date = "2026-08-18";
  const total = US_FINANCIAL_GLOSSARY.length;
  const toc = GLOSSARY_SECTIONS.map((sec) => {
    const n = US_FINANCIAL_GLOSSARY.filter((e) => e.section === sec.id).length;
    return `<li><a href="#sec-${sec.id}">${esc(sec.label)}</a> <span class="toc-n">${n}</span></li>`;
  }).join("");

  const chapters = GLOSSARY_SECTIONS.map((sec) => {
    const rows = US_FINANCIAL_GLOSSARY.filter((e) => e.section === sec.id);
    const items = rows
      .map((e: GlossaryEntry, i) => {
        const formula = e.formula
          ? `<p class="formula">${esc(e.formula)}</p>`
          : "";
        return `<article class="term">
  <div class="term-num">${i + 1}</div>
  <div class="term-body">
    <h3>${esc(e.en)}</h3>
    <p class="ko">${esc(e.ko)}</p>
    ${formula}
    <p class="desc">${esc(e.body)}</p>
  </div>
</article>`;
      })
      .join("\n");
    return `<section id="sec-${sec.id}" class="chapter">
  <h2>${esc(sec.label)} <span class="count">${rows.length}</span></h2>
  ${items}
</section>`;
  }).join("\n");

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<title>미국 재무제표 · SEC 공시 단어책</title>
<style>
  @page { size: A4; margin: 14mm 13mm 16mm; }
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    font-family: "Malgun Gothic", "맑은 고딕", "Apple SD Gothic Neo", sans-serif;
    color: #1a1a1a;
    font-size: 10.5pt;
    line-height: 1.55;
  }
  .cover {
    padding: 18mm 4mm 10mm;
    border-bottom: 2px solid #111;
    page-break-after: always;
  }
  .cover .kicker { font-size: 10pt; letter-spacing: 0.08em; color: #444; margin: 0 0 8mm; }
  .cover h1 { font-size: 22pt; line-height: 1.3; margin: 0 0 6mm; }
  .cover .lead { font-size: 11pt; color: #333; max-width: 150mm; }
  .cover .meta { margin-top: 14mm; font-size: 9.5pt; color: #555; }
  .cover .note { margin-top: 8mm; font-size: 9pt; color: #666; }
  h2 {
    font-size: 14pt;
    margin: 0 0 6mm;
    padding-bottom: 2.5mm;
    border-bottom: 1.5px solid #111;
    page-break-after: avoid;
  }
  h2 .count { font-weight: 500; font-size: 10pt; color: #666; }
  .toc { margin: 8mm 0 0; padding-left: 5mm; }
  .toc li { margin: 1.6mm 0; }
  .toc a { color: #111; text-decoration: none; }
  .toc-n { color: #777; font-size: 9.5pt; }
  .chapter { page-break-before: always; }
  .term {
    display: flex;
    gap: 4mm;
    padding: 3.2mm 0;
    border-bottom: 1px solid #e4e4e4;
    page-break-inside: avoid;
  }
  .term-num {
    flex: 0 0 8mm;
    color: #888;
    font-size: 9pt;
    padding-top: 0.6mm;
  }
  .term-body { min-width: 0; flex: 1; }
  .term h3 { margin: 0 0 1mm; font-size: 10.8pt; line-height: 1.35; }
  .term .ko { margin: 0 0 1.5mm; color: #333; font-weight: 700; font-size: 10pt; }
  .formula {
    margin: 0 0 1.6mm;
    padding: 1.4mm 2.2mm;
    background: #f3f3f3;
    font-family: Consolas, "Courier New", monospace;
    font-size: 9pt;
  }
  .desc { margin: 0; color: #222; }
</style>
</head>
<body>
  <header class="cover">
    <p class="kicker">US FINANCIAL STATEMENTS · SEC FILINGS</p>
    <h1>미국 재무제표 · SEC 공시 단어책</h1>
    <p class="lead">
      10-K·10-Q 표에서 나오는 계정, 비율, 읽는 법 약어, SEC 서류를 모았습니다.
      ‘주요 용어’만 추리지 않고 재무제표를 볼 때 알아야 할 단어를 설명합니다.
    </p>
    <p class="meta">단어 ${total}개 · ${date} · 교육·참고용 (투자 권유 아님)</p>
    <p class="note">회사마다 계정 이름·분류가 조금 다를 수 있습니다. 표의 숫자와 주석(Notes)·MD&amp;A를 같이 보세요.</p>
    <ol class="toc">${toc}</ol>
  </header>
  ${chapters}
</body>
</html>`;
}

function printPdf(htmlPath: string, pdfPath: string) {
  const chrome = findChromium();
  if (!chrome) {
    throw new Error("Edge/Chrome을 찾지 못했습니다. PDF를 만들 수 없습니다.");
  }
  mkdirSync(path.dirname(pdfPath), { recursive: true });
  const fileUrl = pathToFileURL(htmlPath).href;
  execFileSync(
    chrome,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-pdf-header-footer",
      `--print-to-pdf=${pdfPath}`,
      fileUrl,
    ],
    { stdio: "pipe", windowsHide: true, timeout: 120_000 },
  );
  if (!existsSync(pdfPath)) {
    throw new Error(`PDF가 생성되지 않았습니다: ${pdfPath}`);
  }
}

const htmlPath = path.join(ROOT, "docs", "_us-financial-glossary-print.html");
writeFileSync(htmlPath, renderHtml(), "utf8");
try {
  printPdf(htmlPath, DOCS_PDF);
  mkdirSync(path.dirname(DOWNLOADS_PDF), { recursive: true });
  copyFileSync(DOCS_PDF, DOWNLOADS_PDF);
} finally {
  try {
    unlinkSync(htmlPath);
  } catch {
    /* ignore */
  }
}

console.log(`PDF ${US_FINANCIAL_GLOSSARY.length} terms`);
console.log(DOCS_PDF);
console.log(DOWNLOADS_PDF);
