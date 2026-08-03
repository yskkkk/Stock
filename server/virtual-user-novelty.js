/**
 * 가상 사용자 연속 탐색 — 포화 방지·무한 개선점 발굴
 *
 * 시드 지문이 소진되면 각도(접근성·카피·속도 등) 재검증 시드와
 * 생성형 불편 템플릿으로 항상 새 fingerprint를 만든다.
 */

import { vuUiDirectionSuggestionGuard } from "../shared/virtual-user-ui-direction.js";

/** @typedef {{ id: string; label: string; suffix: string }} NoveltyAngle */

/** @type {NoveltyAngle[]} */
export const NOVELTY_ANGLES = [
  { id: "a11y", label: "접근성", suffix: "키보드·스크린리더·대비" },
  { id: "latency", label: "체감속도", suffix: "로딩·대기·먹통 체감" },
  { id: "copy", label: "카피", suffix: "문구·용어 혼동" },
  { id: "error", label: "오류회복", suffix: "실패·빈 상태 안내" },
  { id: "trust", label: "신뢰", suffix: "실주문·금액·위험 표시" },
  { id: "density", label: "정보밀도", suffix: "한 화면 과밀·스크롤 피로" },
  { id: "consistency", label: "일관성", suffix: "탭·모달 패턴 불일치" },
  { id: "thumb", label: "엄지도달", suffix: "한 손·엄지 존 조작" },
  { id: "first", label: "첫방문", suffix: "발견성·온보딩" },
  { id: "power", label: "파워유저", suffix: "반복·단축·일괄 작업" },
  { id: "mobile", label: "모바일", suffix: "좁은 화면·터치" },
  { id: "desktop", label: "PC", suffix: "넓은 뷰·밀도·호버" },
  { id: "icon", label: "아이콘", suffix: "크기·잘림·겹침·대비" },
  { id: "visual", label: "시각정렬", suffix: "간격·정렬·구역 구분" },
  { id: "i18n", label: "표시품질", suffix: "깨진 글자·잘림·정렬" },
];

/**
 * 영역별 생성형 불편(시드와 독립) — 틱마다 고유 title
 * @type {Array<{ area: string; areaLabel: string; severity: "minor"|"nit"|"major"; baseTitle: string; detail: string; suggestion: string; skills?: string[]; devices?: string[]; minSatisfaction?: number }>}
 */
