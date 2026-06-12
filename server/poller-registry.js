/**
 * 서버 백그라운드 폴러 — 목록·상태·런타임 on/off (파일 영속)
 */
import fs from "node:fs";
import path from "node:path";
import { resolveServerDataDir } from "./data-path.js";
import { boxRangeDetectEnabled } from "./box-range/constants.js";

/** @typedef {{
 *   labelKo: string;
 *   groupKo: string;
 *   intervalMs: number | (() => number);
 *   envDisable: string;
 *   isBootEnabled: () => boolean;
 *   descriptionKo: string;
 *   runtimeToggleable?: boolean;
 * }} PollerCatalogEntry */

/** @type {Record<string, PollerCatalogEntry>} */
export const POLLER_CATALOG = {
  "dev-queue-sync": {
    labelKo: "개발 큐 표시 미러",
    groupKo: "운영",
    intervalMs: () => {
      const n = Number(process.env.STOCK_DEV_QUEUE_SYNC_MS ?? 100);
      return Number.isFinite(n) && n >= 50 ? n : 100;
    },
    envDisable: "STOCK_DEV_QUEUE_SYNC=0",
    isBootEnabled: () => process.env.STOCK_DEV_QUEUE_SYNC !== "0",
    descriptionKo:
      "메모리상 IDE·에이전트 개발 큐(FIFO)를 ops-dev-queue-display.json에 100ms 주기로 미러합니다. 웹·IDE가 동일한 대기열 표시를 보도록 하는 SSOT 미러이며, 큐 자체를 실행하지는 않습니다.",
  },
  "ide-transcript": {
    labelKo: "IDE 트랜스크립트 폴러",
    groupKo: "운영",
    intervalMs: 100,
    envDisable: "STOCK_IDE_TRANSCRIPT_POLLER=0",
    isBootEnabled: () => process.env.STOCK_IDE_TRANSCRIPT_POLLER !== "0",
    descriptionKo:
      "Cursor 에이전트 transcript 파일을 감시합니다. 턴 종료(기본 12초 idle)를 감지하면 개발 큐 슬롯을 release하고, 새 작업을 enqueue합니다. STOCK_IDE_TURN_END_IDLE_MS로 idle 판정 시간을 조절합니다.",
  },
  "live-trade-exchange-sync": {
    labelKo: "실매매 거래소 잔고 동기화",
    groupKo: "실매매",
    intervalMs: () => {
      const n = Number(process.env.STOCK_LIVE_TRADE_EXCHANGE_SYNC_MS ?? 10_000);
      return Number.isFinite(n) && n >= 5_000 ? Math.min(n, 60_000) : 10_000;
    },
    envDisable: "STOCK_LIVE_TRADE_EXCHANGE_SYNC=0",
    isBootEnabled: () => process.env.STOCK_LIVE_TRADE_EXCHANGE_SYNC !== "0",
    descriptionKo:
      "armed(실매매 가동) 상태인 프로그램 사용자에 대해 빗썸 잔고·체결을 서버 포트폴리오와 대조(reconcile)합니다. 거래소에서 수동 매도한 뒤 앱 보유가 남는 문제를 줄입니다.",
  },
  "toss-ledger-cache": {
    labelKo: "토스 장부 파일 캐시",
    groupKo: "계좌",
    intervalMs: () => {
      const n = Number(process.env.STOCK_TOSS_LEDGER_CACHE_MS ?? 1_000);
      return Number.isFinite(n) && n >= 500 ? Math.min(n, 5_000) : 1_000;
    },
    envDisable: "STOCK_TOSS_LEDGER_POLL=0",
    isBootEnabled: () => process.env.STOCK_TOSS_LEDGER_POLL !== "0",
    descriptionKo:
      "live-trade-toss-ledger.json 계정별 캐시를 1초마다 터치합니다. 클라이언트가 refresh 없이 파일 캐시만 읽을 때 최신 타임스탬프·내용을 유지합니다. Toss Open API는 호출하지 않습니다.",
  },
  "toss-ledger-api": {
    labelKo: "토스 Open API 잔고 갱신",
    groupKo: "계좌",
    intervalMs: () => {
      const n = Number(process.env.STOCK_TOSS_LEDGER_API_MS ?? 15_000);
      return Number.isFinite(n) && n >= 5_000 ? Math.min(n, 120_000) : 15_000;
    },
    envDisable: "STOCK_TOSS_LEDGER_POLL=0",
    isBootEnabled: () => process.env.STOCK_TOSS_LEDGER_POLL !== "0",
    descriptionKo:
      "토스 연동 사용자의 계좌·보유를 Open API로 주기 조회해 live-trade-toss-ledger.json에 저장합니다. ACCOUNT 1TPS 제한으로 15초 간격이 기본입니다.",
  },
  "live-trade-auto-sell": {
    labelKo: "실매매·시뮬 자동 매도",
    groupKo: "실매매",
    intervalMs: () => {
      const n = Number(process.env.STOCK_LIVE_TRADE_AUTO_SELL_MS ?? 45_000);
      return Number.isFinite(n) && n >= 10_000 ? n : 45_000;
    },
    envDisable: "STOCK_LIVE_TRADE_AUTO_SELL=0",
    isBootEnabled: () => process.env.STOCK_LIVE_TRADE_AUTO_SELL !== "0",
    descriptionKo:
      "armed·sim 프로그램 보유에 대해 익절·손절·시간·시나리오 매도 규칙을 주기 평가하고, 조건 충족 시 매도 주문(또는 시뮬 기록)을 실행합니다.",
  },
  "box-range-runner": {
    labelKo: "박스권 FSM 러너",
    groupKo: "박스권",
    intervalMs: () => {
      const n = Number(process.env.STOCK_BOX_RANGE_TICK_MS ?? 3_000);
      return Number.isFinite(n) && n >= 1_000 ? Math.min(n, 30_000) : 3_000;
    },
    envDisable: "STOCK_BOX_RANGE_RUNNER=0",
    isBootEnabled: () => process.env.STOCK_BOX_RANGE_RUNNER !== "0",
    descriptionKo:
      "박스권 자동매매 프로그램 FSM을 tick합니다. 1분봉 시세·WS 구독·lot reconcile·매수·매도 신호를 처리합니다. STOCK_BOX_RANGE_TICK_MS로 tick 간격을 조절합니다.",
  },
  "box-sp500-scan": {
    labelKo: "S&P500 박스권 카탈로그 스캔",
    groupKo: "박스권",
    intervalMs: 30 * 60 * 1000,
    envDisable: "STOCK_BOX_RANGE_DETECT=1 필요 · STOCK_BOX_RANGE_SP500_SCAN=0",
    isBootEnabled: () =>
      boxRangeDetectEnabled() && process.env.STOCK_BOX_RANGE_SP500_SCAN !== "0",
    descriptionKo:
      "미국 종목 유니버스에 대해 박스권 탐지 스캔을 주기 실행하고 카탈로그에 저장합니다. 기본 30분 간격(BOX_RANGE_SP500_SCAN_MS).",
  },
  "box-kr-scan": {
    labelKo: "국내 박스권 카탈로그 스캔",
    groupKo: "박스권",
    intervalMs: 30 * 60 * 1000,
    envDisable: "STOCK_BOX_RANGE_DETECT=1 필요 · STOCK_BOX_RANGE_KR_SCAN=0",
    isBootEnabled: () =>
      boxRangeDetectEnabled() && process.env.STOCK_BOX_RANGE_KR_SCAN !== "0",
    descriptionKo:
      "국내 종목 유니버스 박스권 탐지 스캔·카탈로그 갱신. 기본 30분 간격.",
  },
  "box-crypto-scan": {
    labelKo: "암호화폐 박스권 카탈로그 스캔",
    groupKo: "박스권",
    intervalMs: 30 * 60 * 1000,
    envDisable: "STOCK_BOX_RANGE_DETECT=1 필요 · STOCK_BOX_RANGE_CRYPTO_SCAN=0",
    isBootEnabled: () =>
      boxRangeDetectEnabled() && process.env.STOCK_BOX_RANGE_CRYPTO_SCAN !== "0",
    descriptionKo:
      "암호화폐 HTF 유니버스 박스권 탐지 스캔·카탈로그 갱신. 기본 30분 간격.",
  },
  "ops-file-dev": {
    labelKo: "파일 반영 큐",
    groupKo: "운영",
    intervalMs: () => {
      const n = Number(process.env.OPS_FILE_DEV_POLL_MS ?? 12_000);
      return Number.isFinite(n) && n >= 3_000 ? n : 12_000;
    },
    envDisable: "OPS_FILE_DEV_DISABLED=1",
    isBootEnabled: () => {
      const dis = String(process.env.OPS_FILE_DEV_DISABLED ?? "").trim();
      return dis !== "1" && dis.toLowerCase() !== "true";
    },
    descriptionKo:
      "ops-file-dev-queue.json의 pending 작업을 순차적으로 디스크에 반영합니다. Cursor 에이전트 없이 JSON 패치만 적용하는 경로입니다.",
  },
  "golden-cross": {
    labelKo: "골든크로스·볼트 스캔",
    groupKo: "스크리너",
    intervalMs: () => {
      const n = Number(process.env.STOCK_GOLDEN_CROSS_POLL_MS ?? 300_000);
      return Number.isFinite(n) && n >= 60_000 ? n : 300_000;
    },
    envDisable: "STOCK_GOLDEN_CROSS_SCAN=0",
    isBootEnabled: () => process.env.STOCK_GOLDEN_CROSS_SCAN !== "0",
    descriptionKo:
      "KR·US 종목에 대해 골든크로스·MA 정렬(볼트) 스캔을 due 시 실행합니다. 결과는 picks·텔레그램·이메일로 연결될 수 있습니다.",
  },
  "golden-cross-intraday": {
    labelKo: "볼트 장중 재스캔",
    groupKo: "스크리너",
    intervalMs: () => {
      const n = Number(process.env.STOCK_VAULT_INTRADAY_TICK_MS ?? 60_000);
      return Number.isFinite(n) && n >= 15_000 ? n : 60_000;
    },
    envDisable: "STOCK_VAULT_INTRADAY_RESCAN=0",
    isBootEnabled: () =>
      process.env.STOCK_GOLDEN_CROSS_SCAN !== "0" &&
      process.env.STOCK_VAULT_INTRADAY_RESCAN !== "0",
    descriptionKo:
      "stock-vault에 등록된 종목 중 장중 조건(MA120 근접 등)을 60초 주기로 재평가합니다. STOCK_VAULT_INTRADAY_RESCAN=0이면 부팅 시 off.",
  },
  "kr-investor-flow": {
    labelKo: "국내 수급 스캔",
    groupKo: "스크리너",
    intervalMs: () => {
      const n = Number(process.env.STOCK_KR_INVESTOR_FLOW_POLL_MS ?? 600_000);
      return Number.isFinite(n) && n >= 60_000 ? n : 600_000;
    },
    envDisable: "STOCK_KR_INVESTOR_FLOW=0",
    isBootEnabled: () => {
      const v = String(process.env.STOCK_KR_INVESTOR_FLOW ?? "").toLowerCase();
      return v !== "0" && v !== "false" && v !== "off";
    },
    descriptionKo:
      "박스권 카탈로그 KR 유니버스에서 투자자별 수급(외국인·기관 등) 데이터를 주기 수집·갱신합니다.",
  },
  "ma120-near-watch": {
    labelKo: "MA120 근접 감시",
    groupKo: "스크리너",
    intervalMs: () => {
      const n = Number(process.env.STOCK_MA120_NEAR_POLL_MS ?? 60_000);
      return Number.isFinite(n) && n >= 15_000 ? n : 60_000;
    },
    envDisable: "STOCK_MA120_NEAR_WATCH=0",
    isBootEnabled: () => process.env.STOCK_MA120_NEAR_WATCH !== "0",
    descriptionKo:
      "stock-vault 종목이 MA120에 근접했는지 60초마다 확인하고, 조건 충족 시 텔레그램 알림을 보냅니다.",
  },
  "holdings-news": {
    labelKo: "보유 종목 속보 이메일",
    groupKo: "알림",
    intervalMs: () => {
      const n = Number(process.env.STOCK_HOLDINGS_NEWS_POLL_MS ?? 45_000);
      return Number.isFinite(n) && n >= 15_000 ? n : 45_000;
    },
    envDisable: "STOCK_HOLDINGS_NEWS_EMAIL=1 (opt-in)",
    isBootEnabled: () => process.env.STOCK_HOLDINGS_NEWS_EMAIL === "1",
    descriptionKo:
      "빗썸·토스·실매매 포트폴리오 보유 심볼에 대한 속보를 주기 조회해 이메일로 발송합니다. 기본 off, env opt-in.",
  },
  "self-improvement": {
    labelKo: "서버 자가진단",
    groupKo: "운영",
    intervalMs: () => {
      const n = Number(process.env.STOCK_SELF_IMPROVEMENT_PROBE_MS ?? 300_000);
      return Number.isFinite(n) && n >= 60_000 ? n : 300_000;
    },
    envDisable: "STOCK_SELF_IMPROVEMENT=0",
    isBootEnabled: () => process.env.STOCK_SELF_IMPROVEMENT !== "0",
    descriptionKo:
      "서버 헬스·로그 패턴을 probe하고 SERVER_IMPROVEMENTS.md 백로그에 항목을 추가합니다.",
  },
  screener: {
    labelKo: "종목 스크리너",
    groupKo: "스크리너",
    intervalMs: () => {
      const n = Number(process.env.SCREEN_INTERVAL_MS ?? 60_000);
      return Number.isFinite(n) && n >= 30_000 ? n : 60_000;
    },
    envDisable: "STOCK_SCREENER_POLL=1 (opt-in)",
    isBootEnabled: () => process.env.STOCK_SCREENER_POLL === "1",
    descriptionKo:
      "KR·US·crypto picks 전체 스캔을 setTimeout 체인으로 반복합니다. 기본 off, STOCK_SCREENER_POLL=1일 때만 기동.",
  },
  "macro-telegram": {
    labelKo: "매크로 일정 텔레그램",
    groupKo: "알림",
    intervalMs: () => {
      const n = Number(process.env.TELEGRAM_MACRO_REMINDER_INTERVAL_MS ?? 45_000);
      return Number.isFinite(n) && n >= 15_000 ? n : 45_000;
    },
    envDisable: "TELEGRAM_MACRO_REMINDERS=0",
    isBootEnabled: () => process.env.TELEGRAM_MACRO_REMINDERS !== "0",
    runtimeToggleable: false,
    descriptionKo:
      "매크로 이벤트(1시간·10분 전) 텔레그램 리마인더. index.js에서 별도 기동. 런타임 토글은 env+재기동 필요.",
  },
  "auto-git-sync": {
    labelKo: "Auto Git Sync",
    groupKo: "운영",
    intervalMs: () => {
      const n = Number(process.env.AUTO_GIT_SYNC_INTERVAL_MS ?? 60_000);
      return Number.isFinite(n) && n >= 10_000 ? n : 60_000;
    },
    envDisable: "AUTO_GIT_SYNC unset/false",
    isBootEnabled: () => {
      const v = String(process.env.AUTO_GIT_SYNC ?? "").toLowerCase();
      return v === "1" || v === "true" || v === "yes";
    },
    runtimeToggleable: false,
    descriptionKo:
      "주기적으로 git pull/push. HTTP 서버 listen 후 index.js에서 기동. 런타임 토글 미지원.",
  },
};

