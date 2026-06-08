import { TossBrandMark } from "./ExchangeBrandMarks";

export default function TossAccountTitle({
  className = "bithumb-account-rail-wrap__title",
}: {
  className?: string;
}) {
  return (
    <span className={`${className} bithumb-account-rail-wrap__title--brand`.trim()}>
      <TossBrandMark className="bithumb-account-rail-wrap__mark" />
      <span className="bithumb-account-rail-wrap__title-copy">
        <span className="bithumb-account-rail-wrap__title-text">토스</span>
        <span className="bithumb-account-rail-wrap__title-suffix">계좌</span>
      </span>
    </span>
  );
}
