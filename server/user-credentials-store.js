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
import {
  enrichBithumbSnapshotWithMarketQuotes,
  summarizeBithumbAccountsForDisplay,
} from "./bithumb-accounts-summary.js";
import { roundTripFeeRateFromOneWay } from "./net-return.js";
import {
  fetchBithumbAccountsWithCredentials,
  fetchBithumbOrderChanceWithCredentials,
  getBithumbTradingStatusFromCredentials,
} from "./bithumb-trading-adapter.js";
import { getTossTradingStatus } from "./toss-trading-adapter.js";
import {
  validateBithumbCredentialPair,
  validateTossCredentialSet,
} from "./stock-input-validation.js";

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
  const tmp = CREDS_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(store, null, 0), "utf8");
  fs.renameSync(tmp, CREDS_FILE);
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
export function readCredentialRowSync(userId, exchange) {
  return findRowSync(userId, exchange);
}

/**
 * @param {string} userId
 * @param {{
 *   bidFee: number;
 *   askFee: number;
 *   roundTripFeeRate: number;
 *   market?: string;
 * }} fees
 */
export function writeBithumbFeesOnRowSync(userId, fees) {
  const uid = String(userId ?? "").trim();
  if (!uid) return;
  const store = readStoreSync();
  const idx = store.credentials.findIndex(
    (c) => c.userId === uid && c.exchange === "bithumb",
  );
  if (idx < 0) return;
  const prev = store.credentials[idx];
  store.credentials[idx] = {
    ...prev,
    bithumbBidFee: fees.bidFee,
    bithumbAskFee: fees.askFee,
    bithumbFeeMarket: fees.market ?? prev.bithumbFeeMarket ?? "KRW-BTC",
    bithumbFeesAtMs: Date.now(),
    updatedAtMs: Date.now(),
  };
  writeStoreSync(store);
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
  const hasAccount = Boolean(row.accountIdEncrypted);
  const configured = hasKey;
  const ready =
    exchange === "toss"
      ? configured && hasSecret && hasAccount
      : configured && hasSecret;
  let messageKo = "API Key만 저장되어 있습니다. Secret Key를 함께 저장하세요.";
  if (exchange === "toss") {
    if (ready) {
      messageKo = "토스 연동됨 · 실주문은 «토스 실매매 시작» 프로그램에서 실행";
    } else if (configured && hasSecret && !hasAccount) {
      messageKo = "API Key·Secret은 저장됐습니다. 계좌 번호를 저장하세요.";
    } else if (!configured) {
      messageKo = "토스 API Key·Secret Key·계좌 번호를 저장하세요.";
    }
  } else if (ready) {
    messageKo = "연동됨 · 실주문은 «빗썸 실매매 시작» 프로그램에서 실행";
  } else if (!configured) {
    messageKo = "API 키를 저장하세요.";
  }
  return {
    exchange,
    configured,
    ready,
    liveOrdersEnabled: Boolean(row.liveOrdersEnabled),
    hasSecret,
    hasAccount,
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
    /** @type {{ apiKey: string; secretKey: string; liveOrdersEnabled: boolean; accountId?: string }} */
    const out = {
      apiKey: decryptSecret(row.apiKeyEncrypted),
      secretKey: decryptSecret(row.secretEncrypted),
      liveOrdersEnabled: true,
    };
    if (row.accountIdEncrypted) {
      out.accountId = decryptSecret(row.accountIdEncrypted);
    }
    return out;
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
 *   accountId?: string;
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
  const acctProvided = Object.prototype.hasOwnProperty.call(input, "accountId");
  const keyIn = keyProvided ? String(input.apiKey ?? "").trim() : "";
  const secIn = secProvided ? String(input.secretKey ?? "").trim() : "";
  const acctIn = acctProvided ? String(input.accountId ?? "").trim() : "";
  const ordersOnly =
    input.liveOrdersEnabled !== undefined &&
    !keyIn &&
    !secIn &&
    !acctIn &&
    Boolean(prev?.apiKeyEncrypted && prev?.secretEncrypted);

  let apiKey = keyIn;
  let secretRaw = secIn;
  let accountRaw = acctIn;

  if (!ordersOnly) {
    if (ex === "toss") {
      const tossCheck = validateTossCredentialSet(keyIn, secIn, acctIn, {
        configured: Boolean(prev?.apiKeyEncrypted),
      });
      if (!tossCheck.ok) {
        throw new Error(tossCheck.error);
      }
      apiKey = tossCheck.value.apiKey;
      secretRaw = tossCheck.value.secretKey;
      accountRaw = tossCheck.value.accountId;
    } else {
      const pairCheck = validateBithumbCredentialPair(keyIn, secIn, {
        configured: Boolean(prev?.apiKeyEncrypted),
      });
      if (!pairCheck.ok) {
        throw new Error(pairCheck.error);
      }
      apiKey = pairCheck.value.apiKey;
      secretRaw = pairCheck.value.secretKey;
    }
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

  const accountIdEncrypted =
    accountRaw.length > 0
      ? encryptSecret(accountRaw)
      : prev?.accountIdEncrypted ?? "";
  if (ex === "toss" && !accountIdEncrypted) {
    throw new Error("계좌 번호가 필요합니다.");
  }

  const row = {
    id: prev?.id ?? randomUUID(),
    userId: uid,
    exchange: ex,
    apiKeyEncrypted,
    secretEncrypted,
    accountIdEncrypted: ex === "toss" ? accountIdEncrypted : prev?.accountIdEncrypted ?? "",
    liveOrdersEnabled: true,
    updatedAtMs: Date.now(),
  };
  if (idx >= 0) store.credentials[idx] = row;
  else store.credentials.push(row);
  writeStoreSync(store);
  if (ex === "bithumb" && row.apiKeyEncrypted && row.secretEncrypted) {
    void import("./exchange-trading-fees.js")
      .then((m) => m.refreshBithumbFeesForUserAsync(uid))
      .catch((e) => {
        console.warn("[credentials] 빗썸 수수료 갱신 실패:", e instanceof Error ? e.message : e);
      });
  }
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
 * @param {{ apiKey?: string; secretKey?: string; accountId?: string } | null} [inline]
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
    const bithumbSnapshot = await enrichBithumbSnapshotWithMarketQuotes(
      summarizeBithumbAccountsForDisplay(accounts),
    );
    const holdingCount = bithumbSnapshot.holdings.length;
    let tradingFees = null;
    try {
      if (inline?.apiKey || inline?.secretKey) {
        const chance = await fetchBithumbOrderChanceWithCredentials(creds);
        const roundTrip = roundTripFeeRateFromOneWay(
          chance?.bid_fee,
          chance?.ask_fee,
        );
        if (roundTrip != null) {
          tradingFees = {
            bidFee: Number(chance.bid_fee),
            askFee: Number(chance.ask_fee),
            roundTripFeeRate: roundTrip,
          };
        }
      } else {
        const { refreshBithumbFeesForUserAsync } = await import(
          "./exchange-trading-fees.js"
        );
        tradingFees = await refreshBithumbFeesForUserAsync(userId);
      }
    } catch {
      /* 수수료 조회 실패해도 연결 테스트는 성공 */
    }
    const feeNote = tradingFees
      ? ` · 수수료 왕복 ${(tradingFees.roundTripFeeRate * 100).toFixed(3).replace(/\.?0+$/, "")}%`
      : "";
    return {
      ok: true,
      exchange: "bithumb",
      accountCount: accounts.length,
      bithumbSnapshot,
      tradingFees,
      messageKo: `빗썸 연결 성공 (계좌 ${accounts.length}건 · 보유 코인 ${holdingCount}종)${feeNote}`,
    };
  }

  if (ex === "toss") {
    let creds = null;
    if (inline?.apiKey || inline?.secretKey || inline?.accountId) {
      const tossCheck = validateTossCredentialSet(
        inline?.apiKey ?? "",
        inline?.secretKey ?? "",
        inline?.accountId ?? "",
        { configured: false },
      );
      if (!tossCheck.ok) {
        throw new Error(tossCheck.error);
      }
      creds = {
        apiKey: tossCheck.value.apiKey,
        secretKey: tossCheck.value.secretKey,
        accountId: tossCheck.value.accountId,
        liveOrdersEnabled: false,
      };
    } else {
      creds = getDecryptedCredentialsSync(userId, "toss");
    }
    if (creds?.apiKey && creds?.secretKey && creds?.accountId) {
      return {
        ok: true,
        exchange: "toss",
        messageKo: `토스 API 저장 확인 (계좌 ${creds.accountId.slice(0, 4)}···)`,
      };
    }
    const meta = getCredentialMetaSync(userId, "toss");
    if (meta.source === "user" && meta.configured && !meta.ready) {
      throw new Error(meta.messageKo);
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
      meta.messageKo ?? "토스 API Key·Secret Key·계좌 번호를 입력하거나 저장하세요.",
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

/**
 * 좌측 레일·계좌 요약 — 빗썸 /v1/accounts
 * @param {string} userId
 */
export async function getBithumbAccountSnapshotForUserAsync(userId) {
  const uid = String(userId ?? "").trim();
  if (!uid) {
    return { ready: false, messageKo: "로그인이 필요합니다." };
  }
  const meta = getCredentialMetaSync(uid, "bithumb");
  if (!meta.ready) {
    return {
      ready: false,
      messageKo:
        meta.messageKo ??
        "빗썸 API Key·Secret을 실거래 탭에서 저장하세요.",
    };
  }
  const creds = getDecryptedCredentialsSync(uid, "bithumb");
  if (!creds?.apiKey || !creds?.secretKey) {
    return { ready: false, messageKo: "빗썸 API 키를 저장하세요." };
  }
  const accounts = await fetchBithumbAccountsWithCredentials(creds);
  const snapshot = await enrichBithumbSnapshotWithMarketQuotes(
    summarizeBithumbAccountsForDisplay(accounts),
  );
  let feeLabelKo = null;
  try {
    const { ensureUserTradingFeesFreshAsync, getUserTradingFeeRatesForApiSync } =
      await import("./exchange-trading-fees.js");
    await ensureUserTradingFeesFreshAsync(uid);
    feeLabelKo = getUserTradingFeeRatesForApiSync(uid).bithumb?.labelKo ?? null;
  } catch {
    /* 수수료 라벨 없어도 잔고·보유는 표시 */
  }
  return { ready: true, snapshot, feeLabelKo };
}
