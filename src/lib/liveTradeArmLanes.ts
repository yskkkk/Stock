import type {
  BithumbTradingStatus,
  LiveTradeArmLane,
  LiveTradeProgram,
  TossTradingStatus,
} from "../api";
import { ko } from "../i18n/ko";

export type LiveArmLaneOption = {
  lane: LiveTradeArmLane;
  label: string;
  enabled: boolean;
  title: string;
};

/** 프로그램 시장 + API 연동 상태로 실매매 채널 목록 */
export function buildLiveArmLaneOptions(
  program: LiveTradeProgram,
  toss: TossTradingStatus | null | undefined,
  bithumb: BithumbTradingStatus | null | undefined,
): LiveArmLaneOption[] {
  const out: LiveArmLaneOption[] = [];
  const mk = program.markets ?? {};

  if (mk.crypto) {
    const configured = Boolean(bithumb?.configured);
    const ready = Boolean(bithumb?.ready);
    out.push({
      lane: "bithumb",
      label: ko.app.liveTradeArmMenuBithumb,
      enabled: configured,
      title:
        ready && configured
          ? ko.app.liveTradeArmMenuBithumbHint
          : (bithumb?.messageKo?.trim() ||
              ko.app.liveTradeArmMenuBithumbNeedApi),
    });
  }

  if (mk.kr || mk.us) {
    const configured = Boolean(toss?.configured);
    const ready = Boolean(toss?.ready);
    out.push({
      lane: "toss",
      label: ko.app.liveTradeArmMenuToss,
      enabled: configured,
      title:
        ready && configured
          ? ko.app.liveTradeArmMenuTossHint
          : (toss?.messageKo?.trim() || ko.app.liveTradeArmMenuTossNeedApi),
    });
  }

  return out;
}

export function filterLiveArmLaneOptions(
  options: LiveArmLaneOption[],
  keep: (lane: LiveTradeArmLane) => boolean,
): LiveArmLaneOption[] {
  return options.filter((o) => keep(o.lane));
}
