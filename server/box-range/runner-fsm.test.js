import { test } from "vitest";
import assert from "node:assert/strict";

/**
 * Pine PRO v2 FSM 의사결정 — runner-fsm.js와 동일 규칙(틱 lastPrice)
 * 모델 ⑩: armed→confirming→in_position (확인캔들 1틱 추가)
 * @param {{ state: string; bottom: number; top: number; dipLow: number | null; dead?: boolean; rightTime: number }} box
 * @param {number} lastPrice
 * @param {number} nowMs
 */
function proV2FsmStep(box, lastPrice, nowMs) {
  if (box.dead) return { action: "close_dead" };
  const afterBox = box.rightTime > 0 && nowMs > box.rightTime * 1000;

  if (box.state === "idle") {
    if (afterBox && lastPrice <= box.bottom) {
      return { action: "arm", dipLow: lastPrice };
    }
    return { action: "none" };
  }

  if (box.state === "armed") {
    if (!afterBox) return { action: "none" };
    const dipLow =
      box.dipLow == null || lastPrice < box.dipLow ? lastPrice : box.dipLow;
    if (lastPrice >= box.bottom) {
      return { action: "confirm", dipLow };
    }
    return { action: "track_dip", dipLow };
  }

  if (box.state === "confirming") {
    if (!afterBox) return { action: "none" };
    if (lastPrice < box.bottom) {
      const dipLow =
        box.dipLow == null || lastPrice < box.dipLow ? lastPrice : box.dipLow;
      return { action: "rearm", dipLow };
    }
    return { action: "buy", entryPrice: box.bottom, dipLow: box.dipLow };
  }

  if (box.state === "in_position") {
    if (lastPrice >= box.top) return { action: "tp", fillPrice: box.top };
    if (box.dipLow != null && lastPrice <= box.dipLow) {
      return { action: "sl", fillPrice: box.dipLow };
    }
    return { action: "none" };
  }

  return { action: "none" };
}

const BOX = {
  state: "idle",
  bottom: 100,
  top: 110,
  dipLow: null,
  rightTime: 1,
};
const AFTER_BOX_MS = 2000;

test("PRO v2: idle→armed on bottom break after box ends", () => {
  const r = proV2FsmStep({ ...BOX, state: "idle" }, 99, AFTER_BOX_MS);
  assert.equal(r.action, "arm");
  assert.equal(r.dipLow, 99);
});

test("PRO v2: no arm before box rightTime", () => {
  const r = proV2FsmStep({ ...BOX, state: "idle" }, 99, 500);
  assert.equal(r.action, "none");
});

test("PRO v2: armed → confirming on first recovery tick", () => {
  const r = proV2FsmStep(
    { ...BOX, state: "armed", dipLow: 97, breakAtMs: 1 },
    100,
    AFTER_BOX_MS,
  );
  assert.equal(r.action, "confirm");
  assert.equal(r.dipLow, 97);
});

test("PRO v2: confirming → buy on second recovery tick", () => {
  const r = proV2FsmStep(
    { ...BOX, state: "confirming", dipLow: 97, breakAtMs: 1 },
    100,
    AFTER_BOX_MS,
  );
  assert.equal(r.action, "buy");
  assert.equal(r.entryPrice, 100);
  assert.equal(r.dipLow, 97);
});

test("PRO v2: confirming → rearm on fake recovery", () => {
  const r = proV2FsmStep(
    { ...BOX, state: "confirming", dipLow: 97, breakAtMs: 1 },
    98,
    AFTER_BOX_MS,
  );
  assert.equal(r.action, "rearm");
});

test("PRO v2: dipLow tracks min while armed even above bottom", () => {
  const r = proV2FsmStep(
    { ...BOX, state: "armed", dipLow: 98 },
    99,
    AFTER_BOX_MS,
  );
  assert.equal(r.action, "track_dip");
  assert.equal(r.dipLow, 98);
  const r2 = proV2FsmStep(
    { ...BOX, state: "armed", dipLow: 98 },
    96,
    AFTER_BOX_MS,
  );
  assert.equal(r2.dipLow, 96);
});

test("PRO v2: TP at top then re-armable (not dead)", () => {
  const r = proV2FsmStep(
    { ...BOX, state: "in_position", dipLow: 97 },
    110,
    AFTER_BOX_MS,
  );
  assert.equal(r.action, "tp");
});

test("PRO v2: SL at dipLow marks dead path", () => {
  const r = proV2FsmStep(
    { ...BOX, state: "in_position", dipLow: 97 },
    97,
    AFTER_BOX_MS,
  );
  assert.equal(r.action, "sl");
  assert.equal(r.fillPrice, 97);
});

test("PRO v2: TP checked before SL when both hit", () => {
  const r = proV2FsmStep(
    { ...BOX, state: "in_position", dipLow: 97, top: 110 },
    110,
    AFTER_BOX_MS,
  );
  assert.equal(r.action, "tp");
});
