import { isBoxRangeProgram } from "./constants.js";
import { listBoxesForProgramSync } from "./store.js";
import { readProgramsStoreSync } from "../live-trade-programs-store.js";

const STATE_ORDER = { in_position: 0, armed: 1, idle: 2, closed: 3 };

/**
 * @param {import("./store.js").BoxRangeRecord} b
 */
function toPublicBox(b) {
  return {
    boxId: b.boxId,
    symbol: b.symbol,
    timeframe: b.timeframe,
    top: b.top,
    bottom: b.bottom,
    mid: b.mid,
    state: b.state,
    entryPrice: b.entryPrice,
    takeProfitPrice: b.top,
    stopLossPrice: b.bottom,
    lotQty: b.lotQty > 0 ? b.lotQty : null,
    buyAtMs: b.buyAtMs,
  };
}

/**
 * @param {string} userId
 */
export function buildBoxRangeStatusForUserSync(userId) {
  const uid = String(userId ?? "").trim();
  /** @type {Record<string, { programId: string; programName: string; status: string; boxes: ReturnType<typeof toPublicBox>[] }>} */
  const programs = {};

  for (const p of readProgramsStoreSync().programs) {
    if (String(p.userId ?? "").trim() !== uid) continue;
    if (!isBoxRangeProgram(p)) continue;
    const boxes = listBoxesForProgramSync(p.id)
      .filter((b) => b.state !== "closed")
      .map(toPublicBox)
      .sort(
        (a, b) =>
          (STATE_ORDER[a.state] ?? 9) - (STATE_ORDER[b.state] ?? 9) ||
          (b.buyAtMs ?? 0) - (a.buyAtMs ?? 0),
      );
    programs[p.id] = {
      programId: p.id,
      programName: p.name,
      status: p.status,
      boxes,
    };
  }

  return { programs, fetchedAtMs: Date.now() };
}
