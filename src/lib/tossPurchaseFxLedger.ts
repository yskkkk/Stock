/**
 * 미국 주식 매입 시점 USD/KRW 가중 평균 — 계정·심볼별 localStorage.
 * (토스 API가 매입 환율을 주지 않아, 수량 증가 시 당시 환율로 가중 평균)
 */

export type TossPurchaseFxEntry = {
  qty: number;
  avgFx: number;
  updatedAtMs: number;
};

type LedgerStore = Record<string, TossPurchaseFxEntry>;

const PREFIX = "ystock:toss-purchase-fx-v1:";

function key(userId: string): string {
  return `${PREFIX}${userId.trim()}`;
}

function readStore(userId: string): LedgerStore {
  try {
    const raw = localStorage.getItem(key(userId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as LedgerStore;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeStore(userId: string, store: LedgerStore): void {
  try {
    localStorage.setItem(key(userId), JSON.stringify(store));
  } catch {
    /* quota / private */
  }
}

export function clearTossPurchaseFxLedger(userId?: string): void {
  try {
    if (userId) {
      localStorage.removeItem(key(userId));
      return;
    }
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (k?.startsWith(PREFIX)) keys.push(k);
    }
    for (const k of keys) localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
}

/**
 * 보유 수량 변화로 매입 환율 가중 평균을 갱신하고, 심볼→환율 맵을 반환.
 */
export function syncTossPurchaseFxLedger(
  userId: string | null | undefined,
  holdings: Array<{
    symbol: string;
    currency?: string;
    market?: string;
    quantity: number;
  }>,
  currentUsdKrw: number | null,
): Map<string, number> {
  const map = new Map<string, number>();
  const uid = userId?.trim();
  if (
    !uid ||
    !(currentUsdKrw != null && Number.isFinite(currentUsdKrw) && currentUsdKrw > 0)
  ) {
    return map;
  }

  const store = readStore(uid);
  const next: LedgerStore = { ...store };
  const seen = new Set<string>();
  const now = Date.now();

  for (const h of holdings) {
    const isUsd =
      String(h.currency ?? "").toUpperCase() === "USD" || h.market === "us";
    if (!isUsd) continue;
    const sym = String(h.symbol ?? "").trim().toUpperCase();
    const qty = Number(h.quantity);
    if (!sym || !(qty > 0) || !Number.isFinite(qty)) continue;
    seen.add(sym);
    const prev = next[sym];
    if (!prev || !(prev.avgFx > 0) || !(prev.qty > 0)) {
      next[sym] = { qty, avgFx: currentUsdKrw, updatedAtMs: now };
    } else if (qty > prev.qty + 1e-9) {
      const added = qty - prev.qty;
      const avgFx =
        (prev.qty * prev.avgFx + added * currentUsdKrw) / qty;
      next[sym] = {
        qty,
        avgFx: Number.isFinite(avgFx) && avgFx > 0 ? avgFx : currentUsdKrw,
        updatedAtMs: now,
      };
    } else {
      next[sym] = { ...prev, qty, updatedAtMs: now };
    }
    map.set(sym, next[sym].avgFx);
  }

  for (const sym of Object.keys(next)) {
    if (!seen.has(sym)) delete next[sym];
  }
  writeStore(uid, next);
  return map;
}
