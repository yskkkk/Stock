import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { fileURLToPath } from "url";
import { clientIp, stampAccessEventNow } from "./access-log.js";

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
const ACCESS_THROTTLE_MAP_MAX = 1200;
const ACCESS_THROTTLE_PRUNE_AGE_MS = 30 * 24 * 60 * 60_000;

function pruneAccessRequestThrottle() {
  const now = Date.now();
  for (const [ip, t] of lastRequestAt) {
    if (now - t > ACCESS_THROTTLE_PRUNE_AGE_MS) lastRequestAt.delete(ip);
  }
  if (lastRequestAt.size <= ACCESS_THROTTLE_MAP_MAX) return;
  const sorted = [...lastRequestAt.entries()].sort((a, b) => a[1] - b[1]);
  const remove = lastRequestAt.size - ACCESS_THROTTLE_MAP_MAX;
  for (let i = 0; i < remove; i++) lastRequestAt.delete(sorted[i][0]);
}

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

function allowedRowMatchesClient(a, clientIpNorm) {
  return normalizeAccessIp(a.ip) === clientIpNorm;
}

function requestRowMatchesClient(r, clientIpNorm) {
  return normalizeAccessIp(r.ip) === clientIpNorm;
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
  if (v === "1" || v === "true" || v === "yes") return true;
  if (v === "0" || v === "false" || v === "no") return false;

  /** 기본값: 접근 제한 없음(로컬·개인 서버). 공개 서버는 ACCESS_CONTROL_ENABLED=1 */
  return false;
}

function allowLocalhost() {
  const v = String(process.env.ACCESS_ALLOW_LOCALHOST ?? "0").toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

function getAdminToken() {
  return String(process.env.ACCESS_ADMIN_TOKEN ?? "").trim();
}

/** ACCESS_ADMIN_IPS(쉼표). 없으면 TELEGRAM_RESET_ADMIN_IPS(구 설정)와 동일 목록으로 간주 */
function parseAccessAdminIps() {
  const primary = String(process.env.ACCESS_ADMIN_IPS ?? "").trim();
  const raw = primary || String(process.env.TELEGRAM_RESET_ADMIN_IPS ?? "").trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => normalizeAccessIp(s.trim()))
    .filter(Boolean);
}

export function isAccessAdminIp(req) {
  if (!isAccessControlEnabled()) return true;
  const list = parseAccessAdminIps();
  if (!list.length) return false;
  const ip = normalizeAccessIp(clientIp(req));
  if (!ip) return false;
  return list.includes(ip);
}

function readBearerToken(req) {
  const auth = String(req.headers.authorization ?? "");
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : "";
}

/** Bearer ACCESS_ADMIN_TOKEN 또는 관리자 등록 IP 또는 허용 목록의 위임 관리자 */
export function isAccessAdminRequest(req) {
  if (!isAccessControlEnabled()) return true;
  const token = getAdminToken();
  const bearer = readBearerToken(req);
  if (token && bearer === token) return true;
  if (isAccessAdminIp(req)) return true;
  const ip = normalizeAccessIp(clientIp(req));
  if (!ip) return false;
  const store = readAccessStore();
  for (const a of store.allowed) {
    if (a.adminDelegate === true && allowedRowMatchesClient(a, ip)) return true;
  }
  return false;
}

function getBootstrapIps() {
  const raw = String(process.env.ACCESS_BOOTSTRAP_IPS ?? "").trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => normalizeAccessIp(s.trim()))
    .filter(Boolean);
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
  if (method === "GET" && pathname === "/api/health") return true;
  if (method === "GET" && pathname === "/api/config") return true;
  if (method === "GET" && pathname === "/api/access/status") return true;
  if (method === "POST" && pathname === "/api/server-open-request") return true;
  if (method === "POST" && pathname === "/api/access/request") return true;
  if (method === "POST" && pathname === "/api/feedback") return true;
  if (method === "GET" && pathname === "/api/feedback/inbox") return true;
  return false;
}

