/** 토스·빗썸 공식 브랜드 아이콘 (도크 레일·계좌 제목) */

const BRAND_ASSET_V = "3";

/** 토스 앱 아이콘 — #0064FF 바탕 + 흰색 toss 워드마크 */
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
      <g fill="#fff">
        <path d="M5.2 7h3.15v1.4H5.2V7zm0 1.4h1.3v8.7H5.2V8.4z" />
        <circle cx="10.9" cy="12.5" r="1.55" />
        <path d="M12.35 8.55c1.2 0 1.95.62 1.95 1.58 0 .72-.42 1.22-1.1 1.42.78.22 1.28.72 1.28 1.42 0 .98-.82 1.62-2.02 1.62-.58 0-1.05-.16-1.28-.42l.48-1c.22.32.58.48 1 .48.58 0 .92-.26.92-.68 0-.42-.36-.68-.92-.76l-.58-.1c-.72-.14-1.18-.56-1.18-1.14 0-.82.72-1.38 1.72-1.38z" />
        <path d="M14.95 8.55c1.2 0 1.95.62 1.95 1.58 0 .72-.42 1.22-1.1 1.42.78.22 1.28.72 1.28 1.42 0 .98-.82 1.62-2.02 1.62-.58 0-1.05-.16-1.28-.42l.48-1c.22.32.58.48 1 .48.58 0 .92-.26.92-.68 0-.42-.36-.68-.92-.76l-.58-.1c-.72-.14-1.18-.56-1.18-1.14 0-.82.72-1.38 1.72-1.38z" />
      </g>
    </svg>
  );
}

/** 빗썸 공식 심볼(오렌지 리본 b) — favicon 원본 */
export function BithumbBrandMark({ className }: { className?: string }) {
  return (
    <img
      className={className}
      src={`/branding/bithumb-app.png?v=${BRAND_ASSET_V}`}
      alt=""
      width={20}
      height={20}
      decoding="async"
      draggable={false}
    />
  );
}
