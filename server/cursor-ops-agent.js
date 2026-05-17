import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { rgPath } from "@vscode/ripgrep";
import { Agent, Cursor } from "@cursor/sdk";
import { commitAndPushAfterOpsAgent } from "./ops-agent-git-push.js";

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

function gitExec(args) {
  try {
    return execFileSync("git", args, {
      cwd: OPS_AGENT_REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    return "";
  }
}

/**
 * Cursor 클라우드 에이전트용 GitHub HTTPS URL (origin).
 * @returns {{ url: string; startingRef: string } | null}
 */
function githubRepoForCloud() {
  const raw = gitExec(["config", "--get", "remote.origin.url"]);
  if (!raw) return null;
  let url = raw.replace(/\s+/g, "");
  if (url.startsWith("git@github.com:")) {
    url = `https://github.com/${url.slice("git@github.com:".length)}`;
  } else if (url.startsWith("ssh://git@github.com/")) {
    url = `https://github.com/${url.replace(/^ssh:\/\/git@github\.com\//i, "")}`;
  }
  if (!/github\.com[/:]/i.test(url)) return null;
  if (!/^https:\/\/github\.com\//i.test(url)) return null;
  if (url.endsWith(".git")) url = url.slice(0, -4);
  const startingRef = gitExec(["rev-parse", "--abbrev-ref", "HEAD"]) || "main";
  return { url, startingRef };
}

/**
 * @param {string} instruction
 * @param {string} context
 */
export function buildOpsPromptMessage(instruction, context) {
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
  parts.push(
    "",
    "## Git (mandatory)",
    "When your edits are complete, you MUST `git commit` (all intended files) and `git push` to `origin` on the current branch before finishing.",
    "Use clear commit messages. If `git push` fails, fix credentials/remote and retry—do not stop while commits remain unpushed.",
  );
  return parts.join("\n");
}

/**
 * @param {string} apiKey
 * @param {string} envModel
 * @returns {Promise<string>}
 */
async function resolveModelId(apiKey, envModel) {
  const want = String(envModel ?? "").trim();
  try {
    const list = await Cursor.models.list({ apiKey });
    const items = Array.isArray(list) ? list : [];
    const ids = new Set(items.map((m) => m.id));
    if (want && ids.has(want)) return want;
    const latest = items.find((m) =>
      Array.isArray(m.aliases) ? m.aliases.includes("composer-latest") : false,
    );
    if (latest?.id) return latest.id;
    if (ids.has("composer-2")) return "composer-2";
    return items[0]?.id ?? (want || "composer-2");
  } catch {
    return want || "composer-2";
  }
}

/**
 * @param {(obj: unknown) => void} writeSse
 * @param {string} message
 * @param {object} agentOptions Agent.create 인자( local 또는 cloud 등 )
 */
async function runStreamOnce(writeSse, message, agentOptions) {
  const agent = await Agent.create(agentOptions);
  try {
    const run = await agent.send(message);
    writeSse({ type: "phase", message: "실행 중 — 응답·도구 스트림 수신" });
    for await (const event of run.stream()) {
      if (event.type === "assistant") {
        for (const block of event.message.content) {
          if (block.type === "text") {
            writeSse({ type: "delta", text: block.text });
          }
        }
      } else if (event.type === "status") {
        writeSse({
          type: "cursor_status",
          status: event.status,
          detail: event.message ?? "",
        });
      } else if (event.type === "thinking" && event.text) {
        writeSse({ type: "thinking", text: event.text.slice(0, 800) });
      } else if (event.type === "tool_call") {
        writeSse({
          type: "tool",
          name: event.name,
          toolStatus: event.status,
        });
      }
    }
    return await run.wait();
  } finally {
    if (typeof agent[Symbol.asyncDispose] === "function") {
      await agent[Symbol.asyncDispose]();
    }
  }
}

/**
 * SSE로 에이전트 진행·델타·최종 결과 전송 (Express response).
 * @param {import("express").Response} res
 * @param {{ instruction: string; context: string }} body
 */
export async function streamOpsCursorAgentSse(res, body) {
  const writeSse = (obj) => {
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify(obj)}\n\n`);
    }
  };

  const instruction = String(body.instruction ?? "").trim();
  const context = String(body.context ?? "").trim();

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const sendError = (message) => {
    try {
      writeSse({ type: "error", message });
    } catch {
      /* ignore */
    }
  };

  try {
    const apiKey = String(process.env.CURSOR_API_KEY ?? "").trim();
    if (!apiKey) {
      sendError(
        "CURSOR_API_KEY가 설정되어 있지 않습니다. .env에 키를 넣고 서버를 다시 시작하세요.",
      );
      return;
    }

    ensureCursorRipgrepPath();

    const envModel =
      String(process.env.CURSOR_AGENT_MODEL ?? "composer-2").trim() ||
      "composer-2";
    const modelId = await resolveModelId(apiKey, envModel);
    const message = buildOpsPromptMessage(instruction, context);
    const base = {
      apiKey,
      model: { id: modelId },
      name: "ops-dashboard",
    };

    writeSse({ type: "phase", message: "로컬 에이전트 연결 중…" });
    let result = await runStreamOnce(writeSse, message, {
      ...base,
      local: { cwd: OPS_AGENT_REPO_ROOT },
    });
    let runtime = "local";

    if (result.status !== "finished") {
      const cloudRepo = githubRepoForCloud();
      if (cloudRepo) {
        writeSse({
          type: "phase",
          message: "로컬이 정상 종료되지 않아 GitHub 클라우드로 재시도합니다…",
        });
        const cloudMessage = `${message}\n\n(You may be running in Cursor Cloud against the linked GitHub repo.)\n\n## Mandatory on GitHub before you finish\n- Commit every file change you made.\n- Run \`git push\` to the linked remote on your working branch and ensure it succeeds.\n- Do not end until the push has completed successfully.`;
        result = await runStreamOnce(writeSse, cloudMessage, {
          ...base,
          cloud: { repos: [cloudRepo] },
        });
        runtime = "cloud";
      }
    }

    if (result.status !== "finished") {
      const tail = result.result?.trim()
        ? ` 에이전트 메시지: ${result.result.trim()}`
        : "";
      sendError(
        `Cursor 에이전트가 정상 종료되지 않았습니다 (상태: ${result.status}).${tail}`,
      );
      return;
    }

    let outText = result.result ?? "";
    if (runtime === "cloud") {
      outText =
        (outText ? `${outText}\n\n` : "") +
        "[안내] 이번 실행은 GitHub에 연결된 Cursor 클라우드 에이전트로 처리되었습니다. 로컬 폴더가 바로 바뀌지 않으면 원격/PR에서 변경을 확인하세요.";
    }

    try {
      commitAndPushAfterOpsAgent({ writeSse, runtime });
    } catch (e) {
      sendError(e instanceof Error ? e.message : String(e));
      return;
    }
    const pushNote =
      runtime === "cloud"
        ? "\n\n[후처리] 이 서버의 로컬 클론을 origin과 동기화(git pull --ff-only)했습니다."
        : "\n\n[후처리] 이 서버에서 변경분을 커밋(필요 시)하고 origin으로 git push 했습니다.";
    outText = (outText ? outText.trimEnd() : "") + pushNote;

    writeSse({
      type: "done",
      ok: true,
      status: result.status,
      result: outText,
      durationMs: result.durationMs,
      runtime,
    });
  } catch (err) {
    sendError(err instanceof Error ? err.message : String(err));
  } finally {
    res.end();
  }
}

