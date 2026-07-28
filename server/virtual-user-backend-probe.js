/**
 * 가상 사용자 — 백엔드 실동작 결함 탐지
 * - 폴링 주기·미세 튜닝은 제외
 * - 운영자/개발자 요청으로 의도적 중지된 기능은 제외
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isAbortLikeError } from "./fetch-abort-guard.js";
import { findLiveOrderGuardGaps } from "./virtual-user-order-guard.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, ".data");

/**
 * @typedef {{
 *   area: string;
 *   areaLabel: string;
 *   severity: "blocker"|"major"|"minor"|"nit";
 *   title: string;
 *   detail: string;
 *   suggestion: string;
 *   minSatisfaction?: number;
 * }} BackendFinding
 */

/** 의도적 비활성 — 피드백/개선 대상으로 올리지 않음 */
const INTENTIONAL_DISABLE_RE =
  /운영자\s*요청|개발자\s*요청|의도적(으로)?\s*(끈|중지|비활성)|intentionally\s*disabled|isBootEnabled:\s*\(\)\s*=>\s*false|스캔\s*범위에서\s*제외|가중점수\s*스크리너.*비활성|코인.*(제외|비활성)|TELEGRAM_.*항상\s*OFF|crypto.*항상\s*OFF|STOCK_VIRTUAL_USER_CONTINUOUS=0|OPS_RECORD_MODE_DISABLED/i;

const POLL_TUNE_RE =
  /폴링\s*주기|poll\s*interval|intervalMs|STOCK_\w+_MS|PROBE_MS|tick\s*간격|몇\s*초마다|주기\s*(를|만)\s*(줄|늘|조정)|백오프\s*시간만/i;

/**
 * @param {string} text
 */
export function isIntentionalDisableText(text) {
  return INTENTIONAL_DISABLE_RE.test(String(text ?? ""));
}

/**
 * @param {string} text
 */
export function isPollIntervalTuneText(text) {
  return POLL_TUNE_RE.test(String(text ?? ""));
}

/**
 * @param {{ problem?: string; suggestion?: string; evidence?: string; area?: string; id?: string }} item
 */
export function shouldSkipBackendImprovementItem(item) {
  const blob = [item?.id, item?.area, item?.problem, item?.suggestion, item?.evidence]
    .map((x) => String(x ?? ""))
    .join("\n");
  if (isIntentionalDisableText(blob)) return true;
  if (isPollIntervalTuneText(blob)) return true;
  // 텔레그램 env 미설정만 반복적으로 찍히는 warn은 동작 결함보다 설정 이슈 — minor로 남길 수는 있으나
  // 「동작해야 하는데 못함」이 아니면 스킵
  if (/TELEGRAM_OPS_BOT_TOKEN|env-ops-telegram-disabled/i.test(blob)) return true;
  // fetch/route abort·navigation cancel — 실동작 장애가 아님
  if (/process-unhandledRejection/i.test(String(item?.id ?? ""))) {
    const problem = String(item?.problem ?? "");
    const bare = problem.replace(/^unhandledRejection:\s*/i, "").trim();
    if (isAbortLikeError(bare) || isAbortLikeError(problem)) return true;
  }
  return false;
}

function baseUrl() {
  return String(process.env.VIRTUAL_USER_BASE_URL ?? "http://127.0.0.1:5173")
    .trim()
    .replace(/\/$/, "");
}

/**
 * @param {string} pathName
 * @param {number} [timeoutMs]
 */
async function fetchJson(pathName, timeoutMs = 12_000) {
  const url = `${baseUrl()}${pathName.startsWith("/") ? pathName : `/${pathName}`}`;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "GET",
      signal: ac.signal,
      headers: { Accept: "application/json" },
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { ok: res.ok, status: res.status, json, textHead: text.slice(0, 200) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, status: 0, json: null, textHead: msg.slice(0, 200) };
  } finally {
    clearTimeout(t);
  }
}

/**
 * .data JSON 파일이 깨져 읽히지 않으면 실동작 장애
 * @returns {BackendFinding[]}
 */
function probeCorruptDataFiles() {
  /** @type {BackendFinding[]} */
  const out = [];
  const candidates = [
    "stock-vault.json",
    "user-stock-vault.json",
    "stock-vault-meta-cache.json",
    "stock-vault-chart-insights.json",
    "granville-scan-state.json",
    "ops-record-mode-queue.json",
    "virtual-users.json",
    "code-versions.json",
    "server-improvement-items.json",
  ];
  for (const name of candidates) {
    const fp = path.join(DATA_DIR, name);
    if (!fs.existsSync(fp)) continue;
    try {
      const raw = fs.readFileSync(fp, "utf8");
      // BOM + "{}" 등 깨진 케이스
      JSON.parse(raw.replace(/^\uFEFF/, ""));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      out.push({
        area: "backend-data",
        areaLabel: "서버 데이터",
        severity: "blocker",
        title: `데이터 파일 JSON 파싱 실패: ${name}`,
        detail: `${fp} 를 읽을 수 없습니다: ${msg}. 이 파일이 깨지면 관련 백엔드 기능이 동작하지 않습니다.`,
        suggestion:
          "BOM/깨진 JSON을 안전하게 읽고, 손상 시 백업 후 기본값으로 복구하는 로더를 적용한다. 폴링 주기 변경은 하지 않는다.",
        minSatisfaction: 1,
      });
    }
  }
  return out;
}

