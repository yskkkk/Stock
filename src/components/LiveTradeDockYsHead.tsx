/** 우측 실매매 도크 패널·팝오버 공통 상단 YS 로고 */

const YS_LOGO_SRC = "/branding/ystock-logo-alpha.png?v=24";

export default function LiveTradeDockYsHead({
  ariaLabel,
}: {
  ariaLabel?: string;
}) {
  return (
    <header className="live-trade-dock-ys-head" aria-label={ariaLabel}>
      <span className="live-trade-dock-ys-head__brand brand-mark" aria-hidden>
        <img
          className="brand-mark__img"
          src={YS_LOGO_SRC}
          alt=""
          width={24}
          height={24}
          decoding="async"
        />
      </span>
    </header>
  );
}
