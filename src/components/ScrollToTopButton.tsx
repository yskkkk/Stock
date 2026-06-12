import { useCallback, useEffect, useState, type RefObject } from "react";
import { ko } from "../i18n/ko";

type ScrollToTopButtonProps = {
  scrollRef: RefObject<HTMLElement | null>;
};

function resolveScrollEl(scrollRef: RefObject<HTMLElement | null>) {
  return scrollRef.current ?? document.querySelector<HTMLElement>(".app__scroll");
}

export default function ScrollToTopButton({ scrollRef }: ScrollToTopButtonProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = resolveScrollEl(scrollRef);
    if (!el) return;

    const onScroll = () => {
      setVisible(el.scrollTop > 200);
    };
    onScroll();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [scrollRef]);

  const scrollTop = useCallback(() => {
    const el = resolveScrollEl(scrollRef);
    if (el) {
      el.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [scrollRef]);

  return (
    <button
      type="button"
      className={`scroll-to-top-btn${visible ? " scroll-to-top-btn--visible" : ""}`}
      onClick={scrollTop}
      aria-label={ko.app.scrollToTop}
      title={ko.app.scrollToTop}
      tabIndex={visible ? 0 : -1}
      aria-hidden={!visible}
    >
      <span className="scroll-to-top-btn__icon" aria-hidden>
        ↑
      </span>
    </button>
  );
}
