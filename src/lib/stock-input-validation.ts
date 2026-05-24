/**
 * 입력 검증 — server/stock-input-validation.js 와 동일 규칙.
 */

const API_TOKEN_MIN = 32;
const API_TOKEN_MAX = 128;

const EMAIL_MAX = 254;
const EMAIL_RE =
  /^[a-z0-9](?:[a-z0-9._%+-]*[a-z0-9])?@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z]{2,})+$/i;

const AUTH_PASSWORD_MIN = 8;
const AUTH_PASSWORD_MAX = 128;

export type ValidationResult<T = string> =
  | { ok: true; value: T }
  | { ok: false; error: string; field?: string };

function bad(label: string, message: string): ValidationResult<never> {
  return { ok: false, error: message, field: label };
}

function ok<T>(value: T): ValidationResult<T> {
  return { ok: true, value };
}

function hasControlChars(v: string) {
  return /[\x00-\x1f\x7f]/.test(v);
}

export function validateExchangeApiToken(
  value: string,
  opts?: { label?: string; allowEmpty?: boolean },
): ValidationResult<string> {
  const label = opts?.label?.trim() || "API Key";
  const v = String(value ?? "").trim();
  if (!v) {
    return opts?.allowEmpty ? ok("") : bad(label, `${label}를 입력하세요.`);
  }
  if (/\s/.test(v) || hasControlChars(v)) {
    return bad(label, `${label}에 공백·제어문자를 넣을 수 없습니다.`);
  }
  if (v.length < API_TOKEN_MIN || v.length > API_TOKEN_MAX) {
    return bad(
      label,
      `${label}는 ${API_TOKEN_MIN}~${API_TOKEN_MAX}자여야 합니다. (현재 ${v.length}자)`,
    );
  }
  if (/^(.)\1{8,}$/.test(v)) {
    return bad(label, `${label} 형식이 올바르지 않습니다.`);
  }
  return ok(v);
}

export function validateBithumbCredentialPair(
  apiKey: string,
  secretKey: string,
  opts?: { configured?: boolean },
): ValidationResult<{ apiKey: string; secretKey: string }> {
  const configured = Boolean(opts?.configured);
  const keyIn = apiKey.trim();
  const secIn = secretKey.trim();

  if (!configured) {
    const k = validateExchangeApiToken(keyIn, { label: "API Key" });
    if (!k.ok) return k;
    const s = validateExchangeApiToken(secIn, { label: "Secret Key" });
    if (!s.ok) return s;
    return ok({ apiKey: k.value, secretKey: s.value });
  }

  if (!keyIn && !secIn) {
    return bad("API Key", "변경할 API Key 또는 Secret Key를 입력하세요.");
  }

  if (keyIn) {
    const k = validateExchangeApiToken(keyIn, { label: "API Key" });
    if (!k.ok) return k;
  }
  if (secIn) {
    const s = validateExchangeApiToken(secIn, { label: "Secret Key" });
    if (!s.ok) return s;
  }

  return ok({ apiKey: keyIn, secretKey: secIn });
}

const TOSS_ACCOUNT_MIN = 4;
const TOSS_ACCOUNT_MAX = 64;
const TOSS_ACCOUNT_RE = /^[A-Za-z0-9-]+$/;

export function validateTossAccountId(
  value: string,
  opts?: { allowEmpty?: boolean },
): ValidationResult<string> {
  const label = "계좌 번호";
  const v = String(value ?? "").trim();
  if (!v) {
    return opts?.allowEmpty ? ok("") : bad(label, `${label}를 입력하세요.`);
  }
  if (v.length < TOSS_ACCOUNT_MIN || v.length > TOSS_ACCOUNT_MAX) {
    return bad(
      label,
      `${label}는 ${TOSS_ACCOUNT_MIN}~${TOSS_ACCOUNT_MAX}자여야 합니다.`,
    );
  }
  if (!TOSS_ACCOUNT_RE.test(v)) {
    return bad(label, `${label}는 영문·숫자와 -(하이픈)만 사용할 수 있습니다.`);
  }
  return ok(v);
}

