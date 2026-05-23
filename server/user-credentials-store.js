/**
 * 사용자별 거래소 API (BYOK) — server/.data/user-exchange-credentials.json
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  decryptSecret,
  encryptSecret,
  isCredentialsCryptoReady,
} from "./credentials-crypto.js";
import { summarizeBithumbAccountsForDisplay } from "./bithumb-accounts-summary.js";
import {
  fetchBithumbAccountsWithCredentials,
  getBithumbTradingStatusFromCredentials,
} from "./bithumb-trading-adapter.js";
import { getTossTradingStatus } from "./toss-trading-adapter.js";
import { validateBithumbCredentialPair } from "./stock-input-validation.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, ".data");
const CREDS_FILE = path.join(DATA_DIR, "user-exchange-credentials.json");

/** @typedef {"bithumb" | "toss"} ExchangeId */

function ensureDirSync() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function defaultStore() {
  return { credentials: [] };
}

function readStoreSync() {
  try {
    if (!fs.existsSync(CREDS_FILE)) return defaultStore();
    const o = JSON.parse(fs.readFileSync(CREDS_FILE, "utf8"));
    if (!o || typeof o !== "object" || !Array.isArray(o.credentials)) {
      return defaultStore();
    }
    return { credentials: o.credentials.filter(Boolean) };
  } catch {
    return defaultStore();
  }
}

function writeStoreSync(store) {
  ensureDirSync();
  fs.writeFileSync(CREDS_FILE, JSON.stringify(store, null, 0), "utf8");
}

/** @param {unknown} ex */
function normalizeExchange(ex) {
  const e = String(ex ?? "").trim().toLowerCase();
  if (e === "bithumb" || e === "toss") return /** @type {ExchangeId} */ (e);
  return null;
}

/**
 * @param {string} userId
 * @param {ExchangeId} exchange
 */
function findRowSync(userId, exchange) {
  const uid = String(userId ?? "").trim();
  return (
    readStoreSync().credentials.find(
      (c) => c.userId === uid && c.exchange === exchange,
    ) ?? null
  );
}

/**
 * @param {string} userId
 * @param {ExchangeId} exchange
 */
export function getCredentialMetaSync(userId, exchange) {
  const row = findRowSync(userId, exchange);
  if (!row) {
    if (exchange === "toss") {
      const env = getTossTradingStatus();
      return {
        exchange,
        configured: env.configured,
        ready: env.ready,
        liveOrdersEnabled: process.env.TOSS_LIVE_ORDERS_ENABLED === "1",
        hasSecret: env.hasSecret,
        messageKo: env.messageKo,
        source: env.configured ? "env" : "none",
      };
    }
    return {
      exchange,
      configured: false,
      ready: false,
      liveOrdersEnabled: false,
      hasSecret: false,
      messageKo:
        "API 키가 등록되지 않았습니다. 아래 «내 API 연동»에서 키를 저장하세요.",
      source: "none",
    };
  }
  const hasKey = Boolean(row.apiKeyEncrypted);
  const hasSecret = Boolean(row.secretEncrypted);
  const configured = hasKey;
  const ready = configured && hasSecret;
  let messageKo = "API Key만 저장되어 있습니다. Secret Key를 함께 저장하세요.";
  if (ready) {
    messageKo = row.liveOrdersEnabled
      ? "연동됨 · 거래소 실주문 허용"
      : "연동됨 · 거래소 실주문 차단(앱 시뮬은 프로그램에서 실행)";
  } else if (!configured) {
    messageKo = "API 키를 저장하세요.";
  }
  return {
    exchange,
    configured,
    ready,
    liveOrdersEnabled: Boolean(row.liveOrdersEnabled),
    hasSecret,
    messageKo,
    source: "user",
    updatedAtMs: row.updatedAtMs ?? null,
  };
}

/**
 * @param {string} userId
 */
