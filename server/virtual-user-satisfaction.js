/**
 * 가상 사용자 만족도·포화(중복) 판정
 * - 만족도↑ = 더 까다로움 → 더 깊은/사소한 이슈까지 찾음
 * - 시드·브라우저 피드백이 포화되면 자동 상승
 */

export const VU_SATISFACTION_MIN = 1;
export const VU_SATISFACTION_MAX = 5;

/** @param {unknown} n */
export function clampSatisfactionLevel(n) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return VU_SATISFACTION_MIN;
  return Math.min(VU_SATISFACTION_MAX, Math.max(VU_SATISFACTION_MIN, v));
}

/**
 * @param {string} area
 * @param {string} title
 */
export function feedbackFingerprint(area, title) {
  const a = String(area ?? "")
    .trim()
    .toLowerCase();
  const t = String(title ?? "")
    .replace(/^\[브라우저\]\s*/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .slice(0, 160);
  return `${a}::${t}`;
}

/**
 * @param {Array<{ personaId?: string; area?: string; title?: string; status?: string }>} feedback
 * @param {string} personaId
 */
export function knownFingerprintsForPersona(feedback, personaId) {
  /** @type {Set<string>} */
  const set = new Set();
  for (const f of feedback || []) {
    if (String(f.personaId ?? "") !== personaId) continue;
    if (f.status === "dismissed") continue;
    set.add(feedbackFingerprint(String(f.area ?? ""), String(f.title ?? "")));
  }
  return set;
}

/**
 * @param {Set<string>} known
 * @param {{ area: string; title: string }} seed
 */
export function isFeedbackDuplicate(known, seed) {
  return known.has(feedbackFingerprint(seed.area, seed.title));
}

/**
 * 만족도별 허용 severity (높을수록 사소한 것도 남김)
 * @param {number} level
 * @returns {Set<"blocker"|"major"|"minor"|"nit">}
 */
export function allowedSeveritiesForSatisfaction(level) {
  const lv = clampSatisfactionLevel(level);
  /** @type {Set<"blocker"|"major"|"minor"|"nit">} */
  const s = new Set(["blocker", "major"]);
  if (lv >= 2) s.add("minor");
  if (lv >= 3) s.add("nit");
  return s;
}

/**
 * @param {number} level
 */
export function satisfactionLabelKo(level) {
  const lv = clampSatisfactionLevel(level);
  if (lv <= 1) return "여유";
  if (lv === 2) return "보통";
  if (lv === 3) return "까다로움";
  if (lv === 4) return "매우 까다로움";
  return "극도로 까다로움";
}

/**
 * 포화 시 만족도 상승 여부
 * @param {{ emitted: number; skippedDup: number; candidateCount: number; level: number }} p
 */
export function shouldEscalateSatisfaction(p) {
  const level = clampSatisfactionLevel(p.level);
  if (level >= VU_SATISFACTION_MAX) return false;
  if (p.candidateCount <= 0) return false;
  // 후보가 있는데 신규가 거의 없고 중복만이면 포화 → 상승
  if (p.emitted === 0 && p.skippedDup >= Math.max(1, Math.ceil(p.candidateCount * 0.6))) {
    return true;
  }
  if (p.emitted <= 1 && p.skippedDup >= 3 && p.skippedDup >= p.emitted * 2) {
    return true;
  }
  return false;
}
