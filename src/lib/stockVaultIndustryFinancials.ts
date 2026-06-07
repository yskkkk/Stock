import type { StockVaultIndustryFinancials } from "../types";

export type VaultIndustryFinVerdict = StockVaultIndustryFinancials["verdict"];

export function vaultIndustryFinVerdictClassName(
  verdict: VaultIndustryFinVerdict | undefined,
): string {
  if (verdict === "better") return "stock-vault-tab__fin-badge--better";
  if (verdict === "worse") return "stock-vault-tab__fin-badge--worse";
  if (verdict === "similar") return "stock-vault-tab__fin-badge--similar";
  return "stock-vault-tab__fin-badge--unknown";
}

export function formatVaultIndustryFinancialLines(
  fin: StockVaultIndustryFinancials,
  labels: {
    per: string;
    roe: string;
    profitMargin: string;
    peerCount: (n: number) => string;
  },
): { metricLine: string; peerLine: string | null } {
  const parts: string[] = [];
  if (fin.per != null && Number.isFinite(fin.per)) {
    parts.push(`${labels.per} ${fin.per.toFixed(2)}`);
  }
  if (fin.roe != null && Number.isFinite(fin.roe)) {
    parts.push(`${labels.roe} ${(fin.roe * 100).toFixed(1)}%`);
  }
  if (fin.profitMargin != null && Number.isFinite(fin.profitMargin)) {
    parts.push(`${labels.profitMargin} ${(fin.profitMargin * 100).toFixed(1)}%`);
  }
  const peerLine =
    fin.industryPeerCount != null && fin.industryPeerCount > 0
      ? labels.peerCount(fin.industryPeerCount)
      : null;
  return {
    metricLine: parts.join(" · ") || "—",
    peerLine,
  };
}
