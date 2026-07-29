/** 토스·빗썸 브랜드 아이콘 (도크 레일·계좌 제목) — 테마와 무관하게 항상 보이도록 SVG 우선 */

const BITHUMB_MARK_SRC = "/branding/bithumb-mark-alpha.png?v=3";

/** 토스 공식색 마크 — 네트워크/캐시와 무관하게 항상 렌더 */
export function TossBrandMark({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width={20}
      height={20}
      aria-hidden
      focusable="false"
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

/** 빗썸 앱 아이콘 — PNG + 로드 실패 시 단색 폴백 */
export function BithumbBrandMark({ className }: { className?: string }) {
  return (
    <img
      className={className}
      src={BITHUMB_MARK_SRC}
      alt=""
      width={20}
      height={20}
      decoding="async"
      draggable={false}
      onError={(e) => {
        const el = e.currentTarget;
        el.onerror = null;
        el.src =
          "data:image/svg+xml," +
          encodeURIComponent(
            `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="6" fill="#E85D00"/><text x="12" y="16" text-anchor="middle" font-size="11" font-weight="800" fill="#fff" font-family="system-ui,sans-serif">B</text></svg>`,
          );
      }}
    />
  );
}
