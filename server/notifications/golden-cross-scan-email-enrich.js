import { getKoreanStockName, hasHangul, resolveDisplayName } from "../names-ko.js";
import { fetchQuoteSnapshotsForSymbols } from "../picks-live-quotes.js";
import { fetchStockVaultMetaForItems } from "../stock-vault-meta.js";

/**
 * @typedef {{
 *   symbol: string;
 *   name: string;
 *   market?: "kr"|"us";
 *   crosses?: string[];
 *   displayName?: string;
 *   industry?: string | null;
 *   price?: number;
 *   changePercent?: number;
 *   currency?: string;
 * }} ScanEmailHit
 */

/**
 * @param {number | undefined} price
 * @param {string | undefined} currency
 * @param {"kr"|"us"} market
 */
export function formatScanEmailPrice(price, currency, market) {
  const v = Number(price);
  if (!Number.isFinite(v)) return "—";
  const cur = currency ?? (market === "kr" ? "KRW" : "USD");
  if (cur === "KRW") {
    return `${new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 }).format(v)}원`;
  }
  return `$${v.toFixed(2)}`;
}

/** @param {number | undefined} changePercent */
export function formatScanEmailChangePercent(changePercent) {
  const ch = Number(changePercent);
  if (!Number.isFinite(ch)) return "—";
  const sign = ch >= 0 ? "+" : "";
  return `${sign}${ch.toFixed(2)}%`;
}

/**
 * @param {{ symbol: string; name: string; market: "kr"|"us" }} hit
 * @param {Record<string, { industry?: string | null; nameKo?: string | null }>} meta
 */
export function resolveScanEmailDisplayName(hit, meta) {
  const sym = String(hit.symbol ?? "")
    .trim()
    .toUpperCase();
  const row = meta[sym];
  if (hit.market === "us") {
    const ko =
      (row?.nameKo && hasHangul(row.nameKo) ? row.nameKo : null) ??
      (() => {
        const mapped = getKoreanStockName(sym);
        return mapped && hasHangul(mapped) ? mapped : null;
      })();
    if (ko) return ko;
    return resolveDisplayName(sym, row?.nameKo, hit.name);
  }
  return resolveDisplayName(sym, row?.nameKo, hit.name);
}

/**
 * @param {Array<{ market: "kr"|"us"; hits: ScanEmailHit[] }>} markets
 */
export async function enrichScanEmailMarkets(markets) {
  /** @type {Array<{ symbol: string; market: "kr"|"us" }>} */
  const metaItems = [];
  /** @type {string[]} */
  const symbols = [];
  for (const block of markets) {
    for (const hit of block.hits ?? []) {
      const sym = String(hit.symbol ?? "")
        .trim()
        .toUpperCase();
      if (!sym) continue;
      symbols.push(sym);
      metaItems.push({ symbol: sym, market: block.market });
    }
  }
  const uniqSymbols = [...new Set(symbols)];
  const [quotes, meta] = await Promise.all([
    uniqSymbols.length
      ? fetchQuoteSnapshotsForSymbols(uniqSymbols, { maxAgeMs: 0 })
      : Promise.resolve({}),
    metaItems.length
      ? fetchStockVaultMetaForItems(metaItems)
      : Promise.resolve({}),
  ]);

  return markets.map((block) => ({
    ...block,
    hits: (block.hits ?? []).map((hit) => {
      const sym = String(hit.symbol ?? "")
        .trim()
        .toUpperCase();
      const q = quotes[sym];
      const row = meta[sym];
      const displayName = resolveScanEmailDisplayName(
        { symbol: sym, name: hit.name, market: block.market },
        meta,
      );
      return {
        ...hit,
        displayName,
        industry: row?.industry ?? null,
        price: q?.price,
        changePercent: q?.changePercent,
        currency: q?.currency,
      };
    }),
  }));
}

/** @param {ScanEmailHit} hit @param {"kr"|"us"} market */
export function formatScanEmailHitLine(hit, market) {
  const code = hit.symbol.replace(/\.(KS|KQ)$/i, "");
  const name = hit.displayName ?? hit.name ?? code;
  const price = formatScanEmailPrice(hit.price, hit.currency, market);
  const chg = formatScanEmailChangePercent(hit.changePercent);
  const industry = hit.industry?.trim() || "—";
  return `· ${name} (${code}) · ${price} · ${chg} · ${industry}`;
}

/** @param {ScanEmailHit} hit @param {"kr"|"us"} market */
export function scanEmailHitCells(hit, market) {
  const code = hit.symbol.replace(/\.(KS|KQ)$/i, "");
  return {
    name: hit.displayName ?? hit.name ?? code,
    code,
    price: formatScanEmailPrice(hit.price, hit.currency, market),
    change: formatScanEmailChangePercent(hit.changePercent),
    industry: hit.industry?.trim() || "—",
  };
}
