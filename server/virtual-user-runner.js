/**
 * 가상 사용자 세션 실행
 * - 기본: Playwright 브라우저 클릭 여정 (실주문 이중 차단)
 * - 보강: 시나리오 시드 피드백
 * - 스텝 실패해도 세션을 중간에 끊지 않음
 */
import { randomUUID } from "crypto";
import {
  appendVirtualFeedbackSync,
  appendVirtualSessionSync,
  listVirtualPersonasSync,
  patchVirtualFeedbackSync,
} from "./virtual-user-store.js";
import { notifyVirtualUserFeedback } from "./virtual-user-telegram.js";
import { runVirtualUserBrowserJourney } from "./virtual-user-browser.js";

/**
 * @typedef {{
 *   area: string;
 *   areaLabel: string;
 *   severity: "blocker"|"major"|"minor"|"nit";
 *   title: string;
 *   detail: string;
 *   suggestion: string;
 *   skills?: Array<"beginner"|"intermediate"|"power">;
 *   devices?: Array<"desktop"|"mobile">;
 * }} ScenarioSeed
 */

/** @type {ScenarioSeed[]} */
const SCENARIO_SEEDS = [
  {
    area: "rebalance",
    areaLabel: "월별 비중 유지·즉시 매수",
    severity: "major",
    title: "시장 켜짐/꺼짐·통화 구분이 한눈에 안 들어온다",
    detail:
      "스케줄 모달에서 국내/미국·원화/달러가 섞여 보이면 초보·중급 모두 확신이 없다.",
    suggestion:
      "시장 칩에 켜짐/꺼짐·통화 라벨, 미리보기는 시장별 원통화로 분리한다.",
    skills: ["beginner", "intermediate", "power"],
  },
  {
    area: "rebalance",
    areaLabel: "월별 비중 유지·즉시 매수",
    severity: "blocker",
    title: "즉시 매수는 정규장·실주문 위험이 분명해야 한다",
    detail:
      "가상 사용자는 실주문을 수행하지 않지만, UI상 실주문 버튼과 미리보기가 비슷하면 위험하다.",
    suggestion:
      "미리보기와 즉시 매수를 시각·카피로 분리하고 정규장 안내를 유지한다.",
    skills: ["beginner", "intermediate", "power"],
  },
  {
    area: "account-manage",
    areaLabel: "계좌관리",
    severity: "minor",
    title: "비중 차트와 즉시 매수 경로가 멀다",
    detail: "현금으로 비중 유지 매수를 하려면 어디를 눌러야 하는지 경로가 길다.",
    suggestion: "요약 툴바에 스케줄·즉시 매수 진입을 유지한다.",
    skills: ["beginner", "intermediate"],
  },
  {
    area: "navigation",
    areaLabel: "탐색",
    severity: "minor",
    title: "나스닥 ETF·레딧·계좌 진입이 분산되어 있다",
    detail: "탭·마이크로 버튼·관리자 메뉴가 나뉘어 첫 방문자가 헤맬 수 있다.",
    suggestion: "주요 진입 라벨을 짧게 통일하고 위치를 고정한다.",
    skills: ["beginner", "intermediate", "power"],
  },
  {
    area: "mobile",
    areaLabel: "모바일",
    severity: "major",
    title: "좁은 화면에서 모달 하단 액션이 가려질 수 있다",
    detail: "스케줄 모달 footer 버튼이 wrap·safe-area 없이 겹치면 탭이 어렵다.",
    suggestion: "모달 footer wrap + 즉시 매수 강조.",
    devices: ["mobile"],
    skills: ["power", "intermediate"],
  },
];

/**
 * @param {string} feedbackId
 * @param {import("./virtual-user-store.js").VirtualPersona} persona
 * @param {{ severity: string; area: string; areaLabel?: string; title: string; detail: string; suggestion: string }} seed
 * @param {string} sessionId
 * @param {string} [extra]
 */
