const YAHOO_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const YAHOO_FETCH_TIMEOUT_MS = (() => {
  const n = Number(process.env.YAHOO_FETCH_TIMEOUT_MS ?? 20_000);
  return Number.isFinite(n) && n >= 5_000 ? Math.min(n, 60_000) : 20_000;
})();

const YAHOO_HOSTS = [
  "https://query2.finance.yahoo.com",
  "https://query1.finance.yahoo.com",
];

let yahooSession = null;

export function getYahooSessionRef() {
  return yahooSession;
}

export function clearYahooSession() {
  yahooSession = null;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * @param {Response} res
 * @param {string} text
 */
function throwIfRateLimited(res, text) {
  if (!(/too many requests/i.test(text) || res.status === 429)) return;
  const retryAfter = res.headers.get("retry-after");
  let retryAfterMs = 12_000;
  if (retryAfter) {
    const sec = Number(retryAfter);
    if (Number.isFinite(sec) && sec > 0) {
      retryAfterMs = Math.min(120_000, Math.max(3_000, sec * 1000));
    } else {
      const when = Date.parse(retryAfter);
      if (Number.isFinite(when)) {
        retryAfterMs = Math.min(120_000, Math.max(3_000, when - Date.now()));
      }
    }
  }
  const err = new Error("rate");
  err.code = "RATE_LIMIT";
  err.retryAfterMs = retryAfterMs;
  throw err;
}

/**
 * @param {string} url
 * @param {RequestInit} [init]
 */
async function yahooFetch(url, init = {}) {
  const res = await fetch(url, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(YAHOO_FETCH_TIMEOUT_MS),
  });
  const text = await res.text();
  throwIfRateLimited(res, text);
  return { res, text };
}

export async function getYahooSession() {
  if (yahooSession && Date.now() < yahooSession.expires) {
    return yahooSession;
  }

  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const consentRes = await fetch("https://fc.yahoo.com/", {
        headers: { "User-Agent": YAHOO_UA },
        redirect: "follow",
        signal: AbortSignal.timeout(YAHOO_FETCH_TIMEOUT_MS),
      });
      const rawCookies =
        typeof consentRes.headers.getSetCookie === "function"
          ? consentRes.headers.getSetCookie()
          : [];
      const cookie = rawCookies.map((c) => c.split(";")[0]).join("; ");

      let crumb = "";
      let crumbOk = false;
      for (const host of YAHOO_HOSTS) {
        try {
          const { res, text } = await yahooFetch(`${host}/v1/test/getcrumb`, {
            headers: { "User-Agent": YAHOO_UA, Cookie: cookie },
          });
          crumb = text.trim();
          if (crumb && !crumb.includes("<") && !crumb.startsWith("{") && res.ok) {
            crumbOk = true;
            break;
          }
        } catch (e) {
          lastErr = e;
          if (e?.code === "RATE_LIMIT") throw e;
        }
      }
      if (!crumbOk) {
        throw lastErr instanceof Error ? lastErr : new Error("Yahoo session");
      }

      yahooSession = { cookie, crumb, expires: Date.now() + 60 * 60_000 };
      return yahooSession;
    } catch (e) {
      lastErr = e;
      if (e?.code === "RATE_LIMIT") throw e;
      yahooSession = null;
      if (attempt + 1 < 3) await sleep(400 * (attempt + 1));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Yahoo session");
}

/**
 * @param {string} path
 * @param {{ allowHostFallback?: boolean }} [opts]
 */
export async function yahooGet(path, opts = {}) {
  const allowHostFallback = opts.allowHostFallback !== false;
  let lastErr;
  const hosts = allowHostFallback ? YAHOO_HOSTS : [YAHOO_HOSTS[0]];
  for (let hi = 0; hi < hosts.length; hi++) {
    try {
      const session = await getYahooSession();
      const sep = path.includes("?") ? "&" : "?";
      const url = `${hosts[hi]}${path}${sep}crumb=${encodeURIComponent(session.crumb)}`;
      const { text } = await yahooFetch(url, {
        headers: { "User-Agent": YAHOO_UA, Cookie: session.cookie },
      });
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error("Yahoo response parse error");
      }
      return data;
    } catch (e) {
      lastErr = e;
      if (e?.code === "RATE_LIMIT") throw e;
      const msg = String(e?.message ?? "").toLowerCase();
      if (
        /parse error|unauthorized|invalid|forbidden|yahoo session/.test(msg)
      ) {
        clearYahooSession();
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Yahoo request failed");
}

export async function yahooPost(path, body) {
  let lastErr;
  for (const host of YAHOO_HOSTS) {
    try {
      const session = await getYahooSession();
      const url = `${host}${path}?crumb=${encodeURIComponent(session.crumb)}`;
      const { text } = await yahooFetch(url, {
        method: "POST",
        headers: {
          "User-Agent": YAHOO_UA,
          Cookie: session.cookie,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      try {
        return JSON.parse(text);
      } catch {
        throw new Error("Yahoo response parse error");
      }
    } catch (e) {
      lastErr = e;
      if (e?.code === "RATE_LIMIT") throw e;
      clearYahooSession();
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Yahoo request failed");
}

export { YAHOO_UA };
