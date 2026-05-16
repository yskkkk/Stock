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

const fixes = [
  [
    'title="?? {ko.app.telegram} {ko.app.tabBullish} ???"',
    "title={ko.app.telegramResetAria}",
  ],
  [
    'aria-label="?? {ko.app.telegram} {ko.app.tabBullish} ???"',
    "aria-label={ko.app.telegramResetAria}",
  ],
  [
    `            onClick={() => setAppTab("screener")}
          >
            {ko.app.telegram}
          </button>`,
    `            onClick={() => setAppTab("screener")}
          >
            {ko.app.tabScreener}
          </button>`,
  ],
  [
    '{rescanning ? "{ko.app.tabBullish}" : "{ko.app.tabBullish}?"}',
    "{rescanning ? ko.app.rescanning : ko.app.rescan}",
  ],
  [
    `<button type="button" className="btn btn--ghost" onClick={pollPicks}>
            {ko.app.tabBullish}
          </button>`,
    `<button type="button" className="btn btn--ghost" onClick={pollPicks}>
            {ko.app.retry}
          </button>`,
  ],
  [
    "<p className=\"placeholder-title\">??? {ko.app.telegram}?</p>",
    "<p className=\"placeholder-title\">{ko.app.selectTitle}</p>",
  ],
  [
    '<span className="tag tag--warn">{ko.app.marketKr}</span>',
    '<span className="tag tag--warn">{ko.app.cacheTag}</span>',
  ],
  [
    "<p>?? {ko.app.telegram} {ko.app.telegram} ?</p>",
    "<p>{ko.app.chartLoading}</p>",
  ],
  [
    `                      onClick={() => loadChart(selected, timeframe, true)}
                    >
                      {ko.app.tabBullish}
                    </button>`,
    `                      onClick={() => loadChart(selected, timeframe, true)}
                    >
                      {ko.app.retry}
                    </button>`,
  ],
  [
    '<p className="chart-empty">?{ko.app.tabBullish}? {ko.app.telegram}.</p>',
    "<p className=\"chart-empty\">{ko.app.chartEmpty}</p>",
  ],
  [
    "err instanceof Error ? err.message : ko.errors.chartLoad,\n      );\n    } finally {\n      if (reqId === newsReqIdRef.current)",
    "err instanceof Error ? err.message : ko.errors.newsLoad,\n      );\n    } finally {\n      if (reqId === newsReqIdRef.current)",
  ],
];

for (const [from, to] of fixes) {
  if (!s.includes(from)) {
    console.warn("skip (not found):", from.slice(0, 60));
    continue;
  }
  s = s.replace(from, to);
}

fs.writeFileSync(appPath, s, "utf8");
console.log("fixed App.tsx");