export function buildVirtualFeedbackPrompt(
  feedbackId,
  persona,
  seed,
  sessionId,
  extra = "",
) {
  return [
    "# 가상 사용자 피드백 구현 요청",
    "",
    "당신은 Stock 앱(React+Vite+Express) 코딩 에이전트다. 아래 UX 피드백을 **최소 diff**로 반영하라.",
    "관련 없는 리팩터·좌측 열 레이아웃 변경 금지. 실주문/돈이 나가는 동작은 추가하지 말 것. 끝나면 git commit 후 git push.",
    "",
    "## 메타",
    `- feedbackId: ${feedbackId}`,
    `- sessionId: ${sessionId}`,
    `- persona: ${persona.name} (${persona.id})`,
    `- skill: ${persona.skill}`,
    `- device: ${persona.device}`,
    `- severity: ${seed.severity}`,
    `- area: ${seed.area}${seed.areaLabel ? ` (${seed.areaLabel})` : ""}`,
    "",
    "## 페르소나 관점",
    persona.traits || "(없음)",
    "",
    "### 목표",
    ...(persona.goals?.length
      ? persona.goals.map((g) => `- ${g}`)
      : ["- (목표 없음)"]),
    "",
    "## 문제 (사용자 관찰)",
    seed.title,
    "",
    seed.detail,
    extra ? `\n### 브라우저 여정 메모\n${extra}\n` : "",
    "## 기대 결과 / 제안",
    seed.suggestion,
    "",
    "## 구현 체크",
    "- [ ] 문제 재현 경로를 코드에서 확인했다",
    "- [ ] UI/카피/동작 중 필요한 것만 고쳤다",
    "- [ ] 실주문·출금 등 돈이 나가는 경로를 늘리지 않았다",
    "- [ ] 커밋·푸시까지 완료했다",
  ].join("\n");
}

/**
 * @param {import("./virtual-user-store.js").VirtualPersona} persona
 * @param {number} [maxItems]
 */
export function pickSeedsForPersona(persona, maxItems = 4) {
  const pool = SCENARIO_SEEDS.filter((s) => {
    if (s.devices && !s.devices.includes(persona.device)) return false;
    if (s.skills && !s.skills.includes(persona.skill)) return false;
    if (persona.focusAreas?.length) {
      return persona.focusAreas.some(
        (a) => a === s.area || s.area.startsWith(a) || a.startsWith(s.area),
      );
    }
    return true;
  });
  const list = pool.length ? pool : SCENARIO_SEEDS;
  return list.slice(0, Math.max(1, maxItems));
}

/**
 * @param {import("./virtual-user-store.js").VirtualPersona} persona
 * @param {string} sessionId
 * @param {{ severity: string; area: string; areaLabel?: string; title: string; detail: string; suggestion: string }} seed
 * @param {boolean} notify
 * @param {string} [extra]
 */
async function emitFeedback(persona, sessionId, seed, notify, extra = "") {
  const res = appendVirtualFeedbackSync({
    personaId: persona.id,
    personaName: persona.name,
    sessionId,
    severity: /** @type {"blocker"|"major"|"minor"|"nit"} */ (seed.severity),
    area: seed.area,
    title: seed.title,
    detail: seed.detail,
    suggestion: seed.suggestion,
    prompt: "(생성 중)",
    status: "new",
  });
  if (!res.ok || !res.item) return null;

  const prompt = buildVirtualFeedbackPrompt(
    res.item.id,
    persona,
    seed,
    sessionId,
    extra,
  );
  const patched = patchVirtualFeedbackSync(res.item.id, { prompt });
  const item = patched.ok && patched.item ? patched.item : { ...res.item, prompt };

  if (notify) {
    try {
      const tg = await notifyVirtualUserFeedback(item);
      if (tg?.ok && tg.sentAtMs) {
        patchVirtualFeedbackSync(item.id, { telegramSentAtMs: tg.sentAtMs });
        item.telegramSentAtMs = tg.sentAtMs;
      }
    } catch {
      /* optional */
    }
  }
  return item;
}

