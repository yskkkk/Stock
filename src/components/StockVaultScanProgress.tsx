import { ko } from "../i18n/ko";
import type { VaultScanProgressRow } from "../types";

type Props = {
  rows: VaultScanProgressRow[];
};

function isActiveRow(row: VaultScanProgressRow) {
  return row.phase === "running" || row.phase === "pending" || row.scanned < row.total;
}

export function StockVaultScanProgress({ rows }: Props) {
  const active = rows.filter(isActiveRow);
  if (!active.length) return null;

  return (
    <ul className="stock-vault-tab__scan-progress" aria-label={ko.stockVault.scanProgressAria}>
      {active.map((row) => {
        const key = `${row.kind}:${row.market ?? ""}:${row.timeframe ?? ""}`;
        const pct = row.total > 0 ? row.pct : 0;
        return (
          <li key={key} className="stock-vault-tab__scan-progress-item">
            <span className="stock-vault-tab__scan-progress-label">{row.label}</span>
            <progress
              className="stock-vault-tab__scan-progress-bar"
              value={row.scanned}
              max={Math.max(row.total, 1)}
            />
            <span className="stock-vault-tab__scan-progress-pct">{pct}%</span>
          </li>
        );
      })}
    </ul>
  );
}
