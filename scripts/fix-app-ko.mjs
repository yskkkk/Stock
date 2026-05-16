import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const p = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "App.tsx");
let s = fs.readFileSync(p, "utf8");

const KO = {
  picksErr: "\uC885\uBAA9 \uBAA9\uB85D\uC744 \uBD88\uB7EC\uC62C \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.",
  confirmReset:
    "\uC624\uB298 \uBC1C\uC1A1\uD55C \uD14C\uB808\uADF8\uB7A8 \uC54C\uB9BC \uC774\uB825\uC744 \uCD08\uAE30\uD654\uD560\uAE4C\uC694?\\n\uAC19\uC740 \uC885\uBAA9\uC774 \uB2E4\uC2DC \uC810\uC218 \uC870\uAC74\uC744 \uB9CC\uC871\uD558\uBA74 \uC54C\uB9BC\uC774 \uC7AC\uC804\uC1A1\uB429\uB2C8\uB2E4.",
  resetFail: "\uC54C\uB9BC \uC774\uB825 \uCD08\uAE30\uD654\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4.",
  chartErr: "\uCC28\uD2B8\uB97C \uBD88\uB7EC\uC62C \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.",
  newsErr: "\uB274\uC2A4\uB97C \uBD88\uB7EC\uC62C \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.",
  title: "\uB9E4\uC218 \uD6C4\uBCF4 \uC2A4\uD06C\uB9AC\uB108",
  subtitle: "\uAD6D\uB0B4 300 \u00B7 \uB098\uC2A4\uB2E5 500",
  telegram: "\uD154\uB808\uADF8\uB7A8",
  telResetTitle: "\uC624\uB298 \uD154\uB808\uADF8\uB7A8 \uC54C\uB9BC \uC774\uB825 \uCD08\uAE30\uD654",
  mainNav: "\uBA54\uC778 \uBA54\uB274",
  screener: "\uC2A4\uD06C\uB9AC\uB108",
  bullish: "\uC0C1\uC2B9 \uC720\uB9DD",
  rescanning: "\uC694\uCCAD \uC911\u2026",
  rescan: "\uC804\uCCB4 \uC7AC\uBD84\uC11D",
  retry: "\uB2E4\uC2DC \uC2DC\uB3C4",
  kr: "\uAD6D\uB0B4",
  us: "\uBBF8\uAD6D",
  maDaily: "\uC77C\uB445\uC774\uD3C9",
  ich: "\uC77C\uBAA9",
  vol: "\uAC70\uB798\uB7C9",
  cache: "\uCE90\uC2DC",
  loading: "\uCC28\uD2B8 \uB370\uC774\uD130\uB97C \uBD88\uB7EC\uC624\uB294 \uC911",
  emptyChart: "\uD45C\uC2DC\uD560 \uCE94\uB4E4\uC774 \uC5C6\uC2B5\uB2C8\uB2E4.",
  selectStock: "\uC885\uBAA9\uC744 \uC120\uD0DD\uD558\uC138\uC694",
  selectDesc:
    "\uC67C\uCABD \uBAA9\uB85D\uC5D0\uC11C \uC885\uBAA9\uC744 \uB204\uB974\uBA74 \uCC28\uD2B8\uAC00 \uD45C\uC2DC\uB429\uB2C8\uB2E4",
  panelHint:
    "\uACE8\uB4E0\uD06C\uB85C\uC2A4\u00B7\uC77C\uBAA9\u00B7\uC815\uBC30\uC5F4 \uB4F1 \uC0C1\uC2B9 \uC2E0\uD638\uAC00 \uAC15\uD55C \uC885\uBAA9",
  reason: "\uC774\uC720",
  reasonSuffix: "\uB85C \uADFC\uAC70 \uD655\uC778",
  failCount: "\uC2E4\uD328",
  failUnit: "\uAC74",
  candleUnit: "\uB4F9",
};