/** 빌드된 SPA 셸·청크 — IP 미허용이어도 로드 허용(데이터는 /api에서 계속 게이트) */
function isBundledFrontendGet(pathname, method) {
  const m = String(method || "GET").toUpperCase();
  if (m !== "GET" && m !== "HEAD") return false;
  if (pathname.startsWith("/assets/")) return true;
  if (
    pathname === "/" ||
    pathname === "/index.html" ||
    pathname === "/access-gate.html" ||
    pathname === "/server-offline.html"
  ) {
    return true;
  }
  return false;
}

function isAdminPath(pathname) {
  return pathname.startsWith("/api/access/admin");
}

/** Cursor IDE 훅이 127.0.0.1 로 호출 — IP 허용제와 무관하게 통과 (라우트에서 loopback 재검증) */
function isIdeDevQueueHookPath(pathname) {
  return (
    pathname === "/api/ops/dev-queue/ide/enqueue" ||
    pathname === "/api/ops/dev-queue/ide/wait-grant" ||
    pathname === "/api/ops/dev-queue/ide/acquire" ||
    pathname === "/api/ops/dev-queue/ide/release" ||
    pathname === "/api/ops/dev-queue/ide/release-active" ||
    pathname === "/api/ops/dev-queue/ide/cancel"
  );
}

