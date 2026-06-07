export type PeerPerVerdict = "high" | "low" | "similar";

export type PeerPerComparison = {
  per: number;
  medianPer: number;
  peerGroup: string;
  deltaPct: number;
  verdict: PeerPerVerdict;
  verdictLabel: string;
  detailText: string;
};

export function peerPerVerdict(ratio: number): PeerPerVerdict {
  if (ratio >= 1.25) return "high";
  if (ratio <= 0.8) return "low";
  return "similar";
}

export function formatPeerPerDeltaPct(per: number, medianPer: number): number {
  return (per / medianPer - 1) * 100;
}

export function buildPeerPerComparison(
  per: number,
  medianPer: number,
  peerGroup: string,
  labels: {
    vsPeerHigh: string;
    vsPeerLow: string;
    vsPeerSimilar: string;
  },
): PeerPerComparison {
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
  const detailText = `PER ${per.toFixed(2)}배 · 동종 ${medianPer.toFixed(2)}배 (${peerGroup}) · ${sign}${deltaPct.toFixed(0)}%`;
  return {
    per,
    medianPer,
    peerGroup,
    deltaPct,
    verdict,
    verdictLabel,
    detailText,
  };
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
): PeerPerComparison & { text: string } {
  const cmp = buildPeerPerComparison(per, medianPer, peerGroup, labels);
  return {
    ...cmp,
    text: `${cmp.verdictLabel} · ${cmp.detailText}`,
  };
}

export function peerPerVerdictClassName(verdict: PeerPerVerdict): string {
  if (verdict === "high") return "peer-per--high";
  if (verdict === "low") return "peer-per--low";
  return "peer-per--similar";
}