export function listCredentialMetaForUserSync(userId) {
  return {
    bithumb: getCredentialMetaSync(userId, "bithumb"),
    toss: getCredentialMetaSync(userId, "toss"),
    cryptoReady: isCredentialsCryptoReady(),
  };
}

/**
 * @param {string} userId
 * @param {ExchangeId} exchange
 * @returns {{ apiKey: string; secretKey: string; liveOrdersEnabled: boolean } | null}
 */
export function getDecryptedCredentialsSync(userId, exchange) {
  if (!isCredentialsCryptoReady()) return null;
  const row = findRowSync(userId, exchange);
  if (!row?.apiKeyEncrypted || !row?.secretEncrypted) return null;
  try {
    return {
      apiKey: decryptSecret(row.apiKeyEncrypted),
      secretKey: decryptSecret(row.secretEncrypted),
      liveOrdersEnabled: Boolean(row.liveOrdersEnabled),
    };
  } catch (e) {
    console.error(
      `[credentials] ${exchange} API 키 복호화 실패 (userId=${userId}):`,
      e instanceof Error ? e.message : e,
      "— CREDENTIALS_MASTER_KEY가 변경되었거나 데이터가 손상되었습니다.",
    );
    return null;
  }
}

/**
 * @param {string} userId
 * @param {ExchangeId} exchange
 * @param {{
 *   apiKey?: string;
 *   secretKey?: string;
 *   liveOrdersEnabled?: boolean;
 * }} input
 */
export function upsertUserCredentialSync(userId, exchange, input) {
  if (!isCredentialsCryptoReady()) {
    throw new Error(
      "CREDENTIALS_MASTER_KEY가 없어 API 키를 저장할 수 없습니다.",
    );
  }
  const uid = String(userId ?? "").trim();
  const ex = normalizeExchange(exchange);
  if (!uid || !ex) throw new Error("잘못된 요청입니다.");

  const store = readStoreSync();
  const idx = store.credentials.findIndex(
    (c) => c.userId === uid && c.exchange === ex,
  );
  const prev = idx >= 0 ? store.credentials[idx] : null;

  const keyProvided = Object.prototype.hasOwnProperty.call(input, "apiKey");
  const secProvided = Object.prototype.hasOwnProperty.call(input, "secretKey");
  const keyIn = keyProvided ? String(input.apiKey ?? "").trim() : "";
  const secIn = secProvided ? String(input.secretKey ?? "").trim() : "";
  const ordersOnly =
    input.liveOrdersEnabled !== undefined &&
    !keyIn &&
    !secIn &&
    Boolean(prev?.apiKeyEncrypted && prev?.secretEncrypted);

  let apiKey = keyIn;
  let secretRaw = secIn;

  if (!ordersOnly) {
    const pairCheck = validateBithumbCredentialPair(keyIn, secIn, {
      configured: Boolean(prev?.apiKeyEncrypted),
    });
    if (!pairCheck.ok) {
      throw new Error(pairCheck.error);
    }
    apiKey = pairCheck.value.apiKey;
    secretRaw = pairCheck.value.secretKey;
  }

  const apiKeyEncrypted = apiKey
    ? encryptSecret(apiKey)
    : prev?.apiKeyEncrypted ?? "";
  if (!apiKeyEncrypted) {
    throw new Error("API Key가 필요합니다.");
  }

  const secretEncrypted =
    secretRaw.length > 0
      ? encryptSecret(secretRaw)
      : prev?.secretEncrypted ?? "";
  if (!secretEncrypted) {
    throw new Error("Secret Key가 필요합니다.");
  }

  const row = {
    id: prev?.id ?? randomUUID(),
    userId: uid,
    exchange: ex,
    apiKeyEncrypted,
    secretEncrypted,
    liveOrdersEnabled:
      input.liveOrdersEnabled === undefined
        ? Boolean(prev?.liveOrdersEnabled)
        : Boolean(input.liveOrdersEnabled),
    updatedAtMs: Date.now(),
  };
  if (idx >= 0) store.credentials[idx] = row;
  else store.credentials.push(row);
  writeStoreSync(store);
  return getCredentialMetaSync(uid, ex);
}

