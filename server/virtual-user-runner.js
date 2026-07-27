/**
 * 가상 사용자 세션 실행 — 페르소나·포커스 영역 기준으로 프롬프트형 피드백 생성
 */
import { randomUUID } from "crypto";
import {
  appendVirtualFeedbackSync,
  appendVirtualSessionSync,
  listVirtualPersonasSync,
  patchVirtualFeedbackSync,
} from "./virtual-user-store.js";
import { notifyVirtualUserFeedback } from "./virtual-user-telegram.js";

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
    title: "시장 켜짐/꺼짐 상태가 한눈에 안 들어온다",
    detail:
      "계좌관리 → 스케줄 모달에서 국내/미국 칩이 비슷해 보여, 무엇이 켜져 있는지 확신이 없다. 원화·달러 현금이 있는데도 금액이 한 통화로 섞여 보이는 느낌이 든다.",
    suggestion:
      "시장 칩에 「켜짐/꺼짐」과 통화(원화/달러) 라벨을 명확히 하고, 미리보기를 국내=원화·미국=달러로 분리 표시한다.",
    skills: ["beginner", "intermediate"],
  },
  {
    area: "rebalance",
    areaLabel: "월별 비중 유지·즉시 매수",
    severity: "blocker",
    title: "시간외·애프터장에도 즉시 매수가 가능해 보인다",
    detail:
      "즉시 매수는 소수점 매수가 되는 정규장에만 의미가 있는데, 장외에도 버튼이 살아 있으면 실수로 주문하거나 실패만 반복할 것 같다.",
    suggestion:
      "즉시 매수는 정규장(국내 09:00–15:30, 미국 09:30–16:00 ET)에만 활성화하고, 장외에는 사유를 짧게 안내한다.",
    skills: ["intermediate", "power"],
  },
  {
    area: "account-manage",
    areaLabel: "계좌관리",
    severity: "minor",
    title: "보유 비중과 현금 요약의 관계가 어렵다",
    detail:
      "원형 차트·목록·현금이 한 화면에 있지만, ‘지금 남은 현금으로 비중을 유지하려면 어디를 눌러야 하는지’ 초보 기준으로 경로가 길다.",
    suggestion:
      "「즉시 매수」「스케줄」 위치를 요약 툴바에 유지하고, 첫 방문 시 한 줄 힌트를 제공한다.",
    skills: ["beginner"],
  },
  {
    area: "account-manage",
    areaLabel: "계좌관리",
    severity: "major",
    title: "원화/달러 표시 전환과 실제 매수 통화가 헷갈린다",
    detail:
      "표시 통화를 바꿔도 실제 주문은 시장별 원통화라는 점이 UI에 약하다. 달러로 보고 있는데 국내 매수가 원화로 나가는 상황을 걱정한다.",
    suggestion:
      "표시 통화 토글 옆에 ‘주문은 시장별 원통화’ 짧은 고지를 넣고, 즉시 매수 확인창에도 동일 문구를 넣는다.",
    skills: ["beginner", "intermediate"],
  },
  {
    area: "orders",
    areaLabel: "주문·실행",
    severity: "major",
    title: "실주문 전 미리보기와 실행의 차이가 불명확하다",
    detail:
      "「미리보기 실행」과 「지금 즉시 매수」 차이가 버튼만으로는 약하다. 미리보기가 실제 주문처럼 느껴질 수 있다.",
    suggestion:
      "미리보기는 secondary, 즉시 매수는 primary+확인 다이얼로그로 역할을 더 분리하고 성공 메시지에 ‘실제 주문 없음/있음’을 분명히 한다.",
    skills: ["beginner", "intermediate", "power"],
  },
  {
    area: "auth",
    areaLabel: "로그인·인증",
    severity: "minor",
    title: "로그인 OTP와 회원가입 OTP가 같은 흐름인지 불안하다",
    detail:
      "이메일 인증이 로그인에도 있으면 좋지만, 초보 입장에서는 ‘왜 또 코드를 받지?’라는 질문이 생긴다.",
    suggestion:
      "로그인 OTP 화면에 한 줄 설명(본인 확인용)을 유지하고, 재전송·유효시간 안내를 눈에 띄게 한다.",
    skills: ["beginner"],
  },
  {
    area: "navigation",
    areaLabel: "탐색·내비게이션",
    severity: "minor",
    title: "관리자·피드백·계좌관리 진입점이 분산되어 있다",
    detail:
      "가상 사용자 피드백을 확인하려면 관리자 모달까지 가야 하고, 일반 불편 접수와 이름이 비슷하면 혼동된다.",
    suggestion:
      "관리자 탭에서 「가상 사용자」를 일반 「불편 접수함」과 명확히 분리된 라벨로 유지한다.",
    skills: ["power", "intermediate"],
  },
  {
    area: "mobile",
    areaLabel: "모바일",
    severity: "major",
    title: "좁은 화면에서 스케줄 모달 하단 버튼이 가려질 수 있다",
    detail:
      "미리보기·즉시 매수·저장이 한 줄에 있으면 모바일에서 탭하기 어렵고, 스크롤 끝인지 알기 어렵다.",
    suggestion:
      "모달 footer를 wrap하고, 즉시 매수 버튼을 시각적으로 가장 강조한다. 하단 safe-area를 확보한다.",
    devices: ["mobile"],
    skills: ["power", "intermediate"],
  },
  {
    area: "rebalance",
    areaLabel: "월별 비중 유지·즉시 매수",
    severity: "nit",
    title: "국내 현금은 있는데 보유 종목이 없을 때 문구가 불친절하다",
    detail:
      "‘배분할 보유·현금이 부족합니다’는 현금이 있을 때도 나와 원인을 오해하게 만든다.",
    suggestion:
      "현금은 있으나 해당 시장 보유가 없으면 그 사실을 직접 말하는 문구로 바꾼다.",
    skills: ["beginner", "intermediate"],
  },
];

