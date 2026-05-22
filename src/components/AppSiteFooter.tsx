import type { CSSProperties, ReactNode, RefObject } from "react";
import { ENABLE_THEME_MODE_TOGGLE } from "../constants/uiFlags";
import {
  LIGHT_PALETTE_IDS,
  LIGHT_PALETTE_PREVIEW,
  type ColorMode,
  type LightPaletteId,
} from "../lib/theme";
import { ko } from "../i18n/ko";
import type { FeedbackCornerHandle } from "./FeedbackCorner";
import ServerRestartButton from "./ServerRestartButton";

type AppSiteFooterProps = {
  accessAdmin: boolean;
  appTab: string;
  colorMode: ColorMode;
  lightPalette: LightPaletteId;
  onToggleColorMode: () => void;
  onLightPalette: (id: LightPaletteId) => void;
  onOpenOps: () => void;
  feedbackRef: RefObject<FeedbackCornerHandle | null>;
};

function Sep() {
  return (
    <span className="app-site-footer__sep" aria-hidden>
      |
    </span>
  );
}

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
      <a href={href} download={download} className={cls} title={title}>
        {children}
      </a>
    );
  }
  return (
    <button
      type="button"
      className={cls}
      onClick={onClick}
      title={title}
      disabled={disabled}
      aria-disabled={disabled || undefined}
    >
      {children}
    </button>
  );
}

export default function AppSiteFooter({
  accessAdmin,
  appTab,
  colorMode,
  lightPalette,
  onToggleColorMode,
  onLightPalette,
  onOpenOps,
  feedbackRef,
}: AppSiteFooterProps) {
  const themeTitle =
    !ENABLE_THEME_MODE_TOGGLE
      ? ko.app.themeToggleDisabledHint
      : colorMode === "dark"
        ? ko.app.themeUseLight
        : ko.app.themeUseDark;

  return (
    <footer className="app-site-footer" aria-label={ko.app.siteFooterAria}>
      <nav className="app-site-footer__nav">
        {accessAdmin ? (
          <>
            <FooterLink onClick={onOpenOps} active={appTab === "ops"}>
              {ko.app.footerDevYsk}
            </FooterLink>
            <Sep />
          </>
        ) : null}

        <FooterLink onClick={() => feedbackRef.current?.openSubmit("inquiry")}>
          {ko.app.footerInquiry}
        </FooterLink>
        <Sep />

        <FooterLink onClick={() => feedbackRef.current?.openSubmit("issue")}>
          {ko.feedback.cornerButton}
        </FooterLink>

        {accessAdmin ? (
          <>
            <Sep />
            <FooterLink onClick={onOpenOps} active={appTab === "ops"}>
              {ko.app.tabOps}
            </FooterLink>
          </>
        ) : null}

        <Sep />

        <span className="app-site-footer__pair">
          <FooterLink
            href="/downloads/stock-dashboard.apk"
            download="stock-dashboard.apk"
            title={ko.mobile.downloadGalaxyTitle}
          >
            {ko.mobile.downloadGalaxy}
          </FooterLink>
          <span className="app-site-footer__dot" aria-hidden>
            ·
          </span>
          <FooterLink href="/install-ios.html" title={ko.mobile.downloadIphoneTitle}>
            {ko.mobile.downloadIphone}
          </FooterLink>
        </span>

        <Sep />

        <FooterLink
          onClick={onToggleColorMode}
          title={themeTitle}
          active={colorMode === "light"}
          disabled={!ENABLE_THEME_MODE_TOGGLE}
        >
          {ko.app.footerTheme}
          <span className="app-site-footer__theme-icon" aria-hidden>
            {colorMode === "dark" ? "\u2600" : "\u263E"}
          </span>
        </FooterLink>

        {colorMode === "light" ? (
          <span
            className="app-site-footer__palette"
            role="group"
            aria-label={ko.app.lightPaletteAria}
          >
            {LIGHT_PALETTE_IDS.map((id, idx) => (
              <button
                key={id}
                type="button"
                className={
                  lightPalette === id
                    ? "light-palette-swatch light-palette-swatch--active app-site-footer__swatch"
                    : "light-palette-swatch app-site-footer__swatch"
                }
                aria-label={`${idx + 1} / ${LIGHT_PALETTE_IDS.length}`}
                aria-pressed={lightPalette === id}
                onClick={() => onLightPalette(id)}
                style={
                  { "--lp-fill": LIGHT_PALETTE_PREVIEW[id] } as CSSProperties
                }
              />
            ))}
          </span>
        ) : null}

        {accessAdmin ? (
          <>
            <Sep />
            <ServerRestartButton linkClassName="app-site-footer__link" />
          </>
        ) : null}
      </nav>
      <p className="app-site-footer__copy">{ko.app.footerCopyright}</p>
    </footer>
  );
}
