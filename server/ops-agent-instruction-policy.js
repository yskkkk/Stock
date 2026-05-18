/**
 * 운영 탭 Cursor 에이전트 instruction 사전 검사 — 악성·유출·파괴 명령 등 차단.
 * (휴리스틱; 100% 정확하지 않으며 정상 요청이 가끔 걸리면 패턴을 완화한다.)
 */

const MAX_INSTRUCTION_CHARS = 32_000;

/** @typedef {{ ok: true } | { ok: false; code: string; messageKo: string }} OpsInstructionPolicyResult */

/** @param {string} t */
function hasCtrlGarbage(t) {
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(t)) return true;
  const zws = (t.match(/\u200b|\u200c|\u200d|\ufeff/g) ?? []).length;
  return zws > 40;
}

/** @param {string} t */
function matchAny(t, patterns) {
  for (const re of patterns) {
    if (re.test(t)) return true;
  }
  return false;
}

/**
 * @param {unknown} instruction
 * @returns {OpsInstructionPolicyResult}
 */
export function checkOpsInstructionPolicy(instruction) {
  const raw = String(instruction ?? "");
  const t = raw.trim();
  if (t.length === 0) {
    return {
      ok: false,
      code: "INSTRUCTION_POLICY_EMPTY",
      messageKo: "요청 내용이 비어 있습니다.",
    };
  }
  if (t.length > MAX_INSTRUCTION_CHARS) {
    return {
      ok: false,
      code: "INSTRUCTION_POLICY_LENGTH",
      messageKo: `요청이 너무 깁니다(최대 ${MAX_INSTRUCTION_CHARS.toLocaleString("ko-KR")}자).`,
    };
  }
  if (hasCtrlGarbage(t)) {
    return {
      ok: false,
      code: "INSTRUCTION_POLICY_CONTROL",
      messageKo: "제어문자 등 비정상 패턴이 포함되어 실행하지 않습니다.",
    };
  }

  const injection = [
    /ignore\s+(all\s+)?(previous|prior|above)\s+instructions?/i,
    /disregard\s+(your\s+|the\s+)?(system|developer|instructions?)/i,
    /\bsystem\s*prompt\b/i,
    /\bdeveloper\s*message\b/i,
    /<\|im_start\|>/i,
    /<\|im_end\|>/i,
    /\[\[\s*INST\s*\]\]/i,
    /\byou\s+are\s+now\s+(DAN|unrestricted|free)\b/i,
    /\b(jailbreak|DAN\s+mode)\b/i,
  ];
  if (matchAny(t, injection)) {
    return {
      ok: false,
      code: "INSTRUCTION_POLICY_INJECTION",
      messageKo: "프롬프트 조작으로 의심되는 표현이 포함되어 실행하지 않습니다.",
    };
  }

  const secrets = [
    /\bcursor[_\s-]*api[_\s-]*key\b/i,
    /\bopenai[_\s-]*api[_\s-]*key\b/i,
    /\banthropic[_\s-]*api[_\s-]*key\b/i,
    /\baws[_\s-]*secret[_\s-]*access[_\s-]*key\b/i,
    /-----BEGIN\s+(OPENSSH|RSA|EC)\s+PRIVATE\s+KEY-----/i,
    /\bsk-[a-zA-Z0-9]{10,}\b/,
    /\bxox[baprs]-[0-9]{10,}-[0-9]{10,}-[a-zA-Z0-9]{10,}\b/,
  ];
  if (matchAny(t, secrets)) {
    return {
      ok: false,
      code: "INSTRUCTION_POLICY_SECRET",
      messageKo: "비밀키·토큰 형태가 포함되어 실행하지 않습니다. 키는 요청 본문에 넣지 마세요.",
    };
  }

  const destructive = [
    /\brm\s+-\s*rf\s+[/\\]/i,
    /\bmkfs\.[a-z0-9]+\b/i,
    /:\(\)\s*\{\s*:\s*\|:\s*&\s*\}\s*;/,
    /\bdd\s+if\s*=\s*\/dev\/zero\b/i,
    /\bformat\s+c\s*:/i,
    /\bdel(?:ete)?tree\s+[\\/]/i,
    />\s*\/dev\/sd[a-z]\b/i,
  ];
  if (matchAny(t, destructive)) {
    return {
      ok: false,
      code: "INSTRUCTION_POLICY_DESTRUCTIVE",
      messageKo: "시스템·디스크 파괴로 이어질 수 있는 명령 패턴이 포함되어 실행하지 않습니다.",
    };
  }

  const remoteExec = [
    /\b(curl|wget)\b[^|\n\r]{0,1200}\|\s*(bash|sh)\b/i,
    /\bpowershell(?:\.exe)?\s+[^|\n\r]{0,400}-\s*enc(?:odedcommand)?\b/i,
    /\bcertutil\s+[^|\n\r]{0,200}-decode\b/i,
  ];
  if (matchAny(t, remoteExec)) {
    return {
      ok: false,
      code: "INSTRUCTION_POLICY_REMOTE_EXEC",
      messageKo: "원격 스크립트 실행으로 이어질 수 있는 패턴이 포함되어 실행하지 않습니다.",
    };
  }

  return { ok: true };
}
