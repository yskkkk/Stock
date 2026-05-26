export const LIVE_TRADE_PROGRAM_FOCUS_EVENT = "ystock-live-trade-program-focus";

const PENDING_KEY = "ystock-live-trade-program-focus";

export function setPendingLiveTradeProgramFocus(programId: string): void {
  const id = String(programId ?? "").trim();
  if (!id) return;
  try {
    sessionStorage.setItem(PENDING_KEY, id);
  } catch {
    /* ignore */
  }
}

export function consumePendingLiveTradeProgramFocus(): string | null {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    sessionStorage.removeItem(PENDING_KEY);
    const id = String(raw ?? "").trim();
    return id || null;
  } catch {
    return null;
  }
}

export function dispatchLiveTradeProgramFocus(programId: string): void {
  const id = String(programId ?? "").trim();
  if (!id || typeof window === "undefined") return;
  setPendingLiveTradeProgramFocus(id);
  window.dispatchEvent(
    new CustomEvent<{ programId: string }>(LIVE_TRADE_PROGRAM_FOCUS_EVENT, {
      detail: { programId: id },
    }),
  );
}
