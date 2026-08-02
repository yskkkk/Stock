/**
 * 가상 사용자 세션 실행
 * - Playwright 브라우저 클릭 여정 (실주문 이중 차단)
 * - 시나리오 시드 + 만족도별 심화 시드
 * - 동일 피드백 중복 스킵 → 포화 시 만족도 자동 상승
 * - 스텝 실패해도 세션을 중간에 끊지 않음
 */
import { randomUUID } from "crypto";
import {
  appendVirtualFeedbackSync,
  appendVirtualSessionSync,
  bumpPersonaSatisfactionSync,
  listVirtualFeedbackSync,
  listVirtualPersonasSync,
  patchVirtualFeedbackSync,
} from "./virtual-user-store.js";
import { notifyVirtualUserFeedback } from "./virtual-user-telegram.js";
import { runVirtualUserBrowserJourney } from "./virtual-user-browser.js";
import {
  BACKEND_SCENARIO_SEEDS,
  collectVirtualUserBackendFindings,
} from "./virtual-user-backend-probe.js";
import {
  allowedSeveritiesForSatisfaction,
  feedbackFingerprint,
  isFeedbackDuplicate,
  knownFingerprintsForPersona,
  satisfactionLabelKo,
  shouldEscalateSatisfaction,
  clampSatisfactionLevel,
} from "./virtual-user-satisfaction.js";
import { buildContinuousNoveltySeeds } from "./virtual-user-novelty.js";
import {
  buildVuUiDirectionPromptBlock,
  vuUiDirectionSuggestionGuard,
} from "../shared/virtual-user-ui-direction.js";

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
 *   minSatisfaction?: number;
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
    minSatisfaction: 1,
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
    minSatisfaction: 1,
  },
  {
    area: "account-manage",
    areaLabel: "계좌관리",
    severity: "minor",
    title: "비중 차트와 즉시 매수 경로가 멀다",
    detail: "현금으로 비중 유지 매수를 하려면 어디를 눌러야 하는지 경로가 길다.",
    suggestion: "요약 툴바에 스케줄·즉시 매수 진입을 유지한다.",
    skills: ["beginner", "intermediate"],
    minSatisfaction: 1,
  },
  {
    area: "navigation",
    areaLabel: "탐색",
    severity: "minor",
    title: "나스닥 ETF·레딧·계좌 진입이 분산되어 있다",
    detail: "탭·마이크로 버튼·관리자 메뉴가 나뉘어 첫 방문자가 헤맬 수 있다.",
    suggestion: "주요 진입 라벨을 짧게 통일하고 위치를 고정한다.",
    skills: ["beginner", "intermediate", "power"],
    minSatisfaction: 1,
  },
  {
    area: "mobile",
    areaLabel: "모바일",
    severity: "major",
    title: "좁은 화면에서 모달 하단 액션이 가려질 수 있다",
    detail: "스케줄 모달 footer 버튼이 wrap·safe-area 없이 겹치면 탭이 어렵다.",
    suggestion:
      "모달 footer wrap + 즉시 매수 강조. 레이아웃 틀(3열·좌측 열)은 건드리지 않는다.",
    devices: ["mobile"],
    skills: ["power", "intermediate", "beginner"],
    minSatisfaction: 1,
  },
  {
    area: "mobile",
    areaLabel: "모바일",
    severity: "major",
    title: "가로로 밀려 스크롤하거나 버튼이 잘린다",
    detail:
      "390px 전후에서 표·툴바·칩 줄이 화면 밖으로 나가면 한 손으로 쓰기 불편하다.",
    suggestion:
      "줄바꿈·min-width 완화·overflow만 기존 컴포넌트 안에서 고친다. 앱 골격·좌측 열 구조는 변경 금지.",
    devices: ["mobile"],
    skills: ["beginner", "intermediate", "power"],
    minSatisfaction: 1,
  },
  {
    area: "mobile",
    areaLabel: "모바일",
    severity: "minor",
    title: "메인 탭이 많아 현재 탭을 찾기 어렵다",
    detail: "가로 스크롤 탭에서 활성 표시가 약하면 어디에 있는지 헤맨다.",
    suggestion:
      "활성 탭 대비·스크롤 위치만 보강한다. 탭 구조·개수 재배치는 하지 않는다.",
    devices: ["mobile"],
    skills: ["beginner", "intermediate", "power"],
    minSatisfaction: 2,
  },
  {
    area: "mobile",
    areaLabel: "모바일",
    severity: "minor",
    title: "계좌관리 요약 카드가 세로로 너무 길어 핵심이 아래로 밀린다",
    detail: "현금·비중·버튼이 한 화면에 안 들어오면 스크롤 피로가 크다.",
    suggestion:
      "카드 안 간격·폰트·접기만 조정한다. 좌측 열·3열 그리드 틀은 바꾸지 않는다.",
    devices: ["mobile"],
    skills: ["beginner", "intermediate"],
    minSatisfaction: 2,
  },
  {
    area: "mobile",
    areaLabel: "모바일",
    severity: "nit",
    title: "터치 타깃이 손가락보다 작아 오탭이 난다",
    detail: "작은 칩·아이콘이 인접하면 잘못된 탭을 누른다.",
    suggestion:
      "주요 액션 min 터치 영역(패딩)만 확보한다. 버튼 위치 골격은 유지한다.",
    devices: ["mobile"],
    skills: ["power", "intermediate", "beginner"],
    minSatisfaction: 3,
  },
  {
    area: "mobile",
    areaLabel: "모바일",
    severity: "nit",
    title: "safe-area(노치·홈바)에 하단 버튼이 겹친다",
    detail: "iPhone 홈 인디케이터에 footer가 가려지면 탭이 불안하다.",
    suggestion:
      "env(safe-area-inset-*) padding만 추가한다. 전체 레이아웃 틀은 유지한다.",
    devices: ["mobile"],
    skills: ["power", "intermediate"],
    minSatisfaction: 4,
  },
  {
    area: "account-manage",
    areaLabel: "계좌관리",
    severity: "minor",
    title: "원화·달러 현금을 한 칸에 합치면 잔고가 헷갈린다",
    detail: "원화 계좌와 달러 계좌를 따로 쓰는데 합산만 보이면 가용 현금을 오해한다.",
    suggestion: "요약에 원화 현금·달러 현금을 분리 표시한다.",
    skills: ["beginner", "intermediate", "power"],
    minSatisfaction: 2,
  },
  {
    area: "navigation",
    areaLabel: "탐색",
    severity: "nit",
    title: "브랜드(YSTOCK)로 홈(종목보관) 복귀가 직관적이어야 한다",
    detail: "다른 탭에 있으면 첫 화면으로 빨리 돌아가고 싶다.",
    suggestion: "로고·제목 클릭 시 종목보관으로 이동한다.",
    skills: ["beginner", "intermediate", "power"],
    minSatisfaction: 2,
  },
  {
    area: "account-manage",
    areaLabel: "계좌관리",
    severity: "nit",
    title: "깨진 한글(????) 라벨이 남아 있으면 신뢰를 잃는다",
    detail: "접기 요약·말풍선에 물음표만 보이면 인코딩·카피 버그로 보인다.",
    suggestion: "표시 문자열 UTF-8을 점검하고 한글 라벨을 복구한다.",
    skills: ["beginner", "intermediate", "power"],
    minSatisfaction: 3,
  },
  {
    area: "rebalance",
    areaLabel: "월별 비중 유지·즉시 매수",
    severity: "nit",
    title: "미리보기 빈 상태가 ‘고장’처럼 느껴질 수 있다",
    detail: "현금·보유가 부족할 때 빈 미리보기가 오류인지 정상인지 구분하기 어렵다.",
    suggestion: "빈 상태에 원인(현금 부족·시장 off)을 짧게 적는다.",
    skills: ["beginner", "intermediate", "power"],
    minSatisfaction: 3,
  },
  {
    area: "stock-vault",
    areaLabel: "종목보관",
    severity: "minor",
    title: "종목보관 첫 진입 시 무엇을 눌러야 할지 모호하다",
    detail: "필터·즐겨찾기·스캔 일자 중 어디가 기본인지 초보에게 부담이다.",
    suggestion: "기본 필터·빈 상태 안내를 한 줄로 고정한다.",
    skills: ["beginner", "intermediate"],
    minSatisfaction: 3,
  },
  {
    area: "navigation",
    areaLabel: "탐색",
    severity: "nit",
    title: "탭이 많아지면 활성 탭을 찾기 어렵다",
    detail: "가로 스크롤·많은 탭에서 현재 위치가 흐리다.",
    suggestion: "활성 탭 대비·스크롤 인디케이터를 강화한다.",
    skills: ["beginner", "intermediate", "power"],
    minSatisfaction: 4,
  },
  {
    area: "account-manage",
    areaLabel: "계좌관리",
    severity: "nit",
    title: "금액 가리기 후에도 차트·말풍선에 숫자가 남을 수 있다",
    detail: "요약만 가리고 차트 호버에 금액이 보이면 프라이버시가 깨진다.",
    suggestion: "숨김 모드를 차트·말풍선까지 일관 적용한다.",
    skills: ["intermediate", "power"],
    minSatisfaction: 4,
  },
  {
    area: "navigation",
    areaLabel: "탐색",
    severity: "nit",
    title: "로딩·빈 상태·에러 카피가 톤이 제각각이다",
    detail: "화면마다 ‘불러오는 중’·‘없음’·‘실패’ 표현이 달라 제품감이 떨어진다.",
    suggestion: "공통 빈/로딩/에러 문구 패턴을 맞춘다.",
    skills: ["beginner", "intermediate", "power"],
    minSatisfaction: 5,
  },
  {
    area: "rebalance",
    areaLabel: "월별 비중 유지·즉시 매수",
    severity: "nit",
    title: "시장 off인데도 주문 행이 남아 있으면 불안하다",
    detail: "꺼진 시장이 미리보기에 회색으로라도 남으면 ‘실행될까’ 걱정된다.",
    suggestion: "off 시장은 목록에서 빼거나 ‘실행 안 함’을 크게 표시한다.",
    skills: ["beginner", "intermediate", "power"],
    minSatisfaction: 5,
  },
  {
    area: "account-manage",
    areaLabel: "계좌관리",
    severity: "minor",
    title: "성장주·가치(방어)·현금 성향 비중이 한눈에 안 들어온다",
    detail:
      "종목·섹터 차트만 있고 성장/가치 성향이 없으면 포트 리스크 감각을 못 잡는다.",
    suggestion:
      "보유 비중 아래에 성장·가치·현금 도넛을 유지하고, 성향 지정 UI와 연결한다.",
    skills: ["beginner", "intermediate", "power"],
    minSatisfaction: 2,
  },
  {
    area: "account-manage",
    areaLabel: "계좌관리",
    severity: "nit",
    title: "성향 「자동」과 「지정」의 차이를 사용자가 모른다",
    detail: "드롭다운에 자동·성장·가치가 있어도 정책 우선순위가 안 보이면 신뢰가 없다.",
    suggestion: "분류 기준(우선순위) 접기 안내와 툴팁을 유지·보강한다.",
    skills: ["beginner", "intermediate", "power"],
    minSatisfaction: 3,
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
  const sat = clampSatisfactionLevel(persona.satisfactionLevel ?? 1);
  const mobile = persona.device === "mobile";
  const suggestion = vuUiDirectionSuggestionGuard(seed.suggestion);
  return [
    "# 가상 사용자 피드백 구현 요청",
    "",
    "당신은 Stock 앱(React+Vite+Express) 코딩 에이전트다. 아래 UX 피드백을 **최소 diff**로 반영하라.",
    "관련 없는 리팩터·좌측 열 레이아웃 변경 금지. 실주문/돈이 나가는 동작은 추가하지 말 것. 끝나면 git commit 후 git push.",
    "UI는 **PC와 모바일을 항상 함께** 맞춘다. 단순 통일(한 레이아웃 복제) 금지 — 미디어쿼리·기존 반응형으로 환경별 간격/줄바꿈/터치를 조정한다.",
    ...(mobile
      ? [
          "이 피드백 device=mobile 이더라도 PC 넓은 뷰가 깨지지 않게 같이 검증한다. **앱 틀(3열·좌측 열·탭 골격)은 바꾸지 말고**, 패딩·줄바꿈·터치·safe-area·모달 footer wrap만 기존 컴포넌트 안에서 고친다.",
        ]
      : [
          "이 피드백 device=desktop 이더라도 좁은 폭(≤900px)·터치 영역이 깨지지 않게 같이 검증한다.",
        ]),
    "",
    buildVuUiDirectionPromptBlock(),
    "",
    "## 메타",
    `- feedbackId: ${feedbackId}`,
    `- sessionId: ${sessionId}`,
    `- persona: ${persona.name} (${persona.id})`,
    `- skill: ${persona.skill}`,
    `- device: ${persona.device}`,
    `- satisfaction: ${sat} (${satisfactionLabelKo(sat)})`,
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
    "## 불편함 (사용자 관찰)",
    seed.title,
    "",
    seed.detail,
    extra ? `\n### 브라우저 여정 메모\n${extra}\n` : "",
    "## 기대 결과 / 제안",
    suggestion,
    "",
    "## 구현 체크",
    "- [ ] 문제 재현 경로를 코드에서 확인했다",
    "- [ ] UI/카피/동작 중 필요한 것만 고쳤다",
    "- [ ] 기존 화면 톤(색·간격·BEM·버튼/칩)을 유지했고, 랜딩식 리디자인을 하지 않았다",
    "- [ ] PC(넓은 뷰)와 모바일(좁은 폭·터치)을 **동시에** 맞췄고, 단순 통일로 한쪽을 희생하지 않았다",
    mobile
      ? "- [ ] 레이아웃 틀(3열·좌측 열·탭 골격)을 바꾸지 않고 터치/간격/줄바꿈만 고쳤다"
      : "- [ ] 좌측 열·3열 그리드 레이아웃을 깨지 않았다",
    "- [ ] 단축 버튼·아이콘이 다른 레일/벨트/목록과 섞이거나 겹치지 않고, 눈에 보이는 정렬·구역으로 배치됐다",
    "- [ ] YS·거래소·레일 아이콘이 라이트/다크에서 보이며 제거되지 않았다",
    "- [ ] 실주문·출금 등 돈이 나가는 경로를 늘리지 않았다",
    "- [ ] 백엔드 이슈면 폴링 주기 조정 대신 실제 실패 원인(예외·깨진 JSON·5xx·가드 누락)을 고쳤다",
    "- [ ] 폴링 주기·의도적(운영자/개발자 요청) 비활성 기능은 바꾸지 않았다",
    "- [ ] 커밋·푸시까지 완료했다",
  ].join("\n");
}

