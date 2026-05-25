import { describe, expect, it } from "vitest";
import {
  orderDedupeKey,
  programBlocksDuplicateBuySync,
  tryAcquireLiveBuySlot,
  releaseLiveBuyReservation,
  clearLiveBuyInFlight,
} from "./live-trade-buy-guard.js";

describe("live-trade-buy-guard", () => {
  it("orderDedupeKey normalizes symbol", () => {
    expect(orderDedupeKey("live:p1", "avl-usd")).toBe("live:p1:AVL-USD");
  });

  it("tryAcquireLiveBuySlot blocks second concurrent acquire", () => {
    const program = {
      id: "test-guard-prog",
      markets: { kr: false, us: false, crypto: true },
    };
    const scope = `live:${program.id}`;
    const sym = `GUARD-${Date.now()}`;
    const a = tryAcquireLiveBuySlot(scope, program, sym, "crypto", { liveOnly: true });
    expect(a.ok).toBe(true);
    const b = tryAcquireLiveBuySlot(scope, program, sym, "crypto", { liveOnly: true });
    expect(b.ok).toBe(false);
    expect(b.reason).toBe("in_flight");
    clearLiveBuyInFlight(a.key);
    releaseLiveBuyReservation(a.key);
  });
});
