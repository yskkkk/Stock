import "./symbol-dispose-polyfill.js";
import { randomUUID } from "node:crypto";
import { finished } from "node:stream/promises";
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { rgPath } from "@vscode/ripgrep";
import { Agent, Cursor } from "@cursor/sdk";
import { commitAndPushAfterOpsAgent } from "./ops-agent-git-push.js";
import { appendServerEventLog, clientIp } from "./access-log.js";
import { buildOpsAgentTelegramBody } from "./ops-agent-notify-body.js";
import { notifyOpsAgentCompleted } from "./telegram-notify.js";
import { normalizeAccessIp } from "./access-control.js";
import {
  finalizeOpsAgentEntry,
  patchOpsAgentEntry,
  prependPolicyRejectedOpsEntry,
  prependRunningOpsEntry,
  promoteOpsAgentEntryToRunning,
} from "./ops-agent-history-store.js";
import {
  clearOpsAgentPending,
  setOpsAgentPending,
} from "./ops-agent-pending-store.js";
import {
  registerOpsStreamUserCancel,
  unregisterOpsStreamUserCancel,
} from "./ops-stream-cancel.js";
import { checkOpsInstructionPolicy } from "./ops-agent-instruction-policy.js";

/** @param {Record<string, unknown>} ev */
function toolCallDetailFromEvent(ev) {
  const raw = ev.arguments ?? ev.input ?? ev.params ?? ev.payload;
  if (raw == null) return "";
  if (typeof raw === "string") return raw.trim().slice(0, 6000);
  try {
    return JSON.stringify(raw).slice(0, 6000);
  } catch {
    return "";
  }
}

/** @param {object} obj */
function applyOpsSsePayloadToCapture(obj, capture) {
  if (!obj || typeof obj !== "object") return;
  const t = obj.type;
  if (t === "phase") {
    capture.phaseLine = String(obj.message ?? "");
  } else if (t === "delta") {
    capture.streamText += String(obj.text ?? "");
  } else if (t === "cursor_status") {
    const d = String(obj.detail ?? "").trim();
    capture.cursorLine = d
      ? `${String(obj.status ?? "")}: ${d}`
      : String(obj.status ?? "");
  } else if (t === "thinking") {
    capture.thinkingLine = String(obj.text ?? "").slice(0, 800);
  } else if (t === "tool") {
    const name = String(obj.name ?? "");
    const st = String(obj.toolStatus ?? "");
    const extra =
      typeof obj.detail === "string" && obj.detail.trim()
        ? obj.detail.trim().slice(0, 6000)
        : "";
    capture.toolLine = `${name} (${st})`;
    const line = extra ? `${name} (${st}) — ${extra}` : `${name} (${st})`;
    if (!capture.toolLog) capture.toolLog = "";
    capture.toolLog = capture.toolLog ? `${capture.toolLog}\n${line}` : line;
  } else if (t === "done") {
    capture.statusText =
      typeof obj.status === "string" ? obj.status : obj.status != null ? String(obj.status) : null;
    const rawRes = String(obj.result ?? "").trim();
    capture.resultText = rawRes ? rawRes : "(내용 없음)";
    capture.durationMs =
      typeof obj.durationMs === "number" && Number.isFinite(obj.durationMs)
        ? obj.durationMs
        : null;
    capture.runtimeLabel =
      typeof obj.runtime === "string"
        ? obj.runtime
        : obj.runtime != null
          ? String(obj.runtime)
          : null;
  } else if (t === "error") {
    capture.error = String(obj.message ?? "");
  }
  /* meta 등 — 캡처 필드 없음 */
}

function streamAbortError() {
  if (typeof DOMException !== "undefined") {
    return new DOMException("stream aborted", "AbortError");
  }
  const e = new Error("stream aborted");
  e.name = "AbortError";
  return e;
}

/** @param {unknown} instruction */
function opsAgentInstructionLogSnippet(instruction) {
  const line =
    String(instruction ?? "")
      .split(/\r?\n/)
      .find((l) => String(l).trim().length > 0) ?? "";
  const t = line.trim();
  return t.length > 180 ? `${t.slice(0, 179)}…` : t;
}

