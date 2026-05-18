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

/** 브라우저·게이트와 동일 — 문서 요청(GET /)에서도 MAC을 내려면 쿠키로 동기화 */
export const ACCESS_CLIENT_MAC_COOKIE = "stock_access_client_mac";

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

/** Wi-Fi 등에서 사용자가 확인한 MAC(자가 신고). 12 hex → AA:BB:… 대문자 */
export function normalizeAccessMac(raw) {
  if (raw == null) return "";
  const s = String(raw).trim().toLowerCase().replace(/[^0-9a-f]/g, "");
  if (s.length !== 12 || !/^[0-9a-f]{12}$/.test(s)) return "";
  const p = s.toUpperCase().match(/.{2}/g);
  return p ? p.join(":") : "";
}

function readAccessClientMacCookie(req) {
  const raw = String(req.headers?.cookie ?? "");
  const m = raw.match(new RegExp(`(?:^|;\\s*)${ACCESS_CLIENT_MAC_COOKIE}=([^;]+)`, "i"));
  if (!m) return "";
  try {
    return normalizeAccessMac(decodeURIComponent(m[1].trim()));
  } catch {
    return normalizeAccessMac(m[1]);
  }
}

function headerAccessClientMac(req) {
  const h = req.headers["x-access-client-mac"] ?? req.headers["X-Access-Client-Mac"];
  const v = typeof h === "string" ? h : Array.isArray(h) ? h[0] : "";
  return normalizeAccessMac(v);
}

/**
 * 헤더 → 쿠키 → JSON body(deviceInfo.clientMac / clientMac)
 * @param {import("http").IncomingMessage} req
 */
export function clientMacFromReq(req) {
  const fromHead = headerAccessClientMac(req);
  if (fromHead) return fromHead;
  const fromCookie = readAccessClientMacCookie(req);
  if (fromCookie) return fromCookie;
  const b = req.body;
  if (b && typeof b === "object" && !Array.isArray(b)) {
    const raw =
      (typeof b.clientMac === "string" && b.clientMac.trim() && b.clientMac) ||
      (b.deviceInfo &&
        typeof b.deviceInfo === "object" &&
        typeof b.deviceInfo.clientMac === "string" &&
        b.deviceInfo.clientMac.trim() &&
        b.deviceInfo.clientMac) ||
      "";
    if (raw) return normalizeAccessMac(raw);
  }
  return "";
}

function allowedMacOnRow(a) {
  return normalizeAccessMac(a?.mac ?? "");
}

function allowedRowMatchesClient(a, clientIpNorm, clientMacNorm) {
  if (normalizeAccessIp(a.ip) === clientIpNorm) return true;
  if (clientMacNorm && allowedMacOnRow(a) === clientMacNorm) return true;
  return false;
}

function requestClientMacNorm(r) {
  const top = normalizeAccessMac(r?.clientMac ?? "");
  if (top) return top;
  const di = r?.deviceInfo;
  if (di && typeof di === "object" && typeof di.clientMac === "string") {
    return normalizeAccessMac(di.clientMac);
  }
  return "";
}

function requestRowMatchesClient(r, clientIpNorm, clientMacNorm) {
  if (normalizeAccessIp(r.ip) === clientIpNorm) return true;
  const rm = requestClientMacNorm(r);
  if (clientMacNorm && rm && rm === clientMacNorm) return true;
  return false;
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
  const token = getAdminToken();
  const bearer = readBearerToken(req);
  if (token && bearer === token) return true;
  if (isAccessAdminIp(req)) return true;
  const ip = normalizeAccessIp(clientIp(req));
  if (!ip) return false;
  const mac = clientMacFromReq(req);
  const store = readAccessStore();
  for (const a of store.allowed) {
    if (a.adminDelegate === true && allowedRowMatchesClient(a, ip, mac)) return true;
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
  if (method === "GET" && pathname === "/api/access/status") return true;
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
    pathname === "/access-gate.html"
  ) {
    return true;
  }
  return false;
}

function isAdminPath(pathname) {
  return pathname.startsWith("/api/access/admin");
}

/**
 * @param {string} ip
 * @param {import("http").IncomingMessage} [req] — 있으면 MAC(헤더·쿠키·body)까지 매칭
 */
export function isClientIpOnAllowlist(ip, req) {
  const n = normalizeAccessIp(ip);
  if (!n) return false;
  if (allowLocalhost() && isLocalIp(n)) return true;
  for (const b of getBootstrapIps()) {
    if (b === n) return true;
  }
  const mac = req ? clientMacFromReq(req) : "";
  const store = readAccessStore();
  for (const a of store.allowed) {
    if (allowedRowMatchesClient(a, n, mac)) return true;
  }
  return false;
}