const reps = [
  [
    /setPicksError\(\s*err instanceof Error \? err\.message : "[^"]*",\s*\);/,
    `setPicksError(\n        err instanceof Error ? err.message : "${KO.picksErr}",\n      );`,
  ],
  [/const ok = window\.confirm\(\s*"[^"]*",\s*\);/, `const ok = window.confirm(\n      "${KO.confirmReset}",\n    );`],
  [
    /window\.alert\(\s*err instanceof Error \? err\.message : "[^"]*",\s*\);/,
    `window.alert(\n        err instanceof Error ? err.message : "${KO.resetFail}",\n      );`,
  ],
  [
    /setChartError\(\s*err instanceof Error \? err\.message : "[^"]*",\s*\);/,
    `setChartError(\n          err instanceof Error ? err.message : "${KO.chartErr}",\n        );`,
  ],
  [
    /setNewsError\(\s*err instanceof Error \? err\.message : "[^"]*",\s*\);/,
    `setNewsError(\n        err instanceof Error ? err.message : "${KO.newsErr}",\n      );`,
  ],
  [
    /`[^`]*\$\{picks\.failedCount\}[^`]*`/,
    "`\uC2E4\uD328 ${picks.failedCount}\uAC74`",
  ],
  [/<h1>[^<]+<\/h1>/, `<h1>${KO.title}</h1>`],
  [
    /<p>\s*\n\s*[^\n<]*300[^\n<]*500/,
    `<p>\n              ${KO.subtitle}`,
  ],
  [
    /<span className="tag tag--telegram">\s*[^<\n{]+\s*\n\s*\{telegramSentCount/,
    `<span className="tag tag--telegram">\n                    ${KO.telegram}\n                    {telegramSentCount`,
  ],
  [
    /title="[^"]*"\s*\n\s*aria-label="[^"]*"\s*\n\s*disabled=\{resettingTelegram\}/,
    `title="${KO.telResetTitle}"\n                    aria-label="${KO.telResetTitle}"\n                    disabled={resettingTelegram}`,
  ],
  [
    /onClick=\{handleResetTelegramSent\}\s*>\s*[^<]+\s*<\/button>/,
    `onClick={handleResetTelegramSent}\n                  >\n                    \u00D7\n                  </button>`,
  ],
  [
    /<nav className="main-tabs" aria-label="[^"]*"/,
    `<nav className="main-tabs" aria-label="${KO.mainNav}"`,
  ],
  [
    /setAppTab\("screener"\)\}\s*>\s*[^<]+\s*<\/button>/,
    `setAppTab("screener")}\n          >\n            ${KO.screener}\n          </button>`,
  ],
  [
    /setAppTab\("bullish"\)\}\s*>\s*[^<\n]+\s*\n\s*\{bullishCount/,
    `setAppTab("bullish")}\n          >\n            ${KO.bullish}\n            {bullishCount`,
  ],
  [
    /\{rescanning \? "[^"]*" : "[^"]*"\}/,
    `{rescanning ? "${KO.rescanning}" : "${KO.rescan}"}`,
  ],
  [
    /onClick=\{pollPicks\}>\s*[^<]+\s*<\/button>/,
    `onClick={pollPicks}>\n            ${KO.retry}\n          </button>`,
  ],
  [
    /setMarketTab\("kr"\)\}\s*>\s*[^<\n]+\s*\n\s*<span className="market-tab__count">/,
    `setMarketTab("kr")}\n              >\n                ${KO.kr}\n                <span className="market-tab__count">`,
  ],
  [
    /setMarketTab\("us"\)\}\s*>\s*[^<\n]+\s*\n\s*<span className="market-tab__count">/,
    `setMarketTab("us")}\n              >\n                ${KO.us}\n                <span className="market-tab__count">`,
  ],
  [
    /<p className="panel-hint">[\s\S]*?<\/p>/,
    `<p className="panel-hint">
              ${KO.panelHint} \u00B7{" "}
              <strong>${KO.reason}</strong>${KO.reasonSuffix}
            </p>`,
  ],
  [
    /<p className="placeholder-title">[^<]+<\/p>/,
    `<p className="placeholder-title">${KO.selectStock}</p>`,
  ],
  [
    /<p className="placeholder-desc">[\s\S]*?<\/p>/,
    `<p className="placeholder-desc">\n                ${KO.selectDesc}\n              </p>`,
  ],
  [/\{candleCount\}[^<]*<\/span>/, `{candleCount}${KO.candleUnit}</span>`],
  [
    /<span className="tag tag--warn">[^<]+<\/span>/,
    `<span className="tag tag--warn">${KO.cache}</span>`,
  ],
  [/\["ma", "[^"]+", showMa/, `["ma", "${KO.maDaily}", showMa`],
  [/\["ich", "[^"]+", showIchimoku/, `["ich", "${KO.ich}", showIchimoku`],
  [/\["vol", "[^"]+", showVolume/, `["vol", "${KO.vol}", showVolume`],
  [
    /<motion className="overlay">/g,
    '<motion className="overlay">',
  ],
  [
    /<motion className="overlay">|<motion className="spinner"|<div className="overlay">\s*<div className="spinner" \/>\s*<p>[^<]*<\/p>/,
    `<div className="overlay">\n                    <div className="spinner" />\n                    <p>${KO.loading}</p>`,
  ],
  [
    /onClick=\{\(\) => loadChart\(selected, timeframe, true\)\}\s*>\s*[^<]+\s*<\/button>/,
    `onClick={() => loadChart(selected, timeframe, true)}\n                    >\n                      ${KO.retry}\n                    </button>`,
  ],
  [
    /<p className="chart-empty">[^<]+<\/p>/,
    `<p className="chart-empty">${KO.emptyChart}</p>`,
  ],
];

let misses = 0;
for (const [pat, rep] of reps) {
  const next = s.replace(pat, rep);
  if (next === s && pat.source.length < 120) {
    console.warn("no match:", pat.source.slice(0, 70));
    misses++;
  }
  s = next;
}

s = s.replace(/<motion className="overlay">/g, '<div className="overlay">');
s = s.replace(/<motion className="spinner" \/>/g, '<div className="spinner" />');

// typo variants from past fixes
s = s.replaceAll("\uC720\uB9F9", "\uC720\uB9DD"); // 유망 -> 유망
s = s.replaceAll("\uC720\uB9F5", "\uC720\uB9DD"); // 유망 -> 유망
s = s.replaceAll("\uD14C\uB808\uADF8\uB7A8", "\uD154\uB808\uADF8\uB7A8"); // 텔레그램 -> 텔레그램

fs.writeFileSync(p, s, "utf8");

const bad = (s.match(/\?{2,}/g) || []).filter(
  (m, i, arr) => {
    const idx = s.indexOf(m, i > 0 ? s.indexOf(arr[i - 1]) + 1 : 0);
    const ctx = s.slice(Math.max(0, idx - 20), idx + 30);
    return !ctx.includes("??") || !/\?\? [a-zA-Z]/.test(ctx);
  },
);

// count suspicious ?? in strings (not ?? operator)
const stringBads = [...s.matchAll(/"[^"]*\?{2,}[^"]*"/g)].map((m) => m[0]);
console.log("done, string issues:", stringBads.length);
for (const x of stringBads.slice(0, 15)) console.log(" ", x);
