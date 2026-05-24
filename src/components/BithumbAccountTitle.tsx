/** 좌측 레일 · 빗썸 계좌 카드 제목 — 브랜드 마크 + Bithumb(영문) 계좌 */
export default function BithumbAccountTitle({
  className = "bithumb-account-rail-wrap__title",
}: {
  className?: string;
}) {
  return (
    <span className={`${className} bithumb-account-rail-wrap__title--brand`.trim()}>
      <img
        className="bithumb-account-rail-wrap__mark"
        src="/branding/bithumb-mark.svg"
        alt=""
        width={16}
        height={16}
        decoding="async"
      />
      <span className="bithumb-account-rail-wrap__title-text">
        Bithumb<span className="bithumb-account-rail-wrap__title-suffix"> 계좌</span>
      </span>
    </span>
  );
}