function overridesPath() {
  return path.join(resolveServerDataDir(), "poller-runtime-overrides.json");
}

function readOverridesSync() {
  try {
    const fp = overridesPath();
    if (!fs.existsSync(fp)) return {};
    const o = JSON.parse(fs.readFileSync(fp, "utf8"));
    return o && typeof o === "object" ? o : {};
  } catch {
    return {};
  }
}

function writeOverridesSync(overrides) {
  const dir = resolveServerDataDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const fp = overridesPath();
  const tmp = `${fp}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(overrides, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, fp);
}

/** @type {Record<string, { bootStarted?: boolean; running?: boolean; lastTickAtMs?: number; lastError?: string | null; tickCount?: number }>} */
const runtime = {};

function resolveIntervalMs(entry) {
  const iv = entry.intervalMs;
  return typeof iv === "function" ? iv() : iv;
}

export function markPollerBootStarted(id) {
  const uid = String(id ?? "").trim();
  if (!uid) return;
  if (!runtime[uid]) runtime[uid] = {};
  runtime[uid].bootStarted = true;
}

/** @param {string} id */
export function isPollerRuntimeEnabled(id) {
  const overrides = readOverridesSync();
  if (Object.prototype.hasOwnProperty.call(overrides, id)) {
    return Boolean(overrides[id]);
  }
  return true;
}

/** @param {string} id */
export function isPollerEffectiveEnabled(id) {
  const entry = POLLER_CATALOG[id];
  if (!entry) return true;
  if (!entry.isBootEnabled()) return false;
  const st = runtime[id];
  if (!st?.bootStarted) return false;
  return isPollerRuntimeEnabled(id);
}

/** @param {string} id @param {() => void | Promise<void>} fn */
export async function pollerGuardAsync(id, fn) {
  if (!isPollerEffectiveEnabled(id)) return;
  if (!runtime[id]) runtime[id] = { bootStarted: true };
  runtime[id].running = true;
  try {
    await fn();
    runtime[id].lastTickAtMs = Date.now();
    runtime[id].lastError = null;
    runtime[id].tickCount = (runtime[id].tickCount ?? 0) + 1;
  } catch (e) {
    runtime[id].lastError = e instanceof Error ? e.message : String(e);
    throw e;
  } finally {
    runtime[id].running = false;
  }
}

/** @param {string} id @param {() => void} fn */
export function pollerGuardSync(id, fn) {
  if (!isPollerEffectiveEnabled(id)) return;
  if (!runtime[id]) runtime[id] = { bootStarted: true };
  runtime[id].running = true;
  try {
    fn();
    runtime[id].lastTickAtMs = Date.now();
    runtime[id].lastError = null;
    runtime[id].tickCount = (runtime[id].tickCount ?? 0) + 1;
  } catch (e) {
    runtime[id].lastError = e instanceof Error ? e.message : String(e);
    throw e;
  } finally {
    runtime[id].running = false;
  }
}

/** @param {string} id @param {boolean} enabled */
/** @param {string} desc */
function pollerSummaryKo(desc) {
  const s = String(desc ?? "").trim();
  if (!s) return "";
  const dot = s.indexOf(". ");
  if (dot > 0 && dot <= 140) return s.slice(0, dot + 1);
  if (s.length <= 96) return s;
  return `${s.slice(0, 93)}…`;
}

export function setPollerRuntimeEnabled(id, enabled) {
  const entry = POLLER_CATALOG[id];
  if (!entry) {
    throw new Error(`unknown poller: ${id}`);
  }
  if (entry.runtimeToggleable === false) {
    throw new Error("이 폴러는 런타임 토글이 지원되지 않습니다. env 변경 후 재기동하세요.");
  }
  const overrides = readOverridesSync();
  overrides[id] = Boolean(enabled);
  writeOverridesSync(overrides);
  return listPollersStatusSync();
}

export function listPollersStatusSync() {
  const overrides = readOverridesSync();
  return Object.entries(POLLER_CATALOG).map(([id, entry]) => {
    const bootEnabled = entry.isBootEnabled();
    const bootStarted = Boolean(runtime[id]?.bootStarted);
    const runtimeEnabled = Object.prototype.hasOwnProperty.call(overrides, id)
      ? Boolean(overrides[id])
      : true;
    const effective = bootEnabled && bootStarted && runtimeEnabled;
    const st = runtime[id] ?? {};
    return {
      id,
      labelKo: entry.labelKo,
      groupKo: entry.groupKo,
      summaryKo: pollerSummaryKo(entry.descriptionKo),
      descriptionKo: entry.descriptionKo,
      intervalMs: resolveIntervalMs(entry),
      envDisable: entry.envDisable,
      bootEnabled,
      bootStarted,
      runtimeEnabled,
      effectiveEnabled: effective,
      runtimeToggleable: entry.runtimeToggleable !== false,
      running: Boolean(st.running),
      lastTickAtMs: st.lastTickAtMs ?? null,
      lastError: st.lastError ?? null,
      tickCount: st.tickCount ?? 0,
    };
  });
}
