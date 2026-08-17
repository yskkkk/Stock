/**
 * 미국 재무제표·SEC 단어책 PDF 생성.
 * 서버 기동 없음. 사전 데이터는 src/lib/usFinancialStatementGlossary.ts.
 *
 *   node --experimental-strip-types --no-warnings scripts/build-us-financial-glossary-pdf.ts
 */
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  copyFileSync,
  unlinkSync,
  readFileSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { tmpdir, homedir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PDFDocument } from "pdf-lib";
import {
  GLOSSARY_SECTIONS,
  US_FINANCIAL_GLOSSARY,
  glossaryMemoWord,
  type GlossaryEntry,
  type GlossarySectionId,
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

const BASE_CSS = `
  @page { size: A4; margin: 8mm 10mm 16mm; }
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0 0 7mm;
    font-family: "Malgun Gothic", "맑은 고딕", "Apple SD Gothic Neo", sans-serif;
    color: #1a1a1a;
    font-size: 7.4pt;
    line-height: 1.36;
  }
  .running-foot {
    position: fixed;
    left: 10mm;
    right: 10mm;
    bottom: 6mm;
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    font-size: 6.6pt;
    letter-spacing: 0.02em;
    color: #666;
    border-top: 0.45pt solid #b4b4b4;
    padding-top: 1.2mm;
  }
  .running-foot .sec { font-weight: 700; color: #1a1a1a; }
  h2 {
    font-size: 10pt;
    margin: 0 0 2mm;
    padding-bottom: 1.1mm;
    border-bottom: 1pt solid #111;
    page-break-after: avoid;
  }
  h2 .count { font-weight: 500; font-size: 7pt; color: #666; }
  .drill-cap {
    margin: 0 0 1.3mm;
    font-size: 6.6pt;
    font-weight: 700;
    color: #555;
    letter-spacing: 0.04em;
  }
  .drill-cap--defs { margin-top: 2.6mm; }
  .drill {
    column-count: 2;
    column-gap: 7mm;
  }
  .drill-row {
    break-inside: avoid;
    display: flex;
    align-items: baseline;
    gap: 1.4mm;
    padding: 0.42mm 0;
  }
  .drill-en { font-weight: 700; flex: 0 1 auto; }
  .drill-dots {
    flex: 1 1 auto;
    border-bottom: 0.45pt dotted #9a9a9a;
    min-width: 4mm;
    transform: translateY(-0.15em);
  }
  .drill-ko { color: #222; white-space: nowrap; flex: 0 0 auto; }
  .term {
    display: flex;
    gap: 2mm;
    padding: 1.05mm 0;
    border-bottom: 0.3pt solid #e6e6e6;
    page-break-inside: avoid;
  }
  .term-num {
    flex: 0 0 4.8mm;
    color: #999;
    font-size: 6.5pt;
    padding-top: 0.15mm;
  }
  .term-body { min-width: 0; flex: 1; }
  .pair {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.3mm 2.1mm;
    margin: 0 0 0.35mm;
  }
  .pair .en { font-weight: 700; font-size: 7.5pt; line-height: 1.28; }
  .pair .ko { color: #222; font-weight: 700; font-size: 7.3pt; }
  .formula {
    margin: 0 0 0.5mm;
    padding: 0.35mm 1.2mm;
    background: #f4f4f4;
    font-family: Consolas, "Courier New", monospace;
    font-size: 6.5pt;
  }
  .desc { margin: 0; color: #333; font-size: 7pt; line-height: 1.38; }
  .cover { padding: 7mm 1mm 2mm; }
  .cover .kicker { font-size: 7pt; letter-spacing: 0.1em; color: #555; margin: 0 0 4mm; }
  .cover h1 { font-size: 15pt; line-height: 1.28; margin: 0 0 3.2mm; }
  .cover .lead { font-size: 8pt; color: #333; max-width: 155mm; line-height: 1.45; }
  .cover .meta { margin-top: 6mm; font-size: 7.2pt; color: #555; }
  .cover .note { margin-top: 3mm; font-size: 7pt; color: #666; }
  .toc { margin: 5mm 0 0; padding-left: 4.5mm; font-size: 7.6pt; }
  .toc li { margin: 1mm 0; }
  .toc a { color: #111; text-decoration: none; }
  .toc-n { color: #777; }
  table.memo {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
    font-size: 7pt;
    line-height: 1.32;
  }
  table.memo thead { display: table-header-group; }
  table.memo th {
    text-align: left;
    font-size: 6.5pt;
    font-weight: 700;
    letter-spacing: 0.02em;
    color: #333;
    border-bottom: 0.8pt solid #111;
    padding: 0.9mm 1.3mm 1mm;
    background: #fff;
  }
  table.memo td {
    vertical-align: top;
    padding: 0.85mm 1.3mm;
    border-bottom: 0.3pt solid #e3e3e3;
  }
  table.memo .c-en { width: 24%; font-weight: 700; word-break: break-word; }
  table.memo .c-ko { width: 18%; font-weight: 700; word-break: keep-all; }
  table.memo .c-mean { width: 58%; color: #222; word-break: keep-all; }
  table.memo .sec-banner th {
    padding: 2.1mm 1.3mm 1.1mm;
    border-bottom: 0.6pt solid #111;
    font-size: 8pt;
    background: #f3f3f3;
  }
  .memo-lead {
    margin: 0 0 2.2mm;
    font-size: 7.2pt;
    color: #444;
  }
`;

function wrapPage(sectionLabel: string, inner: string): string {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<title>미국 재무제표 · SEC 공시 단어책</title>
<style>${BASE_CSS}</style>
</head>
<body>
  <div class="running-foot">
    <span>미국 재무제표 단어책</span>
    <span class="sec">${esc(sectionLabel)}</span>
  </div>
  ${inner}
</body>
</html>`;
}

function coverHtml(): string {
  const date = "2026-08-18";
  const total = US_FINANCIAL_GLOSSARY.length;
  const toc = GLOSSARY_SECTIONS.map((sec) => {
    const n = US_FINANCIAL_GLOSSARY.filter((e) => e.section === sec.id).length;
    return `<li>${esc(sec.label)} <span class="toc-n">${n}</span></li>`;
  }).join("");
  const tocBlock = `<li>암기 표 (영어 · 한글 · 뜻) <span class="toc-n">${total}</span></li>${toc}`;
  return wrapPage(
    "목차",
    `<header class="cover">
      <p class="kicker">US FINANCIAL STATEMENTS · SEC FILINGS</p>
      <h1>미국 재무제표 · SEC 공시 단어책</h1>
      <p class="lead">
        10-K·10-Q 표에서 나오는 계정, 비율, 읽는 법 약어, SEC 서류입니다.
        앞의 암기 표(영어 · 한글 · 뜻)로 외우고, 각 소제목에서 설명을 다시 보세요.
      </p>
      <p class="meta">단어 ${total}개 · ${date} · 교육·참고용 (투자 권유 아님)</p>
      <p class="note">회사마다 계정 이름이 조금 다를 수 있습니다. 표 숫자와 주석(Notes)·MD&amp;A를 같이 보세요.</p>
            <ol class="toc">${tocBlock}</ol>
    </header>`,
  );
}

function meaningCell(entry: GlossaryEntry): string {
  const bits = [entry.formula, entry.body].filter(Boolean);
  return bits.join(" · ");
}

function memoHead(): string {
  return `<thead>
    <tr>
      <th class="c-en">영어단어</th>
      <th class="c-ko">한국단어</th>
      <th class="c-mean">뜻</th>
    </tr>
  </thead>`;
}

function memoRows(rows: readonly GlossaryEntry[], withBanner?: string): string {
  const banner = withBanner
    ? `<tr class="sec-banner"><th colspan="3">${esc(withBanner)}</th></tr>`
    : "";
  const body = rows
    .map(
      (e) =>
        `<tr>
          <td class="c-en">${esc(glossaryMemoWord(e))}</td>
          <td class="c-ko">${esc(e.ko)}</td>
          <td class="c-mean">${esc(meaningCell(e))}</td>
        </tr>`,
    )
    .join("\n");
  return `${banner}${body}`;
}

function memoTable(rows: readonly GlossaryEntry[], withBanner?: string): string {
  return `<table class="memo">
  ${memoHead()}
  <tbody>
    ${memoRows(rows, withBanner)}
  </tbody>
</table>`;
}

function drillBookHtml(): string {
  const chunks = GLOSSARY_SECTIONS.map((sec) => {
    const rows = US_FINANCIAL_GLOSSARY.filter((e) => e.section === sec.id);
    return memoRows(rows, `${sec.label} (${rows.length})`);
  }).join("\n");
  return wrapPage(
    "암기 표",
    `<section>
      <h2>암기 표 <span class="count">${US_FINANCIAL_GLOSSARY.length}</span></h2>
      <p class="memo-lead">영어단어 · 한국단어 · 뜻. 한글과 뜻을 가리고 영문부터 떠올려 보세요.</p>
      <table class="memo">
        ${memoHead()}
        <tbody>
          ${chunks}
        </tbody>
      </table>
    </section>`,
  );
}

function chapterHtml(sectionId: GlossarySectionId, sectionLabel: string): string {
  const rows = US_FINANCIAL_GLOSSARY.filter((e) => e.section === sectionId);
  const items = rows
    .map((e: GlossaryEntry, i) => {
      const formula = e.formula ? `<p class="formula">${esc(e.formula)}</p>` : "";
      return `<article class="term">
  <div class="term-num">${i + 1}</div>
  <div class="term-body">
    <p class="pair"><span class="en">${esc(e.en)}</span><span class="ko">${esc(e.ko)}</span></p>
    ${formula}
    <p class="desc">${esc(e.body)}</p>
  </div>
</article>`;
    })
    .join("\n");
  return wrapPage(
    sectionLabel,
    `<section class="chapter">
      <h2>${esc(sectionLabel)} <span class="count">${rows.length}</span></h2>
      <p class="drill-cap">암기 표 — 영어 · 한글 · 뜻</p>
      ${memoTable(rows)}
      <p class="drill-cap drill-cap--defs">설명</p>
      ${items}
    </section>`,
  );
}

function printPdf(html: string, pdfPath: string, chrome: string) {
  const htmlPath = pdfPath.replace(/\.pdf$/i, ".html");
  writeFileSync(htmlPath, html, "utf8");
  try {
    execFileSync(
      chrome,
      [
        "--headless=new",
        "--disable-gpu",
        "--no-pdf-header-footer",
        `--print-to-pdf=${pdfPath}`,
        pathToFileURL(htmlPath).href,
      ],
      { stdio: "pipe", windowsHide: true, timeout: 120_000 },
    );
  } finally {
    try {
      unlinkSync(htmlPath);
    } catch {
      /* ignore */
    }
  }
  if (!existsSync(pdfPath)) {
    throw new Error(`PDF가 생성되지 않았습니다: ${pdfPath}`);
  }
}

async function mergePdfs(paths: string[], outPath: string) {
  const merged = await PDFDocument.create();
  for (const part of paths) {
    const src = await PDFDocument.load(readFileSync(part));
    const copied = await merged.copyPages(src, src.getPageIndices());
    for (const page of copied) merged.addPage(page);
  }
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, await merged.save());
}

const chrome = findChromium();
if (!chrome) {
  throw new Error("Edge/Chrome을 찾지 못했습니다. PDF를 만들 수 없습니다.");
}

const work = mkdtempSync(path.join(tmpdir(), "us-fin-glossary-"));
try {
  const parts: string[] = [];
  const coverPath = path.join(work, "00-cover.pdf");
  printPdf(coverHtml(), coverPath, chrome);
  parts.push(coverPath);
  const drillPath = path.join(work, "01-drill.pdf");
  printPdf(drillBookHtml(), drillPath, chrome);
  parts.push(drillPath);
  GLOSSARY_SECTIONS.forEach((sec, i) => {
    const partPath = path.join(work, `${String(i + 2).padStart(2, "0")}-${sec.id}.pdf`);
    printPdf(chapterHtml(sec.id, sec.label), partPath, chrome);
    parts.push(partPath);
  });
  await mergePdfs(parts, DOCS_PDF);
  mkdirSync(path.dirname(DOWNLOADS_PDF), { recursive: true });
  copyFileSync(DOCS_PDF, DOWNLOADS_PDF);
} finally {
  rmSync(work, { recursive: true, force: true });
}

console.log(`PDF ${US_FINANCIAL_GLOSSARY.length} terms`);
console.log(DOCS_PDF);
console.log(DOWNLOADS_PDF);