/**
 * @param {import("./virtual-user-store.js").VirtualPersona} persona
 * @param {number} [maxItems]
 * @param {{
 *   satisfactionLevel?: number;
 *   known?: Set<string>;
 *   continuousNovelty?: boolean;
 *   noveltyAngleOffset?: number;
 *   atMs?: number;
 * }} [opts]
 */
export function pickSeedsForPersona(persona, maxItems = 4, opts = {}) {
  const sat = clampSatisfactionLevel(
    opts.satisfactionLevel ?? persona.satisfactionLevel ?? 1,
  );
  const allowed = allowedSeveritiesForSatisfaction(sat);
  const pool = [...SCENARIO_SEEDS, ...BACKEND_SCENARIO_SEEDS].filter((s) => {
    const minSat = s.minSatisfaction ?? 1;
    if (sat < minSat) return false;
    if (!allowed.has(s.severity)) return false;
    if (s.devices && !s.devices.includes(persona.device)) return false;
    if (s.skills && !s.skills.includes(persona.skill)) return false;
    if (persona.focusAreas?.length) {
      const focusHit = persona.focusAreas.some(
        (a) => a === s.area || s.area.startsWith(a) || a.startsWith(s.area),
      );
      const isBackend = String(s.area).startsWith("backend");
      // 만족도 2+ 또는 backend 시드는 포커스 밖도 허용
      if (!focusHit && !isBackend && sat < 3) return false;
    }
    return true;
  });
  const list = pool.length
    ? pool
    : SCENARIO_SEEDS.filter((s) => (s.minSatisfaction ?? 1) <= 1);
  const cap = Math.max(1, maxItems + Math.max(0, sat - 1));
  const maxTake = Math.min(12, cap);

  if (opts.continuousNovelty && opts.known) {
    return buildContinuousNoveltySeeds({
      pool: list,
      known: opts.known,
      fingerprint: feedbackFingerprint,
      maxItems: maxTake,
      personaId: persona.id,
      atMs: opts.atMs,
      angleOffset: opts.noveltyAngleOffset ?? 0,
    });
  }

  // 비연속: 심화·모바일 우선(기존)
  const sorted = [...list].sort((a, b) => {
    if (persona.device === "mobile") {
      const am = a.area === "mobile" ? 1 : 0;
      const bm = b.area === "mobile" ? 1 : 0;
      if (bm !== am) return bm - am;
    }
    const da = a.minSatisfaction ?? 1;
    const db = b.minSatisfaction ?? 1;
    if (db !== da) return db - da;
    return 0;
  });
  return sorted.slice(0, maxTake);
}

