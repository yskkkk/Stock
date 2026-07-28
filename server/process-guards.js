import { isAbortLikeError } from "./fetch-abort-guard.js";
import { recordProcessRuntimeIssue } from "./server-self-improvement-log.js";

let installed = false;

function logProcessError(label, err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[process] ${label}:`, message);
}

/** 개발 중 백그라운드 작업 오류로 Vite/Node 프로세스가 종료되지 않도록 */
export function installProcessGuards() {
  if (installed) return;
  installed = true;

  process.on("unhandledRejection", (reason) => {
    if (isAbortLikeError(reason)) return;
    logProcessError("unhandledRejection", reason);
    try {
      recordProcessRuntimeIssue("unhandledRejection", reason);
    } catch (e) {
      logProcessError("recordProcessRuntimeIssue", e);
    }
  });

  process.on("uncaughtException", (err) => {
    logProcessError("uncaughtException", err);
    try {
      recordProcessRuntimeIssue("uncaughtException", err);
    } catch (e) {
      logProcessError("recordProcessRuntimeIssue", e);
    }
  });
}
