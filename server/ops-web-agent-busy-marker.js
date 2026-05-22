/**
 * 운영 웹/SSE/기록 모드 에이전트가 로컬 워크스페이스를 수정하는 동안
 * 리포 루트에 마커를 둔다. Cursor IDE 훅(beforeSubmitPrompt)이 이를 읽고
 * 사용자 전송을 잠시 막아 동시 편집 충돌을 줄인다.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const OPS_WEB_AGENT_BUSY_FILE = path.join(
  path.resolve(__dirname, ".."),
  ".stock-ops-web-agent-busy.json",
);

/**
 * @param {{
 *   runId: string;
 *   instructionPreview: string;
 *   requestIp?: string;
 *   source?: 'web' | 'ide';
 * }} p
 */
export function writeOpsWebAgentBusyMarker(p) {
  const payload = {
    kind: "stock-ops-dev-queue",
    sinceMs: Date.now(),
    runId: String(p.runId ?? "").trim() || "unknown",
    instructionPreview: String(p.instructionPreview ?? "").slice(0, 400),
    requestIp: String(p.requestIp ?? "").trim().slice(0, 120),
    source: p.source === "ide" ? "ide" : "web",
  };
  try {
    fs.mkdirSync(path.dirname(OPS_WEB_AGENT_BUSY_FILE), { recursive: true });
    fs.writeFileSync(OPS_WEB_AGENT_BUSY_FILE, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  } catch {
    /* 디스크 오류는 에이전트 실행을 막지 않음 */
  }
}

export function clearOpsWebAgentBusyMarkerSync() {
  try {
    fs.unlinkSync(OPS_WEB_AGENT_BUSY_FILE);
  } catch (e) {
    if (e && typeof e === "object" && "code" in e && /** @type {{ code?: string }} */ (e).code === "ENOENT") {
      return;
    }
    /* ignore */
  }
}
