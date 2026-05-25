/** 토스·빗썸 브랜드 아이콘 (도크 레일·계좌 제목) — 매트 제거 투명 PNG */

const TOSS_MARK_SRC = "/branding/toss-mark-alpha.png?v=2";
const BITHUMB_MARK_SRC = "/branding/bithumb-mark-alpha.png?v=2";

function ExchangeBrandMarkImg({
  src,
  className,
}: {
  src: string;
  className?: string;
}) {
  return (
    <img
      className={className}
      src={src}
      alt=""
      width={20}
      height={20}
      decoding="async"
      draggable={false}
    />
  );
}

/** 토스 앱 아이콘 (공식 3D 마크, 배경 없음) */
export function TossBrandMark({ className }: { className?: string }) {
  return <ExchangeBrandMarkImg src={TOSS_MARK_SRC} className={className} />;
}

/** 빗썸 앱 아이콘 (Play 스토어 마크, 흰 배경 제거) */
export function BithumbBrandMark({ className }: { className?: string }) {
  return <ExchangeBrandMarkImg src={BITHUMB_MARK_SRC} className={className} />;
}
