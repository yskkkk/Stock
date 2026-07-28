import fs from "node:fs";

const ko = fs.readFileSync("src/i18n/ko.ts", "utf8");
const m = ko.match(/accountManageRawSummary:\s*"([^"]+)"/);
console.log("rawSummary:", m?.[1]);
console.log(
  "codepoints:",
  [...(m?.[1] ?? "")].map((c) => c.codePointAt(0).toString(16)).join(" "),
);

const tab = fs.readFileSync("src/components/AccountManageTab.tsx", "utf8");
console.log("uses RawSummary:", tab.includes("accountManageRawSummary"));
console.log("literal ?? span:", /<span>\?\?<\/span>/.test(tab));
console.log("literal summary ???:", /<summary>\?\?/.test(tab));

const uiQ = [...tab.matchAll(/>([^<>{}]*\?{2,}[^<>{}]*)</g)].map((x) => x[1]);
console.log("ui ?? literals:", uiQ);
