/**
 * 회원별 보유·관심 종목 심볼 수집 (뉴스 알림용)
 */
import { resolveDisplayName } from "./names-ko.js";
import { getBithumbLedgerSnapshotCacheSync } from "./live-trade-bithumb-ledger.js";
import { getTossLedgerSnapshotCacheSync } from "./live-trade-toss-ledger.js";
import { getUserStockVaultSync } from "./user-stock-vault-store.js";

/**
 * @typedef {{
 *   symbol: string;
 *   name: string;
 *   market: "kr" | "us" | "crypto";
 *   sources: string[];
 * }} HeldSymbolRow
 */

/**
 * @param {unknown} symbol
 */
export function normalizeHeldNewsSymbol(symbol) {
  const raw = String(symbol ?? "").trim().toUpperCase();
  if (!raw) return "";
  if (/^\d{6}$/.test(raw)) return `${raw}.KS`;
  return raw;
}

/**
 * @param {string} symbol
 */
function inferHeldMarket(symbol) {
  const sym = normalizeHeldNewsSymbol(symbol);
  if (!sym) return "us";
  if (sym.endsWith(".KS") || sym.endsWith(".KQ")) return "kr";
  if (/^(BTC|ETH|XRP|SOL|DOGE|ADA|TRX|DOT|MATIC|AVAX|LINK|UNI|ATOM|ETC|BCH|FIL|APT|ARB|OP|NEAR|INJ|SUI|SEI|STX|IMX|AAVE|MKR|GRT|SAND|MANA|AXS|FLOW|EGLD|ALGO|XTZ|EOS|ICP|HBAR|VET|THETA|FTM|RUNE|SNX|CRV|LDO|PEPE|SHIB|WLD|BONK|JUP|STRK|PYTH|TIA|ONDO|ENA|W|NOT|TON|BTT|USDT|USDC)(-|$)/.test(sym)) {
    return "crypto";
  }
  return "us";
}

/**
 * @param {Map<string, HeldSymbolRow>} map
 * @param {string} symbol
 * @param {string} [name]
 * @param {string} source
 */
function addHeldSymbol(map, symbol, name, source) {
  const sym = normalizeHeldNewsSymbol(symbol);
  if (!sym) return;
  const market = inferHeldMarket(sym);
  if (market === "crypto") return;
  const prev = map.get(sym);
  const displayName =
    String(name ?? "").trim() ||
    prev?.name ||
    resolveDisplayName(sym, sym.replace(/\.(KS|KQ)$/i, ""));
  if (prev) {
    if (!prev.sources.includes(source)) prev.sources.push(source);
    if (displayName && displayName !== sym) prev.name = displayName;
    return;
  }
  map.set(sym, {
    symbol: sym,
    name: displayName,
    market: market === "kr" ? "kr" : "us",
    sources: [source],
  });
}

/**
 * @param {string} userId
 * @param {{ includeVaultFavorites?: boolean }} [opts]
 * @returns {Promise<HeldSymbolRow[]>}
 */
export async function collectUserHeldSymbolsAsync(userId, opts = {}) {
  const uid = String(userId ?? "").trim();
  if (!uid) return [];

  /** @type {Map<string, HeldSymbolRow>} */
  const map = new Map();

  try {
    const { buildLiveTradePortfolioSnapshot } = await import(
      "./live-trade-portfolio-store.js"
    );
    const snap = await buildLiveTradePortfolioSnapshot({ userId: uid });
    for (const h of snap?.holdings ?? []) {
      const qty = Number(h.quantity);
      if (!(qty > 0)) continue;
      addHeldSymbol(map, h.symbol, h.name, "portfolio");
    }
  } catch {
    /* ledger 없음 */
  }

  const toss = getTossLedgerSnapshotCacheSync(uid);
  for (const h of toss?.snapshot?.holdings ?? []) {
    const qty = Number(h.quantity);
    if (!(qty > 0)) continue;
    addHeldSymbol(map, h.symbol ?? h.rawSymbol, h.name, "toss");
  }

  const bithumb = getBithumbLedgerSnapshotCacheSync(uid);
  for (const h of bithumb?.snapshot?.holdings ?? []) {
    const qty = Number(h.quantity);
    if (!(qty > 0)) continue;
    addHeldSymbol(map, h.symbol, h.name, "bithumb");
  }

  const includeVault =
    opts.includeVaultFavorites !== false &&
    String(process.env.STOCK_HOLDINGS_NEWS_INCLUDE_VAULT ?? "1").trim() !== "0";
  if (includeVault) {
    const vault = getUserStockVaultSync(uid);
    const meta = vault?.favoriteMeta ?? {};
    for (const sym of vault?.favorites ?? []) {
      const row = meta[sym];
      addHeldSymbol(map, sym, row?.name, "vault");
    }
  }

  return [...map.values()].sort((a, b) => a.symbol.localeCompare(b.symbol));
}
