import { useEffect } from "react";
import { ko } from "../i18n/ko";
import { LiveTradeCollapsibleCard } from "./LiveTradeAuthAndCredentials";
import { useLiveTradeCardSidePanelOptional } from "./LiveTradeAuthAndCredentials";
import { LiveTradeExchangePicker } from "./LiveTradeExchangePicker";
/** 우측 도크 «거래내역» — 토스·빗썸 카드 */
export default function LiveTradeTradesDockPanel({
  selfOnly = false,
}: {
  selfOnly?: boolean;
}) {
  const sidePanel = useLiveTradeCardSidePanelOptional();
  const registerSideTab = sidePanel?.registerSideTab;

  useEffect(() => {
    if (!registerSideTab) return;
    return registerSideTab("trades", ko.app.liveTradeSideDockRailTrades);
  }, [registerSideTab]);

  if (selfOnly) {
    return (
      <div className="live-trade-trades-dock-panel live-trade-trades-dock-panel--self">
        <LiveTradeExchangePicker compact />
      </div>
    );
  }

  return (
    <LiveTradeCollapsibleCard
      title={ko.app.liveTradeSideDockRailTrades}
      summary={ko.app.liveTradeTradesPickExchange}
      className="live-trade-trades-dock-panel"
      ariaLabel={ko.app.liveTradeSideDockRailTrades}
      sidePanelId="trades"
    >
      <LiveTradeExchangePicker compact />
    </LiveTradeCollapsibleCard>
  );
}
