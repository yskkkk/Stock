/**
 * 주가·기업가치에 실질적 영향이 있을 법한 뉴스만 남기고, 탭loid/스포츠 등은 제외합니다.
 * (완벽한 분류는 불가하므로 키워드 휴리스틱 — 공시·DART는 항상 통과)
 */

/** 공시류 제목 (news.js classify와 동일 계열 유지) */
const DISCLOSURE_TITLE_RE =
  /공시|공개|실적|주주|배당|증자|합병|분할|유상|무상|IR\b|유가증권|전자공시|disclosure|SEC\b|10-K|10-Q|8-K|filing|earnings release/i;

/** 기업·시장 영향 가능성이 높은 헤드라인 */
const MATERIAL_TITLE_RE = new RegExp(
  [
    // 실적·재무
    String.raw`실적|매출|영업이익|순이익|적자|흑자|어닝|가이던스|가이드|컨센|컨센서스|서프라이즈|어닝쇼크|어닝 서프라이즈`,
    String.raw`배당|자사주|매입|소각|증자|유상|무상|감자|전환사채|\bCB\b|\bBW\b|신주인수권`,
    String.raw`인수|합병|분할|M\s*&\s*A|지배구조|경영권|승계|대표이사|사장|\bCEO\b|\bCFO\b|사임|해임|선임`,
    String.raw`공시|정정신고|금융위|금감원|거래소|상장폐지|관리종목|투자주의|거래정지|상장적격성`,
    String.raw`소송|패소|승소|제재|과징금|조사|압수수색|분식|회계`,
    String.raw`FDA|승인|허가|임상|계약|수주|납품|납기|MOU|제휴|파트너십|출시|런칭|공급|증설|감산|휴업|폐쇄|리콜`,
    String.raw`파산|부도|워크아웃|구조조정|MBO|매각|지분|매집|공매도`,
    String.raw`목표가|투자의견|매수유지|매도유지|비중확대|비중축소|업그레이드|다운그레이드`,
    String.raw`주가|급등|급락|거래량|신고가|신저가|52주`,
    String.raw`해명|사과|경고|유의|주의|논란|의혹|조작|불공정`,
    // English
    String.raw`earnings|revenue|profit|loss|guidance|\bEPS\b|EBITDA|dividend|buyback|split`,
    String.raw`SEC filing|10-K|10-Q|8-K|acquisition|merger|takeover|buyout`,
    String.raw`lawsuit|settlement|antitrust|indictment|fraud|probe|investigation`,
    String.raw`FDA|approval|clinical trial|contract|recall|bankruptcy|Chapter 11`,
    String.raw`layoff|resign|appoint|CEO|CFO|chairman`,
    String.raw`upgrade|downgrade|price target|PT raise|PT cut|reiterates|initiates`,
    String.raw`surprise|miss|beat|halt|trading halt|suspension|delisting`,
    String.raw`outlook|forecast|analyst|guidance cut|guidance raise`,
    String.raw`unveils|partnership|strategic stake|stake in|warns|caution`,
  ].join("|"),
  "i",
);

/** 주가와 무관한 엔터·스포츠·생활 등 (기업명만 같이 나온 랭킹 기사 등 제거) */
const NOISE_TITLE_RE = new RegExp(
  [
    String.raw`연예|아이돌|가수\s|배우\s|열애|결혼\s|혼인|웨딩`,
    String.raw`드라마\s|예능|방송|시청률|올림픽|월드컵|프리미어리그|프로야구|KBO|NBA\s|골프\s`,
    String.raw`날씨|미세먼지|기상청|레시피|다이어트|패션|화보|포토|인스타`,
    String.raw`퀴즈|이벤트|광고|프로모션|로또|복권`,
    String.raw`맛집|여행|호텔|숙박`,
  ].join("|"),
  "i",
);

export function isDisclosureTitle(title) {
  return DISCLOSURE_TITLE_RE.test(String(title ?? ""));
}

/**
 * @param {{ title?: string; type?: string; source?: string }} item
 */
export function isStockMovingNewsItem(item) {
  const title = String(item?.title ?? "");
  const t = item?.type;
  const src = String(item?.source ?? "");
  if (t === "disclosure") return true;
  if (/dart|전자공시/i.test(src)) return true;
  if (isDisclosureTitle(title)) return true;
  if (NOISE_TITLE_RE.test(title)) return false;
  return MATERIAL_TITLE_RE.test(title);
}

const TRACKING_PARAM = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "gclid",
  "fbclid",
  "mc_cid",
  "mc_eid",
  "ref",
  "icid",
  "ocid",
]);

/**
 * URL 기준 중복 제거용 정규화 (추적 파라미터 제거)
 * @param {string} url
 */
export function canonicalNewsUrl(url) {
  if (!url?.trim()) return "";
  try {
    const u = new URL(url);
    for (const k of [...u.searchParams.keys()]) {
      const low = k.toLowerCase();
      if (TRACKING_PARAM.has(low) || low.startsWith("utm_")) {
        u.searchParams.delete(k);
      }
    }
    u.hash = "";
    return u.toString();
  } catch {
    return url.trim();
  }
}

/**
 * 제목 기준 느슨한 중복 키 (다른 매체 동일 기사)
 * @param {string} title
 */
export function titleDedupeKey(title) {
  let t = String(title ?? "").trim().toLowerCase();
  const pipe = t.split(/\s*[|｜]\s*/)[0];
  const dash = pipe.split(/\s+[-–—]\s+/)[0];
  t = dash.trim();
  try {
    t = t.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  } catch {
    /* ignore */
  }
  return t
    .replace(/[''`´]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 130);
}

export function isNoiseNewsTitle(title) {
  return NOISE_TITLE_RE.test(String(title ?? ""));
}

/**
 * 병합 이후에도 동일 기사가 남는 경우(리다이렉트·URL 정규화 후) 제거
 * @param {Array<{ title: string; url: string; publishedAt?: number }>} items
 */
export function dedupeNewsItems(items) {
  const seenCanon = new Set();
  const seenPath = new Set();
  const seenTitle = new Set();
  const out = [];
  for (const item of items) {
    if (!item?.title || !item?.url) continue;
    const canon = canonicalNewsUrl(item.url);
    const pKey = urlPathKey(item.url);
    const tKey = titleDedupeKey(item.title);
    if (
      seenCanon.has(canon) ||
      (pKey && seenPath.has(pKey)) ||
      (tKey.length > 0 && seenTitle.has(tKey))
    ) {
      continue;
    }
    seenCanon.add(canon);
    if (pKey) seenPath.add(pKey);
    if (tKey.length > 0) seenTitle.add(tKey);
    out.push(canon !== item.url ? { ...item, url: canon } : item);
  }
  return out;
}

/**
 * 호스트+경로만 (쿼리 제거) — 같은 기사 다른 추적 링크 묶기
 * @param {string} url
 */
export function urlPathKey(url) {
  if (!url?.trim()) return "";
  try {
    const u = new URL(canonicalNewsUrl(url));
    const path = u.pathname.replace(/\/+$/, "") || "/";
    return `${u.hostname.toLowerCase()}${path}`;
  } catch {
    return "";
  }
}
