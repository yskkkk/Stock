/**
 * 토스증권 Open API — OAuth2 + 계좌·보유 조회
 * @see https://openapi.tossinvest.com/openapi-docs/overview.md
 */

const DEFAULT_BASE = "https://openapi.tossinvest.com";

/** @type {Map<string, { accessToken: string; expiresAtMs: number }>} */
const tokenCache = new Map();

export function tossOpenApiBaseUrl() {
  const raw = String(process.env.TOSS_API_BASE_URL ?? DEFAULT_BASE).trim();
  return raw || DEFAULT_BASE;
}

/** @param {unknown} v */
export function parseTossDecimal(v) {
  if (v == null || v === "") return 0;
  const n = Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/**
 * @typedef {{
 *   apiKey: string;
 *   secretKey: string;
 *   accountId?: string;
 * }} TossOpenApiCredentials
 */

/**
 * @param {string} clientId
 * @param {string} clientSecret
 */
export async function issueTossAccessToken(clientId, clientSecret) {
  const id = String(clientId ?? "").trim();
  const secret = String(clientSecret ?? "").trim();
  if (!id || !secret) {
    throw new Error("토스 client_id·client_secret(API Key·Secret)가 필요합니다.");
  }

  const cached = tokenCache.get(id);
  if (cached && cached.expiresAtMs > Date.now() + 60_000) {
    return cached.accessToken;
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: id,
    client_secret: secret,
  });

  const res = await fetch(`${tossOpenApiBaseUrl()}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(30_000),
  });

  const text = await res.text();
  /** @type {Record<string, unknown>} */
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = {};
  }

  if (!res.ok) {
    const err =
      typeof json.error_description === "string"
        ? json.error_description
        : typeof json.error === "string"
          ? json.error
          : `토스 토큰 발급 실패 HTTP ${res.status}`;
    throw new Error(err);
  }

  const accessToken = String(json.access_token ?? "").trim();
  if (!accessToken) {
    throw new Error("토스 access token을 받지 못했습니다.");
  }

  const expiresIn = Number(json.expires_in);
  const ttlMs =
    Number.isFinite(expiresIn) && expiresIn > 120
      ? (expiresIn - 60) * 1000
      : 23 * 60 * 60 * 1000;
  tokenCache.set(id, { accessToken, expiresAtMs: Date.now() + ttlMs });
  return accessToken;
}

/**
 * @param {string} accessToken
 * @param {string | null | undefined} preferredAccountId
 */
export async function resolveTossAccountSeq(accessToken, preferredAccountId) {
  const pref = String(preferredAccountId ?? "").trim();
  if (pref) return pref;
  const accounts = await fetchTossAccountsList(accessToken);
  if (!accounts.length) {
    throw new Error("토스 종합매매 계좌가 없습니다.");
  }
  const accountSeq = String(accounts[0]?.accountSeq ?? "").trim();
  if (!accountSeq) {
    throw new Error("토스 accountSeq를 확인할 수 없습니다.");
  }
  return accountSeq;
}

/**
 * @param {string} accessToken
 * @param {string | null | undefined} accountSeq
 * @param {string} path
 * @param {Record<string, string>} [query]
 */
export async function tossOpenApiGet(accessToken, accountSeq, path, query) {
  const base = tossOpenApiBaseUrl();
  const url = new URL(path.startsWith("/") ? path : `/${path}`, base);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v != null && String(v).trim() !== "") url.searchParams.set(k, String(v));
    }
  }

  /** @type {Record<string, string>} */
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
  };
  const acct = String(accountSeq ?? "").trim();
  if (acct) headers["X-Tossinvest-Account"] = acct;

  const res = await fetch(url, {
    method: "GET",
    headers,
    signal: AbortSignal.timeout(30_000),
  });

  const text = await res.text();
  /** @type {Record<string, unknown>} */
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = {};
  }

  if (!res.ok) {
    throw new Error(formatTossOpenApiError(json, res.status));
  }

  return json;
}

/**
 * @param {unknown} json
 * @param {number} [httpStatus]
 */
export function formatTossOpenApiError(json, httpStatus) {
  const errObj =
    json && typeof json === "object" && json.error && typeof json.error === "object"
      ? json.error
      : null;
  const base =
    (errObj && typeof errObj.message === "string" && errObj.message) ||
    (json && typeof json === "object" && typeof json.message === "string" && json.message) ||
    `토스 API 오류 HTTP ${httpStatus ?? "?"}`;
  const data =
    errObj && errObj.data && typeof errObj.data === "object" ? errObj.data : null;
  const field = data && typeof data.field === "string" ? data.field.trim() : "";
  if (field) return `${base} (필드: ${field})`;
  return base;
}

/**
 * @param {string} accessToken
 * @param {string | null | undefined} accountSeq
 * @param {string} path
 * @param {unknown} [body]
 */
export async function tossOpenApiPost(accessToken, accountSeq, path, body) {
  const base = tossOpenApiBaseUrl();
  const url = new URL(path.startsWith("/") ? path : `/${path}`, base);

  /** @type {Record<string, string>} */
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  const acct = String(accountSeq ?? "").trim();
  if (acct) headers["X-Tossinvest-Account"] = acct;

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });

  const text = await res.text();
  /** @type {Record<string, unknown>} */
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = {};
  }

  if (!res.ok) {
    const errObj =
      json.error && typeof json.error === "object" ? json.error : null;
    const msg =
      (errObj && typeof errObj.message === "string" && errObj.message) ||
      (typeof json.message === "string" && json.message) ||
      `토스 API 오류 HTTP ${res.status}`;
    throw new Error(msg);
  }

  return json;
}

/**
 * @param {string} accessToken
 */
export async function fetchTossAccountsList(accessToken) {
  const json = await tossOpenApiGet(accessToken, null, "/api/v1/accounts");
  const result = json.result;
  return Array.isArray(result) ? result : [];
}

/**
 * @param {TossOpenApiCredentials} creds
 */
export async function fetchTossAccountRawWithCredentials(creds) {
  const apiKey = String(creds?.apiKey ?? "").trim();
  const secretKey = String(creds?.secretKey ?? "").trim();
  if (!apiKey || !secretKey) {
    throw new Error("토스 API Key·Secret Key를 입력하세요.");
  }

  const accessToken = await issueTossAccessToken(apiKey, secretKey);
  const accountSeq = await resolveTossAccountSeq(accessToken, creds?.accountId);

  const [holdingsJson, bpKrwJson, bpUsdJson] = await Promise.all([
    tossOpenApiGet(accessToken, accountSeq, "/api/v1/holdings"),
    tossOpenApiGet(accessToken, accountSeq, "/api/v1/buying-power", {
      currency: "KRW",
    }).catch(() => null),
    tossOpenApiGet(accessToken, accountSeq, "/api/v1/buying-power", {
      currency: "USD",
    }).catch(() => null),
  ]);

  return {
    accountSeq,
    holdings: holdingsJson?.result ?? null,
    buyingPowerKrw: bpKrwJson?.result ?? null,
    buyingPowerUsd: bpUsdJson?.result ?? null,
  };
}

/**
 * @param {TossOpenApiCredentials} creds
 * @param {"KR"|"US"} [marketCountry]
 */
/**
 * @param {string} accessToken
 * @param {string} accountSeq
 * @param {string} path
 */
export async function tossOpenApiDelete(accessToken, accountSeq, path) {
  const base = tossOpenApiBaseUrl();
  const url = new URL(path.startsWith("/") ? path : `/${path}`, base);

  /** @type {Record<string, string>} */
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
  };
  const acct = String(accountSeq ?? "").trim();
  if (acct) headers["X-Tossinvest-Account"] = acct;

  const res = await fetch(url, {
    method: "DELETE",
    headers,
    signal: AbortSignal.timeout(30_000),
  });

  const text = await res.text();
  /** @type {Record<string, unknown>} */
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = {};
  }

  if (!res.ok) {
    throw new Error(formatTossOpenApiError(json, res.status));
  }

  return json;
}

/**
 * @param {unknown} result
 */
export function parseTossOpenOrdersResult(result) {
  if (Array.isArray(result)) return result;
  if (result && typeof result === "object") {
    if (Array.isArray(result.orders)) return result.orders;
    if (Array.isArray(result.items)) return result.items;
  }
  return [];
}

/**
 * @param {string} accessToken
 * @param {string} accountSeq
 */
export async function fetchTossOpenOrdersRaw(accessToken, accountSeq) {
  const json = await tossOpenApiGet(accessToken, accountSeq, "/api/v1/orders", {
    status: "OPEN",
  });
  return parseTossOpenOrdersResult(json?.result);
}

/**
 * @param {string} accessToken
 * @param {string} accountSeq
 * @param {string} symbol
 * @param {"KR"|"US"} marketCountry
 */
export async function fetchTossSellableQuantityRaw(
  accessToken,
  accountSeq,
  symbol,
  marketCountry,
) {
  const json = await tossOpenApiGet(accessToken, accountSeq, "/api/v1/sellable-quantity", {
    symbol: String(symbol ?? "").trim(),
    marketCountry,
  });
  return json?.result ?? json;
}

/**
 * @param {string} accessToken
 * @param {string} accountSeq
 * @param {string} orderId
 */
export async function cancelTossOrderRaw(accessToken, accountSeq, orderId) {
  const id = String(orderId ?? "").trim();
  if (!id) throw new Error("주문 ID가 필요합니다.");
  return tossOpenApiPost(accessToken, accountSeq, `/api/v1/orders/${encodeURIComponent(id)}/cancel`);
}

export async function fetchTossCommissionsWithCredentials(creds, marketCountry = "KR") {
  const apiKey = String(creds?.apiKey ?? "").trim();
  const secretKey = String(creds?.secretKey ?? "").trim();
  if (!apiKey || !secretKey) {
    throw new Error("토스 API Key·Secret Key가 필요합니다.");
  }
  const accessToken = await issueTossAccessToken(apiKey, secretKey);
  const accountSeq = await resolveTossAccountSeq(accessToken, creds?.accountId);
  const json = await tossOpenApiGet(accessToken, accountSeq, "/api/v1/commissions", {
    marketCountry,
  });
  return { accountSeq, result: json?.result ?? json };
}
