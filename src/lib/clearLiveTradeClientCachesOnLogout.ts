/**
 * 로그아웃·계정 전환 시 브라우저에 남은 실매매/계좌 클라이언트 캐시 제거.
 * (다른 계정 로그인 시 이전 잔고·스냅샷이 보이지 않게)
 */
import { logoutAuth } from "../api";
import { refreshLiveTradingStatusNow } from "../hooks/useLiveTradingStatusPoll";
import { notifyLiveTradeAuthChange } from "./liveTradeAuthEvents";
import { clearTossSnapshotCache } from "./tossSnapshotClientCache";
import { clearTossPurchaseFxLedger } from "./tossPurchaseFxLedger";
import { invalidateLiveTradingPrefetch } from "./tabPrefetch";
import { writeLiveTradingHeaderSnapshot } from "./liveTradingHeaderSnapshot";

export function clearLiveTradeClientCachesOnLogout(): void {
  clearTossSnapshotCache();
  clearTossPurchaseFxLedger();
  invalidateLiveTradingPrefetch();
  try {
    writeLiveTradingHeaderSnapshot({
      programs: [],
      armedCount: 0,
      simCount: 0,
    });
  } catch {
    /* ignore */
  }
}

/** POST logout + 클라이언트 캐시 비우기 + auth/status 이벤트 */
export async function logoutLiveTradeAndClearCaches(): Promise<void> {
  await logoutAuth();
  clearLiveTradeClientCachesOnLogout();
  refreshLiveTradingStatusNow();
  notifyLiveTradeAuthChange();
}