/**
 * @param {string} userId
 * @param {ExchangeId} exchange
 */
export function deleteUserCredentialSync(userId, exchange) {
  const uid = String(userId ?? "").trim();
  const ex = normalizeExchange(exchange);
  if (!uid || !ex) throw new Error("잘못된 요청입니다.");
  const store = readStoreSync();
  const before = store.credentials.length;
  store.credentials = store.credentials.filter(
    (c) => !(c.userId === uid && c.exchange === ex),
  );
  if (store.credentials.length === before) {
    throw new Error("저장된 API 키가 없습니다.");
  }
  writeStoreSync(store);
  return { ok: true };
}

/**
 * @param {string} userId
 * @param {ExchangeId} exchange
 * @param {{ apiKey?: string; secretKey?: string } | null} [inline]
 */
export async function testUserCredentialAsync(userId, exchange, inline = null) {
  const ex = normalizeExchange(exchange);
  if (!ex) throw new Error("지원하지 않는 거래소입니다.");

  if (ex === "bithumb") {
    let creds = null;
    if (inline?.apiKey || inline?.secretKey) {
      const pairCheck = validateBithumbCredentialPair(
        inline?.apiKey ?? "",
        inline?.secretKey ?? "",
        { configured: false },
      );
      if (!pairCheck.ok) {
        throw new Error(pairCheck.error);
      }
      creds = {
        apiKey: pairCheck.value.apiKey,
        secretKey: pairCheck.value.secretKey,
        liveOrdersEnabled: false,
      };
    } else {
      creds = getDecryptedCredentialsSync(userId, "bithumb");
    }
    if (!creds?.apiKey || !creds?.secretKey) {
      throw new Error("빗썸 API Key·Secret Key를 입력하거나 저장하세요.");
    }
    const status = getBithumbTradingStatusFromCredentials(creds);
    if (!status.ready) {
      throw new Error(status.messageKo);
    }
    const accounts = await fetchBithumbAccountsWithCredentials(creds);
    const bithumbSnapshot = summarizeBithumbAccountsForDisplay(accounts);
    const holdingCount = bithumbSnapshot.holdings.length;
    return {
      ok: true,
      exchange: "bithumb",
      accountCount: accounts.length,
      bithumbSnapshot,
      messageKo: `빗썸 연결 성공 (계좌 ${accounts.length}건 · 보유 코인 ${holdingCount}종)`,
    };
  }

  if (ex === "toss") {
    const meta = getCredentialMetaSync(userId, "toss");
    if (inline?.apiKey) {
      return {
        ok: true,
        exchange: "toss",
        messageKo:
          "토스 BYOK 주문 연동은 다음 단계에서 제공됩니다. 키 저장은 가능합니다.",
      };
    }
    if (meta.source === "user" && meta.ready) {
      return {
        ok: true,
        exchange: "toss",
        messageKo: "저장된 토스 키가 있습니다. (주문 BYOK는 추후)",
      };
    }
    const env = getTossTradingStatus();
    if (env.ready) {
      return {
        ok: true,
        exchange: "toss",
        messageKo: "서버 .env 토스 설정으로 연결 확인됨 (공유 키)",
      };
    }
    throw new Error(
      meta.messageKo ?? "토스 API 키를 저장하거나 서버 .env를 설정하세요.",
    );
  }

  throw new Error("지원하지 않는 거래소입니다.");
}

/**
 * @param {string} userId
 */
export function getBithumbTradingStatusForUserSync(userId) {
  const creds = getDecryptedCredentialsSync(userId, "bithumb");
  if (creds) {
    return getBithumbTradingStatusFromCredentials(creds);
  }
  return getBithumbTradingStatusFromCredentials(null);
}