/**
 * @param {import("./virtual-user-store.js").VirtualPersona} persona
 * @param {string} sessionId
 * @param {{ severity: string; area: string; areaLabel?: string; title: string; detail: string; suggestion: string }} seed
 * @param {boolean} notify
 * @param {string} [extra]
 * @param {Set<string>} [known]
 */
async function emitFeedback(persona, sessionId, seed, notify, extra = "", known) {
  if (known && isFeedbackDuplicate(known, seed)) {
    return { skipped: true, item: null };
  }

  const res = appendVirtualFeedbackSync({
    personaId: persona.id,
    personaName: persona.name,
    sessionId,
    severity: /** @type {"blocker"|"major"|"minor"|"nit"} */ (seed.severity),
    area: seed.area,
    title: seed.title,
    detail: seed.detail,
    suggestion: seed.suggestion,
    discomfort: [seed.title, seed.detail].filter(Boolean).join("\n\n"),
    prompt: "(생성 중)",
    status: "new",
  });
  if (!res.ok || !res.item) return { skipped: false, item: null };

  if (known) {
    known.add(feedbackFingerprint(seed.area, seed.title));
  }

  const prompt = buildVirtualFeedbackPrompt(
    res.item.id,
    persona,
    seed,
    sessionId,
    extra,
  );
  const patched = patchVirtualFeedbackSync(res.item.id, {
    prompt,
    status: "pending_review",
    improvementSummary:
      "매니저 검토 대기 — 승인된 뒤에만 에이전트 전송 대기열에 들어갑니다.",
  });
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

  // 피드백은 여기까지 저장·적재. 에이전트 전송은 dispatchNext가 FIFO 1건만 담당.
  return { skipped: false, item };
}

