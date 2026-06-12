export function isStatementMoneyRowLabel(label: string): boolean {
  const n = label.trim().toLowerCase().replace(/\s+/g, "");
  if (/^(per|pbr|psr|pcr|eps|bps|roe|roa|ros)$/.test(n)) return false;
  if (n.includes("주당") || n.endsWith("이익률") || n.endsWith("수익률")) return false;
  if ((n.endsWith("률") || n.endsWith("율")) && !n.includes("배당")) return false;
  return true;
}

export function parseStatementDisplayNumber(raw: string): number | null {
  const s = raw.trim();
  if (!s || s === "—" || s === "-") return null;
  const neg = /^\(.*\)$/.test(s);
  const m = s.replace(/,/g, "").replace(/[()]/g, "").match(/^([+-]?[\d.]+)/);
  if (!m) return null;
  let n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

export function formatKrEokDisplay(eok: number): string {
  if (!Number.isFinite(eok)) return "—";
  const abs = Math.abs(eok);
  const maxFrac = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  return eok.toLocaleString("ko-KR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxFrac,
  });
}

/** KR 재무제표 — 억원 단위로 통일. Yahoo 원(₩) raw는 억으로 환산. */
export function normalizeKrStatementMoneyValue(
  value: string | null | undefined,
  unitNote = "",
  label = "",
): string {
  const raw = String(value ?? "").trim();
  if (!raw || raw === "—" || raw === "-") return raw || "—";
  if (!unitNote.includes("억원")) return raw;
  if (label && !isStatementMoneyRowLabel(label)) return raw;
  if (/[%배]|krw|usd|million|billion/i.test(raw) || /[억조]/.test(raw)) return raw;

  const n = parseStatementDisplayNumber(raw);
  if (n == null) return raw;
  if (Math.abs(n) < 1_000_000) return raw;
  return formatKrEokDisplay(n / 1e8);
}
