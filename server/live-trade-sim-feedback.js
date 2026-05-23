/**
 * 시뮬 프로그램별 청산 라운드 승패·요인 분석 및 설정 개선안
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SIGNAL_DEFS } from "./technical.js";
import {
  getLiveTradeProgramSync,
  listLiveTradeProgramsSync,
  updateLiveTradeProgramSync,
} from "./live-trade-programs-store.js";
import { listLiveTradeRecordsSync } from "./live-trade-portfolio-store.js";
import { getTechModelByIdSync } from "./picks-tech-models-store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, ".data");
const FEEDBACK_FILE = path.join(DATA_DIR, "live-trade-sim-feedback.json");

const MIN_ROUNDS = 3;
const MIN_SIGNAL_SAMPLES = 2;

const SIGNAL_LABEL = Object.fromEntries(
  SIGNAL_DEFS.map((s) => [s.id, s.label]),
);

/**
 * @typedef {"target" | "stop" | "manual" | "unknown"} ExitKind
 * @typedef {{
 *   symbol: string;
 *   market: string;
 *   netPct: number;
 *   outcome: "win" | "loss" | "flat" | "unknown";
 *   holdHours: number;
 *   exitKind: ExitKind;
 *   buyScore: number | null;
 *   buySignalIds: string[];
 *   exitScenarioNote: string | null;
 *   entryStructureNote: string | null;
 *   entryIdeal: boolean;
 *   entryKind: string;
 *   sellNote: string | null;
 * }} ClosedRound
 */

/**
 * @param {import("./live-trade-portfolio-store.js").LiveTradeRecord[]} trades
 * @param {string} programId
 * @returns {ClosedRound[]}
 */
export function buildSimClosedRounds(trades, programId) {
  const pid = String(programId ?? "").trim();
  const sorted = trades
    .filter((t) => t.programId === pid && t.simulated)
    .sort((a, b) => a.atMs - b.atMs);

  /** @type {Map<string, { trade: object; remaining: number }[]>} */
  const lots = new Map();
  /** @type {ClosedRound[]} */
  const rounds = [];

  for (const t of sorted) {
    const key = `${t.market}:${t.symbol}`;
    if (t.side === "buy") {
      if (!lots.has(key)) lots.set(key, []);
      lots.get(key).push({
        trade: t,
        remaining: t.quantity,
      });
      continue;
    }

    let sellLeft = t.quantity;
    const queue = lots.get(key) ?? [];
    while (sellLeft > 1e-9 && queue.length > 0) {
      const lot = queue[0];
      const matched = Math.min(sellLeft, lot.remaining);
      const buy = lot.trade;
      const buyFee = (buy.feeAmount / buy.quantity) * matched;
      const sellFee = (t.feeAmount / t.quantity) * matched;
      const entry = buy.price;
      const exit = t.price;
      const cost = entry * matched + buyFee;
      const proceeds = exit * matched - sellFee;
      const netPct = cost > 0 ? (proceeds / cost - 1) * 100 : 0;
      const outcome =
        Math.abs(netPct) < 0.005
          ? "flat"
          : netPct > 0
            ? "win"
            : "loss";
      const holdHours = Math.max(0, (t.atMs - buy.atMs) / 3_600_000);

      rounds.push({
        symbol: t.symbol,
        market: t.market,
        netPct,
        outcome:
          outcome === "win" || outcome === "loss" || outcome === "flat"
            ? outcome
            : "unknown",
        holdHours,
        exitKind: classifyExitKind(t.note),
        buyScore:
          typeof buy.buyScore === "number" && Number.isFinite(buy.buyScore)
            ? buy.buyScore
            : null,
        buySignalIds: Array.isArray(buy.buySignalIds) ? buy.buySignalIds : [],
        exitScenarioNote: buy.exitScenarioNote ?? null,
        entryStructureNote: buy.entryStructureNote ?? null,
        entryIdeal: Boolean(buy.entryIdeal),
        entryKind: buy.entryKind ?? "none",
        sellNote: t.note ?? null,
      });

      lot.remaining -= matched;
      sellLeft -= matched;
      if (lot.remaining <= 1e-9) queue.shift();
    }
    lots.set(key, queue);
  }

  return rounds;
}

