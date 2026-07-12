export type GranvilleSignalId =
  | "buy1"
  | "buy2"
  | "buy3"
  | "buy4"
  | "sell1"
  | "sell2"
  | "sell3"
  | "sell4";
export type GranvilleSide = "buy" | "sell";

export interface GranvilleRule {
  id: GranvilleSignalId;
  side: GranvilleSide;
  num: 1 | 2 | 3 | 4;
  short: string;
  desc: string;
}

export const GRANVILLE_MA_PERIOD_DEFAULT: number;
export const GRANVILLE_RULES: GranvilleRule[];

export function getGranvilleRule(
  id: string | null | undefined,
): GranvilleRule | null;
export function granvilleSideLabel(side: GranvilleSide): string;
export function granvilleSummaryLabel(
  id: string | null | undefined,
  maPeriod?: number,
): string;
export function granvilleDescription(
  id: string | null | undefined,
  maPeriod?: number,
): string;
