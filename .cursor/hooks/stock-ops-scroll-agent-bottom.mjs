/**
 * Agent 응답·턴 종료 시 Composer 채팅 스크롤을 최하단으로 (Windows).
 * STOCK_AGENT_AUTO_SCROLL=0 이면 비활성.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEBOUNCE_MS = 180;
const debounceFile = path.join(__dirname, ".agent-scroll-debounce");

function shouldRun() {
  if (process.platform !== "win32") return false;
  if (process.env.STOCK_AGENT_AUTO_SCROLL === "0") return false;
  try {
    const now = Date.now();
    let last = 0;
    if (fs.existsSync(debounceFile)) {
      const raw = fs.readFileSync(debounceFile, "utf8").trim();
      const n = Number(raw);
      if (Number.isFinite(n)) last = n;
    }
    if (now - last < DEBOUNCE_MS) return false;
    fs.writeFileSync(debounceFile, String(now), "utf8");
    return true;
  } catch {
    return true;
  }
}

function scrollAgentChatToBottom() {
  const ps1 = path.join(__dirname, "stock-ops-scroll-agent-bottom.ps1");
  const child = spawn(
    "powershell",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", ps1],
    { detached: true, stdio: "ignore", windowsHide: true },
  );
  child.unref();
}

try {
  if (shouldRun()) scrollAgentChatToBottom();
} catch {
  /* ignore */
}

process.stdout.write("{}\n");
process.exit(0);
