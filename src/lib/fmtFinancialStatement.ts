function normStatementLabel(label: string): string {
  return label.replace(/\s+/g, "").toLowerCase();
}

function valueLooksUnitized(raw: string): boolean {
  return /[%원배억$€£₩]|krw|usd|million|billion|m\b|b\b/i.test(raw);
}

/** 재무제표 행 라벨·섹션 단위로 표시 단위 추론 */
export function statementRowDisplayUnit(
  label: string,
  unitNote?: string,
  market?: "kr" | "us",
): string | null {
  const n = normStatementLabel(label);
  const upper = label.trim();

  if (/^(per|pbr|psr|pcr)$/i.test(upper) || /^(per|pbr|psr|pcr)$/.test(n)) {
    return "배";
  }
  if (/eps|bps/.test(n) || n.includes("주당배당") || n.includes("주당순이익")) {
    return "원";
  }
  if (
    /^roe$|^roa$|^ros$/.test(n) ||
    n.endsWith("이익률") ||
    n.endsWith("수익률") ||
    (n.endsWith("률") && !n.includes("배당"))
  ) {
    return "%";
  }

  if (unitNote?.includes("억원")) return "억원";
  if (unitNote?.match(/million|백만|million/i)) {
    return market === "us" ? "USD" : null;
  }

  if (market === "us" && /revenue|income|profit|assets|liab|cash|debt|equity/i.test(n)) {
    return "USD";
  }

  return null;
}

export function fmtFinancialStatementCell(
  value: string | null | undefined,
  label: string,
  unitNote?: string,
  market?: "kr" | "us",
): string {
  const raw = String(value ?? "").trim();
  if (!raw || raw === "—" || raw === "-") return "—";
  if (valueLooksUnitized(raw)) return raw;

  const unit = statementRowDisplayUnit(label, unitNote, market);
  if (!unit) return raw;
  if (unit === "%") return `${raw}%`;
  if (unit === "배") return `${raw}배`;
  if (unit === "원") return `${raw}원`;
  if (unit === "억원") return `${raw}억원`;
  if (unit === "USD") return `$${raw}`;
  return raw;
}