/**
 * 큐에서 실제 워커가 돌기 시작해 이력이 running으로 잡힌 시점 — 접근 로그와 동일한 일일 파일에 기록.
 * @param {"SSE"|"API"} kind
 * @param {string} runId
 * @param {string} instruction
 * @param {string} requestIp
 */
function logOpsAgentExecutionStarted(kind, runId, instruction, requestIp) {
  const eventMs = Date.now();
  const prev = opsAgentInstructionLogSnippet(instruction);
  const ip = normalizeAccessIp(String(requestIp ?? ""));
  const tail = prev ? ` «${prev}»` : "";
  appendServerEventLog(
    "ops-agent",
    `${kind} 에이전트 실행 시작 runId=${runId}${tail}`,
    "info",
    ip || null,
    eventMs,
  );
}

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
 */
export function buildOpsPromptMessage(instruction) {
  const task = String(instruction ?? "").trim();
  const parts = [
    "You are working in the local git repository for a Korean stock dashboard web app (Vite + React + Express API).",
    "Apply the operator's request by editing files as needed. Reply in Korean with a concise summary of what you changed.",
    "",
    "## Operator request",
    "",
    "## 작업 지시",
    task,
  ];
  parts.push(
    "",
    "## Git (mandatory)",
    "When your edits are complete, you MUST `git commit` (all intended files) and `git push` to `origin` on the current branch before finishing.",
    "Use clear commit messages. If `git push` fails, fix credentials/remote and retry—do not stop while commits remain unpushed.",
  );
  return parts.join("\n");
}

/**
 * @cursor/sdk `run.stream()`이 AsyncIterable이 아니라 Web ReadableStream인 경우가 있어
 * `stream[Symbol.asyncIterator] is not a function` 를 피한다.
 * @param {unknown} stream
 * @returns {AsyncIterable<unknown>}
 */
function asAsyncIterableStream(stream) {
  if (stream == null) {
    throw new Error("에이전트 스트림이 비어 있습니다.");
  }
  const s = /** @type {Record<PropertyKey, unknown>} */ (Object(stream));
  const asyncIter = s[Symbol.asyncIterator];
  if (typeof asyncIter === "function") {
    return /** @type {AsyncIterable<unknown>} */ (stream);
  }
  const getReader = s.getReader;
  if (typeof getReader === "function") {
    const reader = /** @type {{ read: () => Promise<{ done: boolean; value?: unknown }>; cancel?: (reason?: unknown) => Promise<void>; releaseLock?: () => void }} */ (
      getReader.call(stream)
    );
    let released = false;
    async function releaseReader() {
      if (released) return;
      released = true;
      try {
        await reader.cancel?.();
      } catch {
        /* ignore */
      }
      try {
        reader.releaseLock?.();
      } catch {
        /* ignore */
      }
    }
    return {
      [Symbol.asyncIterator]() {
        const iter = {
          async next() {
            const chunk = await reader.read();
            return { done: chunk.done, value: chunk.value };
          },
          async return() {
            await releaseReader();
            return { done: true, value: undefined };
          },
        };
        const ad = Symbol.asyncDispose;
        if (ad != null && typeof ad === "symbol") {
          try {
            Object.defineProperty(iter, ad, {
              value: releaseReader,
              enumerable: false,
              configurable: true,
              writable: true,
            });
          } catch {
            /* ignore */
          }
        }
        return iter;
      },
    };
  }
  throw new Error(
    "에이전트 스트림을 읽을 수 없습니다(AsyncIterable·ReadableStream 아님). @cursor/sdk 버전을 확인하세요.",
  );
}

/**
 * `Agent.prompt` 내부 `n[Symbol.asyncDispose]()` 가 런타임 심볼 불일치 등으로
 * TypeError(`…asyncDispose… is not a function`) 를 낼 수 있어 동등 경로로 실행하고
 * dispose 는 `close` 폴백까지 시도한다.
 * @param {string} message
 * @param {object} agentOptions `Agent.create` 인자와 동일
 */
