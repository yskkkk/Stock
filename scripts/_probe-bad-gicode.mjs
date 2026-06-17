import { yahooSymbolToKrCode } from "../server/kr-naver-quote.js";

const badGicode = `A${"035250.KS"}`;
const res = await fetch(
  `https://comp.fnguide.com/SVO2/ASP/SVD_Main.asp?gicode=${encodeURIComponent(badGicode)}`,
  { headers: { "User-Agent": "Mozilla/5.0" } },
);
const html = await res.text();
const totalM = html.match(
  /발행주식수<span class="csize">\(보통주\/ 우선주\)<\/span><\/div><\/th>\s*<td class="r">([\d,]+)/,
);
const title = html.match(/<title>([^<]+)/)?.[1] ?? "";
console.log("bad gicode", badGicode);
console.log("title", title.slice(0, 100));
console.log("total", totalM?.[1]);
console.log("yahooSymbolToKrCode", yahooSymbolToKrCode("035250.KS"));
