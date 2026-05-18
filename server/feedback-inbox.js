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
const MAX_REPLY_LEN = 2000;
const MAX_COMMENTS_PER_THREAD = 40;
const POST_COOLDOWN_MS = 20_000;

function ensureDir() {
  fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
}

function normalizeItem(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = String(raw.id ?? "").trim();
  if (!id) return null;
  const comments = Array.isArray(raw.comments)
    ? raw.comments
        .map((c) => ({
          id: String(c?.id ?? "").trim(),
          at: String(c?.at ?? ""),
          message: String(c?.message ?? "").slice(0, MAX_REPLY_LEN),
        }))
        .filter((c) => c.id && c.message)
    : [];
  return {
    id,
    at: String(raw.at ?? new Date().toISOString()),
    ip: String(raw.ip ?? ""),
    userAgent: String(raw.userAgent ?? "").slice(0, 400),
    message: String(raw.message ?? "").slice(0, MAX_MESSAGE_LEN),
    comments,
  };
}

function readItems() {
  try {
    if (!fs.existsSync(STORE_PATH)) return [];
    const raw = fs.readFileSync(STORE_PATH, "utf8");
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data.map(normalizeItem).filter(Boolean);
  } catch {
    return [];
  }
}

function writeItems(items) {
  ensureDir();
  fs.writeFileSync(STORE_PATH, JSON.stringify(items, null, 2), "utf8");
}

const lastPostAt = new Map();
const LAST_POST_MAP_MAX = 400;
const LAST_POST_PRUNE_AGE_MS = 3 * 60 * 60_000;

function pruneLastPostAtMap() {
  const now = Date.now();
  for (const [ip, t] of lastPostAt) {
    if (now - t > LAST_POST_PRUNE_AGE_MS) lastPostAt.delete(ip);
  }
  if (lastPostAt.size <= LAST_POST_MAP_MAX) return;
  const sorted = [...lastPostAt.entries()].sort((a, b) => a[1] - b[1]);
  const remove = lastPostAt.size - LAST_POST_MAP_MAX;
  for (let i = 0; i < remove; i++) lastPostAt.delete(sorted[i][0]);
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
    comments: [],
  };

  const next = [entry, ...readItems()].slice(0, MAX_ITEMS);
  writeItems(next);
  lastPostAt.set(ip, now);
  pruneLastPostAtMap();
  res.json({ ok: true });
}

/**
 * GET /api/feedback/inbox — 공개 조회 (IP 게이트 예외 경로). 댓글 포함.
 */
export function getFeedbackInbox(_req, res) {
  const items = readItems();
  res.json({ items, count: items.length });
}

/**
 * POST /api/feedback/admin/reply — 관리자만 (토큰·등록 IP·위임 IP)
 */
export function postFeedbackAdminReply(req, res) {
  if (!isAccessAdminRequest(req)) {
    res.status(401).json({ error: "관리자 권한이 필요합니다." });
    return;
  }
  const id = String(req.body?.id ?? "").trim();
  const message = String(req.body?.message ?? "").trim();
  if (!id) {
    res.status(400).json({ error: "id가 필요합니다." });
    return;
  }
  if (!message) {
    res.status(400).json({ error: "댓글 내용을 입력해 주세요." });
    return;
  }
  if (message.length > MAX_REPLY_LEN) {
    res.status(400).json({ error: `댓글은 ${MAX_REPLY_LEN}자 이하로 적어 주세요.` });
    return;
  }
  const items = readItems();
  const idx = items.findIndex((x) => x.id === id);
  if (idx < 0) {
    res.status(404).json({ error: "해당 접수를 찾을 수 없습니다." });
    return;
  }
  const row = items[idx];
  const comments = Array.isArray(row.comments) ? [...row.comments] : [];
  if (comments.length >= MAX_COMMENTS_PER_THREAD) {
    res.status(400).json({ error: "댓글 수가 상한에 도달했습니다." });
    return;
  }
  comments.push({
    id: randomUUID(),
    at: new Date().toISOString(),
    message: message.slice(0, MAX_REPLY_LEN),
  });
  items[idx] = { ...row, comments };
  writeItems(items);
  res.json({ ok: true });
}

/**
 * POST /api/feedback/admin/delete — 관리자만
 */
export function deleteFeedbackAdmin(req, res) {
  if (!isAccessAdminRequest(req)) {
    res.status(401).json({ error: "관리자 권한이 필요합니다." });
    return;
  }
  const id = String(req.body?.id ?? "").trim();
  if (!id) {
    res.status(400).json({ error: "id가 필요합니다." });
    return;
  }
  const items = readItems();
  const next = items.filter((x) => x.id !== id);
  if (next.length === items.length) {
    res.status(404).json({ error: "해당 접수를 찾을 수 없습니다." });
    return;
  }
  writeItems(next);
  res.json({ ok: true });
}
