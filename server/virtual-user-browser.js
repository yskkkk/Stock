/**
 * 가상 사용자 — Playwright로 실제 브라우저 클릭 여정
 * 실주문 API는 route abort + 서버 가드로 이중 차단
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { isAbortLikeError } from "./fetch-abort-guard.js";
import {
  shouldBlockVirtualUserMoneyRequest,
} from "./virtual-user-order-guard.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOT_DIR = path.join(__dirname, ".data", "virtual-user-screenshots");

/**
 * @typedef {{
 *   ok: boolean;
 *   step: string;
 *   detail: string;
 *   severity?: "blocker"|"major"|"minor"|"nit";
 *   area?: string;
 *   suggestion?: string;
 *   screenshot?: string | null;
 * }} VuBrowserObservation
 */

function baseUrl() {
  return String(process.env.VIRTUAL_USER_BASE_URL ?? "http://127.0.0.1:5173")
    .trim()
    .replace(/\/$/, "");
}

function headed() {
  const v = String(process.env.VIRTUAL_USER_HEADED ?? "")
    .trim()
    .toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/**
 * @returns {Promise<typeof import("playwright") | null>}
 */
async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch {
    return null;
  }
}

/**
 * @param {import("playwright").Page} page
 * @param {string} name
 */
async function shot(page, name) {
  try {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    const file = path.join(
      SCREENSHOT_DIR,
      `${Date.now()}_${name.replace(/[^\w.-]+/g, "_").slice(0, 40)}.png`,
    );
    await page.screenshot({ path: file, fullPage: false });
    return path.relative(path.join(__dirname, ".data"), file).replace(/\\/g, "/");
  } catch {
    return null;
  }
}

/**
 * @param {import("playwright").Page} page
 * @param {string} vu
 * @param {number} [timeoutMs]
 */
async function clickVu(page, vu, timeoutMs = 8_000) {
  const loc = page.locator(`[data-vu="${vu}"]`).first();
  await loc.waitFor({ state: "visible", timeout: timeoutMs });
  await loc.click({ timeout: timeoutMs });
}

/**
 * count() 대신 waitFor — SPA 리렌더·탭 전환 중 execution context destroyed 방지
 * @param {import("playwright").Page} page
 * @param {string} selector
 * @param {number} [timeoutMs]
 * @returns {Promise<import("playwright").Locator | null>}
 */
async function waitVisibleLocator(page, selector, timeoutMs = 8_000) {
  const loc = page.locator(selector).first();
  try {
    await loc.waitFor({ state: "visible", timeout: timeoutMs });
    return loc;
  } catch {
    return null;
  }
}

/**
 * @param {import("playwright").Page} page
 * @param {string} selector
 * @param {number} [timeoutMs]
 */
