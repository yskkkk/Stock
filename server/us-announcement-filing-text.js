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
 * @param {string | null | undefined} url
 * @param {{ maxChars?: number }} [opts]
 */
export async function fetchEdgarFilingPlainText(url, opts = {}) {
  const u = String(url ?? "").trim();
  if (!u || !/^https?:\/\//i.test(u)) {
    return { ok: false, text: "", error: "bad_url" };
  }
  const maxChars = Math.min(
    80_000,
    Math.max(2_000, Number(opts.maxChars) || 40_000),
  );
  try {
    const res = await fetch(u, {
      headers: {
        "User-Agent": SEC_UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      signal: AbortSignal.timeout(40_000),
    });
    if (!res.ok) {
      return { ok: false, text: "", error: `http_${res.status}` };
    }
    const html = await res.text();
    const text = htmlToPlainText(html).slice(0, maxChars);
    return { ok: Boolean(text), text, error: text ? null : "empty" };
  } catch (e) {
    return {
      ok: false,
      text: "",
      error: e instanceof Error ? e.message : "fetch_fail",
    };
  }
}
