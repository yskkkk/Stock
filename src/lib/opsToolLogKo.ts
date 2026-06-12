/** 운영 에이전트 도구 로그 — UI 표시용 한글 라벨(서버 ops-tool-log-ko.js와 동일 규칙) */

const TOOL_NAMES: Record<string, string> = {
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

const STATUS_KO: Record<string, string> = {
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

function truncate(s: string, n: number): string {
  const t = String(s ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return "";
  return t.length > n ? `${t.slice(0, Math.max(0, n - 1))}…` : t;
}

function toolNameKo(name: string): string {
  const key = String(name ?? "").trim();
  if (!key) return "도구";
  return TOOL_NAMES[key] ?? `도구(${key})`;
}

function toolStatusKo(status: string): string {
  const raw = String(status ?? "").trim();
  if (!raw) return "진행";
  return STATUS_KO[raw.toLowerCase()] ?? raw;
}

function parseDetailObject(detail: unknown): Record<string, unknown> | null {
  if (detail == null) return null;
  if (typeof detail === "object" && !Array.isArray(detail)) {
    return detail as Record<string, unknown>;
  }
  const text = String(detail).trim();
  if (!text) return null;
  if (text.startsWith("{") || text.startsWith("[")) {
    try {
      const parsed = JSON.parse(text) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      /* raw */
    }
  }
  return { _raw: text };
}

function formatOpsToolDetailKo(name: string, detail: unknown): string {
  const obj = parseDetailObject(detail);
  if (!obj) return "";

  const parts: string[] = [];

  const path = obj.path ?? obj.target_file ?? obj.file_path ?? obj.target_notebook;
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

export function formatOpsToolEventLine(
  name: string,
  status: string,
  detail: unknown = "",
): string {
  const toolKo = toolNameKo(name);
  const stKo = toolStatusKo(status);
  const detailKo = formatOpsToolDetailKo(name, detail);
  return detailKo ? `[${toolKo}] ${stKo} — ${detailKo}` : `[${toolKo}] ${stKo}`;
}

export function upgradeOpsToolLogLine(line: string): string {
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

export function formatOpsToolLogBlock(text: string): string {
  return String(text ?? "")
    .split(/\r?\n/)
    .map((line) => upgradeOpsToolLogLine(line))
    .filter(Boolean)
    .join("\n");
}

export function formatOpsToolLineDisplay(line: string): string {
  return upgradeOpsToolLogLine(line);
}
