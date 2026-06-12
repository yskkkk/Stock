/** @param {string} label */
export function isStatementMoneyRowLabel(label) {
  const n = String(label ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
  if (/^(per|pbr|psr|pcr|eps|bps|roe|roa|ros)$/.test(n)) return false;
  if (n.includes("주당") || n.endsWith("이익률") || n.endsWith("수익률")) return false;
  if ((n.endsWith("률") || n.endsWith("율")) && !n.includes("배당")) return false;
  return true;
}

/** @param {string} raw */
export function parseStatementDisplayNumber(raw) {
  const s = String(raw ?? "").trim();
  if (!s || s === "—" || s === "-") return null;
  const neg = /^\(.*\)$/.test(s);
  const m = s.replace(/,/g, "").replace(/[()]/g, "").match(/^([+-]?[\d.]+)/);
  if (!m) return null;
  let n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

/** @param {number} eok */
export function formatKrEokDisplay(eok) {
  if (!Number.isFinite(eok)) return "—";
  const abs = Math.abs(eok);
  const maxFrac = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  return new Intl.NumberFormat("ko-KR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxFrac,
  }).format(eok);
}

/**
 * KR 재무제표 — 억원 단위 표기로 통일. Yahoo 원(₩) raw는 억으로 환산.
 * @param {string | null | undefined} value
 * @param {string} [unitNote]
 * @param {string} [label]
 */
export function normalizeKrStatementMoneyValue(value, unitNote = "", label = "") {
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
