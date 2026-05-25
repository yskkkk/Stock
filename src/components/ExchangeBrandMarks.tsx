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

/** 빗썸 — 라운드 스퀘어 + 거래량 막대(도크·계좌, B 로고 미사용) */
export function BithumbBrandMark({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width={20}
      height={20}
      aria-hidden
    >
      <rect x="2" y="2" width="20" height="20" rx="6.5" fill="#FF6C00" fillOpacity="0.14" />
      <rect
        x="2"
        y="2"
        width="20"
        height="20"
        rx="6.5"
        fill="none"
        stroke="#E85D00"
        strokeOpacity="0.55"
        strokeWidth="1.25"
      />
      <rect x="6" y="13.5" width="3" height="5" rx="1.1" fill="#E85D00" />
      <rect x="10.5" y="10.5" width="3" height="8" rx="1.1" fill="#FF8533" />
      <rect x="15" y="7.5" width="3" height="11" rx="1.1" fill="#FF6C00" />
    </svg>
  );
}