export function getAccessStateForIp(ip, req) {
  const n = normalizeAccessIp(ip);
  const mac = req ? clientMacFromReq(req) : "";
  if (isClientIpOnAllowlist(ip, req)) return "allowed";
  const store = readAccessStore();
  if (store.requests.some((r) => r.status === "pending" && requestRowMatchesClient(r, n, mac))) {
    return "pending";
  }
  if (store.requests.some((r) => r.status === "rejected" && requestRowMatchesClient(r, n, mac))) {
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
  const ip = clientIp(req);
  if (isClientIpOnAllowlist(ip, req)) return next();
  res.status(403).json({
    error: "이 IP·단말에서는 API를 사용할 수 없습니다. 접근 게이트에서 접속 신청을 해 주세요.",
    code: "ACCESS_DENIED",
  });
}

function requireAdmin(req, res, next) {
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
        adminIpConsole: isAccessAdminIp(req),
      });
      return;
    }
    const mac = clientMacFromReq(req);
    res.json({
      enabled: true,
      state: getAccessStateForIp(ip, req),
      yourIp: ip,
      ...(mac ? { yourMac: mac } : {}),
    });
  });

  app.post("/api/access/request", (req, res) => {
    if (!isAccessControlEnabled()) {
      res.json({ ok: true, message: "접근 제어가 비활성화되어 있습니다." });
      return;
    }
    const ip = clientIp(req);
    const ipn = normalizeAccessIp(ip);
    const macn = clientMacFromReq(req);
    if (isClientIpOnAllowlist(ip, req)) {
      res.json({ ok: true, message: "이미 허용된 IP 또는 단말(MAC)입니다." });
      return;
    }
    const now = Date.now();
    const throttleKey = macn || ipn;
    const prev = lastRequestAt.get(throttleKey) ?? 0;
    if (now - prev < THROTTLE_MS) {
      res.status(429).json({ error: "잠시 후 다시 신청해 주세요." });
      return;
    }
    lastRequestAt.set(throttleKey, now);
    pruneAccessRequestThrottle();

    const store = readAccessStore();
    if (
      store.requests.some(
        (r) => r.status === "pending" && requestRowMatchesClient(r, ipn, macn),
      )
    ) {
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
      const dm = normalizeAccessMac(rawDevice.clientMac ?? "");
      if (dm) deviceInfo.clientMac = dm;
    }
    if (macn) {
      if (!deviceInfo) deviceInfo = {};
      if (!deviceInfo.clientMac) deviceInfo.clientMac = macn;
    }
    const row = {
      id,
      ip,
      userAgent: String(req.headers["user-agent"] ?? "").slice(0, 400),
      message,
      deviceInfo,
      requestedAt: new Date().toISOString(),
      status: "pending",
    };
    if (macn) row.clientMac = macn;
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
    const macReq = normalizeAccessMac(
      reqEntry.clientMac ??
        (reqEntry.deviceInfo &&
        typeof reqEntry.deviceInfo === "object" &&
        reqEntry.deviceInfo.clientMac) ??
        "",
    );

    let mergedByMac = false;
    if (macReq) {
      const hit = store.allowed.find((a) => allowedMacOnRow(a) === macReq);
      if (hit) {
        hit.ip = ipn;
        hit.mac = macReq;
        if (adminMemo) hit.memo = adminMemo;
        if (requestMsg) hit.requestMessage = requestMsg;
        mergedByMac = true;
      }
    }

    if (!mergedByMac) {
      const existingIp = store.allowed.find((a) => normalizeAccessIp(a.ip) === ipn);
      if (!existingIp) {
        /** @type {{ ip: string; mac?: string; addedAt: string; fromRequestId: string; memo?: string; requestMessage?: string }} */
        const newRow = {
          ip: ipn,
          addedAt: new Date().toISOString(),
          fromRequestId: id,
        };
        if (macReq) newRow.mac = macReq;
        if (adminMemo) newRow.memo = adminMemo;
        if (requestMsg) newRow.requestMessage = requestMsg;
        store.allowed.push(newRow);
      } else {
        if (macReq && !existingIp.mac) existingIp.mac = macReq;
        if (adminMemo) existingIp.memo = adminMemo;
        if (requestMsg) existingIp.requestMessage = requestMsg;
      }
    }
    reqEntry.status = "approved";
    reqEntry.resolvedAt = new Date().toISOString();
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
    console.log("[access-control] IP·MAC 허용제 ON — 등록된 IP 또는 MAC만 /api 사용");
    const envTok = getAdminToken();
    const ips = parseAccessAdminIps();
    if (!envTok && ips.length === 0) {
      console.warn(
        "[access-control] ACCESS_ADMIN_TOKEN·ACCESS_ADMIN_IPS 미설정 — 관리 API는 503",
      );
    }
  }
}