/**
 * @param {{ instruction: string; context?: string }} input
 * @returns {Promise<{ status: string; result: string; durationMs?: number; model?: unknown; runtime?: string }>}
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

  const envModel =
    String(process.env.CURSOR_AGENT_MODEL ?? "composer-2").trim() ||
    "composer-2";
  const modelId = await resolveModelId(apiKey, envModel);
  const instruction = String(input.instruction ?? "").trim();
  const context = String(input.context ?? "").trim();

  const message = buildOpsPromptMessage(instruction, context);

  const base = {
    apiKey,
    model: { id: modelId },
    name: "ops-dashboard",
  };

  let result = await Agent.prompt(message, {
    ...base,
    local: { cwd: OPS_AGENT_REPO_ROOT },
  });

  let runtime = "local";

  if (result.status !== "finished") {
    const cloudRepo = githubRepoForCloud();
    if (cloudRepo) {
      const cloudNote =
        "\n\n(You may be running in Cursor Cloud against the linked GitHub repo.)\n\n## Mandatory on GitHub before you finish\n- Commit every file change you made.\n- Run `git push` to the linked remote on your working branch and ensure it succeeds.\n- Do not end until the push has completed successfully.";
      result = await Agent.prompt(message + cloudNote, {
        ...base,
        cloud: { repos: [cloudRepo] },
      });
      runtime = "cloud";
    }
  }

  if (result.status !== "finished") {
    const tail = result.result?.trim()
      ? `\n에이전트 메시지: ${result.result.trim()}`
      : "";
    const cloudHint = githubRepoForCloud()
      ? " 로컬 실패 시 GitHub 클라우드 재시도도 실패했습니다."
      : " origin이 GitHub HTTPS가 아니면 클라우드 폴백을 쓸 수 없습니다.";
    const err = new Error(
      `Cursor 에이전트가 정상 종료되지 않았습니다 (상태: ${result.status}).${tail}${cloudHint}\n` +
        "로컬: Cursor CLI 설치 후 터미널에서 `cursor` 명령이 되는지, `cursor agent` 로그인 여부를 확인하세요.\n" +
        "모델: 대시보드 Integrations에서 발급한 키로 사용 가능한 모델인지 확인하거나 .env의 CURSOR_AGENT_MODEL을 비워 보세요.",
    );
    err.code = "AGENT_RUN_FAILED";
    throw err;
  }

  let outText = result.result ?? "";
  if (runtime === "cloud") {
    outText =
      (outText ? `${outText}\n\n` : "") +
      "[안내] 이번 실행은 GitHub에 연결된 Cursor 클라우드 에이전트로 처리되었습니다. 로컬 폴더가 바로 바뀌지 않으면 원격/PR에서 변경을 확인하세요.";
  }

  commitAndPushAfterOpsAgent({ runtime });
  const pushNote =
    runtime === "cloud"
      ? "\n\n[후처리] 이 서버의 로컬 클론을 origin과 동기화(git pull --ff-only)했습니다."
      : "\n\n[후처리] 이 서버에서 변경분을 커밋(필요 시)하고 origin으로 git push 했습니다.";
  outText = (outText ? outText.trimEnd() : "") + pushNote;

  return {
    status: result.status,
    result: outText,
    durationMs: result.durationMs,
    model: result.model,
    runtime,
  };
}
