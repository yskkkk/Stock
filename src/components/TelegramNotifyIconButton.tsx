import { ko } from "../i18n/ko";
import { TelegramBrandMark } from "./ExchangeBrandMarks";

/** 상단 실매매 스트립 — 텔레그램 알림 이력(아이콘) */
export default function TelegramNotifyIconButton({
  sentCount,
  onClick,
  className = "",
}: {
  sentCount: number;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`live-trade-header-strip__telegram-btn${className ? ` ${className}` : ""}`}
      title={ko.app.telegramListAria}
      aria-label={ko.app.telegramListAria}
      onClick={onClick}
    >
      <TelegramBrandMark className="live-trade-header-strip__telegram-icon" />
      {sentCount > 0 ? (
        <span className="tag-count live-trade-header-strip__telegram-count">
          {sentCount > 99 ? "99+" : sentCount}
        </span>
      ) : null}
    </button>
  );
}
