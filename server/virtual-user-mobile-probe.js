/**
 * 모바일 뷰포트 UI 불편 탐지 (레이아웃 틀/골격 변경 제안은 하지 않음)
 * @param {import("playwright").Page} page
 * @param {string} personaId
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
export async function probeMobileUiDiscomfort(page, personaId) {
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
   *   modalFooterCut: boolean;
   *   vw: number;
   *   vh: number;
   * }} */
  let metrics;
  try {
    metrics = await page.evaluate(() => {
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
      const nodes = Array.from(document.querySelectorAll(selectors)).slice(0, 100);
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
        if (r.height < 36 || r.width < 36) {
          tinyCount += 1;
          if (tinySamples.length < 6) {
            const label =
              el.getAttribute("data-vu") ||
              el.getAttribute("aria-label") ||
              el.className?.toString?.() ||
              el.tagName;
            tinySamples.push(String(label).slice(0, 48));
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
        modalFooterCut,
        vw,
        vh,
      };
    });
  } catch (e) {
    observations.push({
      ok: false,
      step: "mobile-ui-probe",
      area: "mobile",
      severity: "minor",
      detail: `모바일 UI 프로브 실행 실패: ${e instanceof Error ? e.message : String(e)}`,
      suggestion:
        "프로브는 유지하고, 모바일에서 가로 넘침·터치 타깃·모달 footer만 기존 틀 안에서 고친다.",
    });
    return observations;
  }

  const frameConstraint =
    "레이아웃 틀(3열·좌측 열·메인 탭 골격)은 바꾸지 말고, 패딩·줄바꿈·터치 영역·safe-area·모달 footer wrap만 기존 컴포넌트 안에서 조정한다.";

  if (metrics.overflowX) {
    observations.push({
      ok: false,
      step: "mobile-overflow-x",
      area: "mobile",
      severity: "major",
      detail: `좁은 화면(${metrics.vw}×${metrics.vh})에서 가로로 약 ${Math.round(metrics.overflowPx)}px 넘침. 스크롤·잘림으로 불편함.`,
      suggestion: `가로 넘침 원인을 찾아 줄바꿈·min-width·overflow만 고친다. ${frameConstraint}`,
    });
  }

  if (metrics.tabsOverflow && !metrics.tabsScrollable) {
    observations.push({
      ok: false,
      step: "mobile-tabs-overflow",
      area: "mobile",
      severity: "major",
      detail: "메인 탭이 좁은 화면에서 넘치는데 가로 스크롤이 안 된다.",
      suggestion: `main-tabs에 가로 스크롤(overflow-x)과 터치 스크롤만 보강한다. ${frameConstraint}`,
    });
  } else if (metrics.tabsOverflow && metrics.tabsScrollable) {
    observations.push({
      ok: true,
      step: "mobile-tabs-scroll",
      area: "mobile",
      severity: "nit",
      detail: "메인 탭이 좁아 가로 스크롤이 필요하다. 스크롤 가능은 확인됨.",
      suggestion: `활성 탭이 보이도록 스크롤 인디케이터·대비만 보강한다. ${frameConstraint}`,
    });
  }

  if (metrics.tinyCount >= 6) {
    observations.push({
      ok: false,
      step: "mobile-touch-target",
      area: "mobile",
      severity: "major",
      detail: `손가락보다 작은 터치 타깃 약 ${metrics.tinyCount}개(예: ${metrics.tinySamples.join(", ") || "—"}). 오탭 위험.`,
      suggestion: `주요 버튼·칩에 min-height/min-width·패딩으로 터치 영역만 키운다(배치 골격 유지). ${frameConstraint}`,
    });
  }

  if (metrics.modalFooterCut) {
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
      step: "mobile-ui-probe",
      area: "mobile",
      severity: "nit",
      detail: `모바일 ${metrics.vw}×${metrics.vh} 프로브: 가로 넘침·치명적 터치/footer 이슈 없음.`,
      suggestion: `모바일 터치·safe-area 점검을 유지한다. ${frameConstraint}`,
    });
  }

  // screenshot optional — caller may attach
  void personaId;
  return observations;
}
