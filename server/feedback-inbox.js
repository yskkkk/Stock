import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { fileURLToPath } from "url";
import { isAccessAdminRequest } from "./access-control.js";
import { clientIp } from "./access-log.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORE_PATH = path.join(__dirname, ".data", "feedback-inbox.json");
const MAX_ITEMS = 400;
const MAX_MESSAGE_LEN = 2000;
const POST_COOLDOWN_MS = 20_000;

function ensureDir() {
  fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
}

function readItems() {
  try {
    if (!fs.existsSync(STORE_PATH)) return [];
    const raw = fs.readFileSync(STORE_PATH, "utf8");
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function writeItems(items) {
  ensureDir();
  fs.writeFileSync(STORE_PATH, JSON.stringify(items, null, 2), "utf8");
}

const lastPostAt = new Map();

function inboxToken() {
  return String(process.env.FEEDBACK_INBOX_TOKEN ?? "").trim();
}

/**
 * POST /api/feedback — 본문 저장 + 접속 IP·UA 기록 (IP 게이트 밖에서도 제출 가능)
 */
export function postFeedback(req, res) {
  const ip = clientIp(req);
  const now = Date.now();
  const prev = lastPostAt.get(ip) ?? 0;
  if (now - prev < POST_COOLDOWN_MS) {
    res.status(429).json({ error: "잠시 후 다시 제출해 주세요." });
    return;
  }

  const message = String(req.body?.message ?? "").trim();
  if (!message) {
    res.status(400).json({ error: "내용을 입력해 주세요." });
    return;
  }
  if (message.length > MAX_MESSAGE_LEN) {
    res
      .status(400)
      .json({ error: `내용은 ${MAX_MESSAGE_LEN}자 이하로 적어 주세요.` });
    return;
  }

  const entry = {
    id: randomUUID(),
    at: new Date().toISOString(),
    ip,
    userAgent: String(req.headers["user-agent"] ?? "").slice(0, 400),
    message: message.slice(0, MAX_MESSAGE_LEN),
  };

  const next = [entry, ...readItems()].slice(0, MAX_ITEMS);
  writeItems(next);
  lastPostAt.set(ip, now);
  res.json({ ok: true });
}

/**
 * GET /api/feedback/inbox — Bearer FEEDBACK_INBOX_TOKEN 또는 관리자(ACCESS 토큰·등록 IP)
 */
export function getFeedbackInbox(req, res) {
  const tok = inboxToken();
  const admin = isAccessAdminRequest(req);
  if (!tok && !admin) {
    res.status(503).json({
      error:
        "접수함을 열려면 FEEDBACK_INBOX_TOKEN을 설정하거나, 관리자(ACCESS_ADMIN_TOKEN 또는 ACCESS_ADMIN_IPS)로 접속하세요.",
    });
    return;
  }
  if (admin) {
    const items = readItems();
    res.json({ items, count: items.length });
    return;
  }
  const auth = String(req.headers.authorization ?? "");
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m || m[1].trim() !== tok) {
    res.status(401).json({ error: "비밀번호가 올바르지 않습니다." });
    return;
  }
  const items = readItems();
  res.json({ items, count: items.length });
}
