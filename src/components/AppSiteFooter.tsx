import type { CSSProperties, KeyboardEvent, ReactNode, RefObject } from "react";
import { ko } from "../i18n/ko";
import type { FeedbackCornerHandle } from "./FeedbackCorner";
import ServerRestartButton from "./ServerRestartButton";

const FOOTER_TEXT: CSSProperties = {
  fontFamily: '"Segoe UI", Arial, Helvetica, sans-serif',
  fontWeight: 500,
  fontStyle: "normal",
};

const FOOTER_LINK: CSSProperties = {
  ...FOOTER_TEXT,
  textDecoration: "none",
};

type AppSiteFooterProps = {
  accessAdmin: boolean;
  appTab: string;
  onOpenOps: () => void;
  feedbackRef: RefObject<FeedbackCornerHandle | null>;
  feedbackOpenKind?: "inquiry" | "issue" | null;
  /** 데스크톱 우측 고정 버튼 사용 시 푸터 링크 숨김 */
  hideFeedbackLink?: boolean;
};

function FooterLink({
  children,
  onClick,
  active,
  href,
  download,
  title,
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  active?: boolean;
  href?: string;
  download?: string;
  title?: string;
  disabled?: boolean;
}) {
  const cls = active
    ? "app-site-footer__link app-site-footer__link--active"
    : "app-site-footer__link";

  if (href) {
    return (
      <a href={href} download={download} className={cls} title={title} style={FOOTER_LINK}>
        {children}
      </a>
    );
  }

  const onKeyDown = (e: KeyboardEvent<HTMLSpanElement>) => {
    if (disabled) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onClick?.();
    }
  };

  return (
    <span
      role="button"
      tabIndex={disabled ? -1 : 0}
      className={cls}
      style={FOOTER_LINK}
      title={title}
      aria-disabled={disabled || undefined}
      onClick={disabled ? undefined : onClick}
      onKeyDown={onKeyDown}
    >
      {children}
    </span>
  );
}

export default function AppSiteFooter({
  accessAdmin,
  appTab,
  onOpenOps,
  feedbackRef,
  feedbackOpenKind = null,
  hideFeedbackLink = false,
}: AppSiteFooterProps) {
  return (
    <footer className="app-site-footer" style={FOOTER_TEXT} aria-label={ko.app.siteFooterAria}>
      <nav className="app-site-footer__nav" style={FOOTER_TEXT}>
        {accessAdmin ? (
          <FooterLink onClick={onOpenOps} active={appTab === "ops"}>
            {ko.app.footerDevYsk}
          </FooterLink>
        ) : null}

        {!hideFeedbackLink ? (
          <FooterLink
            onClick={() => feedbackRef.current?.openSubmit()}
            active={feedbackOpenKind != null}
          >
            {ko.app.footerFeedback}
          </FooterLink>
        ) : null}

        {accessAdmin ? (
          <FooterLink onClick={onOpenOps} active={appTab === "ops"}>
            {ko.app.tabOps}
          </FooterLink>
        ) : null}

        <FooterLink
          href="/downloads/stock-dashboard.apk"
          download="stock-dashboard.apk"
          title={ko.mobile.downloadGalaxyTitle}
        >
          {ko.mobile.downloadGalaxy}
        </FooterLink>

        <FooterLink href="/install-ios.html" title={ko.mobile.downloadIphoneTitle}>
          {ko.mobile.downloadIphone}
        </FooterLink>

        {accessAdmin ? (
          <ServerRestartButton linkClassName="app-site-footer__link" textLink />
        ) : null}
      </nav>

      <p className="app-site-footer__copy" style={FOOTER_TEXT}>
        {ko.app.footerCopyright}
      </p>
    </footer>
  );
}
