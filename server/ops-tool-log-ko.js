/** 운영 에이전트 도구 로그 — 사람이 읽기 쉬운 한글 라벨 */

/** @type {Record<string, string>} */
const TOOL_NAMES = {
  Read: "파일 읽기",
  read_file: "파일 읽기",
  Write: "파일 쓰기",
  write: "파일 쓰기",
  StrReplace: "파일 수정",
  search_replace: "파일 수정",
  Delete: "파일 삭제",
  delete_file: "파일 삭제",
  Grep: "코드 검색",
  grep: "코드 검색",
  Glob: "파일 찾기",
  glob_file_search: "파일 찾기",
  SemanticSearch: "의미 검색",
  codebase_search: "의미 검색",
  Shell: "셸 명령",
  run_terminal_cmd: "셸 명령",
  Task: "서브에이전트",
  WebSearch: "웹 검색",
  WebFetch: "URL 조회",
  ReadLints: "린트 확인",
  EditNotebook: "노트북 편집",
  GenerateImage: "이미지 생성",
  SwitchMode: "모드 전환",
  AskQuestion: "확인 질문",
  TodoWrite: "할 일 목록",
  Await: "백그라운드 대기",
};

/** @type {Record<string, string>} */
const STATUS_KO = {
  pending: "대기",
  running: "실행 중",
  in_progress: "실행 중",
  completed: "완료",
  success: "완료",
  succeeded: "완료",
  failed: "실패",
  error: "실패",
  cancelled: "취소",
  canceled: "취소",
};

/**
 * @param {string} s
 * @param {number} n
 */
function truncate(s, n) {
  const t = String(s ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return "";
  return t.length > n ? `${t.slice(0, Math.max(0, n - 1))}…` : t;
}

/**
 * @param {string} name
 */
export function toolNameKo(name) {
  const key = String(name ?? "").trim();
  if (!key) return "도구";
  return TOOL_NAMES[key] ?? `도구(${key})`;
}

/**
 * @param {string} status
 */
export function toolStatusKo(status) {
  const raw = String(status ?? "").trim();
  if (!raw) return "진행";
  const key = raw.toLowerCase();
  return STATUS_KO[key] ?? raw;
}

/**
 * @param {unknown} detail
 * @returns {Record<string, unknown> | null}
 */
function parseDetailObject(detail) {
  if (detail == null) return null;
  if (typeof detail === "object" && !Array.isArray(detail)) {
    return /** @type {Record<string, unknown>} */ (detail);
  }
  const text = String(detail).trim();
  if (!text) return null;
  if (text.startsWith("{") || text.startsWith("[")) {
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return /** @type {Record<string, unknown>} */ (parsed);
      }
    } catch {
      /* raw text */
    }
  }
  return { _raw: text };
}

/**
 * @param {string} name
 * @param {unknown} detail
 */
export function formatOpsToolDetailKo(name, detail) {
  const obj = parseDetailObject(detail);
  if (!obj) return "";

  /** @type {string[]} */
  const parts = [];

  const path =
    obj.path ?? obj.target_file ?? obj.file_path ?? obj.target_notebook;
  if (typeof path === "string" && path.trim()) {
    parts.push(`파일: ${truncate(path.trim(), 140)}`);
  }

  if (typeof obj.command === "string" && obj.command.trim()) {
    parts.push(`명령: ${truncate(obj.command.trim(), 120)}`);
  }
  if (typeof obj.description === "string" && obj.description.trim()) {
    parts.push(`설명: ${truncate(obj.description.trim(), 100)}`);
  }
  if (typeof obj.query === "string" && obj.query.trim()) {
    parts.push(`검색: ${truncate(obj.query.trim(), 100)}`);
  }
  if (typeof obj.pattern === "string" && obj.pattern.trim()) {
    parts.push(`패턴: ${truncate(obj.pattern.trim(), 80)}`);
  }
  if (typeof obj.search_term === "string" && obj.search_term.trim()) {
    parts.push(`검색어: ${truncate(obj.search_term.trim(), 80)}`);
  }
  if (typeof obj.glob_pattern === "string" && obj.glob_pattern.trim()) {
    parts.push(`파일 패턴: ${truncate(obj.glob_pattern.trim(), 80)}`);
  }
  if (typeof obj.url === "string" && obj.url.trim()) {
    parts.push(`URL: ${truncate(obj.url.trim(), 100)}`);
  }
  if (typeof obj.prompt === "string" && obj.prompt.trim()) {
    parts.push(`지시: ${truncate(obj.prompt.trim(), 100)}`);
  }
  if (typeof obj.title === "string" && obj.title.trim()) {
    parts.push(`제목: ${truncate(obj.title.trim(), 80)}`);
  }
  if (typeof obj.target_mode_id === "string" && obj.target_mode_id.trim()) {
    parts.push(`모드: ${obj.target_mode_id.trim()}`);
  }
  if (
    (typeof obj.old_string === "string" && obj.old_string) ||
    (typeof obj.new_string === "string" && obj.new_string)
  ) {
    parts.push("내용 치환");
  }
  if (name === "Task") {
    const sub = obj.subagent_type;
    if (typeof sub === "string" && sub.trim()) {
      parts.push(`유형: ${sub.trim()}`);
    }
  }

  if (parts.length > 0) return parts.join(" · ");

  const raw = obj._raw;
  if (typeof raw === "string" && raw.trim()) {
    return truncate(raw, 160);
  }

  try {
    return truncate(JSON.stringify(obj), 160);
  } catch {
    return "";
  }
}

/**
 * @param {string} name
 * @param {string} status
 * @param {unknown} [detail]
 */
export function formatOpsToolEventLine(name, status, detail = "") {
  const toolKo = toolNameKo(name);
  const stKo = toolStatusKo(status);
  const detailKo = formatOpsToolDetailKo(name, detail);
  return detailKo ? `[${toolKo}] ${stKo} — ${detailKo}` : `[${toolKo}] ${stKo}`;
}

/**
 * 저장된 영문 로그 한 줄을 한글로 보강(이미 `[`로 시작하면 그대로).
 * @param {string} line
 */
export function upgradeOpsToolLogLine(line) {
  const t = String(line ?? "").trim();
  if (!t) return "";
  if (t.startsWith("[")) return t;

  const sep = t.includes(" — ") ? " — " : t.includes(" - ") ? " - " : null;
  let head = t;
  let tail = "";
  if (sep) {
    const i = t.indexOf(sep);
    head = t.slice(0, i);
    tail = t.slice(i + sep.length);
  }

  const m = /^([A-Za-z_][\w]*)\s*\(([^)]+)\)\s*$/.exec(head.trim());
  if (!m) return t;
  return formatOpsToolEventLine(m[1], m[2], tail);
}

/**
 * @param {string} text
 */
export function formatOpsToolLogBlock(text) {
  return String(text ?? "")
    .split(/\r?\n/)
    .map((line) => upgradeOpsToolLogLine(line))
    .filter(Boolean)
    .join("\n");
}
