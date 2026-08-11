/**
 * 접속 기기 목록 SSOT — IP + User-Agent(+선택 deviceInfo)를 server/.data 에 유지
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { formatLogTimestampKst } from "./log-kst.js";
import {
  dailyServerLogPath,
  ensureServerLogDirSync,
} from "./log-paths.js";
import { parseJsonText } from "./store-json.js";
import { getCachedIpGeo, lookupIpGeo } from "./access-ip-geo.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORE_FILE = path.join(__dirname, ".data", "access-devices.json");
const MAX_DEVICES = 800;
/** 동일 기기 디스크 갱신 최소 간격 */
const WRITE_THROTTLE_MS = 90_000;

/** @type {Map<string, number>} */
const lastPersistAt = new Map();

/** @type {{ updatedAt: number; devices: AccessDeviceRow[] } | null} */
let cache = null;

/**
 * @typedef {{
 *   id: string;
 *   ip: string;
 *   userAgent: string;
 *   deviceLabel: string;
 *   platform: string;
 *   language: string;
 *   languages: string;
 *   screen: string;
 *   viewport: string;
 *   timezone: string;
 *   hardwareConcurrency: number | null;
 *   deviceMemory: number | null;
 *   maxTouchPoints: number | null;
 *   cookieEnabled: boolean | null;
 *   firstSeenAt: string;
 *   lastSeenAt: string;
 *   lastSeenKst: string;
 *   hitCount: number;
 *   lastPath: string;
 *   source: string;
 *   geoLabel: string;
 *   geoCountry: string;
 *   geoCountryCode: string;
 *   geoRegion: string;
 *   geoCity: string;
 *   geoIsp: string;
 *   geoSource: string;
 * }} AccessDeviceRow
 */

