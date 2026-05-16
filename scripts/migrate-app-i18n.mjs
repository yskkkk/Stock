/**
 * App.tsx Korean literals -> ko.* (ASCII-only edits in this script)
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const appPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
  "App.tsx",
);

let s = fs.readFileSync(appPath, "utf8");

if (!s.includes('from "./i18n/ko"')) {
  s = s.replace(
    'import type {\n  Candle,',
    'import { failedCountLabel, ko } from "./i18n/ko";\nimport type {\n  Candle,',
  );
}

const reps = [
  [
    /err instanceof Error \? err\.message : "[^"]*",\s*\n\s*\)/g,
    (m, offset) => {
      const before = s.slice(Math.max(0, offset - 400), offset);
      if (before.includes("pollPicks")) return `err instanceof Error ? err.message : ko.errors.picksLoad,\n      )`;
      if (before.includes("loadChart")) return `err instanceof Error ? err.message : ko.errors.chartLoad,\n        )`;
      if (before.includes("fetchNews")) return `err instanceof Error ? err.message : ko.errors.newsLoad,\n      )`;
      return m;
    },
  ],
];

// targeted single replacements
const singles = [
  [
    'err instanceof Error ? err.message : "?? ??? ??? ? ????.",',
    "err instanceof Error ? err.message : ko.errors.picksLoad,",
  ],
  [
    /const ok = window\.confirm\(\s*"[^"]*",\s*\);/s,
    "const ok = window.confirm(ko.app.telegramConfirm);",
  ],
  [
    'err instanceof Error ? err.message : "?? ?? ???? ??????.",',
    "err instanceof Error ? err.message : ko.app.telegramResetFail,",
  ],
  [
    'err instanceof Error ? err.message : "??? ??? ? ????.",',
    "err instanceof Error ? err.message : ko.errors.chartLoad,",
  ],
  [
    /const failedLabel =\s*picks\?\.failedCount && picks\.failedCount > 0\s*\? `[^`]*`\s*: "";/s,
    `const failedLabel =
    picks?.failedCount && picks.failedCount > 0
      ? failedCountLabel(picks.failedCount)
      : "";`,
  ],
  ["<h1>?? ?? ????</h1>", "<h1>{ko.app.title}</h1>"],
  ["?? 300 ? ??? 500", "{ko.app.subtitle}"],
  ["????", "{ko.app.telegram}"],
  ['title="?? ???? ?? ?? ???"', "title={ko.app.telegramResetAria}"],
  ['aria-label="?? ???? ?? ?? ???"', "aria-label={ko.app.telegramResetAria}"],
  ['aria-label="?? ??"', 'aria-label={ko.app.mainNav}'],
  ["????", "{ko.app.tabScreener}"],
  ["?? ??", "{ko.app.tabBullish}"],
  ['{rescanning ? "?? ??" : "?? ???"}', "{rescanning ? ko.app.rescanning : ko.app.rescan}"],
  ['title="조회 실패 종목 목록"', "title={ko.app.failBtnTitle}"],
  ["?? ??", "{ko.app.retry}"],
  [">??<", ">{ko.app.marketKr}<"],
  [">??<", ">{ko.app.marketUs}<"],
  [
    /<p className="panel-hint">[\s\S]*?<\/p>/,
    `<p className="panel-hint">
              {ko.app.bullishHint}
              {" · "}
              <strong>{ko.app.reason}</strong>
              {ko.app.reasonSuffix}
            </p>`,
  ],
  ["<p className=\"placeholder-title\">??? ?????</p>", "<p className=\"placeholder-title\">{ko.app.selectTitle}</p>"],
  [
    /<p className="placeholder-desc">\s*[^<]*\s*<\/p>/,
    "<p className=\"placeholder-desc\">{ko.app.selectDesc}</p>",
  ],
  ['<span className="chart-toolbar__muted">{candleCount}?</span>', '<span className="chart-toolbar__muted">{candleCount}{ko.app.candleSuffix}</span>'],
  ['<span className="tag tag--warn">??</span>', '<span className="tag tag--warn">{ko.app.cacheTag}</span>'],
  [
    /\[\s*\["ma", "[^"]*", showMa, setShowMa\],\s*\["ich", "[^"]*", showIchimoku, setShowIchimoku\],\s*\["vol", "[^"]*", showVolume, setShowVolume\],\s*\["rsi", "RSI", showRsi, setShowRsi\],\s*\] as const/s,
    `[
                          ["ma", ko.app.chipMa, showMa, setShowMa],
                          ["ich", ko.app.chipIch, showIchimoku, setShowIchimoku],
                          ["vol", ko.app.chipVol, showVolume, setShowVolume],
                          ["rsi", ko.app.chipRsi, showRsi, setShowRsi],
                        ] as const`,
  ],
  ["<p>?? ???? ???? ?</p>", "<p>{ko.app.chartLoading}</p>"],
  ['<p className="chart-empty">??? ??? ????.</p>', '<p className="chart-empty">{ko.app.chartEmpty}</p>'],
];

for (const [a, b] of singles) {
  if (typeof a === "string") {
    if (!s.includes(a) && typeof b === "string") continue;
    s = s.split(a).join(b);
  } else {
    s = s.replace(a, b);
  }
}

// news error (second chartLoad pattern in handleNews)
s = s.replace(
  /setNewsError\(\s*err instanceof Error \? err\.message : "[^"]*",\s*\);/,
  "setNewsError(\n        err instanceof Error ? err.message : ko.errors.newsLoad,\n      );",
);

// market tabs: only replace button text between tags (kr then us)
s = s.replace(
  /(onClick=\{\(\) => setMarketTab\("kr"\)\}\s*>\s*)\?\?/,
  "$1{ko.app.marketKr}",
);
s = s.replace(
  /(onClick=\{\(\) => setMarketTab\("us"\)\}\s*>\s*)\?\?/,
  "$1{ko.app.marketUs}",
);

fs.writeFileSync(appPath, s, "utf8");
console.log("migrated App.tsx");
