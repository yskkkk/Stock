/** 토스·빗썸 브랜드 아이콘 (도크 레일·계좌 제목) */

const BITHUMB_APP_ICON_SRC = "/branding/bithumb-app-icon.png?v=1";

/** 토스 앱 아이콘 — #0064FF + 흰색 곡선 워드마크 */
export function TossBrandMark({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width={20}
      height={20}
      aria-hidden
    >
      <rect width="24" height="24" rx="5.5" fill="#0064FF" />
      <path
        fill="none"
        stroke="#fff"
        strokeWidth="1.45"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12.99 7.23c4.67-.99 8.68.55 8.68 4.23 0 4.69-7.03 9.65-11.79 9.65L13.96 2.92C9.2 2.92 1.17 8.08 1.17 12.77c0 3.68 4.01 5.22 8.68 4.23"
      />
    </svg>
  );
}

/** 빗썸 — Google Play 앱 아이콘(공식 마크) */
export function BithumbBrandMark({ className }: { className?: string }) {
  return (
    <img
      className={className}
      src={BITHUMB_APP_ICON_SRC}
      alt=""
      width={20}
      height={20}
      decoding="async"
      draggable={false}
    />
  );
}
