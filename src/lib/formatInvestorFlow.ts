export function formatInvestorNetQty(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (value === 0) return "0";
  const sign = value > 0 ? "+" : "−";
  const abs = Math.abs(value);
  if (abs >= 100_000_000) {
    return `${sign}${(abs / 100_000_000).toFixed(2)}억주`;
  }
  if (abs >= 10_000) {
    return `${sign}${(abs / 10_000).toFixed(1)}만주`;
  }
  return `${sign}${abs.toLocaleString("ko-KR")}주`;
}

export function investorNetQtyClass(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value === 0) {
    return "investor-flow-tab__qty--flat";
  }
  return value > 0
    ? "investor-flow-tab__qty--buy"
    : "investor-flow-tab__qty--sell";
}
