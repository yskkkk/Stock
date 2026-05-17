import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { rgPath } from "@vscode/ripgrep";
import { Agent } from "@cursor/sdk";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** 스크리너 앱 저장소 루트 (로컬 에이전트 작업 디렉터리) */
export const OPS_AGENT_REPO_ROOT = path.resolve(__dirname, "..");

/**
 * Cursor SDK 로컬 런이 .gitignore 등을 읽을 때 ripgrep 바이너리가 필요함.
 * Windows 등에서 PATH에 rg가 없으면 에이전트가 error로 끝날 수 있어 선설정한다.
 */
function ensureCursorRipgrepPath() {
  const existing = String(process.env.CURSOR_RIPGREP_PATH ?? "").trim();
  if (existing) return;
  try {
    if (typeof rgPath === "string" && rgPath && fs.existsSync(rgPath)) {
      process.env.CURSOR_RIPGREP_PATH = rgPath;
    }
  } catch {
    /* @vscode/ripgrep optional 플랫폼 패키지 누락 등 */
  }
}

/**
 * @param {{ instruction: string; context?: string }} input
 * @returns {Promise<{ status: string; result: string; durationMs?: number; model?: unknown }>}
 */
export async function runOpsCursorAgent(input) {
  const apiKey = String(process.env.CURSOR_API_KEY ?? "").trim();
  if (!apiKey) {
    const err = new Error(
      "CURSOR_API_KEY가 설정되어 있지 않습니다. .env에 키를 넣고 서버를 다시 시작하세요.",
    );
    err.code = "NO_API_KEY";
    throw err;
  }

  ensureCursorRipgrepPath();

  const modelId =
    String(process.env.CURSOR_AGENT_MODEL ?? "composer-2").trim() ||
    "composer-2";
  const instruction = String(input.instruction ?? "").trim();
  const context = String(input.context ?? "").trim();

  const parts = [
    "You are working in the local git repository for a Korean stock dashboard web app (Vite + React + Express API).",
    "Apply the operator's request by editing files as needed. Reply in Korean with a concise summary of what you changed.",
    "",
    "## Operator request",
    instruction,
  ];
  if (context) {
    parts.push("", "## Extra context", context);
  }
  const message = parts.join("\n");

  const result = await Agent.prompt(message, {
    apiKey,
    model: { id: modelId },
    local: { cwd: OPS_AGENT_REPO_ROOT },
    name: "ops-dashboard",
  });

  if (result.status !== "finished") {
    const tail = result.result?.trim()
      ? `\n에이전트 메시지: ${result.result.trim()}`
      : "";
    const err = new Error(
      `로컬 Cursor 에이전트가 정상 종료되지 않았습니다 (상태: ${result.status}).${tail}\n` +
        "Cursor CLI 설치·`cursor agent` 로그인, API 키·모델 ID(CURSOR_AGENT_MODEL)를 확인하고 서버를 다시 시작해 보세요.",
    );
    err.code = "AGENT_RUN_FAILED";
    throw err;
  }

  return {
    status: result.status,
    result: result.result ?? "",
    durationMs: result.durationMs,
    model: result.model,
  };
}