function ensureDataDir() {
  const dir = path.dirname(STORE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/** access-log 와 순환 import 피하려고 로컬 복제 */
function clientIpFromReq(req) {
  const xff = req?.headers?.["x-forwarded-for"];
  if (xff) return String(xff).split(",")[0]?.trim() || "-";
  const raw = req?.socket?.remoteAddress ?? "";
  if (String(raw).startsWith("::ffff:")) return String(raw).slice(7);
  return raw || "-";
}

/**
 * @param {string} ua
 */
export function summarizeUserAgent(ua) {
  const s = String(ua ?? "").trim();
  if (!s) return "Unknown";
  /** @type {string[]} */
  const bits = [];
  if (/Cursor\//i.test(s)) bits.push("Cursor");
  else if (/Edg\//i.test(s)) bits.push("Edge");
  else if (/Chrome\//i.test(s) && !/Chromium/i.test(s)) bits.push("Chrome");
  else if (/Firefox\//i.test(s)) bits.push("Firefox");
  else if (/Safari\//i.test(s) && !/Chrome\//i.test(s)) bits.push("Safari");
  else if (/bot|crawler|spider|scan/i.test(s)) bits.push("Bot/Scanner");

  if (/iPhone/i.test(s)) bits.unshift("iPhone");
  else if (/iPad/i.test(s)) bits.unshift("iPad");
  else if (/Android/i.test(s)) bits.unshift("Android");
  else if (/Windows NT/i.test(s)) bits.unshift("Windows");
  else if (/Mac OS X|Macintosh/i.test(s)) bits.unshift("macOS");
  else if (/Linux/i.test(s)) bits.unshift("Linux");
  else if (/CrOS/i.test(s)) bits.unshift("ChromeOS");

  if (!bits.length) return s.slice(0, 48);
  return bits.join(" · ");
}

/**
 * @param {string} ip
 * @param {string} userAgent
 */
export function accessDeviceId(ip, userAgent) {
  const raw = `${String(ip || "").trim()}|${String(userAgent || "").trim()}`;
  return crypto.createHash("sha1").update(raw).digest("hex").slice(0, 16);
}

function emptyStore() {
  return { updatedAt: 0, devices: /** @type {AccessDeviceRow[]} */ ([]) };
}

function readStore() {
  if (cache) return cache;
  ensureDataDir();
  try {
    if (!fs.existsSync(STORE_FILE)) {
      cache = emptyStore();
      return cache;
    }
    const raw = fs.readFileSync(STORE_FILE, "utf8");
    const parsed = parseJsonText(raw);
    if (!parsed || typeof parsed !== "object") {
      cache = emptyStore();
      return cache;
    }
    const devices = Array.isArray(
      /** @type {{ devices?: unknown }} */ (parsed).devices,
    )
      ? /** @type {AccessDeviceRow[]} */ (
          /** @type {{ devices: AccessDeviceRow[] }} */ (parsed).devices
        )
      : [];
    cache = {
      updatedAt:
        Number(/** @type {{ updatedAt?: number }} */ (parsed).updatedAt) || 0,
      devices,
    };
    return cache;
  } catch {
    cache = emptyStore();
    return cache;
  }
}

function writeStore(store) {
  ensureDataDir();
  const payload = {
    updatedAt: Date.now(),
    devices: store.devices,
  };
  cache = payload;
  fs.writeFileSync(STORE_FILE, JSON.stringify(payload, null, 2), "utf8");
}

/**
 * @param {AccessDeviceRow} row
 * @param {import("./access-ip-geo.js").IpGeoInfo} geo
 */
function applyGeoToRow(row, geo) {
  row.geoLabel = geo.geoLabel;
  row.geoCountry = geo.geoCountry;
  row.geoCountryCode = geo.geoCountryCode;
  row.geoRegion = geo.geoRegion;
  row.geoCity = geo.geoCity;
  row.geoIsp = geo.geoIsp;
  row.geoSource = geo.geoSource;
}

/**
 * @param {string} deviceId
 * @param {string} ip
 */
function scheduleGeoEnrich(deviceId, ip) {
  const id = String(deviceId || "");
  const ipn = String(ip || "");
  if (!id || !ipn) return;
  void lookupIpGeo(ipn)
    .then((geo) => {
      if (!geo) return;
      const store = readStore();
      const row = store.devices.find((d) => d.id === id);
      if (!row) return;
      const prev = row.geoLabel || "";
      applyGeoToRow(row, geo);
      if (prev !== row.geoLabel) {
        writeStore(store);
      } else {
        cache = { updatedAt: Date.now(), devices: store.devices };
      }
    })
    .catch(() => {
      /* ignore */
    });
}

/**
 * @param {unknown} raw
 */
export function normalizeDeviceInfoPayload(raw) {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const d = /** @type {Record<string, unknown>} */ (raw);
  return {
    userAgent: String(d.userAgent ?? "").slice(0, 400),
    platform: String(d.platform ?? "").slice(0, 120),
    language: String(d.language ?? "").slice(0, 80),
    languages: String(d.languages ?? "").slice(0, 200),
    screen: String(d.screen ?? "").slice(0, 80),
    viewport: String(d.viewport ?? "").slice(0, 80),
    timezone: String(d.timezone ?? "").slice(0, 80),
    hardwareConcurrency:
      typeof d.hardwareConcurrency === "number" &&
      Number.isFinite(d.hardwareConcurrency)
        ? d.hardwareConcurrency
        : null,
    deviceMemory:
      typeof d.deviceMemory === "number" && Number.isFinite(d.deviceMemory)
        ? d.deviceMemory
        : null,
    maxTouchPoints:
      typeof d.maxTouchPoints === "number" && Number.isFinite(d.maxTouchPoints)
        ? d.maxTouchPoints
        : null,
    cookieEnabled: typeof d.cookieEnabled === "boolean" ? d.cookieEnabled : null,
  };
}

/**
 * @param {{
 *   ip: string;
 *   userAgent?: string;
 *   path?: string;
 *   source?: string;
 *   deviceInfo?: ReturnType<typeof normalizeDeviceInfoPayload> | null;
 *   forcePersist?: boolean;
 * }} args
 */
export function recordAccessDeviceSeen(args) {
  const ip = String(args.ip ?? "").trim();
  if (!ip || ip === "-") return null;

  const fromInfo = args.deviceInfo;
  const userAgent = String(fromInfo?.userAgent || args.userAgent || "")
    .trim()
    .slice(0, 400);
  if (!userAgent) return null;

  const id = accessDeviceId(ip, userAgent);
  const nowIso = new Date().toISOString();
  const nowKst = formatLogTimestampKst();
  const store = readStore();
  let row = store.devices.find((d) => d.id === id);
  const isNew = !row;
  if (!row) {
    row = {
      id,
      ip,
      userAgent,
      deviceLabel: summarizeUserAgent(userAgent),
      platform: "",
      language: "",
      languages: "",
      screen: "",
      viewport: "",
      timezone: "",
      hardwareConcurrency: null,
      deviceMemory: null,
      maxTouchPoints: null,
      cookieEnabled: null,
      firstSeenAt: nowIso,
      lastSeenAt: nowIso,
      lastSeenKst: nowKst,
      hitCount: 0,
      lastPath: "",
      source: String(args.source || "header").slice(0, 32),
      geoLabel: "",
      geoCountry: "",
      geoCountryCode: "",
      geoRegion: "",
      geoCity: "",
      geoIsp: "",
      geoSource: "",
    };
    store.devices.push(row);
  }

  row.hitCount = (Number(row.hitCount) || 0) + 1;
  row.lastSeenAt = nowIso;
  row.lastSeenKst = nowKst;
  row.ip = ip;
  row.userAgent = userAgent;
  row.deviceLabel = summarizeUserAgent(userAgent);
  if (args.path) row.lastPath = String(args.path).slice(0, 200);
  if (args.source) row.source = String(args.source).slice(0, 32);
  if (fromInfo) {
    if (fromInfo.platform) row.platform = fromInfo.platform;
    if (fromInfo.language) row.language = fromInfo.language;
    if (fromInfo.languages) row.languages = fromInfo.languages;
    if (fromInfo.screen) row.screen = fromInfo.screen;
    if (fromInfo.viewport) row.viewport = fromInfo.viewport;
    if (fromInfo.timezone) row.timezone = fromInfo.timezone;
    if (fromInfo.hardwareConcurrency != null) {
      row.hardwareConcurrency = fromInfo.hardwareConcurrency;
    }
    if (fromInfo.deviceMemory != null) row.deviceMemory = fromInfo.deviceMemory;
    if (fromInfo.maxTouchPoints != null) {
      row.maxTouchPoints = fromInfo.maxTouchPoints;
    }
    if (fromInfo.cookieEnabled != null) {
      row.cookieEnabled = fromInfo.cookieEnabled;
    }
  }

  const cachedGeo = getCachedIpGeo(ip);
  if (cachedGeo) applyGeoToRow(row, cachedGeo);
  if (!row.geoLabel) scheduleGeoEnrich(id, ip);

  store.devices.sort(
    (a, b) => Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt),
  );
  if (store.devices.length > MAX_DEVICES) {
    store.devices = store.devices.slice(0, MAX_DEVICES);
  }

  const lastWrite = lastPersistAt.get(id) || 0;
  const now = Date.now();
  const shouldWrite =
    args.forcePersist || isNew || now - lastWrite >= WRITE_THROTTLE_MS;
  if (shouldWrite) {
    lastPersistAt.set(id, now);
    writeStore(store);
    if (isNew) {
      try {
        ensureServerLogDirSync();
        const geoBit = row.geoLabel ? `\tgeo=${row.geoLabel}` : "";
        const line = `${nowKst}\tip=${ip}${geoBit}\tdevice=${row.deviceLabel}\tua=${userAgent.replace(/[\t\r\n]/g, " ").slice(0, 240)}\tpath=${row.lastPath || "-"}\tsource=${row.source}\n`;
        fs.appendFile(dailyServerLogPath("access-devices"), line, () => {});
      } catch {
        /* ignore */
      }
    }
  } else {
    cache = { updatedAt: Date.now(), devices: store.devices };
  }

  return row;
}

/**
 * @param {import("http").IncomingMessage} req
 * @param {{ path?: string; source?: string }} [opts]
 */
export function recordAccessDeviceFromReq(req, opts = {}) {
  try {
    const ip = clientIpFromReq(req);
    const ua = String(req.headers?.["user-agent"] ?? "").trim();
    if (!ua) return null;
    let pathName = opts.path || "";
    if (!pathName) {
      const raw = String(
        /** @type {{ originalUrl?: string; url?: string; path?: string }} */ (
          req
        ).originalUrl ??
          /** @type {{ url?: string }} */ (req).url ??
          /** @type {{ path?: string }} */ (req).path ??
          "",
      );
      pathName = raw.split("?")[0].split("#")[0] || "";
    }
    return recordAccessDeviceSeen({
      ip,
      userAgent: ua,
      path: pathName,
      source: opts.source || "header",
    });
  } catch {
    return null;
  }
}

/**
 * @param {{ limit?: number; sinceMs?: number }} [opts]
 */
export function listAccessDevices(opts = {}) {
  const store = readStore();
  const limit = Math.min(500, Math.max(1, Number(opts.limit) || 120));
  const sinceMs = Number(opts.sinceMs) || 0;
  let rows = [...store.devices];
  if (sinceMs > 0) {
    rows = rows.filter((d) => Date.parse(d.lastSeenAt) >= sinceMs);
  }
  return {
    updatedAt: store.updatedAt,
    count: rows.length,
    devices: rows.slice(0, limit),
  };
}

/** @param {string} ymd KST YYYY-MM-DD */
export function listAccessDevicesSeenOnKstDay(ymd) {
  const day = String(ymd || "").trim();
  const store = readStore();
  const devices = store.devices
    .filter((d) => String(d.lastSeenKst || "").startsWith(day))
    .sort((a, b) => Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt));
  return {
    day,
    count: devices.length,
    devices,
  };
}