/**
 * @param {{
 *   personaId?: string;
 *   maxPerPersona?: number;
 *   notifyTelegram?: boolean;
 *   useBrowser?: boolean;
 *   continuous?: boolean;
 *   personaOffset?: number;
 *   maxPersonasPerTick?: number;
 *   noveltyAngleOffset?: number;
 * }} [opts]
 */
export async function runVirtualUserSession(opts = {}) {
  const startedAtMs = Date.now();
  const sessionId = randomUUID();
  const maxPer = Math.min(10, Math.max(2, Number(opts.maxPerPersona) || 4));
  const notify = opts.notifyTelegram !== false;
  const useBrowser = opts.useBrowser !== false;
  const continuous = opts.continuous === true;
  const noveltyAngleOffset = Math.max(
    0,
    Math.floor(Number(opts.noveltyAngleOffset) || 0),
  );

  let personas = listVirtualPersonasSync().filter((p) => {
    if (!p.enabled) return false;
    if (opts.personaId) return p.id === opts.personaId;
    return true;
  });

  if (continuous && !opts.personaId && personas.length > 1) {
    const maxP = Math.min(
      personas.length,
      Math.max(1, Math.floor(Number(opts.maxPersonasPerTick) || 2)),
    );
    const offset = Math.max(0, Math.floor(Number(opts.personaOffset) || 0));
    const rotated = [];
    for (let i = 0; i < maxP; i++) {
      rotated.push(personas[(offset + i) % personas.length]);
    }
    personas = rotated;
  }

  if (!personas.length) {
    return {
      ok: false,
      error: "실행할 활성 페르소나가 없습니다.",
      sessionId,
      feedback: [],
    };
  }

  const allFeedback = listVirtualFeedbackSync();
  /** 완료 피드백은 7일 후 재검증 허용 — 무한 개선 루프 */
  const DONE_REVISIT_MS = 7 * 24 * 60 * 60 * 1000;

  /** @type {string[]} */
  const feedbackIds = [];
  /** @type {import("./virtual-user-store.js").VirtualFeedback[]} */
  const created = [];
  /** @type {string[]} */
  const personaErrors = [];
  /** @type {Array<{ personaId: string; from: number; to: number }>} */
  const escalations = [];

  for (let persona of personas) {
    const known = knownFingerprintsForPersona(allFeedback, persona.id, {
      allowDoneRevisitAfterMs: continuous ? DONE_REVISIT_MS : 0,
      nowMs: startedAtMs,
    });
    let emitted = 0;
    let skippedDup = 0;
    let candidateCount = 0;
    const sat = clampSatisfactionLevel(persona.satisfactionLevel ?? 1);
    const allowedSev = allowedSeveritiesForSatisfaction(sat);

    try {
      if (useBrowser) {
        const journey = await runVirtualUserBrowserJourney(persona, sessionId, {
          satisfactionLevel: sat,
        });
        const obs = journey.observations || [];
        for (const o of obs) {
          const severity = /** @type {"blocker"|"major"|"minor"|"nit"} */ (
            o.severity || (o.ok ? "minor" : "major")
          );
          // 낮은 만족도: 성공한 nit/minor 관찰은 생략(포화 방지). 실패·심각만.
          if (o.ok && sat < 3 && (severity === "nit" || severity === "minor")) {
            continue;
          }
          if (!allowedSev.has(severity)) continue;
          candidateCount += 1;
          const title = `[브라우저] ${o.step}${o.ok ? "" : " 실패"}`;
          const result = await emitFeedback(
            persona,
            sessionId,
            {
              severity,
              area: o.area || "navigation",
              areaLabel: "브라우저 여정",
              title,
              detail: o.detail,
              suggestion:
                o.suggestion ||
                "해당 화면 UX를 페르소나 관점에서 개선한다.",
            },
            notify,
            o.screenshot ? `screenshot: ${o.screenshot}` : "",
            known,
          );
          if (result.skipped) {
            skippedDup += 1;
            continue;
          }
          if (result.item) {
            created.push(result.item);
            feedbackIds.push(result.item.id);
            emitted += 1;
          }
        }
        if (journey.error) {
          personaErrors.push(`${persona.id}: ${journey.error}`);
          candidateCount += 1;
          const result = await emitFeedback(
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
            "",
            known,
          );
          if (result.skipped) skippedDup += 1;
          else if (result.item) {
            created.push(result.item);
            feedbackIds.push(result.item.id);
            emitted += 1;
          }
        }
      }

      const seeds = pickSeedsForPersona(persona, maxPer, {
        satisfactionLevel: sat,
        known,
        continuousNovelty: continuous,
        noveltyAngleOffset,
        atMs: startedAtMs,
      });
      for (const seed of seeds) {
        candidateCount += 1;
        const result = await emitFeedback(
          persona,
          sessionId,
          seed,
          notify,
          continuous
            ? `연속 탐색 모드 · 만족도 ${sat}(${satisfactionLabelKo(sat)}) · 무한 개선`
            : "",
          known,
        );
        if (result.skipped) {
          skippedDup += 1;
          continue;
        }
        if (result.item) {
          created.push(result.item);
          feedbackIds.push(result.item.id);
          emitted += 1;
        }
      }

      if (
        shouldEscalateSatisfaction({
          emitted,
          skippedDup,
          candidateCount,
          level: sat,
        })
      ) {
        const bump = bumpPersonaSatisfactionSync(persona.id, 1);
        if (bump.ok && bump.escalated && bump.persona) {
          escalations.push({
            personaId: persona.id,
            from: sat,
            to: bump.persona.satisfactionLevel,
          });
          persona = bump.persona;
          // 상승 직후 한 번 더 심화 시드 시도
          const more = pickSeedsForPersona(persona, Math.max(2, Math.ceil(maxPer / 2)), {
            satisfactionLevel: bump.persona.satisfactionLevel,
            known,
            continuousNovelty: continuous,
            noveltyAngleOffset: noveltyAngleOffset + 1,
            atMs: startedAtMs,
          });
          for (const seed of more) {
            candidateCount += 1;
            const result = await emitFeedback(
              persona,
              sessionId,
              seed,
              notify,
              `만족도 상승 후 재탐색 (${sat}→${bump.persona.satisfactionLevel})`,
              known,
            );
            if (result.skipped) skippedDup += 1;
            else if (result.item) {
              created.push(result.item);
              feedbackIds.push(result.item.id);
              emitted += 1;
            }
          }
        }
      }

      // 연속 모드: 여전히 0건이면 각도+1 노벨티로 한 번 더 강제 발굴
      if (continuous && emitted === 0) {
        const forced = pickSeedsForPersona(persona, Math.max(2, maxPer), {
          satisfactionLevel: Math.max(sat, 3),
          known,
          continuousNovelty: true,
          noveltyAngleOffset: noveltyAngleOffset + emitted + 3,
          atMs: startedAtMs + 1,
        });
        for (const seed of forced) {
          candidateCount += 1;
          const result = await emitFeedback(
            persona,
            sessionId,
            seed,
            notify,
            "연속 탐색 포화 돌파 · 강제 재검증",
            known,
          );
          if (result.skipped) skippedDup += 1;
          else if (result.item) {
            created.push(result.item);
            feedbackIds.push(result.item.id);
            emitted += 1;
          }
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      personaErrors.push(`${persona.id}: ${msg}`);
      const result = await emitFeedback(
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
        "",
        known,
      );
      if (result.item) {
        created.push(result.item);
        feedbackIds.push(result.item.id);
      }
    }
  }

  // 백엔드 실동작 결함 (세션당 1회) — 의도적 중지·폴링 주기 제외
  try {
    const backendPersona = personas[0];
    const backendKnown = knownFingerprintsForPersona(
      listVirtualFeedbackSync(),
      backendPersona.id,
    );
    const findings = await collectVirtualUserBackendFindings();
    for (const f of findings) {
      const result = await emitFeedback(
        backendPersona,
        sessionId,
        f,
        notify,
        continuous
          ? "백엔드 프로브 · 운영자/개발자 요청 비활성·폴링 주기 튜닝 제외"
          : "백엔드 프로브",
        backendKnown,
      );
      if (result.skipped) continue;
      if (result.item) {
        created.push(result.item);
        feedbackIds.push(result.item.id);
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    personaErrors.push(`backend-probe: ${msg}`);
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

  // 에이전트 전송은 폴러의 3분 스캔(개발 중 아님)에서만 — 여기서 바로 보내지 않음
  return {
    ok: true,
    sessionId,
    createdCount: created.length,
    feedback: created,
    personas: personas.map((p) => ({
      id: p.id,
      name: p.name,
      satisfactionLevel: p.satisfactionLevel ?? 1,
    })),
    escalations,
    warnings: personaErrors,
    mode: useBrowser ? "browser+seeds+backend" : "seeds+backend",
    continuous,
  };
}
