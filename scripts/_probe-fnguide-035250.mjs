const code = "035250";
const html = await (
  await fetch(`https://comp.fnguide.com/SVO2/ASP/SVD_Main.asp?gicode=A${code}`, {
    headers: { "User-Agent": "Mozilla/5.0" },
  })
).text();

const oldM = html.match(
  /발행주식수<span class="csize">\(보통주[^"]*"[\s\S]*?<td class="r">([\d,]+)/,
);
const newM = html.match(
  /발행주식수<span class="csize">\(보통주\/ 우선주\)<\/span><\/div><\/th>\s*<td class="r">([\d,]+)/,
);
console.log("old regex total:", oldM?.[1]);
console.log("new regex total:", newM?.[1]);

const floatM = html.match(
  /유동주식수\/비율<\/a>[\s\S]*?<td class="r">([\d,]+)\s*\/\s*([\d.]+)/,
);
console.log("float:", floatM?.[1], "pct:", floatM?.[2]);
if (floatM) {
  const f = Number(floatM[1].replace(/,/g, ""));
  const p = Number(floatM[2]);
  console.log("derived index from float/pct:", Math.round(f / (p / 100)));
}

// find all 발행주식수 occurrences
let idx = 0;
let n = 0;
while ((idx = html.indexOf("발행주식수", idx)) !== -1 && n < 10) {
  console.log("occurrence", n, html.slice(idx, idx + 200).replace(/\s+/g, " "));
  idx++;
  n++;
}
