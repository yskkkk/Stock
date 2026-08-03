/**
 * 뷰포트 UI 불편 탐지 — 모바일·PC 공통(레이아웃 틀/골격 변경 제안은 하지 않음)
 * @param {import("playwright").Page} page
 * @param {{ personaId?: string; device?: "mobile"|"desktop" }} [opts]
 * @returns {Promise<Array<{
 *   ok: boolean;
 *   step: string;
 *   detail: string;
 *   severity?: "blocker"|"major"|"minor"|"nit";
 *   area?: string;
 *   suggestion?: string;
 *   screenshot?: string | null;
 * }>>}
 */
export async function probeViewportUiDiscomfort(page, opts = {}) {
  const device = opts.device === "desktop" ? "desktop" : "mobile";
  const area = device === "mobile" ? "mobile" : "navigation";
  const touchMin = device === "mobile" ? 44 : 28;
  const tinyGate = device === "mobile" ? 3 : 5;
  const iconMinDisplay = 16;

  /** @type {Array<{
   *   ok: boolean;
   *   step: string;
   *   detail: string;
   *   severity?: "blocker"|"major"|"minor"|"nit";
   *   area?: string;
   *   suggestion?: string;
   *   screenshot?: string | null;
   * }>} */
  const observations = [];

  /** @type {{
   *   overflowX: boolean;
   *   overflowPx: number;
   *   tabsOverflow: boolean;
   *   tabsScrollable: boolean;
   *   tinyCount: number;
   *   tinySamples: string[];
   *   smallIconCount: number;
   *   smallIconSamples: string[];
   *   clippedIconCount: number;
   *   modalFooterCut: boolean;
   *   vw: number;
   *   vh: number;
   * }} */
  let metrics;
  try {
    metrics = await page.evaluate(
      ({ touchMin, iconMinDisplay }) => {
        const doc = document.documentElement;
        const body = document.body;
        const vw = doc.clientWidth;
        const vh = doc.clientHeight;
        const maxScrollW = Math.max(doc.scrollWidth, body?.scrollWidth || 0);
        const overflowPx = Math.max(0, maxScrollW - vw);
        const tabs = document.querySelector("nav.main-tabs");
        let tabsOverflow = false;
        let tabsScrollable = false;
        if (tabs instanceof HTMLElement) {
          tabsOverflow = tabs.scrollWidth > tabs.clientWidth + 4;
          const ox = getComputedStyle(tabs).overflowX;
          tabsScrollable =
            ox === "auto" || ox === "scroll" || tabs.scrollWidth > tabs.clientWidth;
        }
        const selectors =
          "button, a, [role='button'], .main-tab, .btn, [data-vu]";
        const nodes = Array.from(document.querySelectorAll(selectors)).slice(0, 120);
        let tinyCount = 0;
        /** @type {string[]} */
        const tinySamples = [];
        for (const el of nodes) {
          if (!(el instanceof HTMLElement)) continue;
          const style = getComputedStyle(el);
          if (style.display === "none" || style.visibility === "hidden") continue;
          const r = el.getBoundingClientRect();
          if (r.width < 2 || r.height < 2) continue;
          if (r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) continue;
          if (r.height < touchMin || r.width < touchMin) {
            tinyCount += 1;
            if (tinySamples.length < 8) {
              const label =
                el.getAttribute("data-vu") ||
                el.getAttribute("aria-label") ||
                el.className?.toString?.() ||
                el.tagName;
              tinySamples.push(String(label).slice(0, 48));
            }
          }
        }

        const iconSel =
          "img, svg, .brand-mark, .app-brand img, .main-tabs img, [class*='icon'] img, [class*='logo'] img, [class*='Logo']";
        const icons = Array.from(document.querySelectorAll(iconSel)).slice(0, 80);
        let smallIconCount = 0;
        let clippedIconCount = 0;
        /** @type {string[]} */
        const smallIconSamples = [];
        for (const el of icons) {
          if (!(el instanceof Element)) continue;
          const style = getComputedStyle(el);
          if (style.display === "none" || style.visibility === "hidden") continue;
          const r = el.getBoundingClientRect();
          if (r.width < 1 || r.height < 1) continue;
          if (r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) continue;
          const label =
            el.getAttribute("alt") ||
            el.getAttribute("aria-label") ||
            el.className?.toString?.() ||
            el.tagName;
          if (r.width < iconMinDisplay || r.height < iconMinDisplay) {
            smallIconCount += 1;
            if (smallIconSamples.length < 8) {
              smallIconSamples.push(
                `${String(label).slice(0, 36)}(${Math.round(r.width)}×${Math.round(r.height)})`,
              );
            }
          }
          const parent = el.parentElement;
          if (parent instanceof HTMLElement) {
            const pr = parent.getBoundingClientRect();
            const overflowHidden =
              getComputedStyle(parent).overflow === "hidden" ||
              getComputedStyle(parent).overflowX === "hidden" ||
              getComputedStyle(parent).overflowY === "hidden";
            if (
              overflowHidden &&
              (r.right > pr.right + 1 ||
                r.bottom > pr.bottom + 1 ||
                r.left < pr.left - 1 ||
                r.top < pr.top - 1)
            ) {
              clippedIconCount += 1;
            }
          }
        }

        let modalFooterCut = false;
        const footer = document.querySelector(
          ".account-rebalance-modal .modal__footer, [data-vu='account-rebalance-modal'] .modal__footer, .account-rebalance-modal footer",
        );
        if (footer instanceof HTMLElement) {
          const fr = footer.getBoundingClientRect();
          if (fr.height > 0 && (fr.bottom > vh + 2 || fr.top > vh - 8)) {
            modalFooterCut = true;
          }
        }
        return {
          overflowX: overflowPx > 8,
          overflowPx,
          tabsOverflow,
          tabsScrollable,
          tinyCount,
          tinySamples,
          smallIconCount,
          smallIconSamples,
          clippedIconCount,
          modalFooterCut,
          vw,
          vh,
        };
      },
      { touchMin, iconMinDisplay },
    );
  } catch (e) {
    observations.push({
      ok: false,
      step: `${device}-ui-probe`,
      area,
      severity: "minor",
      detail: `${device} UI 프로브 실행 실패: ${e instanceof Error ? e.message : String(e)}`,
      suggestion:
        "프로브는 유지하고, PC·모바일에서 가로 넘침·터치/클릭 타깃·아이콘 크기·모달 footer만 기존 틀 안에서 고친다.",
    });
    return observations;
  }

  const frameConstraint =
    "레이아웃 틀(3열·좌측 열·메인 탭 골격)은 바꾸지 말고, 패딩·줄바꿈·터치/아이콘 크기·safe-area·모달 footer wrap만 기존 컴포넌트 안에서 조정한다. PC·모바일을 함께 검증한다.";

  if (metrics.overflowX) {
    observations.push({
      ok: false,
      step: `${device}-overflow-x`,
      area,
      severity: "major",
      detail: `${device} ${metrics.vw}×${metrics.vh}에서 가로로 약 ${Math.round(metrics.overflowPx)}px 넘침. 스크롤·잘림으로 불편함.`,
      suggestion: `가로 넘침 원인을 찾아 줄바꿈·min-width·overflow만 고친다. ${frameConstraint}`,
    });
  }

  if (metrics.tabsOverflow && !metrics.tabsScrollable) {
    observations.push({
      ok: false,
      step: `${device}-tabs-overflow`,
      area,
      severity: "major",
      detail: "메인 탭이 뷰포트에서 넘치는데 가로 스크롤이 안 된다.",
      suggestion: `main-tabs에 가로 스크롤(overflow-x)과 터치 스크롤만 보강한다. ${frameConstraint}`,
    });
  } else if (device === "mobile" && metrics.tabsOverflow && metrics.tabsScrollable) {
    observations.push({
      ok: true,
      step: "mobile-tabs-scroll",
      area: "mobile",
      severity: "nit",
      detail: "메인 탭이 좁아 가로 스크롤이 필요하다. 스크롤 가능은 확인됨.",
      suggestion: `활성 탭이 보이도록 스크롤 인디케이터·대비만 보강한다. ${frameConstraint}`,
    });
  }

  if (metrics.tinyCount >= tinyGate) {
    observations.push({
      ok: false,
      step: `${device}-touch-target`,
      area,
      severity: device === "mobile" ? "major" : "minor",
      detail: `${device}: 기준(${touchMin}px)보다 작은 클릭/터치 타깃 약 ${metrics.tinyCount}개(예: ${metrics.tinySamples.join(", ") || "—"}).`,
      suggestion: `주요 버튼·칩·아이콘 버튼에 min-height/min-width·패딩으로 타깃만 키운다(배치 골격 유지). ${frameConstraint}`,
    });
  }

  if (metrics.smallIconCount >= 2) {
    observations.push({
      ok: false,
      step: `${device}-icon-size`,
      area,
      severity: "minor",
      detail: `${device}: 표시 크기가 작은 아이콘/마크 약 ${metrics.smallIconCount}개(예: ${metrics.smallIconSamples.join(", ") || "—"}). 가독·탭 정확도가 떨어짐.`,
      suggestion: `브랜드·탭·레일·거래소 아이콘 표시 크기·여백을 PC·모바일 각각에서 키우거나 대비를 보강한다(흰 사각 매트 금지). ${frameConstraint}`,
    });
  }

  if (metrics.clippedIconCount >= 1) {
    observations.push({
      ok: false,
      step: `${device}-icon-clip`,
      area,
      severity: "minor",
      detail: `${device}: overflow에 잘린 아이콘 약 ${metrics.clippedIconCount}개. 마크가 반만 보이거나 겹침.`,
      suggestion: `아이콘 컨테이너 overflow·크기·간격을 조정해 잘림·겹침을 없앤다. ${frameConstraint}`,
    });
  }

  if (device === "mobile" && metrics.modalFooterCut) {
    observations.push({
      ok: false,
      step: "mobile-modal-footer",
      area: "mobile",
      severity: "major",
      detail: "모달 하단 액션(footer)이 뷰포트 밖으로 잘리거나 가려져 탭하기 어렵다.",
      suggestion: `모달 footer wrap·sticky·safe-area padding만 보강한다. ${frameConstraint}`,
    });
  }

  if (observations.length === 0) {
    observations.push({
      ok: true,
      step: `${device}-ui-probe`,
      area,
      severity: "nit",
      detail: `${device} ${metrics.vw}×${metrics.vh} 프로브: 치명적 넘침·타깃·아이콘 이슈 없음. 그래도 UI/UX는 계속 깐깐히 본다.`,
      suggestion: `아이콘 크기·터치·정렬을 PC·모바일에서 계속 점검한다. ${frameConstraint}`,
    });
  }

  void opts.personaId;
  return observations;
}

/**
 * @deprecated use probeViewportUiDiscomfort(page, { device: "mobile", personaId })
 * @param {import("playwright").Page} page
 * @param {string} personaId
 */
export async function probeMobileUiDiscomfort(page, personaId) {
  return probeViewportUiDiscomfort(page, { device: "mobile", personaId });
}