/**
 * @param {string | null} note
 * @returns {ExitKind}
 */
function classifyExitKind(note) {
  const n = String(note ?? "");
  if (n.includes("목표")) return "target";
  if (n.includes("손절")) return "stop";
  if (n.trim()) return "manual";
  return "unknown";
}

/**
 * @param {ClosedRound[]} rounds
 */
function signalWinRates(rounds) {
  /** @type {Map<string, { wins: number; losses: number }>} */
  const map = new Map();
  for (const r of rounds) {
    if (r.outcome !== "win" && r.outcome !== "loss") continue;
    for (const id of r.buySignalIds) {
      const sid = String(id ?? "").trim();
      if (!sid) continue;
      let row = map.get(sid);
      if (!row) {
        row = { wins: 0, losses: 0 };
        map.set(sid, row);
      }
      if (r.outcome === "win") row.wins++;
      else row.losses++;
    }
  }
  /** @type {{ id: string; label: string; winRatePct: number; decided: number }[]} */
  const out = [];
  for (const [id, row] of map) {
    const decided = row.wins + row.losses;
    if (decided < MIN_SIGNAL_SAMPLES) continue;
    out.push({
      id,
      label: SIGNAL_LABEL[id] ?? id,
      winRatePct: (row.wins / decided) * 100,
      decided,
    });
  }
  out.sort((a, b) => b.winRatePct - a.winRatePct);
  return out;
}

/**
 * @param {ClosedRound[]} rounds
 * @param {import("./live-trade-programs-store.js").LiveTradeProgram} program
 */
function buildSuggestedPatch(rounds, program) {
  /** @type {Record<string, unknown>} */
  const patch = {};
  /** @type {{ field: string; label: string; reason: string }[]} */
  const applyItems = [];

  const decided = rounds.filter(
    (r) => r.outcome === "win" || r.outcome === "loss",
  );
  const wins = decided.filter((r) => r.outcome === "win");
  const losses = decided.filter((r) => r.outcome === "loss");
  const winRate =
    decided.length > 0 ? (wins.length / decided.length) * 100 : null;

  const stopLosses = losses.filter((r) => r.exitKind === "stop");
  const targetWins = wins.filter((r) => r.exitKind === "target");

  if (winRate != null && winRate < 48 && stopLosses.length >= 2) {
    const next = Math.min(0.95, program.minScoreRatio + 0.03);
    if (next > program.minScoreRatio + 0.005) {
      patch.minScoreRatio = Math.round(next * 100) / 100;
      applyItems.push({
        field: "minScoreRatio",
        label: "최소 점수 비율",
        reason: `손절 청산 ${stopLosses.length}건·승률 ${winRate.toFixed(1)}% — 진입 문턱을 올려 약한 신호 매수를 줄입니다.`,
      });
    }
  }

  const lowScoreLosses = losses.filter(
    (r) => r.buyScore != null && r.buyScore < program.minScoreRatio * 100 * 0.95,
  );
  if (lowScoreLosses.length >= 2) {
    const next = Math.min(0.95, program.minScoreRatio + 0.02);
    if (!patch.minScoreRatio && next > program.minScoreRatio + 0.005) {
      patch.minScoreRatio = Math.round(next * 100) / 100;
      applyItems.push({
        field: "minScoreRatio",
        label: "최소 점수 비율",
        reason: `저점수 매수 후 손실 ${lowScoreLosses.length}건 — 최소 점수를 상향합니다.`,
      });
    }
  }

  if (targetWins.length >= 2 && wins.length >= 3) {
    if (!program.autoSellAtTarget) {
      patch.autoSellAtTarget = true;
      applyItems.push({
        field: "autoSellAtTarget",
        label: "목표·손절 자동 매도",
        reason: `목표가 청산 승리 ${targetWins.length}건 — 자동 매도를 켭니다.`,
      });
    }
  }

  const longHoldLosses = losses.filter((r) => r.holdHours > 72);
  if (longHoldLosses.length >= 2 && program.maxOpenPositions > 3) {
    const next = Math.max(2, program.maxOpenPositions - 1);
    patch.maxOpenPositions = next;
    applyItems.push({
      field: "maxOpenPositions",
      label: "최대 보유 종목",
      reason: `장기 보유 후 손실 ${longHoldLosses.length}건 — 동시 보유 수를 ${next}개로 줄입니다.`,
    });
  }

  const signalRates = signalWinRates(decided);
  const best = signalRates.filter((s) => s.winRatePct >= 60).slice(0, 2);
  const worst = signalRates
    .filter((s) => s.winRatePct <= 35)
    .slice(-2)
    .reverse();

  return { patch, applyItems, signalRates, best, worst, winRate };
}