async function agentPromptDisposeSafe(message, agentOptions) {
  const agent = await Agent.create(agentOptions);
  try {
    const run = await agent.send(message);
    return await run.wait();
  } finally {
    await disposeSdkAgentSafe(agent);
  }
}

/** @param {unknown} agent */
async function disposeSdkAgentSafe(agent) {
  if (agent == null || typeof agent !== "object") return;
  const o = /** @type {Record<PropertyKey, unknown>} */ (agent);
  try {
    const ad = Symbol.asyncDispose;
    const fn = ad != null ? o[ad] : undefined;
    if (typeof fn === "function") {
      await /** @type {(this: unknown) => PromiseLike<unknown> | unknown} */ (fn).call(agent);
      return;
    }
  } catch {
    /* dispose 실패 시 close 시도 */
  }
  try {
    const close = o.close;
    if (typeof close === "function") {
      /** @type {(this: unknown) => void} */ (close).call(agent);
    }
  } catch {
    /* ignore */
  }
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
 * @param {AbortSignal | undefined} signal
 */
async function runStreamOnce(writeSse, message, agentOptions, signal) {
  const agent = await Agent.create(agentOptions);
  try {
    if (signal?.aborted) {
      return { status: "cancelled", result: "", durationMs: undefined };
    }
    const run = await agent.send(message);
    writeSse({ type: "phase", message: "실행 중 — 응답·도구 스트림 수신" });
    const stream = run.stream();
    const iterable = asAsyncIterableStream(stream);
    const it = iterable[Symbol.asyncIterator]();
    const abortErr = streamAbortError();
    try {
      for (;;) {
        const step =
          signal != null
            ? await Promise.race([
                it.next(),
                new Promise((_, rej) => {
                  if (signal.aborted) rej(abortErr);
                  else
                    signal.addEventListener("abort", () => rej(abortErr), {
                      once: true,
                    });
                }),
              ])
            : await it.next();
        if (step.done) break;
        const event = step.value;
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
          const ev = /** @type {Record<string, unknown>} */ (event);
          const detail = toolCallDetailFromEvent(ev);
          writeSse({
            type: "tool",
            name: event.name,
            toolStatus: event.status,
            detail,
          });
        }
      }
    } catch (e) {
      const aborted =
        Boolean(signal?.aborted) ||
        e === abortErr ||
        (e &&
          typeof e === "object" &&
          "name" in e &&
          /** @type {{ name?: string }} */ (e).name === "AbortError");
      if (aborted) {
        try {
          await run.cancel();
        } catch {
          /* ignore */
        }
      }
      try {
        if (typeof it.return === "function") await it.return();
      } catch {
        /* ignore */
      }
      if (!aborted) throw e;
      return { status: "cancelled", result: "", durationMs: undefined };
    }

    return await run.wait();
  } finally {
    try {
      const ad = Symbol.asyncDispose;
      if (ad != null && typeof /** @type {unknown} */ (agent)[ad] === "function") {
        await /** @type {(this: unknown) => Promise<void>} */ (/** @type {unknown} */ (agent)[ad]).call(
          agent,
        );
      } else {
        const d = Symbol.dispose;
        if (d != null && typeof /** @type {unknown} */ (agent)[d] === "function") {
          /** @type {(this: unknown) => void} */ (/** @type {unknown} */ (agent)[d]).call(agent);
        }
      }
    } catch {
      /* dispose 실패는 무시 */
    }
  }
}

const OPS_AGENT_SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};

/**
 * 운영 에이전트 SSE — 큐 대기 중에도 먼저 열 수 있게 idempotent.
 * @param {import("express").Response} res
 */
export function ensureOpsAgentSseHeaders(res) {
  if (res.headersSent) return;
  res.writeHead(200, OPS_AGENT_SSE_HEADERS);
}

/**
 * @param {import("express").Response} res
 * @param {object} obj
 */
