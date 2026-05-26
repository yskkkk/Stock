import type { LiveTradeRecord } from "../api";

export type ProgramTradeGroup = {
  programId: string;
  programName: string;
  trades: LiveTradeRecord[];
};

/** 최신 체결 시각 기준 내림차순 */
export function groupTradesByProgram(
  trades: LiveTradeRecord[],
): ProgramTradeGroup[] {
  const byId = new Map<string, LiveTradeRecord[]>();
  for (const t of trades) {
    const pid = String(t.programId ?? "").trim() || "_unknown";
    const list = byId.get(pid);
    if (list) list.push(t);
    else byId.set(pid, [t]);
  }
  const groups: ProgramTradeGroup[] = [];
  for (const [programId, rows] of byId) {
    const sorted = [...rows].sort((a, b) => b.atMs - a.atMs);
    const programName =
      String(
        (sorted[0] as LiveTradeRecord & { programName?: string }).programName ??
          "",
      ).trim() ||
      (programId === "_unknown" ? "—" : programId);
    groups.push({ programId, programName, trades: sorted });
  }
  groups.sort((a, b) => (b.trades[0]?.atMs ?? 0) - (a.trades[0]?.atMs ?? 0));
  return groups;
}
