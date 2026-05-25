import { describe, expect, it } from "vitest";
import { resolveProgramAccountMigrationPatch } from "./live-trade-programs-store.js";

/** @param {Partial<import("./live-trade-programs-store.js").LiveTradeProgram>} p */
function prog(p) {
  return {
    id: "p1",
    name: "코인봇",
    modelId: "m1",
    markets: { kr: false, us: false, crypto: true },
    minScoreRatio: 0.8,
    maxOpenPositions: 5,
    orderAmountKrw: 10000,
    orderAmountUsd: null,
    status: "armed",
    armedAtMs: null,
    lastRunAtMs: null,
    lastError: null,
    simAutoBuy: true,
    autoSellAtTarget: true,
    takeProfitPct: 5,
    stopLossPct: -3,
    userId: null,
    ownerEmail: null,
    createdAtMs: 1,
    updatedAtMs: 1,
    ...p,
  };
}

const users = [
  { id: "u-a", email: "a@test.com" },
  { id: "u-b", email: "b@test.com" },
];

describe("resolveProgramAccountMigrationPatch", () => {
  it("assigns null userId when ownerEmail matches", () => {
    const patch = resolveProgramAccountMigrationPatch(
      prog({ userId: null, ownerEmail: "a@test.com" }),
      { userId: "u-a", email: "a@test.com", users, soleBithumbUserId: null },
    );
    expect(patch).toEqual({ userId: "u-a", ownerEmail: "a@test.com" });
  });

  it("does not assign null userId to wrong account on multi-user", () => {
    const patch = resolveProgramAccountMigrationPatch(
      prog({ userId: null, ownerEmail: "b@test.com" }),
      { userId: "u-a", email: "a@test.com", users, soleBithumbUserId: null },
    );
    expect(patch).toBeNull();
  });

  it("assigns null userId only when single user on server", () => {
    const patch = resolveProgramAccountMigrationPatch(
      prog({ userId: null }),
      {
        userId: "u-a",
        email: "a@test.com",
        users: [users[0]],
        soleBithumbUserId: null,
      },
    );
    expect(patch).toEqual({ userId: "u-a", ownerEmail: "a@test.com" });
  });

  it("reclaims orphan userId when ownerEmail matches", () => {
    const patch = resolveProgramAccountMigrationPatch(
      prog({ userId: "user-hist-1", ownerEmail: "a@test.com" }),
      { userId: "u-a", email: "a@test.com", users, soleBithumbUserId: null },
    );
    expect(patch).toEqual({ userId: "u-a", ownerEmail: "a@test.com" });
  });

  it("reclaims orphan crypto program for sole bithumb user", () => {
    const patch = resolveProgramAccountMigrationPatch(
      prog({ userId: "user-hist-1" }),
      {
        userId: "u-a",
        email: "a@test.com",
        users,
        soleBithumbUserId: "u-a",
      },
    );
    expect(patch).toEqual({ userId: "u-a", ownerEmail: "a@test.com" });
  });

  it("reassigns when ownerEmail matches but userId is another account", () => {
    const patch = resolveProgramAccountMigrationPatch(
      prog({ userId: "u-b", ownerEmail: "a@test.com" }),
      { userId: "u-a", email: "a@test.com", users, soleBithumbUserId: null },
    );
    expect(patch).toEqual({ userId: "u-a", ownerEmail: "a@test.com" });
  });
});