export function writeOpsAgentSseEvent(res, obj) {
  if (res.writableEnded) return;
  ensureOpsAgentSseHeaders(res);
  try {
    res.write(`data: ${JSON.stringify(obj)}\n\n`);
    if (typeof res.flush === "function") {
      res.flush();
    }
  } catch {
    /* 클라이언트 조기 종료 */
  }
}

/**
 * SSE로 에이전트 진행·델타·최종 결과 전송.
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @param {{ instruction: string; historyRunId?: string | null }} body
 */
export async function streamOpsCursorAgentSse(req, res, body) {
  const instruction = String(body.instruction ?? "").trim();
  const historyRunIdRaw = body.historyRunId;
  const historyRunId =
    typeof historyRunIdRaw === "string" && historyRunIdRaw.trim().length > 0
      ? historyRunIdRaw.trim()
      : null;
  const requestIp = normalizeAccessIp(clientIp(req));
  if (requestIp) {
    setOpsAgentPending(requestIp, instruction);
  }

  const capture = {
    instruction,
    phaseLine: "",
    cursorLine: "",
    thinkingLine: "",
    toolLine: "",
    toolLog: "",
    streamText: "",
    statusText: null,
    resultText: null,
    durationMs: null,
    runtimeLabel: null,
    error: null,
    gitSummary: "",
  };

  let runId = /** @type {string | null} */ (null);
  /** @type {ReturnType<typeof setTimeout> | null} */
  let patchTimer = null;

  const userCancelAc = new AbortController();

  const flushPatchSoon = () => {
    if (!runId) return;
    if (patchTimer) clearTimeout(patchTimer);
    patchTimer = setTimeout(() => {
      patchTimer = null;
      void patchOpsAgentEntry(runId, {
        phaseLine: capture.phaseLine,
        cursorLine: capture.cursorLine,
        thinkingLine: capture.thinkingLine,
        toolLine: capture.toolLine,
        toolLog: capture.toolLog,
        streamText: capture.streamText,
        statusText: capture.statusText,
        resultText: capture.resultText,
        durationMs: capture.durationMs,
        runtimeLabel: capture.runtimeLabel,
        error: capture.error,
      });
    }, 450);
  };

  const writeSse = (obj) => {
    applyOpsSsePayloadToCapture(obj, capture);
    flushPatchSoon();
    writeOpsAgentSseEvent(res, obj);
  };

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

    writeSse({ type: "phase", message: "에이전트 실행 준비 중…" });

    if (historyRunId) {
      runId = historyRunId;
      try {
        const promoted = await promoteOpsAgentEntryToRunning(historyRunId);
        if (!promoted) {
          await prependRunningOpsEntry(historyRunId, instruction, requestIp);
        }
        registerOpsStreamUserCancel(historyRunId, userCancelAc);
        writeSse({ type: "meta", requestId: historyRunId });
        logOpsAgentExecutionStarted("SSE", historyRunId, instruction, requestIp);
      } catch {
        try {
          await prependRunningOpsEntry(historyRunId, instruction, requestIp);
          registerOpsStreamUserCancel(historyRunId, userCancelAc);
          writeSse({ type: "meta", requestId: historyRunId });
          logOpsAgentExecutionStarted("SSE", historyRunId, instruction, requestIp);
        } catch {
          /* 디스크 오류 등 — 스트림은 계속 */
        }
      }
    } else {
      const id = randomUUID();
      try {
        await prependRunningOpsEntry(id, instruction, requestIp);
        runId = id;
        registerOpsStreamUserCancel(id, userCancelAc);
        writeSse({ type: "meta", requestId: id });
        logOpsAgentExecutionStarted("SSE", id, instruction, requestIp);
      } catch {
        /* 디스크 오류 등 — 스트림은 계속 */
      }
    }

    ensureCursorRipgrepPath();

    const envModel =
      String(process.env.CURSOR_AGENT_MODEL ?? "composer-2").trim() ||
      "composer-2";
    const modelId = await resolveModelId(apiKey, envModel);
    const message = buildOpsPromptMessage(instruction);
    const base = {
      apiKey,
      model: { id: modelId },
      name: "ops-dashboard",
    };

    writeSse({ type: "phase", message: "로컬 에이전트 연결 중…" });
    let result = await runStreamOnce(writeSse, message, {
      ...base,
      local: { cwd: OPS_AGENT_REPO_ROOT },
    }, userCancelAc.signal);
    let runtime = "local";

    if (result.status === "cancelled") {
      sendError("사용자가 요청을 중단했습니다.");
      return;
    }

    if (result.status !== "finished") {
      const cloudRepo = githubRepoForCloud();
      if (cloudRepo && !userCancelAc.signal.aborted) {
        writeSse({
          type: "phase",
          message: "로컬이 정상 종료되지 않아 GitHub 클라우드로 재시도합니다…",
        });
        const cloudMessage = `${message}\n\n(You may be running in Cursor Cloud against the linked GitHub repo.)\n\n## Mandatory on GitHub before you finish\n- Commit every file change you made.\n- Run \`git push\` to the linked remote on your working branch and ensure it succeeds.\n- Do not end until the push has completed successfully.`;
        result = await runStreamOnce(writeSse, cloudMessage, {
          ...base,
          cloud: { repos: [cloudRepo] },
        }, userCancelAc.signal);
        runtime = "cloud";
      }
    }

    if (result.status === "cancelled") {
      sendError("사용자가 요청을 중단했습니다.");
      return;
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

    let postGit = /** @type {{ cloudPullOk: boolean | null }} */ ({
      cloudPullOk: null,
    });
    try {
      postGit = commitAndPushAfterOpsAgent({
        writeSse,
        runtime,
        requestIp: requestIp || undefined,
      });
    } catch (e) {
      sendError(e instanceof Error ? e.message : String(e));
      return;
    }
    const pushNote =
      runtime === "cloud"
        ? postGit.cloudPullOk
          ? "\n\n[후처리] 이 서버의 로컬 클론을 origin과 동기화(git pull --ff-only)했습니다."
          : "\n\n[후처리] 로컬 클론 자동 동기화(git pull --ff-only)는 건너뛰었습니다. 원격/PR에서 변경을 확인하세요."
        : "\n\n[후처리] 이 서버에서 변경분을 커밋(필요 시)하고 origin으로 git push 했습니다.";
    outText = (outText ? outText.trimEnd() : "") + pushNote;
    capture.gitSummary = postGit.gitSummary ?? "";

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
    if (requestIp) {
      clearOpsAgentPending(requestIp);
    }

    if (patchTimer) {
      clearTimeout(patchTimer);
      patchTimer = null;
    }

    let state = /** @type {"ok" | "error" | "cancelled"} */ ("ok");
    if (userCancelAc.signal.aborted) {
      state = "cancelled";
    } else if (capture.error) {
      state = "error";
    }
    const errorStored =
      state === "cancelled"
        ? "사용자가 요청을 중단했습니다."
        : state === "error"
          ? (capture.error ?? "알 수 없는 오류")
          : null;

    if (runId) {
      try {
        await finalizeOpsAgentEntry(runId, {
          state,
          instruction: capture.instruction,
          requestIp,
          phaseLine: capture.phaseLine,
          cursorLine: capture.cursorLine,
          thinkingLine: capture.thinkingLine,
          toolLine: capture.toolLine,
          toolLog: capture.toolLog,
          streamText: capture.streamText,
          statusText: capture.statusText,
          resultText: capture.resultText,
          durationMs: capture.durationMs,
          runtimeLabel: capture.runtimeLabel,
          error: errorStored,
        });
      } catch {
        /* disk full 등 */
      }
      unregisterOpsStreamUserCancel(runId);
    }

    if (
      capture.instruction ||
      capture.resultText ||
      capture.error ||
      capture.gitSummary
    ) {
      try {
        const titleForNotify = opsAgentInstructionLogSnippet(capture.instruction);
        const requesterLabel = requestIp || "알 수 없음";
        const bodyForNotify = buildOpsAgentTelegramBody({
          state,
          capture,
          errorText: errorStored,
        });
        notifyOpsAgentCompleted({
          dedupKey: runId ? `web:${runId}` : undefined,
          requester: requesterLabel,
          title: titleForNotify || "웹 에이전트",
          body: bodyForNotify,
        });
      } catch {
        /* notify 실패 */
      }
    }

    try {
      if (!res.writableEnded) {
        res.end();
      }
    } catch {
      /* ignore */
    }
    try {
      await finished(res, { readable: false });
    } catch {
      /* 클라이언트 조기 종료 */
    }
  }
}

