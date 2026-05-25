/** 우측 도크 패널 — 데이터 로드 전 본문 중앙 스피너 */

export default function DockPanelCenterLoading({
  label,
}: {
  label: string;
}) {
  return (
    <div className="dock-panel-center-loading" role="status" aria-live="polite">
      <div className="spinner" aria-hidden />
      <span className="dock-panel-center-loading__label">{label}</span>
    </div>
  );
}
