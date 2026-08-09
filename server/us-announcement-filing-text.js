/**
 * SEC 공시 HTML → 평문 추출
 */
const SEC_UA =
  String(process.env.SEC_USER_AGENT ?? "").trim() ||
  "YSTOCK AnnouncementInbox contact@ystock.local";

/**
 * @param {string} html
 */
export function htmlToPlainText(html) {
  let s = String(html ?? "");
  s = s.replace(/<script[\s\S]*?<\/script>/gi, " ");
  s = s.replace(/<style[\s\S]*?<\/style>/gi, " ");
  // 단락·줄바꿈 보존
  s = s.replace(/<(?:br|BR)\s*\/?>/g, "\n");
  s = s.replace(/<\/(?:p|div|tr|li|h[1-6]|table|section|article)[^>]*>/gi, "\n\n");
  s = s.replace(/<[^>]+>/g, " ");
  s = s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => {
      const code = Number(n);
      return Number.isFinite(code) ? String.fromCharCode(code) : " ";
    });
  s = s
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return s;
}

/**
 * 폴더 index HTML에서 본문 .htm 후보 고르기
 * @param {string} html
 * @param {string} baseUrl
 */
export function pickPrimaryDocFromIndexHtml(html, baseUrl) {
  const hrefs = [
    ...String(html ?? "").matchAll(/href=["']([^"']+\.htm[l]?)["']/gi),
  ].map((m) => String(m[1] ?? "").trim());
  if (!hrefs.length) return null;
  const scored = hrefs
    .map((h) => {
      const name = h.split("/").pop() || h;
      let score = 0;
      if (/ex\d|exhibit|xsl|index|cover|r\d+\.htm/i.test(name)) score -= 5;
      if (/\d{8}|\d{6}|8-k|10-q|10-k|defa?14/i.test(name)) score += 3;
      if (/\.htm$/i.test(name)) score += 1;
      return { href: h, score };
    })
    .sort((a, b) => b.score - a.score);
  const best = scored[0]?.href;
  if (!best) return null;
  try {
    return new URL(best, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`).href;
  } catch {
    return null;
  }
}

/**
 * @param {string} url
 * @param {number} timeoutMs
 */
async function fetchSecHtml(url, timeoutMs) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": SEC_UA,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  return res;
}

/**
 * @param {string | null | undefined} url
 * @param {{ maxChars?: number }} [opts]
 */
export async function fetchEdgarFilingPlainText(url, opts = {}) {
  let u = String(url ?? "").trim();
  if (!u || !/^https?:\/\//i.test(u)) {
    return { ok: false, text: "", error: "bad_url" };
  }
  if (/\.pdf(\?|$)/i.test(u)) {
    return { ok: false, text: "", error: "pdf_unsupported" };
  }
  const maxChars = Math.min(
    80_000,
    Math.max(2_000, Number(opts.maxChars) || 40_000),
  );
  const timeoutMs = 45_000;

  /** @param {string} target */
  const tryOnce = async (target) => {
    const res = await fetchSecHtml(target, timeoutMs);
    if (!res.ok) {
      return { ok: false, text: "", error: `http_${res.status}`, html: "" };
    }
    const html = await res.text();
    // 디렉터리 인덱스면 본문 htm으로 한 번 더
    const looksLikeIndex =
      /Directory Listing|edgar\/data/i.test(html) &&
      !/Item\s+2\.02|CONSOLIDATED|FORM\s+10-|FORM\s+8-K/i.test(html.slice(0, 4000));
    if (looksLikeIndex || /\/$/.test(target)) {
      const primary = pickPrimaryDocFromIndexHtml(html, target);
      if (primary && primary !== target && !/\.pdf(\?|$)/i.test(primary)) {
        const nested = await fetchSecHtml(primary, timeoutMs);
        if (nested.ok) {
          const nestedHtml = await nested.text();
          const text = htmlToPlainText(nestedHtml).slice(0, maxChars);
          return {
            ok: Boolean(text),
            text,
            error: text ? null : "empty",
            html: nestedHtml,
          };
        }
      }
    }
    const text = htmlToPlainText(html).slice(0, maxChars);
    return {
      ok: Boolean(text),
      text,
      error: text ? null : "empty",
      html,
    };
  };

  try {
    let result = await tryOnce(u);
    if (!result.ok) {
      await new Promise((r) => setTimeout(r, 400));
      result = await tryOnce(u);
    }
    return {
      ok: result.ok,
      text: result.text,
      error: result.error,
    };
  } catch (e) {
    try {
      await new Promise((r) => setTimeout(r, 500));
      const retry = await tryOnce(u);
      return {
        ok: retry.ok,
        text: retry.text,
        error: retry.error,
      };
    } catch (e2) {
      return {
        ok: false,
        text: "",
        error: e2 instanceof Error ? e2.message : "fetch_fail",
      };
    }
  }
}