/**
 * @param {{ instruction: string; requestIp?: string }} input
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
  const reqIpNorm = normalizeAccessIp(String(input.requestIp ?? ""));

  const pol = checkOpsInstructionPolicy(instruction);
  if (!pol.ok) {
    const rid = randomUUID();
    try {
      await prependPolicyRejectedOpsEntry({
        id: rid,
        requestIp: reqIpNorm,
        policyCode: pol.code,
        userMessage: pol.messageKo,
      });
    } catch {
      /* ignore */
    }
    appendServerEventLog(
      "ops-agent",
      `instruction policy reject (API run) code=${pol.code} id=${rid}`,
      "warn",
      reqIpNorm || null,
    );
    const err = new Error(pol.messageKo);
    err.code = pol.code;
    throw err;
  }

  const message = buildOpsPromptMessage(instruction);

  const base = {
    apiKey,
    model: { id: modelId },
    name: "ops-dashboard",
  };

  logOpsAgentExecutionStarted(
    "API",
    randomUUID(),
    instruction,
    reqIpNorm,
  );

  try {
    let result = await agentPromptDisposeSafe(message, {
      ...base,
      local: { cwd: OPS_AGENT_REPO_ROOT },
    });

    let runtime = "local";

    if (result.status !== "finished") {
      const cloudRepo = githubRepoForCloud();
      if (cloudRepo) {
        const cloudNote =
          "\n\n(You may be running in Cursor Cloud against the linked GitHub repo.)\n\n## Mandatory on GitHub before you finish\n- Commit every file change you made.\n- Run `git push` to the linked remote on your working branch and ensure it succeeds.\n- Do not end until the push has completed successfully.";
        result = await agentPromptDisposeSafe(message + cloudNote, {
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

    const postGit = commitAndPushAfterOpsAgent({
      runtime,
      requestIp: reqIpNorm || undefined,
    });
    const pushNote =
      runtime === "cloud"
        ? postGit.cloudPullOk
          ? "\n\n[후처리] 이 서버의 로컬 클론을 origin과 동기화(git pull --ff-only)했습니다."
          : "\n\n[후처리] 로컬 클론 자동 동기화(git pull --ff-only)는 건너뛰었습니다. 원격/PR에서 변경을 확인하세요."
        : "\n\n[후처리] 이 서버에서 변경분을 커밋(필요 시)하고 origin으로 git push 했습니다.";
    outText = (outText ? outText.trimEnd() : "") + pushNote;

    notifyOpsAgentCompleted({
      dedupKey: `web-api:${opsAgentInstructionLogSnippet(instruction)}`,
      requester: reqIpNorm || "알 수 없음",
      title: opsAgentInstructionLogSnippet(instruction) || "웹 에이전트",
      body: buildOpsAgentTelegramBody({
        state: "ok",
        capture: {
          instruction,
          resultText: outText,
          runtimeLabel: runtime,
          durationMs: result.durationMs,
          gitSummary: postGit.gitSummary ?? "",
        },
      }),
    });

    return {
      status: result.status,
      result: outText,
      durationMs: result.durationMs,
      model: result.model,
      runtime,
    };
  } catch (e) {
    notifyOpsAgentCompleted({
      dedupKey: `web-api-err:${opsAgentInstructionLogSnippet(instruction)}`,
      requester: reqIpNorm || "알 수 없음",
      title: opsAgentInstructionLogSnippet(instruction) || "웹 에이전트",
      body: buildOpsAgentTelegramBody({
        state: "error",
        capture: { instruction, resultText: null, gitSummary: "" },
        errorText: e instanceof Error ? e.message : String(e),
      }),
    });
    throw e;
  }
}
