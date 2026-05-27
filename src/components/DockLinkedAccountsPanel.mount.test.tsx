import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ko } from "../i18n/ko";
import DockLinkedAccountsPanel from "./DockLinkedAccountsPanel";
import { useLiveTradeAuth } from "./LiveTradeAuthAndCredentials";
import { useLiveTradingStatusPoll } from "../hooks/useLiveTradingStatusPoll";

vi.mock("./LiveTradeAuthAndCredentials", () => ({
  useLiveTradeAuth: vi.fn(),
}));

vi.mock("../hooks/useLiveTradingStatusPoll", () => ({
  useLiveTradingStatusPoll: vi.fn(),
}));

vi.mock("../hooks/useBithumbAccountSnapshot", () => ({
  useBithumbAccountSnapshot: vi.fn(() => ({
    snapshot: null,
    feeLabelKo: null,
    updatedAtMs: null,
    loading: false,
    err: null,
  })),
}));

vi.mock("./TossAccountBalancePanel", () => ({
  default: () => <div data-testid="toss-balance" />,
}));

vi.mock("./BithumbAccountSnapshotCard", () => ({
  default: () => <div data-testid="bithumb-card" />,
}));

describe("DockLinkedAccountsPanel mount", () => {
  beforeEach(() => {
    vi.mocked(useLiveTradeAuth).mockReturnValue({
      user: null,
      authChecked: true,
      registrationOpen: false,
    } as ReturnType<typeof useLiveTradeAuth>);
    vi.mocked(useLiveTradingStatusPoll).mockReturnValue({
      bithumb: { ready: true },
      toss: { ready: false },
    } as ReturnType<typeof useLiveTradingStatusPoll>);
  });

  it("renders loading state while auth is pending", () => {
    vi.mocked(useLiveTradeAuth).mockReturnValue({
      user: null,
      authChecked: false,
      registrationOpen: false,
    } as ReturnType<typeof useLiveTradeAuth>);

    render(<DockLinkedAccountsPanel />);
    expect(screen.getByText(ko.app.marketIndicesLoading)).toBeTruthy();
  });

  it("renders exchange picker when logged in (account tab)", () => {
    vi.mocked(useLiveTradeAuth).mockReturnValue({
      user: { id: "u1", email: "a@b.c" },
      authChecked: true,
      registrationOpen: false,
    } as ReturnType<typeof useLiveTradeAuth>);

    render(<DockLinkedAccountsPanel />);
    expect(screen.getByText(ko.app.liveTradeTradesPickExchange)).toBeTruthy();
  });
});
