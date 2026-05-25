/** 토스·빗썸 브랜드 아이콘 (도크 레일·계좌 제목) — 벡터 SVG, 작은 크기에서도 선명 */

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

/** 빗썸 CI — 오렌지 원 + 소문자 b */
export function BithumbBrandMark({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width={20}
      height={20}
      aria-hidden
    >
      <circle cx="12" cy="12" r="12" fill="#FF6C00" />
      <path
        fill="#fff"
        d="M8.35 17.1V6.65h2.05c3.05 0 4.95 1.55 4.95 4.05 0 1.75-.95 3.05-2.55 3.55 1.65.55 2.65 1.75 2.65 3.45 0 2.35-1.95 3.9-5.05 3.9H8.35zm1.55-7.55h1.25c1.25 0 1.95-.65 1.95-1.6 0-.95-.7-1.6-1.95-1.6H9.9v3.2zm0 4.85h1.55c1.55 0 2.4-.75 2.4-1.85 0-1.1-.85-1.85-2.4-1.85H9.9v3.7z"
      />
    </svg>
  );
}