export function validateTossCredentialSet(
  apiKey: string,
  secretKey: string,
  accountId: string,
  opts?: { configured?: boolean },
): ValidationResult<{ apiKey: string; secretKey: string; accountId: string }> {
  const configured = Boolean(opts?.configured);
  const keyIn = apiKey.trim();
  const secIn = secretKey.trim();
  const acctIn = accountId.trim();

  if (!configured) {
    const k = validateExchangeApiToken(keyIn, { label: "API Key" });
    if (!k.ok) return k;
    const s = validateExchangeApiToken(secIn, { label: "Secret Key" });
    if (!s.ok) return s;
    const a = validateTossAccountId(acctIn);
    if (!a.ok) return a;
    return ok({ apiKey: k.value, secretKey: s.value, accountId: a.value });
  }

  if (!keyIn && !secIn && !acctIn) {
    return bad(
      "API Key",
      "변경할 API Key·Secret Key·계좌 번호 중 하나 이상을 입력하세요.",
    );
  }

  if (keyIn) {
    const k = validateExchangeApiToken(keyIn, { label: "API Key" });
    if (!k.ok) return k;
  }
  if (secIn) {
    const s = validateExchangeApiToken(secIn, { label: "Secret Key" });
    if (!s.ok) return s;
  }
  if (acctIn) {
    const a = validateTossAccountId(acctIn);
    if (!a.ok) return a;
  }

  return ok({ apiKey: keyIn, secretKey: secIn, accountId: acctIn });
}

export function validateAuthEmail(email: string): ValidationResult<string> {
  const raw = String(email ?? "");
  if (raw !== raw.trim()) {
    return bad("이메일", "이메일 앞뒤 공백은 제거해 주세요.");
  }
  const v = raw.trim().toLowerCase();
  if (!v) {
    return bad("이메일", "이메일을 입력하세요.");
  }
  if (v.length > EMAIL_MAX) {
    return bad("이메일", `이메일은 ${EMAIL_MAX}자 이하여야 합니다.`);
  }
  if (hasControlChars(v) || /\s/.test(v)) {
    return bad("이메일", "이메일에 공백·제어문자를 넣을 수 없습니다.");
  }
  if (!EMAIL_RE.test(v)) {
    return bad("이메일", "올바른 이메일 형식이 아닙니다.");
  }
  return ok(v);
}

export function validateAuthPassword(
  password: string,
  opts?: { register?: boolean },
): ValidationResult<string> {
  const v = String(password ?? "");
  if (!v) {
    return bad("비밀번호", "비밀번호를 입력하세요.");
  }
  if (v.length < AUTH_PASSWORD_MIN || v.length > AUTH_PASSWORD_MAX) {
    return bad(
      "비밀번호",
      `비밀번호는 ${AUTH_PASSWORD_MIN}~${AUTH_PASSWORD_MAX}자여야 합니다.`,
    );
  }
  if (/\s/.test(v)) {
    return bad("비밀번호", "비밀번호에 공백을 넣을 수 없습니다.");
  }
  if (hasControlChars(v)) {
    return bad("비밀번호", "비밀번호에 사용할 수 없는 문자가 포함되어 있습니다.");
  }
  if (opts?.register) {
    if (!/[A-Za-z]/.test(v) || !/[0-9]/.test(v)) {
      return bad(
        "비밀번호",
        "비밀번호는 영문과 숫자를 각각 1자 이상 포함해야 합니다.",
      );
    }
  }
  return ok(v);
}

export function validateAuthCredentials(
  email: string,
  password: string,
  opts?: { register?: boolean },
): ValidationResult<{ email: string; password: string }> {
  const e = validateAuthEmail(email);
  if (!e.ok) return e;
  const p = validateAuthPassword(password, { register: opts?.register });
  if (!p.ok) return p;
  return ok({ email: e.value, password: p.value });
}
