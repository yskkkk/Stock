import { useCallback, useRef, useState } from "react";
import { ko } from "../i18n/ko";
import {
  formatLastScanDateCell,
  type StockVaultLastScanRow,
} from "../lib/stockVaultLastScan";
import { stockVaultTimeframeLabel } from "../lib/stockVaultTimeframe";

function ScanDateCell({ date }: { date: string | null }) {
  const cell = formatLastScanDateCell(date);
  return (
    <td
      className={cell.empty ? "stock-vault-tab__scan-date--empty" : undefined}
      title={cell.title}
    >
      {cell.label}
    </td>
  );
}

function ScanTable({ rows }: { rows: StockVaultLastScanRow[] }) {
  return (
    <div className="stock-vault-tab__scan-table-wrap">
      <table className="stock-vault-tab__scan-table">
        <thead>
          <tr>
            <th scope="col" aria-hidden="true" />
            <th scope="col" colSpan={2}>
              {stockVaultTimeframeLabel("1d")}
            </th>
            <th scope="col" colSpan={2}>
              {stockVaultTimeframeLabel("1wk")}
            </th>
          </tr>
          <tr>
            <th scope="col" aria-hidden="true" />
            <th scope="col">{ko.app.marketKr}</th>
            <th scope="col">{ko.app.marketUs}</th>
            <th scope="col">{ko.app.marketKr}</th>
            <th scope="col">{ko.app.marketUs}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <th scope="row">{row.label}</th>
              <ScanDateCell date={row.dailyKr} />
              <ScanDateCell date={row.dailyUs} />
              <ScanDateCell date={row.weeklyKr} />
              <ScanDateCell date={row.weeklyUs} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function StockVaultLastScanTable({
  rows,
}: {
  rows: StockVaultLastScanRow[];
}) {
  const [open, setOpen] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback(() => {
    if (hideTimer.current != null) {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
    setOpen(true);
  }, []);

  const scheduleHide = useCallback(() => {
    if (hideTimer.current != null) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      hideTimer.current = null;
      setOpen(false);
    }, 120);
  }, []);

  if (!rows.length) return null;

  return (
    <div className="stock-vault-tab__scan-summary">
      <button
        type="button"
        className="stock-vault-tab__scan-summary-trigger"
        aria-expanded={open}
        aria-haspopup="true"
        onMouseEnter={show}
        onMouseLeave={scheduleHide}
        onFocus={show}
        onBlur={scheduleHide}
      >
        {ko.stockVault.lastScan}
      </button>
      {open ? (
        <div
          className="stock-vault-tab__scan-bubble"
          role="tooltip"
          onMouseEnter={show}
          onMouseLeave={scheduleHide}
        >
          <ScanTable rows={rows} />
        </div>
      ) : null}
    </div>
  );
}