/**
 * 필수 API가 5xx이거나 JSON이 깨지면 동작 결함
 * @returns {Promise<BackendFinding[]>}
 */
async function probeCriticalApis() {
  /** @type {BackendFinding[]} */
  const out = [];
  /** @type {Array<{ path: string; label: string; check: (r: {ok:boolean;status:number;json:any}) => boolean; skipIf?: () => boolean }>} */
  const checks = [
    {
      path: "/api/health",
      label: "헬스",
      check: (r) => r.status > 0 && r.status < 500,
    },
    {
      path: "/api/config",
      label: "설정",
      check: (r) =>
        r.status >= 200 &&
        r.status < 300 &&
        r.json != null &&
        typeof r.json === "object",
    },
    {
      path: "/api/ui-features",
      label: "UI 기능 토글",
      check: (r) =>
        (r.status >= 200 && r.status < 300 && r.json != null) ||
        r.status === 401 ||
        r.status === 403,
    },
    {
      path: "/api/macro-events",
      label: "매크로 일정",
      check: (r) =>
        (r.status >= 200 && r.status < 300 && r.json != null) ||
        r.status === 401 ||
        r.status === 403,
    },
    {
      path: "/api/stock-vault",
      label: "종목보관",
      check: (r) =>
        (r.status >= 200 && r.status < 300) ||
        r.status === 401 ||
        r.status === 403,
    },
    {
      // 가중점수 스크리너는 운영자 요청으로 탐지 OFF일 수 있음 — API 자체는 응답해야 함
      path: "/api/picks",
      label: "스크리너 picks 응답",
      check: (r) =>
        (r.status >= 200 && r.status < 300 && r.json != null) ||
        r.status === 401 ||
        r.status === 403,
    },
  ];

  for (const c of checks) {
    if (c.skipIf?.()) continue;
    try {
      const r = await fetchJson(c.path);
      if (!c.check(r)) {
        out.push({
          area: "backend-api",
          areaLabel: "백엔드 API",
          severity: r.status >= 500 ? "blocker" : "major",
          title: `${c.label} API가 정상 응답하지 않음 (${c.path})`,
          detail: `status=${r.status}, body=${r.textHead || "(empty)"}. 프론트/다른 기능이 이 API에 의존하면 동작이 멈춘다.`,
          suggestion:
            "해당 라우트 핸들러·미들웨어·JSON 직렬화 오류를 고친다. 의도적 비활성(운영자 요청)이 아닌 한 5xx/깨진 JSON을 방치하지 않는다. 폴링 주기는 건드리지 않는다.",
          minSatisfaction: 1,
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      out.push({
        area: "backend-api",
        areaLabel: "백엔드 API",
        severity: "blocker",
        title: `${c.label} API 호출 실패 (${c.path})`,
        detail: `fetch 실패: ${msg}. 서버가 기동 중이 아니거나 라우트가 죽어 있다.`,
        suggestion:
          "서버 기동·프록시·라우트 등록을 확인하고, 핸들러 throw가 Express까지 새지 않게 고친다.",
        minSatisfaction: 1,
      });
    }
  }
  return out;
}

/**
 * 부팅되어야 하는데(카탈로그상) 런타임에 죽은 폴러 — 단, 의도적 OFF는 제외
 * (현재는 의도적 비활성만 걸러 두고, 강제 ON 강요는 하지 않음)
 * @returns {BackendFinding[]}
 */
function probeUnexpectedPollerGaps() {
  return [];
}

/**
 * toss/bithumb 실주문 진입점 ALS 가드 누락
 * @returns {BackendFinding[]}
 */
function probeLiveOrderGuardGaps() {
  const gaps = findLiveOrderGuardGaps(__dirname);
  if (!gaps.length) return [];
  return [
    {
      area: "backend-orders-guard",
      areaLabel: "백엔드 주문 가드",
      severity: "blocker",
      title: "가상 사용자·실주문 차단이 서버에서도 반드시 막혀야 한다",
      detail: `실주문 진입점에 rejectIfVirtualUserLiveOrder 가드가 없습니다: ${gaps.join(", ")}. 클라이언트 route abort만으로는 부족합니다.`,
      suggestion:
        "toss/bithumb live order 경로에서 rejectIfVirtualUserLiveOrder 등 가드가 빠지지 않았는지 확인·보강한다. 폴링과 무관하다.",
      minSatisfaction: 3,
    },
  ];
}

/**
 * 자가개선 백로그에서 실동작 결함만 추출
 * @returns {Promise<BackendFinding[]>}
 */
async function findingsFromSelfImprovement() {
  /** @type {BackendFinding[]} */
  const out = [];
  try {
    const { readStoreForVirtualUser } = await import("./server-self-improvement-log.js").catch(
      () => ({}),
    );
    // fallback: read file directly if export missing
    let items = [];
    if (typeof readStoreForVirtualUser === "function") {
      items = readStoreForVirtualUser();
    } else {
      const fp = path.join(DATA_DIR, "server-improvement-items.json");
      if (fs.existsSync(fp)) {
        const o = JSON.parse(fs.readFileSync(fp, "utf8").replace(/^\uFEFF/, ""));
        items = Array.isArray(o?.items) ? o.items : [];
      }
    }
    for (const it of items) {
      if (!it || it.status === "muted") continue;
      if (shouldSkipBackendImprovementItem(it)) continue;
      if (it.severity !== "error" && it.severity !== "warn") continue;
      // warn은 반복·치명 데이터/프로세스만
      if (it.severity === "warn" && !/process|data|json|uncaught|unhandled/i.test(String(it.id))) {
        continue;
      }
      out.push({
        area: `backend-${String(it.area || "server").slice(0, 40)}`,
        areaLabel: "백엔드 자가진단",
        severity: it.severity === "error" ? "blocker" : "major",
        title: String(it.problem || "서버 문제").slice(0, 160),
        detail: [
          `자가진단 id=${it.id}`,
          it.evidence ? `근거: ${it.evidence}` : "",
          "운영자 요청으로 끈 기능·폴링 주기 조정은 대상이 아니다. 실제 동작 장애만 고친다.",
        ]
          .filter(Boolean)
          .join("\n"),
        suggestion:
          String(it.suggestion || "").trim() ||
          "해당 영역 코드의 실제 실패 원인을 고친다. 폴링 주기는 변경하지 않는다.",
        minSatisfaction: 1,
      });
    }
  } catch {
    /* optional */
  }
  return out.slice(0, 6);
}

/**
 * @returns {Promise<BackendFinding[]>}
 */
export async function collectVirtualUserBackendFindings() {
  const [apis, files, selfImp, pollers, orderGuards] = await Promise.all([
    probeCriticalApis(),
    Promise.resolve(probeCorruptDataFiles()),
    findingsFromSelfImprovement(),
    Promise.resolve(probeUnexpectedPollerGaps()),
    Promise.resolve(probeLiveOrderGuardGaps()),
  ]);
  /** @type {Map<string, BackendFinding>} */
  const map = new Map();
  for (const f of [...files, ...apis, ...selfImp, ...pollers, ...orderGuards]) {
    const key = `${f.area}::${f.title}`.toLowerCase();
    if (map.has(key)) continue;
    if (shouldSkipBackendImprovementItem(f)) continue;
    map.set(key, f);
  }
  return [...map.values()].slice(0, 10);
}

/** 정적 시드 — 에이전트에게 백엔드 실동작 개선 방향 안내 */
export const BACKEND_SCENARIO_SEEDS = [
  {
    area: "backend-reliability",
    areaLabel: "백엔드 신뢰성",
    severity: "major",
    title: "깨진 .data JSON·uncaughtException이 기능을 멈추게 해서는 안 된다",
    detail:
      "서버 로그/자가진단에 JSON 파싱 실패·uncaughtException이 반복되면 스캔·큐·가상 사용자가 멈춘다.",
    suggestion:
      "해당 파일 로더에 BOM 제거·try/catch·손상 시 기본값 복구를 넣고, tick에서 throw가 프로세스를 죽이지 않게 한다. 폴링 주기는 바꾸지 않는다.",
    skills: ["beginner", "intermediate", "power"],
    minSatisfaction: 2,
  },
  {
    area: "backend-api",
    areaLabel: "백엔드 API",
    severity: "major",
    title: "필수 API가 5xx를 내면 UI가 빈 화면·무한 로딩이 된다",
    detail:
      "health/config/macro/vault/picks 등 필수 GET이 500이거나 JSON이 아니면 프론트가 의존 기능을 못 쓴다.",
    suggestion:
      "라우트 예외를 잡고 의미 있는 JSON 에러를 반환한다. 운영자 요청으로 끈 기능은 그대로 두고, 살아 있어야 할 API만 고친다.",
    skills: ["beginner", "intermediate", "power"],
    minSatisfaction: 2,
  },
  {
    area: "backend-orders-guard",
    areaLabel: "백엔드 주문 가드",
    severity: "blocker",
    title: "가상 사용자·실주문 차단이 서버에서도 반드시 막혀야 한다",
    detail:
      "클라이언트 route abort만으로는 부족하다. 서버 ALS/가드가 빠지면 돈이 나갈 수 있다.",
    suggestion:
      "toss/bithumb live order 경로에서 rejectIfVirtualUserLiveOrder 등 가드가 빠지지 않았는지 확인·보강한다. 폴링과 무관하다.",
    skills: ["intermediate", "power"],
    minSatisfaction: 3,
  },
];