/**
 * @param {string} programId
 */
export function analyzeSimProgramFeedback(programId, userId) {
  const program = getLiveTradeProgramSync(programId, userId);
  if (!program) throw new Error("프로그램을 찾을 수 없습니다.");

  const trades = listLiveTradeRecordsSync(programId, userId);
  const rounds = buildSimClosedRounds(trades, programId);
  const decided = rounds.filter(
    (r) => r.outcome === "win" || r.outcome === "loss",
  );
  const wins = decided.filter((r) => r.outcome === "win");
  const losses = decided.filter((r) => r.outcome === "loss");
  const winRatePct =
    decided.length > 0 ? (wins.length / decided.length) * 100 : null;

  const model = getTechModelByIdSync(program.modelId);

  /** @type {string[]} */
  const winFactors = [];
  /** @type {string[]} */
  const lossFactors = [];

  if (decided.length < MIN_ROUNDS) {
    return {
      programId,
      programName: program.name,
      ready: false,
      message: `청산 완료 ${decided.length}건 — 분석하려면 최소 ${MIN_ROUNDS}건 필요합니다.`,
      stats: {
        closedCount: decided.length,
        winCount: wins.length,
        lossCount: losses.length,
        winRatePct,
        openRoundHint: rounds.length - decided.length,
      },
      winFactors: [],
      lossFactors: [],
      suggestedPatch: {},
      applyItems: [],
      signalInsights: [],
      generatedAtMs: Date.now(),
    };
  }

  const targetWins = wins.filter((r) => r.exitKind === "target");
  const stopLosses = losses.filter((r) => r.exitKind === "stop");
  if (targetWins.length > 0) {
    winFactors.push(
      `목표가 도달 청산 ${targetWins.length}건 (평균 +${avgPct(targetWins)}%) — 설정한 저항·ATR 목표가 유효했습니다.`,
    );
  }
  const manualWins = wins.filter((r) => r.exitKind === "manual");
  if (manualWins.length > 0) {
    winFactors.push(`수동·기타 청산 승리 ${manualWins.length}건.`);
  }

  const { signalRates, best, worst, patch, applyItems, winRate } =
    buildSuggestedPatch(rounds, program);

  for (const s of best) {
    winFactors.push(
      `「${s.label}」 신호 포함 시 승률 ${s.winRatePct.toFixed(1)}% (${s.decided}건) — 매수 시 이 조건이 많을수록 유리했습니다.`,
    );
  }

  const idealWins = wins.filter((r) => r.entryIdeal);
  const idealLosses = losses.filter((r) => r.entryIdeal);
  const idealDecided = idealWins.length + idealLosses.length;
  if (idealDecided >= MIN_SIGNAL_SAMPLES) {
    const idealWr = (idealWins.length / idealDecided) * 100;
    if (idealWr >= 55) {
      winFactors.push(
        `구조적 진입(리테스트·추세전환 등) ${idealDecided}건 승률 ${idealWr.toFixed(1)}% — 매물대·추세 구조가 맞을 때 유리했습니다.`,
      );
    } else if (idealWr <= 40) {
      lossFactors.push(
        `구조적 진입 표시 ${idealDecided}건 승률 ${idealWr.toFixed(1)}% — 돌파·리테스트만으로는 부족할 수 있습니다.`,
      );
    }
  }
  const retestRounds = decided.filter((r) => r.entryKind === "breakout_retest");
  if (retestRounds.length >= MIN_SIGNAL_SAMPLES) {
    const rw = retestRounds.filter((r) => r.outcome === "win").length;
    const rr = (rw / retestRounds.length) * 100;
    if (rr >= 55) {
      winFactors.push(
        `매물대 돌파 후 리테스트 진입 ${retestRounds.length}건 승률 ${rr.toFixed(1)}%.`,
      );
    } else if (rr <= 40) {
      lossFactors.push(
        `리테스트 진입 ${retestRounds.length}건 승률 ${rr.toFixed(1)}% — 가짜 돌파·재하락을 걸러야 합니다.`,
      );
    }
  }

  if (stopLosses.length > 0) {
    lossFactors.push(
      `손절가 도달 ${stopLosses.length}건 (평균 ${avgPct(stopLosses)}%) — 지지·ATR 손절이 깨진 진입이 많습니다.`,
    );
  }
  const highScoreLosses = losses.filter(
    (r) =>
      r.buyScore != null &&
      r.buyScore >= (model?.maxTechScore ?? 100) * program.minScoreRatio,
  );
  if (highScoreLosses.length >= 2) {
    lossFactors.push(
      `고점수 매수 후에도 손실 ${highScoreLosses.length}건 — 점수만으로는 부족, 신호 조합·시장 환경을 의심합니다.`,
    );
  }
  for (const s of worst) {
    lossFactors.push(
      `「${s.label}」 신호 포함 시 승률 ${s.winRatePct.toFixed(1)}% (${s.decided}건) — 이 조건 위주 매수는 피하는 편이 낫습니다.`,
    );
  }

  if (winRate != null && winRate >= 55 && applyItems.length === 0) {
    winFactors.push(
      `전체 승률 ${winRate.toFixed(1)}% — 현재 설정을 유지해도 됩니다.`,
    );
  }

  const summary =
    winRate != null
      ? `청산 ${decided.length}건 · 승 ${wins.length} / 패 ${losses.length} · 승률 ${winRate.toFixed(1)}%`
      : `청산 ${decided.length}건`;

  const feedback = {
    programId,
    programName: program.name,
    ready: true,
    message: summary,
    stats: {
      closedCount: decided.length,
      winCount: wins.length,
      lossCount: losses.length,
      winRatePct,
      avgWinPct: avgPct(wins),
      avgLossPct: avgPct(losses),
      targetWinCount: targetWins.length,
      stopLossCount: stopLosses.length,
    },
    winFactors,
    lossFactors,
    suggestedPatch: patch,
    applyItems,
    signalInsights: signalRates,
    generatedAtMs: Date.now(),
  };

  cacheFeedback(programId, feedback);
  return feedback;
}