/**
 * @param {{ personaId?: string; maxPerPersona?: number; notifyTelegram?: boolean; useBrowser?: boolean }} [opts]
 */
export async function runVirtualUserSession(opts = {}) {
  const startedAtMs = Date.now();
  const sessionId = randomUUID();
  const maxPer = Math.min(8, Math.max(2, Number(opts.maxPerPersona) || 4));
  const notify = opts.notifyTelegram !== false;
  const useBrowser = opts.useBrowser !== false;

  const personas = listVirtualPersonasSync().filter((p) => {
    if (!p.enabled) return false;
    if (opts.personaId) return p.id === opts.personaId;
    return true;
  });

  if (!personas.length) {
    return {
      ok: false,
      error: "실행할 활성 페르소나가 없습니다.",
      sessionId,
      feedback: [],
    };
  }

  /** @type {string[]} */
  const feedbackIds = [];
  /** @type {import("./virtual-user-store.js").VirtualFeedback[]} */
  const created = [];
  /** @type {string[]} */
  const personaErrors = [];

  for (const persona of personas) {
    try {
      if (useBrowser) {
        const journey = await runVirtualUserBrowserJourney(persona, sessionId);
        const obs = journey.observations || [];
        for (const o of obs) {
          const item = await emitFeedback(
            persona,
            sessionId,
            {
              severity: o.severity || (o.ok ? "minor" : "major"),
              area: o.area || "navigation",
              areaLabel: "브라우저 여정",
              title: `[브라우저] ${o.step}${o.ok ? "" : " 실패"}`,
              detail: o.detail,
              suggestion:
                o.suggestion ||
                "해당 화면 UX를 페르소나 관점에서 개선한다.",
            },
            notify,
            o.screenshot ? `screenshot: ${o.screenshot}` : "",
          );
          if (item) {
            created.push(item);
            feedbackIds.push(item.id);
          }
        }
        if (journey.error) {
          personaErrors.push(`${persona.id}: ${journey.error}`);
          const item = await emitFeedback(
            persona,
            sessionId,
            {
              severity: "blocker",
              area: "navigation",
              title: "브라우저 여정 오류",
              detail: journey.error,
              suggestion:
                "Playwright Chromium 설치·VIRTUAL_USER_BASE_URL·서버 기동을 확인한다.",
            },
            notify,
          );
          if (item) {
            created.push(item);
            feedbackIds.push(item.id);
          }
        }
      }

      // 시드 보강 — 브라우저와 별도로 전부 남김(중도 생략 금지)
      const seeds = pickSeedsForPersona(persona, maxPer);
      for (const seed of seeds) {
        const item = await emitFeedback(persona, sessionId, seed, notify);
        if (item) {
          created.push(item);
          feedbackIds.push(item.id);
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      personaErrors.push(`${persona.id}: ${msg}`);
      const item = await emitFeedback(
        persona,
        sessionId,
        {
          severity: "blocker",
          area: "navigation",
          title: "페르소나 세션 예외",
          detail: `페르소나 처리 중 예외가 났지만 다른 페르소나는 계속합니다. ${msg}`,
          suggestion: "예외 스택·셀렉터·타임아웃을 점검한다.",
        },
        notify,
      );
      if (item) {
        created.push(item);
        feedbackIds.push(item.id);
      }
    }
  }

  appendVirtualSessionSync({
    id: sessionId,
    startedAtMs,
    finishedAtMs: Date.now(),
    personaIds: personas.map((p) => p.id),
    feedbackIds,
    ok: personaErrors.length === 0,
    error: personaErrors.length ? personaErrors.join(" | ") : null,
  });

  return {
    ok: true,
    sessionId,
    createdCount: created.length,
    feedback: created,
    personas: personas.map((p) => ({ id: p.id, name: p.name })),
    warnings: personaErrors,
    mode: useBrowser ? "browser+seeds" : "seeds",
  };
}