function isLoopbackClient(req) {
  const ip = normalizeAccessIp(clientIp(req));
  if (ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1") return true;
  const ra = String(req.socket?.remoteAddress ?? "");
  return (
    ra === "127.0.0.1" ||
    ra === "::1" ||
    ra.endsWith("127.0.0.1")
  );
}

/**
 * @param {string} ip
 * @param {import("http").IncomingMessage} [_req] — 호환용(미사용)
 */
export function isClientIpOnAllowlist(ip, _req) {
  const n = normalizeAccessIp(ip);
  if (!n) return false;
  if (allowLocalhost() && isLocalIp(n)) return true;
  for (const b of getBootstrapIps()) {
    if (b === n) return true;
  }
  const store = readAccessStore();
  for (const a of store.allowed) {
    if (allowedRowMatchesClient(a, n)) return true;
  }
  return false;
}

export function getAccessStateForIp(ip, req) {
  if (req && isAccessAdminRequest(req)) return "allowed";
  const n = normalizeAccessIp(ip);
  if (isClientIpOnAllowlist(ip, req)) return "allowed";
  const store = readAccessStore();
  if (store.requests.some((r) => r.status === "pending" && requestRowMatchesClient(r, n))) {
    return "pending";
  }
  if (store.requests.some((r) => r.status === "rejected" && requestRowMatchesClient(r, n))) {
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
  if (isBundledFrontendGet(pathname, method)) return next();
  if (isIdeDevQueueHookPath(pathname) && isLoopbackClient(req)) return next();
  /** 관리자 IP·Bearer — 허용 목록 없이도 운영·대기열 API 사용 (앱이 게이트로 튕기지 않게) */
  if (isAccessAdminRequest(req)) return next();
  const ip = clientIp(req);
  if (isClientIpOnAllowlist(ip, req)) return next();
  res.status(403).json({
    error: "이 IP에서는 API를 사용할 수 없습니다. 접근 게이트에서 접속 신청을 해 주세요.",
    code: "ACCESS_DENIED",
  });
}

function requireAdmin(req, res, next) {
  if (!isAccessControlEnabled()) {
    next();
    return;
  }
  const token = getAdminToken();
  const hasIps = parseAccessAdminIps().length > 0;
  if (!token && !hasIps) {
    res.status(503).json({
      error:
        "서버에 ACCESS_ADMIN_TOKEN 또는 ACCESS_ADMIN_IPS(관리자 IP)가 필요합니다.",
    });
    return;
  }
  if (isAccessAdminRequest(req)) {
    next();
    return;
  }
  res.status(401).json({ error: "관리자 권한이 필요합니다." });
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
        adminIpConsole: true,
        accessAdmin: true,
      });
      return;
    }
    res.json({
      enabled: true,
      state: getAccessStateForIp(ip, req),
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
    if (isClientIpOnAllowlist(ip, req)) {
      res.json({ ok: true, message: "이미 허용된 IP입니다." });
      return;
    }
    const now = Date.now();
    const prev = lastRequestAt.get(ipn) ?? 0;
    if (now - prev < THROTTLE_MS) {
      stampAccessEventNow(req, now);
      res.status(429).json({ error: "잠시 후 다시 신청해 주세요." });
      return;
    }
    lastRequestAt.set(ipn, now);
    pruneAccessRequestThrottle();

    const store = readAccessStore();
    if (
      store.requests.some(
        (r) => r.status === "pending" && requestRowMatchesClient(r, ipn),
      )
    ) {
      stampAccessEventNow(req);
      res.json({ ok: true, message: "이미 신청이 접수되어 있습니다." });
      return;
    }

    const message = String(req.body?.message ?? "").trim().slice(0, 500);
    const id = randomUUID();
    const rawDevice = req.body?.deviceInfo;
    let deviceInfo = null;
    if (rawDevice != null && typeof rawDevice === "object" && !Array.isArray(rawDevice)) {
      deviceInfo = {
        userAgent: String(rawDevice.userAgent ?? "").slice(0, 400),
        platform: String(rawDevice.platform ?? "").slice(0, 120),
        language: String(rawDevice.language ?? "").slice(0, 80),
        languages: String(rawDevice.languages ?? "").slice(0, 200),
        screen: String(rawDevice.screen ?? "").slice(0, 80),
        viewport: String(rawDevice.viewport ?? "").slice(0, 80),
        timezone: String(rawDevice.timezone ?? "").slice(0, 80),
        hardwareConcurrency:
          typeof rawDevice.hardwareConcurrency === "number" &&
          Number.isFinite(rawDevice.hardwareConcurrency)
            ? rawDevice.hardwareConcurrency
            : null,
        deviceMemory:
          typeof rawDevice.deviceMemory === "number" &&
          Number.isFinite(rawDevice.deviceMemory)
            ? rawDevice.deviceMemory
            : null,
        maxTouchPoints:
          typeof rawDevice.maxTouchPoints === "number" &&
          Number.isFinite(rawDevice.maxTouchPoints)
            ? rawDevice.maxTouchPoints
            : null,
        cookieEnabled:
          typeof rawDevice.cookieEnabled === "boolean"
            ? rawDevice.cookieEnabled
            : null,
      };
    }
    const eventMs = Date.now();
    stampAccessEventNow(req, eventMs);
    const row = {
      id,
      ip,
      userAgent: String(req.headers["user-agent"] ?? "").slice(0, 400),
      message,
      deviceInfo,
      requestedAt: new Date(eventMs).toISOString(),
      status: "pending",
    };
    store.requests.push(row);
    writeAccessStore(store);
    res.json({ ok: true, message: "신청이 접수되었습니다." });
  });

  app.get("/api/access/admin/requests", requireAdmin, (_req, res) => {
    const store = readAccessStore();
    const pending = store.requests.filter((r) => r.status === "pending");
    const recent = [...store.requests].reverse().slice(0, 80);
    const allowed = [...store.allowed].sort((a, b) => {
      const ta = Date.parse(String(a.addedAt ?? "")) || 0;
      const tb = Date.parse(String(b.addedAt ?? "")) || 0;
      return tb - ta;
    });
    res.json({ pending, allowed, recent });
  });

  app.post("/api/access/admin/approve", requireAdmin, (req, res) => {
    const id = String(req.body?.id ?? "").trim();
    if (!id) {
      res.status(400).json({ error: "id가 필요합니다." });
      return;
    }
    const adminMemo = String(req.body?.memo ?? "").trim().slice(0, 300);
    const store = readAccessStore();
    const reqEntry = store.requests.find((r) => r.id === id && r.status === "pending");
    if (!reqEntry) {
      res.status(404).json({ error: "대기 중인 신청을 찾을 수 없습니다." });
      return;
    }
    const ipn = normalizeAccessIp(reqEntry.ip);
    const requestMsg = String(reqEntry.message ?? "").trim().slice(0, 500);
    const existingIp = store.allowed.find((a) => normalizeAccessIp(a.ip) === ipn);
    if (!existingIp) {
      /** @type {{ ip: string; addedAt: string; fromRequestId: string; memo?: string; requestMessage?: string }} */
      const newRow = {
        ip: ipn,
        addedAt: new Date().toISOString(),
        fromRequestId: id,
      };
      if (adminMemo) newRow.memo = adminMemo;
      if (requestMsg) newRow.requestMessage = requestMsg;
      store.allowed.push(newRow);
    } else {
      if (adminMemo) existingIp.memo = adminMemo;
      if (requestMsg) existingIp.requestMessage = requestMsg;
    }
    const eventMs = Date.now();
    stampAccessEventNow(req, eventMs);
    reqEntry.status = "approved";
    reqEntry.resolvedAt = new Date(eventMs).toISOString();
    writeAccessStore(store);
    res.json({ ok: true });
  });

  app.post("/api/access/admin/allowed-memo", requireAdmin, (req, res) => {
    const rawIp = String(req.body?.ip ?? "").trim();
    if (!rawIp) {
      res.status(400).json({ error: "ip가 필요합니다." });
      return;
    }
    const memo = String(req.body?.memo ?? "").trim().slice(0, 300);
    const store = readAccessStore();
    const target = normalizeAccessIp(rawIp);
    const entry = store.allowed.find((a) => normalizeAccessIp(a.ip) === target);
    if (!entry) {
      res.status(404).json({ error: "허용 목록에 없는 IP입니다." });
      return;
    }
    stampAccessEventNow(req);
    if (memo) entry.memo = memo;
    else delete entry.memo;
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
    const eventMs = Date.now();
    stampAccessEventNow(req, eventMs);
    reqEntry.status = "rejected";
    reqEntry.resolvedAt = new Date(eventMs).toISOString();
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
    stampAccessEventNow(req);
    writeAccessStore(store);
    res.json({ ok: true });
  });

  app.post("/api/access/admin/grant-delegate", requireAdmin, (req, res) => {
    const rawIp = String(req.body?.ip ?? "").trim();
    if (!rawIp) {
      res.status(400).json({ error: "ip가 필요합니다." });
      return;
    }
    const target = normalizeAccessIp(rawIp);
    const store = readAccessStore();
    const entry = store.allowed.find((a) => normalizeAccessIp(a.ip) === target);
    if (!entry) {
      res.status(404).json({ error: "허용 목록에 없는 IP입니다. 먼저 접속을 허용한 뒤 위임할 수 있습니다." });
      return;
    }
    entry.adminDelegate = true;
    writeAccessStore(store);
    res.json({ ok: true });
  });

  app.post("/api/access/admin/revoke-delegate", requireAdmin, (req, res) => {
    const rawIp = String(req.body?.ip ?? "").trim();
    if (!rawIp) {
      res.status(400).json({ error: "ip가 필요합니다." });
      return;
    }
    const target = normalizeAccessIp(rawIp);
    const store = readAccessStore();
    const entry = store.allowed.find((a) => normalizeAccessIp(a.ip) === target);
    if (!entry) {
      res.status(404).json({ error: "허용 목록에 없는 IP입니다." });
      return;
    }
    if (entry.adminDelegate !== true) {
      res.status(400).json({ error: "이 IP에는 위임된 관리자 권한이 없습니다." });
      return;
    }
    delete entry.adminDelegate;
    writeAccessStore(store);
    res.json({ ok: true });
  });

  if (isAccessControlEnabled()) {
    console.log("[access-control] IP 허용제 ON — 등록된 IP만 /api 사용");
    const envTok = getAdminToken();
    const ips = parseAccessAdminIps();
    if (!envTok && ips.length === 0) {
      console.warn(
        "[access-control] ACCESS_ADMIN_TOKEN·ACCESS_ADMIN_IPS 미설정 — 관리 API는 503",
      );
    }
  }
}