/**
 * @param {{ netPct: number }[]} rows
 */
function avgPct(rows) {
  if (!rows.length) return "—";
  const n =
    rows.reduce((s, r) => s + r.netPct, 0) / Math.max(1, rows.length);
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}`;
}

function cacheFeedback(programId, feedback) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    let store = { byProgram: {} };
    if (fs.existsSync(FEEDBACK_FILE)) {
      store = JSON.parse(fs.readFileSync(FEEDBACK_FILE, "utf8"));
    }
    if (!store.byProgram || typeof store.byProgram !== "object") {
      store.byProgram = {};
    }
    store.byProgram[programId] = feedback;
    fs.writeFileSync(FEEDBACK_FILE, JSON.stringify(store, null, 0), "utf8");
  } catch {
    /* optional cache */
  }
}

/**
 * @param {string} programId
 */
export function applySimProgramFeedbackPatch(programId, userId) {
  const analysis = analyzeSimProgramFeedback(programId, userId);
  if (!analysis.ready) {
    throw new Error(analysis.message ?? "분석 데이터가 부족합니다.");
  }
  if (!analysis.applyItems?.length) {
    throw new Error("적용할 자동 개선안이 없습니다. 승·패 요인만 참고하세요.");
  }
  const patch = analysis.suggestedPatch ?? {};
  const program = updateLiveTradeProgramSync(programId, patch, userId);
  return { program, analysis };
}

/**
 * 신규 테스터 등록용 — 시뮬 이력 기반 추천
 * @param {string} [userId]
 */
export function buildSimCreationRecommendations(userId) {
  const programs = listLiveTradeProgramsSync(userId);
  const allTrades = listLiveTradeRecordsSync(null, userId);

  /** @type {{ programId: string; name: string; winRatePct: number; decided: number; program: object }[]} */
  const programStats = [];

  for (const p of programs) {
    const rounds = buildSimClosedRounds(allTrades, p.id);
    const decided = rounds.filter(
      (r) => r.outcome === "win" || r.outcome === "loss",
    );
    if (decided.length < MIN_ROUNDS) continue;
    const wins = decided.filter((r) => r.outcome === "win").length;
    programStats.push({
      programId: p.id,
      name: p.name,
      winRatePct: (wins / decided.length) * 100,
      decided: decided.length,
      program: p,
    });
  }

  programStats.sort((a, b) => b.winRatePct - a.winRatePct);

  /** @type {{ id: string; title: string; reason: string; patch: object; winRatePct?: number }[]} */
  const items = [];

  const top = programStats[0];
  if (top && top.winRatePct >= 50) {
    const p = top.program;
    const model = getTechModelByIdSync(p.modelId);
    items.push({
      id: `clone-${top.programId}`,
      title: `「${top.name}」와 비슷하게 (${top.winRatePct.toFixed(1)}% 승률)`,
      reason: `시뮬 청산 ${top.decided}건 중 승률이 가장 높았습니다. 모델「${model?.name ?? p.modelId}」, 최소 점수 ${Math.round(p.minScoreRatio * 100)}%, 보유 ${p.maxOpenPositions}종.`,
      patch: {
        modelId: p.modelId,
        minScoreRatio: p.minScoreRatio,
        maxOpenPositions: p.maxOpenPositions,
        markets: { ...p.markets },
        simAutoBuy: p.simAutoBuy !== false,
        autoSellAtTarget: p.autoSellAtTarget !== false,
        orderAmountKrw: p.orderAmountKrw,
        orderAmountUsd: p.orderAmountUsd,
      },
      winRatePct: top.winRatePct,
    });
  }

  const allRounds = [];
  for (const p of programs) {
    allRounds.push(...buildSimClosedRounds(allTrades, p.id));
  }
  const decided = allRounds.filter(
    (r) => r.outcome === "win" || r.outcome === "loss",
  );
  const signalRates = signalWinRates(decided);
  const bestSignals = signalRates.filter((s) => s.winRatePct >= 58).slice(0, 3);

  if (bestSignals.length > 0) {
    const labels = bestSignals.map((s) => s.label).join(", ");
    const topProg = programStats[0]?.program;
    items.push({
      id: "signals-high-wr",
      title: `승률 높은 신호 조합 (${labels})`,
      reason: bestSignals
        .map(
          (s) =>
            `「${s.label}」 포함 매수 승률 ${s.winRatePct.toFixed(1)}% (${s.decided}건)`,
        )
        .join(" · "),
      patch: topProg
        ? {
            modelId: topProg.modelId,
            minScoreRatio: Math.min(
              0.92,
              Math.max(topProg.minScoreRatio, 0.85),
            ),
          }
        : { minScoreRatio: 0.88 },
      winRatePct: bestSignals[0]?.winRatePct,
    });
  }

  if (items.length === 0) {
    items.push({
      id: "default-conservative",
      title: "기본 보수 설정",
      reason:
        "아직 분석할 시뮬 청산이 부족합니다. 최소 점수 85%, 자동 매도 켜기, 보유 5종으로 시작하세요.",
      patch: {
        minScoreRatio: 0.85,
        maxOpenPositions: 5,
        simAutoBuy: true,
        autoSellAtTarget: true,
      },
    });
  }

  return {
    items,
    programLeaderboard: programStats.slice(0, 5),
    generatedAtMs: Date.now(),
  };
}
