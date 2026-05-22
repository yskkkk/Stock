/**
 * 서버 재기동 전용 비밀번호 — ACCESS_ADMIN_TOKEN 과 분리 가능.
 */
export function getServerRestartPasswordExpected() {
  const dedicated = String(process.env.SERVER_RESTART_PASSWORD ?? "").trim();
  if (dedicated) return dedicated;
  return String(process.env.ACCESS_ADMIN_TOKEN ?? "").trim();
}

/**
 * @param {string | null | undefined} supplied
 */
export function verifyServerRestartPassword(supplied) {
  const expected = getServerRestartPasswordExpected();
  if (!expected) return false;
  const got = String(supplied ?? "").trim();
  return got.length > 0 && got === expected;
}
