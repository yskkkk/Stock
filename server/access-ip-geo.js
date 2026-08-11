/**
 * 공인 IP → 대략 지역(국가·시·ISP). 무료 ip-api.com + 메모리 캐시.
 */
/** @typedef {{
 *   geoLabel: string;
 *   geoCountry: string;
 *   geoCountryCode: string;
 *   geoRegion: string;
 *   geoCity: string;
 *   geoIsp: string;
 *   geoSource: string;
 * }} IpGeoInfo */

/** @type {Map<string, { at: number; info: IpGeoInfo }>} */
const cache = new Map();
const CACHE_MS = 24 * 60 * 60 * 1000;
/** @type {Map<string, Promise<IpGeoInfo | null>>} */
const inflight = new Map();

/**
 * @param {string} ip
 */
export function isPrivateOrLocalIp(ip) {
  const s = String(ip ?? "").trim();
  if (!s || s === "-" || s === "::1" || s === "localhost") return true;
  if (s === "127.0.0.1") return true;
  if (/^10\./.test(s)) return true;
  if (/^192\.168\./.test(s)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(s)) return true;
  if (/^fc|fd|fe80:/i.test(s)) return true;
  return false;
}

/**
 * @param {string} ip
 * @returns {IpGeoInfo | null}
 */
export function getCachedIpGeo(ip) {
  const key = String(ip ?? "").trim();
  if (!key) return null;
  if (isPrivateOrLocalIp(key)) {
    return {
      geoLabel: "로컬/사설망",
      geoCountry: "",
      geoCountryCode: "",
      geoRegion: "",
      geoCity: "",
      geoIsp: "",
      geoSource: "local",
    };
  }
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_MS) {
    cache.delete(key);
    return null;
  }
  return hit.info;
}

/**
 * @param {Record<string, unknown>} data
 * @returns {IpGeoInfo}
 */
export function geoInfoFromIpApiPayload(data) {
  const country = String(data.country ?? "").trim();
  const code = String(data.countryCode ?? "").trim();
  const region = String(data.regionName ?? "").trim();
  const city = String(data.city ?? "").trim();
  const isp = String(data.isp ?? "").trim();
  /** @type {string[]} */
  const bits = [];
  if (code || country) bits.push(code || country);
  if (region) bits.push(region);
  if (city && city !== region) bits.push(city);
  const geoLabel = bits.length ? bits.join(" · ") : "지역 미상";
  return {
    geoLabel: geoLabel.slice(0, 160),
    geoCountry: country.slice(0, 80),
    geoCountryCode: code.slice(0, 8),
    geoRegion: region.slice(0, 80),
    geoCity: city.slice(0, 80),
    geoIsp: isp.slice(0, 120),
    geoSource: "ip-api",
  };
}

/**
 * @param {string} ip
 * @returns {Promise<IpGeoInfo | null>}
 */
export async function lookupIpGeo(ip) {
  const key = String(ip ?? "").trim();
  if (!key || key === "-") return null;

  const cached = getCachedIpGeo(key);
  if (cached) return cached;

  if (isPrivateOrLocalIp(key)) {
    const local = getCachedIpGeo(key);
    if (local) cache.set(key, { at: Date.now(), info: local });
    return local;
  }

  const pending = inflight.get(key);
  if (pending) return pending;

  const job = (async () => {
    try {
      const url = `http://ip-api.com/json/${encodeURIComponent(key)}?fields=status,message,country,countryCode,regionName,city,isp,query`;
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(6_000),
      });
      if (!res.ok) return null;
      const data = await res.json();
      if (!data || data.status !== "success") return null;
      const info = geoInfoFromIpApiPayload(
        /** @type {Record<string, unknown>} */ (data),
      );
      cache.set(key, { at: Date.now(), info });
      return info;
    } catch {
      return null;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, job);
  return job;
}
