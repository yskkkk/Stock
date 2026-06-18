import { TELEGRAM_CHANNEL_URL } from "../constants/telegramChannel";
import { ko } from "../i18n/ko";

/** 상단 실매매 스트립 — 텔레그램 채널(아이콘) · 알림 이력(건수) */
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
    <span
      className={`live-trade-header-strip__telegram-btn${className ? ` ${className}` : ""}`}
    >
      <a
        href={TELEGRAM_CHANNEL_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="live-trade-header-strip__telegram-channel-link"
        title={ko.app.telegramChannelAria}
        aria-label={ko.app.telegramChannelAria}
      >
        <svg
          className="live-trade-header-strip__telegram-icon"
          viewBox="0 0 24 24"
          width={14}
          height={14}
          aria-hidden
        >
          <circle cx="12" cy="12" r="12" fill="#229ED9" />
          <path
            fill="#fff"
            d="M5.45 11.55 17.35 7.1c.55-.22 1.02.12.85.88L16.2 16.7c-.18.65-.58.84-1.15.55l-3.05-2.25-1.48 1.42c-.18.18-.38.17-.55.08l-.18-2.12 5.62-5.08c.27-.2-.05-.38-.37-.2l-7.2 4.45-3.05-1.02c-.65-.2-.65-.65.06-.98z"
          />
        </svg>
      </a>
      {sentCount > 0 ? (
        <button
          type="button"
          className="live-trade-header-strip__telegram-count-btn"
          title={ko.app.telegramListAria}
          aria-label={ko.app.telegramListAria}
          onClick={onClick}
        >
          <span className="tag-count live-trade-header-strip__telegram-count">
            {sentCount > 99 ? "99+" : sentCount}
          </span>
        </button>
      ) : null}
    </span>
  );
}