export const GENERATIVE_DISCOMFORT_BANK = [
  {
    area: "account-manage",
    areaLabel: "계좌관리",
    severity: "minor",
    baseTitle: "성장·가치 성향 차트가 실제 투자 감각과 어긋날 수 있다",
    detail:
      "자동 분류와 내 지정 성향이 섞이면 비중 해석이 흔들린다. 신규 종목은 자동인데 기존만 지정돼 있으면 더 헷갈린다.",
    suggestion:
      "성향 열·차트 범례에 「자동/지정」 구분을 분명히 하고, 신규 종목 기본값 안내를 한 줄 넣는다.",
    skills: ["beginner", "intermediate", "power"],
    minSatisfaction: 2,
  },
  {
    area: "account-manage",
    areaLabel: "계좌관리",
    severity: "nit",
    baseTitle: "성향 드롭다운 옵션이 길면 좁은 화면에서 잘린다",
    detail: "「자동 · 가치·방어주」처럼 긴 옵션이 셀렉트에서 잘리면 무엇을 고르는지 모른다.",
    suggestion: "모바일에서 짧은 라벨(자동/성장/가치) + title 툴팁으로 풀어 쓴다.",
    devices: ["mobile"],
    skills: ["beginner", "intermediate", "power"],
    minSatisfaction: 3,
  },
  {
    area: "rebalance",
    areaLabel: "월별 비중 유지·즉시 매수",
    severity: "minor",
    baseTitle: "미리보기와 즉시 매수 금액 단위가 어긋나 보인다",
    detail: "원화/달러·수수료 반영 여부가 미리보기와 실행 버튼에 다르게 보이면 확신이 없다.",
    suggestion: "미리보기·확인 문구에 통화·수수료 반영 여부를 동일 포맷으로 맞춘다.",
    skills: ["beginner", "intermediate", "power"],
    minSatisfaction: 2,
  },
  {
    area: "navigation",
    areaLabel: "탐색",
    severity: "nit",
    baseTitle: "탭 전환 후 스크롤 위치가 리셋되어 맥락이 끊긴다",
    detail: "긴 목록에서 탭을 바꿨다 돌아오면 맨 위로 가면 다시 찾느라 피곤하다.",
    suggestion: "탭별 스크롤 위치를 세션 동안 유지하거나 복원 여부를 선택하게 한다.",
    skills: ["intermediate", "power"],
    minSatisfaction: 3,
  },
  {
    area: "stock-vault",
    areaLabel: "종목보관",
    severity: "minor",
    baseTitle: "스캔 일자·즐겨찾기·필터 조합이 과하면 결과가 비어 보인다",
    detail: "필터를 여러 개 켜면 빈 목록이 ‘고장’처럼 느껴진다.",
    suggestion: "빈 결과에 「어떤 필터 때문에 0건인지」 한 줄과 초기화 버튼을 둔다.",
    skills: ["beginner", "intermediate"],
    minSatisfaction: 2,
  },
  {
    area: "mobile",
    areaLabel: "모바일",
    severity: "major",
    baseTitle: "가로 칩·툴바가 한 줄에 몰려 오탭이 난다",
    detail: "390px에서 칩이 밀집하면 의도한 액션을 누르기 어렵다.",
    suggestion: "줄바꿈·간격만 조정한다. 앱 골격·좌측 열은 건드리지 않는다.",
    devices: ["mobile"],
    skills: ["beginner", "intermediate", "power"],
    minSatisfaction: 2,
  },
  {
    area: "backend-reliability",
    areaLabel: "백엔드 신뢰성",
    severity: "minor",
    baseTitle: "API 지연 시 화면이 조용히 멈춰 고장난 것처럼 보인다",
    detail: "폴링·스냅샷이 느려도 스피너/시간이 없으면 사용자는 새로고침만 반복한다.",
    suggestion: "주요 패널에 갱신 시각·지연 안내를 짧게 노출한다.",
    skills: ["beginner", "intermediate", "power"],
    minSatisfaction: 2,
  },
  {
    area: "navigation",
    areaLabel: "탐색",
    severity: "nit",
    baseTitle: "동일 기능 진입 경로가 탭·모달·관리자에 흩어져 있다",
    detail: "어디서 열어야 하는지 기억에 의존하면 이탈한다.",
    suggestion: "핵심 기능은 주 진입 1곳 + 보조 링크 규칙으로 정리한다.",
    skills: ["beginner", "intermediate"],
    minSatisfaction: 4,
  },
  {
    area: "account-manage",
    areaLabel: "계좌관리",
    severity: "minor",
    baseTitle: "차트 조각 클릭 필터와 성향 필터가 서로 덮어쓴다",
    detail: "비중 차트와 성장·가치 차트를 번갈아 누르면 목록 필터 상태가 헷갈린다.",
    suggestion: "활성 필터 출처(비중/성향)를 표시하고 전체 보기로 한 번에 해제한다.",
    skills: ["intermediate", "power"],
    minSatisfaction: 3,
  },
  {
    area: "mobile",
    areaLabel: "모바일",
    severity: "nit",
    baseTitle: "가상 키보드가 뜨면 하단 확인 버튼이 가려진다",
    detail: "입력 후 확인을 못 누르면 제출을 포기한다.",
    suggestion: "키보드 inset·스크롤 인투 뷰만 보강한다. 레이아웃 틀은 유지.",
    devices: ["mobile"],
    skills: ["beginner", "intermediate", "power"],
    minSatisfaction: 4,
  },
  {
    area: "navigation",
    areaLabel: "탐색·아이콘",
    severity: "minor",
    baseTitle: "브랜드·탭 아이콘이 너무 작아 한눈에 안 들어온다",
    detail:
      "YS·탭·거래소 아이콘이 작거나 대비가 약하면 PC·모바일 모두에서 위치를 헤맨다.",
    suggestion:
      "아이콘 표시 크기·여백·대비만 보강한다. 흰 사각 매트·제거 금지. PC·모바일 함께 확인.",
    skills: ["beginner", "intermediate", "power"],
    minSatisfaction: 3,
  },
  {
    area: "navigation",
    areaLabel: "탐색·아이콘",
    severity: "nit",
    baseTitle: "라이트 모드에서 아이콘이 배경에 묻힌다",
    detail: "다크에서만 보이면 라이트 사용자는 마크가 사라진 것처럼 느낀다.",
    suggestion: "라이트/다크 대비를 점검하고 투명 매트·색만 조정한다.",
    skills: ["beginner", "intermediate", "power"],
    minSatisfaction: 3,
  },
  {
    area: "mobile",
    areaLabel: "모바일·아이콘",
    severity: "major",
    baseTitle: "아이콘 hit area가 44px 미만이라 오탭이 반복된다",
    detail: "그림은 보여도 누르는 영역이 작으면 인접 컨트롤을 누른다.",
    suggestion: "패딩으로 터치 영역만 ~44px 확보한다. 골격·위치는 유지.",
    devices: ["mobile"],
    skills: ["beginner", "intermediate", "power"],
    minSatisfaction: 3,
  },
  {
    area: "navigation",
    areaLabel: "탐색",
    severity: "minor",
    baseTitle: "PC에서 고친 간격이 모바일에서 다시 밀집된다",
    detail: "한쪽만 검증하면 다른 기기에서 아이콘·칩이 다시 붙는다.",
    suggestion: "미디어쿼리로 환경별 간격만 조정하고 PC·모바일을 함께 확인한다.",
    skills: ["beginner", "intermediate", "power"],
    minSatisfaction: 3,
  },
];

