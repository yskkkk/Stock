import type { LiveTradeProgram } from "../api";

export const LIVE_TRADING_HEADER_SNAPSHOT_KEY = "stock-live-trading-header-snapshot";

export type LiveTradingHeaderSnapshot = {
  atMs: number;
  programs: Array<{ id: string; name: string; status: LiveTradeProgram["status"] }>;
  armedCount: number;
  simCount: number;
};

export function writeLiveTradingHeaderSnapshot(input: {
  programs: LiveTradeProgram[];
  armedCount: number;
  simCount: number;
}): void {
  if (typeof sessionStorage === "undefined") return;
  const running = input.programs.filter(
    (p) => p.status === "armed" || p.status === "sim",
  );
  if (running.length === 0) {
    try {
      sessionStorage.removeItem(LIVE_TRADING_HEADER_SNAPSHOT_KEY);
    } catch {
      /* ignore */
    }
    return;
  }
  const snap: LiveTradingHeaderSnapshot = {
    atMs: Date.now(),
    armedCount: input.armedCount,
    simCount: input.simCount,
    programs: running.map((p) => ({
      id: p.id,
      name: p.name,
      status: p.status,
    })),
  };
  try {
    sessionStorage.setItem(LIVE_TRADING_HEADER_SNAPSHOT_KEY, JSON.stringify(snap));
  } catch {
    /* ignore */
  }
}

export function readLiveTradingHeaderSnapshot(): LiveTradingHeaderSnapshot | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(LIVE_TRADING_HEADER_SNAPSHOT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LiveTradingHeaderSnapshot;
    if (!parsed || !Array.isArray(parsed.programs)) return null;
    return parsed;
  } catch {
    return null;
  }
}
