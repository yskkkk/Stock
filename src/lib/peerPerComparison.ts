export type PeerPerVerdict = "high" | "low" | "similar";

export function peerPerVerdict(ratio: number): PeerPerVerdict {
  if (ratio >= 1.25) return "high";
  if (ratio <= 0.8) return "low";
  return "similar";
}

export function formatPeerPerDeltaPct(per: number, medianPer: number): number {
  return ((per / medianPer) - 1) * 100;
}

export function formatPeerPerComparison(
  per: number,
  medianPer: number,
  peerGroup: string,
  labels: {
    peerMedianPer: string;
    vsPeerHigh: string;
    vsPeerLow: string;
    vsPeerSimilar: string;
  },
): { text: string; verdict: PeerPerVerdict; deltaPct: number } {
  const ratio = per / medianPer;
  const deltaPct = formatPeerPerDeltaPct(per, medianPer);
  const sign = deltaPct >= 0 ? "+" : "";
  const verdict = peerPerVerdict(ratio);
  const verdictLabel =
    verdict === "high"
      ? labels.vsPeerHigh
      : verdict === "low"
        ? labels.vsPeerLow
        : labels.vsPeerSimilar;
  const medianText = `${medianPer.toFixed(2)}배`;
  const text = `${labels.peerMedianPer} ${medianText} (${peerGroup}) · ${sign}${deltaPct.toFixed(0)}% · ${verdictLabel}`;
  return { text, verdict, deltaPct };
}

export function peerPerVerdictClassName(verdict: PeerPerVerdict): string {
  if (verdict === "high") return "peer-per--high";
  if (verdict === "low") return "peer-per--low";
  return "peer-per--similar";
}
