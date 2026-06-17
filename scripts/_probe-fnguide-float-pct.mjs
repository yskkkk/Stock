const code = "035250";
const html = await (
  await fetch(`https://comp.fnguide.com/SVO2/ASP/SVD_Main.asp?gicode=A${code}`, {
    headers: { "User-Agent": "Mozilla/5.0" },
  })
).text();

// all 유동주식 matches
let idx = 0;
let n = 0;
while ((idx = html.indexOf("유동주식", idx)) !== -1 && n < 15) {
  console.log(n, html.slice(idx, idx + 150).replace(/\s+/g, " "));
  idx++;
  n++;
}

const re = /유동주식수\/비율<\/a>[\s\S]*?<td class="r">([\d,]+)\s*\/\s*([\d.]+)/g;
let m;
while ((m = re.exec(html))) console.log(m[1], m[2]);