/**
 * @param {string} feedbackId
 * @param {import("./virtual-user-store.js").VirtualPersona} persona
 * @param {ScenarioSeed} seed
 * @param {string} sessionId
 */
export function buildVirtualFeedbackPrompt(feedbackId, persona, seed, sessionId) {
  return [
    "# 가상 사용자 피드백 구현 요청",
    "",
    "당신은 Stock 앱(React+Vite+Express) 코딩 에이전트다. 아래 UX 피드백을 **최소 diff**로 반영하라.",
    "관련 없는 리팩터·좌측 열 레이아웃 변경 금지. 끝나면 git commit 후 git push.",
    "",
    "## 메타",
    `- feedbackId: ${feedbackId}`,
    `- sessionId: ${sessionId}`,
    `- persona: ${persona.name} (${persona.id})`,
    `- skill: ${persona.skill}`,
    `- device: ${persona.device}`,
    `- severity: ${seed.severity}`,
    `- area: ${seed.area} (${seed.areaLabel})`,
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
    "",
    "## 기대 결과 / 제안",
    seed.suggestion,
    "",
    "## 구현 체크",
    "- [ ] 문제 재현 경로를 코드에서 확인했다",
    "- [ ] UI/카피/동작 중 필요한 것만 고쳤다",
    "- [ ] 정규장·통화 분리 등 기존 제약을 깨지 않았다",
    "- [ ] 커밋·푸시까지 완료했다",
    "",
    "## 완료 보고 (짧게)",
    "무엇을 바꿨는지 한두 문장으로 남긴다.",
  ].join("\n");
}

/**
 * @param {import("./virtual-user-store.js").VirtualPersona} persona
 * @param {number} [maxItems]
 * @returns {ScenarioSeed[]}
 */
export function pickSeedsForPersona(persona, maxItems = 2) {
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
  const day = new Date().toISOString().slice(0, 10);
  const scored = list.map((s, i) => {
    let h = 0;
    const key = `${persona.id}:${day}:${s.area}:${s.title}:${i}`;
    for (let j = 0; j < key.length; j++) h = (h * 31 + key.charCodeAt(j)) >>> 0;
    return { s, h };
  });
  scored.sort((a, b) => a.h - b.h);
  /** @type {ScenarioSeed[]} */
  const picked = [];
  const seenAreas = new Set();
  for (const { s } of scored) {
    if (picked.length >= maxItems) break;
    if (seenAreas.has(s.area) && picked.length + 1 < maxItems) continue;
    picked.push(s);
    seenAreas.add(s.area);
  }
  if (picked.length === 0 && list[0]) picked.push(list[0]);
  return picked;
}

/**
 * @param {{ personaId?: string; maxPerPersona?: number; notifyTelegram?: boolean }} [opts]
 */
export async function runVirtualUserSession(opts = {}) {
  const startedAtMs = Date.now();
  const sessionId = randomUUID();
  const maxPer = Math.min(4, Math.max(1, Number(opts.maxPerPersona) || 2));
  const notify = opts.notifyTelegram !== false;

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

  for (const persona of personas) {
    const seeds = pickSeedsForPersona(persona, maxPer);
    for (const seed of seeds) {
      const res = appendVirtualFeedbackSync({
        personaId: persona.id,
        personaName: persona.name,
        sessionId,
        severity: seed.severity,
        area: seed.area,
        title: seed.title,
        detail: seed.detail,
        suggestion: seed.suggestion,
        prompt: "(생성 중)",
        status: "new",
      });
      if (!res.ok || !res.item) continue;

      const prompt = buildVirtualFeedbackPrompt(
        res.item.id,
        persona,
        seed,
        sessionId,
      );
      const patched = patchVirtualFeedbackSync(res.item.id, { prompt });
      const item = patched.ok && patched.item ? patched.item : { ...res.item, prompt };
      created.push(item);
      feedbackIds.push(item.id);

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
    }
  }

  appendVirtualSessionSync({
    id: sessionId,
    startedAtMs,
    finishedAtMs: Date.now(),
    personaIds: personas.map((p) => p.id),
    feedbackIds,
    ok: true,
    error: null,
  });

  return {
    ok: true,
    sessionId,
    createdCount: created.length,
    feedback: created,
    personas: personas.map((p) => ({ id: p.id, name: p.name })),
  };
}
