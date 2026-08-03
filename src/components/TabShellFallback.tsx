import { ko } from "../i18n/ko";
import "./tab-shell-fallback.css";

type Props = {
  /** 탭별 제목(있으면 골격에 표시) */
  title?: string;
  subtitle?: string;
  /** 표형 스켈레톤 행 수 */
  rows?: number;
  /**
   * full: 제목·툴바·표까지 (청크 Suspense·빈 탭)
   * body: 이미 헤더가 있을 때 표 영역만
   */
  variant?: "full" | "body";
};

/** 지연 청크·데이터 대기 중에도 즉시 화면 형태를 잡음 (빈 「불러오는 중」 방지) */
export default function TabShellFallback({
  title,
  subtitle,
  rows = 8,
  variant = "full",
}: Props) {
  const n = Math.max(3, Math.min(12, rows));
  const body = (
    <div className="tab-shell-fallback__panel card">
      {variant === "full" ? (
        <div className="tab-shell-fallback__summary">
          <div className="tab-shell-fallback__bone tab-shell-fallback__bone--card" />
          <div className="tab-shell-fallback__bone tab-shell-fallback__bone--card" />
          <div className="tab-shell-fallback__bone tab-shell-fallback__bone--card" />
        </div>
      ) : null}
      <ul className="tab-shell-fallback__rows" aria-hidden>
        {Array.from({ length: n }, (_, i) => (
          <li key={i} className="tab-shell-fallback__row">
            <div className="tab-shell-fallback__bone tab-shell-fallback__bone--cell" />
            <div className="tab-shell-fallback__bone tab-shell-fallback__bone--cell tab-shell-fallback__bone--wide" />
            <div className="tab-shell-fallback__bone tab-shell-fallback__bone--cell" />
            <div className="tab-shell-fallback__bone tab-shell-fallback__bone--cell" />
          </li>
        ))}
      </ul>
    </div>
  );

  if (variant === "body") {
    return (
      <div
        className="tab-shell-fallback tab-shell-fallback--body"
        role="status"
        aria-live="polite"
        aria-busy="true"
      >
        <span className="tab-shell-fallback__hint tab-shell-fallback__hint--inline">
          {ko.app.tabShellLoadingHint}
        </span>
        {body}
      </div>
    );
  }

  return (
    <div
      className="workspace tab-shell-fallback"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <header className="tab-shell-fallback__head">
        <div className="tab-shell-fallback__head-text">
          {title ? (
            <h2 className="tab-shell-fallback__title">{title}</h2>
          ) : (
            <div className="tab-shell-fallback__bone tab-shell-fallback__bone--title" />
          )}
          {subtitle ? (
            <p className="tab-shell-fallback__sub">{subtitle}</p>
          ) : (
            <div className="tab-shell-fallback__bone tab-shell-fallback__bone--sub" />
          )}
        </div>
        <span className="tab-shell-fallback__hint">{ko.app.tabShellLoadingHint}</span>
      </header>
      <div className="tab-shell-fallback__toolbar">
        <div className="tab-shell-fallback__bone tab-shell-fallback__bone--search" />
        <div className="tab-shell-fallback__bone tab-shell-fallback__bone--chip" />
        <div className="tab-shell-fallback__bone tab-shell-fallback__bone--chip" />
      </div>
      {body}
    </div>
  );
}
