const YAHOO_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

let yahooSession = null;

export function getYahooSessionRef() {
  return yahooSession;
}

export function clearYahooSession() {
  yahooSession = null;
}

export async function getYahooSession() {
  if (yahooSession && Date.now() < yahooSession.expires) {
    return yahooSession;
  }

  const consentRes = await fetch("https://fc.yahoo.com/", {
    headers: { "User-Agent": YAHOO_UA },
    redirect: "follow",
  });
  const rawCookies =
    typeof consentRes.headers.getSetCookie === "function"
      ? consentRes.headers.getSetCookie()
      : [];
  const cookie = rawCookies.map((c) => c.split(";")[0]).join("; ");

  const crumbRes = await fetch(
    "https://query2.finance.yahoo.com/v1/test/getcrumb",
    { headers: { "User-Agent": YAHOO_UA, Cookie: cookie } },
  );
  const crumb = (await crumbRes.text()).trim();
  if (!crumb || crumb.includes("<") || crumb.startsWith("{")) {
    throw new Error("Yahoo session");
  }

  yahooSession = { cookie, crumb, expires: Date.now() + 60 * 60_000 };
  return yahooSession;
}

export async function yahooGet(path) {
  const session = await getYahooSession();
  const sep = path.includes("?") ? "&" : "?";
  const url =
    `https://query2.finance.yahoo.com${path}${sep}crumb=${encodeURIComponent(session.crumb)}`;
  const res = await fetch(url, {
    headers: { "User-Agent": YAHOO_UA, Cookie: session.cookie },
  });
  const text = await res.text();
  if (/too many requests/i.test(text) || res.status === 429) {
    const err = new Error("rate");
    err.code = "RATE_LIMIT";
    throw err;
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Yahoo response parse error");
  }
  return data;
}

export async function yahooPost(path, body) {
  const session = await getYahooSession();
  const url =
    `https://query2.finance.yahoo.com${path}?crumb=${encodeURIComponent(session.crumb)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "User-Agent": YAHOO_UA,
      Cookie: session.cookie,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (/too many requests/i.test(text) || res.status === 429) {
    const err = new Error("rate");
    err.code = "RATE_LIMIT";
    throw err;
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Yahoo response parse error");
  }
}

export { YAHOO_UA };
