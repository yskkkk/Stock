import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { fileURLToPath } from "url";
import { clientIp } from "./access-log.js";

/**
 * Vite가 Express에 넘기는 `IncomingMessage`에는 `path`가 없어 `/`로만 판별되면
 * `/api/access/status`까지 403으로 막히는 문제가 생긴다. 항상 URL에서 경로를 쓴다.
 */
function requestPathname(req) {
  const raw = String(req.originalUrl ?? req.url ?? "/");
  const pathPart = raw.split("?")[0].split("#")[0] || "/";
  if (pathPart.startsWith("/")) return pathPart;
  return `/${pathPart}`.replace(/\/{2,}/g, "/");
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORE_FILE = path.join(__dirname, ".data", "access-control.json");

const lastRequestAt = new Map();
const THROTTLE_MS = 45_000;

function ensureDir() {
  const dir = path.dirname(STORE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function normalizeAccessIp(ip) {
  if (!ip || ip === "-") return "";
  let s = String(ip).trim();
  if (s.startsWith("::ffff:")) s = s.slice(7);
  return s;
}

function isLocalIp(ip) {
  const n = normalizeAccessIp(ip);
  return n === "127.0.0.1" || n === "::1" || n === "localhost";
}

export function isAccessControlEnabled() {
  const disabled = String(process.env.ACCESS_CONTROL_DISABLED ?? "")
    .toLowerCase()
    .trim();
  if (disabled === "1" || disabled === "true" || disabled === "yes") {
    return false;
  }

  const v = String(process.env.ACCESS_CONTROL_ENABLED ?? "").toLowerCase().trim();
  if (v === "0" || v === "false" || v === "no") return false;

  /** 기본값: IP 허용제 ON. 공개 서버만 ACCESS_CONTROL_DISABLED=1 */
  return true;
}

/** 비운영(NODE_ENV≠production)에서만 .env 미설정 시 사용. 운영에서는 미사용. */
const DEFAULT_DEV_ADMIN_TOKEN = "dev-stock-access-admin-change-in-env";

function allowLocalhost() {
  const v = String(process.env.ACCESS_ALLOW_LOCALHOST ?? "0").toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

function getBootstrapIps() {
  const raw = String(process.env.ACCESS_BOOTSTRAP_IPS ?? "").trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => normalizeAccessIp(s.trim()))
    .filter(Boolean);
}

function getAdminToken() {
  const t = String(process.env.ACCESS_ADMIN_TOKEN ?? "").trim();
  if (t) return t;
  const nodeEnv = String(process.env.NODE_ENV ?? "").toLowerCase();
  if (nodeEnv !== "production") return DEFAULT_DEV_ADMIN_TOKEN;
  return "";
}

export function readAccessStore() {
  try {
    if (!fs.existsSync(STORE_FILE)) return { requests: [], allowed: [] };
    const raw = fs.readFileSync(STORE_FILE, "utf8");
    const data = JSON.parse(raw);
    return {
      requests: Array.isArray(data.requests) ? data.requests : [],
      allowed: Array.isArray(data.allowed) ? data.allowed : [],
    };
  } catch {
    return { requests: [], allowed: [] };
  }
}

function writeAccessStore(data) {
  ensureDir();
  fs.writeFileSync(STORE_FILE, JSON.stringify(data, null, 2), "utf8");
}

function isPathPublic(pathname, method) {
  if (method === "GET" && pathname === "/api/access/status") return true;
  if (method === "POST" && pathname === "/api/access/request") return true;
  return false;
}

function isAdminPath(pathname) {
  return pathname.startsWith("/api/access/admin");
}

export function isClientIpOnAllowlist(ip) {
  const n = normalizeAccessIp(ip);
  if (!n) return false;
  if (allowLocalhost() && isLocalIp(n)) return true;
  for (const b of getBootstrapIps()) {
    if (b === n) return true;
  }
  const store = readAccessStore();
  for (const a of store.allowed) {
    if (normalizeAccessIp(a.ip) === n) return true;
  }
  return false;
}

export function getAccessStateForIp(ip) {
  const n = normalizeAccessIp(ip);
  if (isClientIpOnAllowlist(ip)) return "allowed";
  const store = readAccessStore();
  if (store.requests.some((r) => normalizeAccessIp(r.ip) === n && r.status === "pending")) {
    return "pending";
  }
  if (store.requests.some((r) => normalizeAccessIp(r.ip) === n && r.status === "rejected")) {
    return "rejected";
  }
  return "none";
}

export function accessIpGateMiddleware(req, res, next) {
  if (!isAccessControlEnabled()) return next();
  const pathname = requestPathname(req);
  const method = req.method || "GET";
  if (isAdminPath(pathname)) return next();
  if (isPathPublic(pathname, method)) return next();
  const ip = clientIp(req);
  if (isClientIpOnAllowlist(ip)) return next();
  res.status(403).json({
    error: "이 IP에서는 API를 사용할 수 없습니다. 접속 신청을 해 주세요.",
    code: "ACCESS_DENIED",
  });
}

function requireAdmin(req, res, next) {
  const token = getAdminToken();
  if (!token) {
    res.status(503).json({
      error: "서버에 ACCESS_ADMIN_TOKEN이 설정되지 않았습니다.",
    });
    return;
  }
  const auth = String(req.headers.authorization ?? "");
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m || m[1].trim() !== token) {
    res.status(401).json({ error: "관리자 토큰이 필요합니다." });
    return;
  }
  next();
}

/**
 * @param {import("express").Express} app
 */
export function registerAccessControl(app) {
  app.use(accessIpGateMiddleware);

  app.get("/api/access/status", (req, res) => {
    const ip = clientIp(req);
    if (!isAccessControlEnabled()) {
      res.json({
        enabled: false,
        state: "allowed",
        yourIp: ip,
      });
      return;
    }
    res.json({
      enabled: true,
      state: getAccessStateForIp(ip),
      yourIp: ip,
    });
  });

  app.post("/api/access/request", (req, res) => {
    if (!isAccessControlEnabled()) {
      res.json({ ok: true, message: "접근 제어가 비활성화되어 있습니다." });
      return;
    }
    const ip = clientIp(req);
    const ipn = normalizeAccessIp(ip);
    if (isClientIpOnAllowlist(ip)) {
      res.json({ ok: true, message: "이미 허용된 IP입니다." });
      return;
    }
    const now = Date.now();
    const prev = lastRequestAt.get(ipn) ?? 0;
    if (now - prev < THROTTLE_MS) {
      res.status(429).json({ error: "잠시 후 다시 신청해 주세요." });
      return;
    }
    lastRequestAt.set(ipn, now);

    const store = readAccessStore();
    if (store.requests.some((r) => normalizeAccessIp(r.ip) === ipn && r.status === "pending")) {
      res.json({ ok: true, message: "이미 신청이 접수되어 있습니다." });
      return;
    }

    const message = String(req.body?.message ?? "").trim().slice(0, 500);
    const id = randomUUID();
    store.requests.push({
      id,
      ip,
      userAgent: String(req.headers["user-agent"] ?? "").slice(0, 400),
      message,
      requestedAt: new Date().toISOString(),
      status: "pending",
    });
    writeAccessStore(store);
    res.json({ ok: true, message: "신청이 접수되었습니다." });
  });

  app.get("/api/access/admin/requests", requireAdmin, (_req, res) => {
    const store = readAccessStore();
    const pending = store.requests.filter((r) => r.status === "pending");
    const recent = [...store.requests].reverse().slice(0, 80);
    res.json({ pending, allowed: store.allowed, recent });
  });

  app.post("/api/access/admin/approve", requireAdmin, (req, res) => {
    const id = String(req.body?.id ?? "").trim();
    if (!id) {
      res.status(400).json({ error: "id가 필요합니다." });
      return;
    }
    const store = readAccessStore();
    const reqEntry = store.requests.find((r) => r.id === id && r.status === "pending");
    if (!reqEntry) {
      res.status(404).json({ error: "대기 중인 신청을 찾을 수 없습니다." });
      return;
    }
    const ipn = normalizeAccessIp(reqEntry.ip);
    if (!store.allowed.some((a) => normalizeAccessIp(a.ip) === ipn)) {
      store.allowed.push({
        ip: reqEntry.ip,
        note: String(reqEntry.message ?? "").slice(0, 200),
        addedAt: new Date().toISOString(),
        fromRequestId: id,
      });
    }
    reqEntry.status = "approved";
    reqEntry.resolvedAt = new Date().toISOString();
    writeAccessStore(store);
    res.json({ ok: true });
  });

  app.post("/api/access/admin/reject", requireAdmin, (req, res) => {
    const id = String(req.body?.id ?? "").trim();
    if (!id) {
      res.status(400).json({ error: "id가 필요합니다." });
      return;
    }
    const store = readAccessStore();
    const reqEntry = store.requests.find((r) => r.id === id && r.status === "pending");
    if (!reqEntry) {
      res.status(404).json({ error: "대기 중인 신청을 찾을 수 없습니다." });
      return;
    }
    reqEntry.status = "rejected";
    reqEntry.resolvedAt = new Date().toISOString();
    writeAccessStore(store);
    res.json({ ok: true });
  });

  app.post("/api/access/admin/revoke", requireAdmin, (req, res) => {
    const rawIp = String(req.body?.ip ?? "").trim();
    if (!rawIp) {
      res.status(400).json({ error: "ip가 필요합니다." });
      return;
    }
    const store = readAccessStore();
    const target = normalizeAccessIp(rawIp);
    const before = store.allowed.length;
    store.allowed = store.allowed.filter((a) => normalizeAccessIp(a.ip) !== target);
    if (store.allowed.length === before) {
      res.status(404).json({ error: "허용 목록에 없는 IP입니다." });
      return;
    }
    writeAccessStore(store);
    res.json({ ok: true });
  });

  if (isAccessControlEnabled()) {
    console.log(
      "[access-control] IP 허용제 ON — 허가된 IP만 /api 사용(신청·상태·관리 API 제외).",
    );
    const envTok = String(process.env.ACCESS_ADMIN_TOKEN ?? "").trim();
    if (!envTok) {
      const nodeEnv = String(process.env.NODE_ENV ?? "").toLowerCase();
      if (nodeEnv !== "production") {
        console.warn(
          "[access-control] 비운영: ACCESS_ADMIN_TOKEN 미설정 → 기본 토큰으로 관리 API 허용. 운영에서는 .env에 ACCESS_ADMIN_TOKEN 필수.",
        );
      } else {
        console.warn(
          "[access-control] ACCESS_ADMIN_TOKEN이 없습니다. 승인/거절 API는 503입니다. .env에 설정하세요.",
        );
      }
    }
  }
}
