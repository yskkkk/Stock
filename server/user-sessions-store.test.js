import { afterEach, describe, expect, it } from "vitest";
import {
  AUTH_VALIDITY_MESSAGE_MINUTES,
  sessionTtlMinutesLabel,
  sessionTtlMs,
} from "./user-sessions-store.js";

describe("sessionTtlMs", () => {
  const prevMinutes = process.env.USER_SESSION_TTL_MINUTES;
  const prevDays = process.env.USER_SESSION_TTL_DAYS;

  afterEach(() => {
    if (prevMinutes === undefined) delete process.env.USER_SESSION_TTL_MINUTES;
    else process.env.USER_SESSION_TTL_MINUTES = prevMinutes;
    if (prevDays === undefined) delete process.env.USER_SESSION_TTL_DAYS;
    else process.env.USER_SESSION_TTL_DAYS = prevDays;
  });

  it("defaults to 30 days when unset", () => {
    delete process.env.USER_SESSION_TTL_MINUTES;
    delete process.env.USER_SESSION_TTL_DAYS;
    expect(sessionTtlMs()).toBe(30 * 24 * 60 * 60 * 1000);
    expect(sessionTtlMinutesLabel()).toBe(30 * 24 * 60);
  });

  it("keeps display message minutes at 1 regardless of TTL", () => {
    expect(AUTH_VALIDITY_MESSAGE_MINUTES).toBe(1);
  });

  it("honors USER_SESSION_TTL_MINUTES", () => {
    process.env.USER_SESSION_TTL_MINUTES = "5";
    delete process.env.USER_SESSION_TTL_DAYS;
    expect(sessionTtlMs()).toBe(5 * 60_000);
    expect(sessionTtlMinutesLabel()).toBe(5);
  });

  it("honors USER_SESSION_TTL_DAYS", () => {
    delete process.env.USER_SESSION_TTL_MINUTES;
    process.env.USER_SESSION_TTL_DAYS = "2";
    expect(sessionTtlMs()).toBe(2 * 24 * 60 * 60 * 1000);
  });
});
