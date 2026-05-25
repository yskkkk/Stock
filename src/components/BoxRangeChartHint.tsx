import { useMemo } from "react";
import type { BoxRangeOverlayScan } from "../api";
import { shouldDrawBoxOnChart } from "../lib/boxRangeChartPrimitive";
import { ko } from "../i18n/ko";

const TF_ORDER = ["1h", "4h", "1d"] as const;

function scanLabel(tf: string, status: string | undefined): string {
  if (status === "found") return ko.app.boxRangeScanFound;
  if (status === "error") return ko.app.boxRangeScanError;
  return ko.app.boxRangeScanNone;
}

export default function BoxRangeChartHint({
  loading,
  needsLogin,
  scan,
  chartInterval,
  overlayCount,
}: {
  loading: boolean;
  needsLogin: boolean;
  scan: BoxRangeOverlayScan | null;
  chartInterval: string;
  overlayCount: number;
}) {
  const detail = useMemo(() => {
    if (!scan) return null;
    return TF_ORDER.map((tf) => {
      const st = scan[tf];
      const drawn =
        st === "found" && shouldDrawBoxOnChart(tf, chartInterval);
      return `${tf.toUpperCase()} ${scanLabel(tf, st)}${
        st === "found" && !drawn ? ko.app.boxRangeScanHiddenOnChart : ""
      }`;
    }).join(" · ");
  }, [scan, chartInterval]);

  if (loading) {
    return (
      <p className="crypto-chart-box-hint">{ko.app.boxRangeChartLoading}</p>
    );
  }
  if (needsLogin) {
    return (
      <p className="crypto-chart-box-hint crypto-chart-box-hint--empty">
        {ko.app.boxRangeChartLogin}
      </p>
    );
  }
  if (overlayCount > 0) return null;

  return (
    <p className="crypto-chart-box-hint crypto-chart-box-hint--empty">
      {ko.app.boxRangeChartEmpty}
      {detail ? (
        <>
          <br />
          <span className="crypto-chart-box-hint__scan">{detail}</span>
        </>
      ) : null}
      <br />
      <span className="crypto-chart-box-hint__cond">
        {ko.app.boxRangeConditions}
      </span>
    </p>
  );
}