async function waitHiddenLocator(page, selector, timeoutMs = 8_000) {
  const loc = page.locator(selector).first();
  try {
    await loc.waitFor({ state: "hidden", timeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
}

/**
 * SPA 리렌더·탭 전환·confirm 중 navigation/context destroyed 클릭 실패 방지
 * @param {import("playwright").Locator | null} loc
 * @param {number} [timeoutMs]
 */
async function safeClick(loc, timeoutMs = 8_000) {
  if (!loc) return false;
  try {
    await loc.click({ timeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
}

/**
 * navigation/route inflight 중 close 시 reject가 process unhandledRejection으로 새는 것 방지
 * @param {import("playwright").BrowserContext | null | undefined} context
 * @param {import("playwright").Browser | null | undefined} browser
 */
async function safeClosePlaywright(context, browser) {
  if (context) {
    try {
      await context.unroute("**/*");
    } catch (e) {
      if (!isAbortLikeError(e)) {
        /* navigation teardown */
      }
    }
    try {
      await context.close();
    } catch (e) {
      if (!isAbortLikeError(e)) {
        /* context already closed */
      }
    }
  }
  if (browser) {
    try {
      await browser.close();
    } catch (e) {
      if (!isAbortLikeError(e)) {
        /* browser already closed */
      }
    }
  }
}

/**
 * @param {import("playwright").Page} page
 * @param {string} text
 * @param {number} [timeoutMs]
 */
async function clickTabByText(page, text, timeoutMs = 8_000) {
  const loc = page.locator("nav.main-tabs button.main-tab", { hasText: text }).first();
  await loc.waitFor({ state: "visible", timeout: timeoutMs });
  await loc.click({ timeout: timeoutMs });
}

/**
 * @param {import("playwright").Page} page
 * @param {string} [text]
 * @param {number} [timeoutMs]
 */
async function ensureAccountManageTab(page, text = "계좌관리", timeoutMs = 8_000) {
  const shell = await waitVisibleLocator(page, ".account-manage-tab", 2_000);
  if (shell) return shell;
  await clickTabByText(page, text, timeoutMs).catch(() => {});
  await page.waitForTimeout(400);
  return waitVisibleLocator(page, ".account-manage-tab", timeoutMs);
}

/**
 * @param {import("./virtual-user-store.js").VirtualPersona} persona
 * @param {string} sessionId
 * @param {{ satisfactionLevel?: number }} [opts]
 * @returns {Promise<{ ok: boolean; observations: VuBrowserObservation[]; error?: string; mode: string }>}
 */
export async function runVirtualUserBrowserJourney(persona, sessionId, opts = {}) {
  const satisfactionLevel = Math.min(
    5,
    Math.max(1, Math.round(Number(opts.satisfactionLevel ?? persona.satisfactionLevel ?? 1)) || 1),
  );
  const pw = await loadPlaywright();
  if (!pw) {
    return {
      ok: false,
      mode: "unavailable",
      error: "playwright 패키지를 불러올 수 없습니다.",
      observations: [],
    };
  }

  /** @type {VuBrowserObservation[]} */
  const observations = [];
  const url = baseUrl();
  const mobile = persona.device === "mobile";
  let browser = null;
  /** @type {import("playwright").BrowserContext | null} */
  let context = null;

  try {
    browser = await pw.chromium.launch({
      headless: !headed(),
      args: ["--disable-dev-shm-usage"],
    });
    context = await browser.newContext({
      viewport: mobile
        ? { width: 390, height: 844 }
        : { width: 1440, height: 900 },
      userAgent: mobile
        ? "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
        : undefined,
      locale: "ko-KR",
      extraHTTPHeaders: {
        "X-Virtual-User": "1",
        "X-Virtual-User-Session": sessionId,
        "X-Virtual-User-Persona": persona.id,
      },
    });

    // 돈이 나가는 요청 차단 — route handler reject는 Playwright가 await하지 않아 try/catch 필수
    await context.route("**/*", async (route) => {
      try {
        const req = route.request();
        const u = req.url();
        const method = req.method();
        let post = "";
        try {
          post = req.postData() || "";
        } catch {
          post = "";
        }
        if (shouldBlockVirtualUserMoneyRequest(u, method, post)) {
          await route.fulfill({
            status: 403,
            contentType: "application/json",
            body: JSON.stringify({
              ok: false,
              blocked: true,
              error: "가상 사용자: 실주문 API 차단",
            }),
          });
          return;
        }
        await route.continue();
      } catch (e) {
        if (isAbortLikeError(e)) return;
        try {
          await route.abort();
        } catch {
          /* navigation teardown */
        }
      }
    });

    const page = await context.newPage();

    // confirm: 즉시 매수·실주문 관련은 무조건 거절
    page.on("dialog", async (dialog) => {
      const msg = dialog.message() || "";
      const block =
        /즉시\s*매수|시장가\s*매수|실제\s*주문|주문이\s*나갑니다|매도|출금/i.test(
          msg,
        );
      try {
        if (block) await dialog.dismiss();
        else await dialog.accept();
      } catch {
        /* ignore */
      }
    });

    // —— 여정 시작 ——
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
      await page.waitForTimeout(800);
      observations.push({
        ok: true,
        step: "open-app",
        area: "navigation",
        severity: "nit",
        detail: `앱 진입 성공 (${url}). 페르소나=${persona.name}`,
        suggestion: "진입 경로·초기 로딩 상태를 유지한다.",
        screenshot: await shot(page, `${persona.id}_home`),
      });
    } catch (e) {
      observations.push({
        ok: false,
        step: "open-app",
        area: "navigation",
        severity: "blocker",
        detail: `앱 진입 실패: ${e instanceof Error ? e.message : String(e)}`,
        suggestion: "VIRTUAL_USER_BASE_URL과 로컬 서버(5173) 기동을 확인한다.",
        screenshot: await shot(page, `${persona.id}_home_fail`),
      });
      await safeClosePlaywright(context, browser);
      context = null;
      browser = null;
      return { ok: false, mode: "browser", observations, error: "앱 진입 실패" };
    }

    /** @type {Array<{ id: string; run: () => Promise<void> }>} */
    const steps = [
      {
        id: "tab-screener",
        run: async () => {
          await clickTabByText(page, "스크리너");
          await page.waitForTimeout(600);
          observations.push({
            ok: true,
            step: "tab-screener",
            area: "navigation",
            severity: "minor",
            detail: "스크리너 탭 클릭·전환 확인.",
            suggestion: "탭 라벨·활성 상태가 분명한지 유지한다.",
            screenshot: await shot(page, `${persona.id}_screener`),
          });
        },
      },
      {
        id: "tab-recommendations",
        run: async () => {
          await clickTabByText(page, "주식 추천목록");
          await page.waitForTimeout(600);
          observations.push({
            ok: true,
            step: "tab-recommendations",
            area: "navigation",
            severity: "minor",
            detail: "주식 추천목록 탭 진입.",
            suggestion: "추천 목록 로딩·빈 상태 안내를 확인한다.",
            screenshot: await shot(page, `${persona.id}_reco`),
          });
        },
      },
      {
        id: "tab-reddit",
        run: async () => {
          await clickTabByText(page, "레딧");
          await page.waitForTimeout(900);
          const hasKo = (await page.locator("text=한글명").count()) > 0;
          observations.push({
            ok: true,
            step: "tab-reddit",
            area: "navigation",
            severity: hasKo ? "nit" : "major",
            detail: hasKo
              ? "레딧 관심 탭에서 한글명 열을 확인함."
              : "레딧 관심 탭에 들어갔으나 한글명 열이 보이지 않음.",
            suggestion: hasKo
              ? "한글명·로딩 체감을 유지한다."
              : "한글명 컬럼이 보이도록 표를 확인한다.",
            screenshot: await shot(page, `${persona.id}_reddit`),
          });
        },
      },
      {
        id: "nasdaq-etf-micro",
        run: async () => {
          const btn = page.locator(".app__nasdaq-etf-micro, [data-vu='nasdaq-etf-micro']").first();
          if ((await btn.count()) === 0) {
            observations.push({
              ok: false,
              step: "nasdaq-etf-micro",
              area: "navigation",
              severity: "major",
              detail: "좌상단 나스닥 ETF 작은 진입 버튼을 찾지 못함.",
              suggestion: "S&P 원형 아래 ETF 진입이 보이는지 확인한다.",
              screenshot: await shot(page, `${persona.id}_etf_missing`),
            });
            return;
          }
          await btn.click({ timeout: 8_000 });
          await page.waitForTimeout(800);
          observations.push({
            ok: true,
            step: "nasdaq-etf-micro",
            area: "navigation",
            severity: "minor",
            detail: "좌상단 ETF 마이크로 버튼으로 나스닥 ETF 화면 진입.",
            suggestion: "탭이 아닌 마이크로 진입 경로를 유지한다.",
            screenshot: await shot(page, `${persona.id}_etf`),
          });
        },
      },
      {
        id: "tab-account-manage",
        run: async () => {
          await clickTabByText(page, "계좌관리");
          await page.waitForTimeout(1000);
          observations.push({
            ok: true,
            step: "tab-account-manage",
            area: "account-manage",
            severity: "minor",
            detail: "계좌관리 탭 진입. 로그인·연동 상태에 따라 본문이 달라질 수 있음.",
            suggestion: "비로그인 안내와 연동 후 요약 툴바를 구분한다.",
            screenshot: await shot(page, `${persona.id}_account`),
          });
        },
      },
      {
        id: "rebalance-schedule-preview",
        run: async () => {
          await ensureAccountManageTab(page, "계좌관리", 10_000);
          const manageReady = await waitVisibleLocator(
            page,
            '[data-vu="account-manage-ready"]',
            12_000,
          );
          if (!manageReady) {
            await waitVisibleLocator(page, '[data-vu="account-manage-guest"]', 3_000);
            await waitVisibleLocator(page, '[data-vu="account-manage-shell"]', 3_000);
            await waitVisibleLocator(page, '[data-vu="account-manage-loading"]', 3_000);
          }

          let openBtn = await waitVisibleLocator(
            page,
            '[data-vu="account-rebalance-open"]',
            6_000,
          );
          if (!openBtn) {
            observations.push({
              ok: true,
              step: "rebalance-schedule-preview",
              area: "rebalance",
              severity: "minor",
              detail:
                "스케줄 버튼을 찾지 못함(토스 미연동·비로그인·로딩 중 가능). 실주문 없이 탐색만 수행.",
              suggestion: "연동 시에만 스케줄/즉시매수가 보이게 하거나 안내한다.",
              screenshot: await shot(page, `${persona.id}_no_schedule`),
            });
            return;
          }
          if (!(await safeClick(openBtn))) {
            await ensureAccountManageTab(page, "계좌관리", 8_000);
            openBtn = await waitVisibleLocator(
              page,
              '[data-vu="account-rebalance-open"]',
              4_000,
            );
            if (!openBtn || !(await safeClick(openBtn))) {
              observations.push({
                ok: true,
                step: "rebalance-schedule-preview",
                area: "rebalance",
                severity: "minor",
                detail:
                  "스케줄 버튼 클릭 중 화면 전환·리렌더로 중단(실주문 없음).",
                suggestion: "스케줄 버튼·모달 data-vu 마커와 로딩 상태를 안정화한다.",
                screenshot: await shot(page, `${persona.id}_no_schedule`),
              });
              return;
            }
          }

          const modal = await waitVisibleLocator(
            page,
            '[data-vu="account-rebalance-modal"]',
            8_000,
          );
          if (!modal) {
            observations.push({
              ok: true,
              step: "rebalance-schedule-preview",
              area: "rebalance",
              severity: "minor",
              detail: "스케줄 버튼 클릭 후 모달이 열리지 않음.",
              suggestion: "모달 마운트·data-vu 마커를 유지한다.",
              screenshot: await shot(page, `${persona.id}_no_schedule`),
            });
            return;
          }

          await waitVisibleLocator(page, '[data-vu="account-rebalance-ready"]', 8_000);
          await waitHiddenLocator(
            page,
            '[data-vu="account-rebalance-loading"]',
            15_000,
          );

          const dry = await waitVisibleLocator(
            page,
            '.account-rebalance-modal [data-vu="account-rebalance-dry-run"]',
            8_000,
          );
          if (dry) {
            await safeClick(dry, 8_000);
            await page.waitForTimeout(1200);
          }

          // 모달 안 즉시 매수만 — 툴바 버튼(동일 문구)과 구분. confirm은 dialog handler가 dismiss
          const buy = await waitVisibleLocator(
            page,
            '.account-rebalance-modal [data-vu="account-rebalance-buy-now"]',
            3_000,
          );
          if (buy) {
            await safeClick(buy, 5_000);
            await page.waitForTimeout(400);
          }

          const close = await waitVisibleLocator(
            page,
            '[data-vu="account-rebalance-close"]',
            5_000,
          );
          if (close) {
            await safeClick(close, 5_000);
          }

          observations.push({
            ok: true,
            step: "rebalance-schedule-preview",
            area: "rebalance",
            severity: "major",
            detail:
              "스케줄 모달 열기·미리보기 실행까지 수행. 즉시 매수 confirm은 거절(실주문 차단). 시장 on/off·원화/달러 구분 가독성을 확인함.",
            suggestion:
              "미리보기와 실주문을 시각적으로 더 분리하고, 정규장 안내를 유지한다.",
            screenshot: await shot(page, `${persona.id}_rebalance`),
          });
        },
      },
      {
        id: "tab-stock-vault",
        run: async () => {
          await clickTabByText(page, "종목보관");
          await page.waitForTimeout(800);
          observations.push({
            ok: true,
            step: "tab-stock-vault",
            area: "stock-vault",
            severity: satisfactionLevel >= 3 ? "nit" : "minor",
            detail: `종목보관 탭 진입 (만족도 ${satisfactionLevel}). 필터·목록 가독성 확인.`,
            suggestion: "홈(종목보관) 첫 화면 안내·필터 기본값을 유지한다.",
            screenshot: await shot(page, `${persona.id}_vault`),
          });
        },
      },
      {
        id: "tab-stock-lookup",
        run: async () => {
          await clickTabByText(page, "종목 검색");
          await page.waitForTimeout(500);
          observations.push({
            ok: true,
            step: "tab-stock-lookup",
            area: "navigation",
            severity: "nit",
            detail: "종목 검색 탭으로 복귀.",
            suggestion: "기본 홈 탭 복귀 경로를 유지한다.",
            screenshot: await shot(page, `${persona.id}_lookup`),
          });
        },
      },
    ];

    const coreIds = new Set([
      "tab-account-manage",
      "rebalance-schedule-preview",
      "tab-stock-lookup",
    ]);
    if (satisfactionLevel >= 2) {
      coreIds.add("tab-reddit");
      coreIds.add("nasdaq-etf-micro");
    }
    if (satisfactionLevel >= 3) {
      coreIds.add("tab-screener");
      coreIds.add("tab-recommendations");
      coreIds.add("tab-stock-vault");
    }
    const stepsForLevel =
      satisfactionLevel >= 4
        ? steps
        : steps.filter((s) => coreIds.has(s.id));

    const focus = new Set(persona.focusAreas || []);
    const ordered = [
      ...stepsForLevel.filter((s) => {
        if (!focus.size || satisfactionLevel >= 3) return true;
        if (s.id.includes("account") || s.id.includes("rebalance"))
          return focus.has("account-manage") || focus.has("rebalance") || focus.has("orders");
        if (
          s.id.includes("reddit") ||
          s.id.includes("etf") ||
          s.id.includes("screener") ||
          s.id.includes("reco") ||
          s.id.includes("vault")
        )
          return focus.has("navigation") || focus.has("mobile") || true;
        return true;
      }),
    ];
    const seen = new Set();
    const finalSteps = [];
    for (const s of [...ordered, ...stepsForLevel]) {
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      finalSteps.push(s);
    }

    for (const step of finalSteps) {
      try {
        await step.run();
      } catch (e) {
        observations.push({
          ok: false,
          step: step.id,
          area: "navigation",
          severity: "major",
          detail: `스텝 실패(${step.id}): ${e instanceof Error ? e.message : String(e)} — 이후 스텝 계속`,
          suggestion: "해당 UI 셀렉터·로딩 상태를 점검한다. 세션은 중단하지 않고 이어간다.",
          screenshot: await shot(page, `${persona.id}_${step.id}_err`),
        });
      }
    }

    await safeClosePlaywright(context, browser);
    context = null;
    browser = null;

    return {
      ok: observations.some((o) => o.ok),
      mode: "browser",
      observations,
    };
  } catch (e) {
    await safeClosePlaywright(context, browser);
    context = null;
    browser = null;
    return {
      ok: false,
      mode: "browser",
      error: e instanceof Error ? e.message : String(e),
      observations,
    };
  }
}