/**
 * @param {number} n
 * @param {number} max
 */
export function clampIndex(n, max) {
  if (!(max > 0)) return 0;
  const v = Math.floor(Number(n) || 0);
  return ((v % max) + max) % max;
}

/** ISO week key for stable-but-rotating titles */
export function noveltyTickKey(atMs = Date.now()) {
  const d = new Date(atMs);
  const oneJan = new Date(d.getFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - oneJan.getTime()) / 86400000 + oneJan.getDay() + 1) / 7);
  const day = d.getUTCDay();
  const slot = Math.floor(d.getUTCHours() / 6); // 0..3 — 하루 4번 각도 전환
  return `${d.getUTCFullYear()}-W${week}-d${day}-s${slot}`;
}

/**
 * @template T
 * @param {T[]} arr
 * @param {number} [seed]
 */
export function shuffleInPlace(arr, seed = Date.now()) {
  let s = seed >>> 0;
  for (let i = arr.length - 1; i > 0; i--) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const j = s % (i + 1);
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

/**
 * @param {{ area: string; title: string; detail: string; suggestion: string; severity: string; areaLabel?: string; skills?: string[]; devices?: string[]; minSatisfaction?: number }} base
 * @param {NoveltyAngle} angle
 * @param {string} tickKey
 */
export function angledNoveltySeed(base, angle, tickKey) {
  return {
    ...base,
    title: `${base.title} · ${angle.label} 재검증 (${tickKey})`,
    detail: `${base.detail}\n\n[재검증 각도] ${angle.suffix}. 이전 개선 후에도 같은 불편이 남는지 페르소나 관점에서 다시 본다. 리디자인이 아니라 기존 톤 안에서 마찰만 줄인다.`,
    suggestion: vuUiDirectionSuggestionGuard(
      `${base.suggestion} (${angle.label}·${angle.suffix} 관점 포함)`,
    ),
  };
}

/**
 * @param {(typeof GENERATIVE_DISCOMFORT_BANK)[number]} item
 * @param {string} tickKey
 * @param {string} personaId
 * @param {number} idx
 */
export function generativeNoveltySeed(item, tickKey, personaId, idx) {
  const shortPersona = String(personaId || "vu").slice(-8);
  return {
    area: item.area,
    areaLabel: item.areaLabel,
    severity: item.severity,
    title: `${item.baseTitle} · ${tickKey} · ${shortPersona}#${idx}`,
    detail: item.detail,
    suggestion: vuUiDirectionSuggestionGuard(item.suggestion),
    skills: item.skills,
    devices: item.devices,
    minSatisfaction: item.minSatisfaction ?? 1,
  };
}

/**
 * 연속 탐색용: 미발급 시드 우선 → 셔플 → 각도 재검증 → 생성형
 * @param {object} p
 * @param {Array<object>} p.pool
 * @param {Set<string>} p.known
 * @param {(area: string, title: string) => string} p.fingerprint
 * @param {number} p.maxItems
 * @param {string} p.personaId
 * @param {number} [p.atMs]
 * @param {number} [p.angleOffset]
 */
export function buildContinuousNoveltySeeds(p) {
  const tickKey = noveltyTickKey(p.atMs);
  const maxItems = Math.max(1, Math.min(8, Number(p.maxItems) || 4));
  /** @type {object[]} */
  const out = [];

  const fresh = p.pool.filter(
    (s) => !p.known.has(p.fingerprint(String(s.area), String(s.title))),
  );
  shuffleInPlace(fresh, (p.atMs || Date.now()) ^ p.personaId.length * 31);
  for (const s of fresh) {
    if (out.length >= maxItems) break;
    out.push(s);
  }
  if (out.length >= maxItems) return out;

  const angle = NOVELTY_ANGLES[clampIndex(p.angleOffset ?? 0, NOVELTY_ANGLES.length)];
  const angledPool = shuffleInPlace(
    [...p.pool],
    ((p.atMs || Date.now()) >>> 0) + 17,
  );
  for (const base of angledPool) {
    if (out.length >= maxItems) break;
    const seeded = angledNoveltySeed(base, angle, tickKey);
    if (p.known.has(p.fingerprint(seeded.area, seeded.title))) continue;
    out.push(seeded);
  }
  if (out.length >= maxItems) return out;

  const bank = shuffleInPlace(
    [...GENERATIVE_DISCOMFORT_BANK],
    ((p.atMs || Date.now()) >>> 0) + 99,
  );
  let idx = 0;
  for (const item of bank) {
    if (out.length >= maxItems) break;
    const seeded = generativeNoveltySeed(item, tickKey, p.personaId, idx++);
    if (p.known.has(p.fingerprint(seeded.area, seeded.title))) continue;
    out.push(seeded);
  }

  // 최후: 메타 시드 — 그래도 비면 카탈로그 확장 요청
  if (out.length === 0) {
    out.push({
      area: "vu-meta",
      areaLabel: "가상사용자",
      severity: "nit",
      title: `탐색 포화 돌파 · ${tickKey} · ${String(p.personaId).slice(-6)}`,
      detail:
        "기존 시드·지문이 소진된 상태에서 추가 개선 각도를 강제 발굴한다. UX·카피·모바일·신뢰·접근성 중 아직 손대지 않은 세부 불편을 찾아, 현재 앱 톤을 유지한 채 구체적 수정안을 낸다.",
      suggestion: vuUiDirectionSuggestionGuard(
        "현재 제품에서 페르소나가 느끼는 미해결 불편 1가지를 골라 최소 변경으로 개선한다. 좌측 열·3열·탭 골격은 건드리지 않는다.",
      ),
      minSatisfaction: 1,
    });
  }

  return out.slice(0, maxItems);
}
