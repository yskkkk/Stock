/**
 * 미국 발표 인박스 — 워치리스트 스캔·카드 생성
 */
import {
  addWatchSymbolSync,
  buildAnnouncementDedupeKey,
  buildAnnouncementDedupeKeys,
  dedupeRegisteredAnnouncementCards,
  hasAnyAnnouncementDedupeKey,
  hasSeenAnnouncementKey,
  insertAnnouncementCard,
  isSymbolAnnouncementPrimed,
  loadUsAnnouncementStoreSync,
  markAnnouncementAlerted,
  markSymbolAnnouncementPrimed,
  saveUsAnnouncementStoreSync,
  setWatchlistSync,
  shouldNotifyAnnouncement,
  shouldSendAnnouncementAlert,
} from "./us-announcement-inbox-store.js";
import { fetchRecentSecFilingsForSymbol } from "./us-announcement-edgar.js";
import {
  consensusEpsChangedEnough,
  fetchYahooConsensusSnapshot,
  metricsFromYahooSnapshot,
} from "./us-announcement-consensus.js";
import {
  ANNOUNCEMENT_METRIC_VERSION,
  buildAnnouncementMetrics,
  generateAnnouncementAiSummary,
  pctChange,
} from "./us-announcement-analyze.js";
import { enrichAnnouncementCopy, buildFilingHeadlineAndDetail } from "./us-announcement-summarize.js";
import { notifyUsAnnouncementCard } from "./us-announcement-notify.js";
import { liveTradeLogInfo, liveTradeLogWarn } from "./live-trade-log.js";

const CONSENSUS_MIN_PCT = (() => {
  const n = Number(process.env.STOCK_US_ANNOUNCEMENT_CONSENSUS_PCT ?? 2);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 20) : 2;
})();

/**
 * @param {string} symbol
 */
function yahooAnalysisUrl(symbol) {
  return `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}/analysis/`;
}

/**
 * @param {import("./us-announcement-inbox-store.js").UsAnnouncementCard} card
 * @param {string} dedupeKey
 * @param {boolean} [notify]
 * @param {{ deepEnrich?: boolean }} [opts]
 */
async function commitCard(card, dedupeKey, notify = true, opts = {}) {
  let store = loadUsAnnouncementStoreSync();
  const keys = [
    ...new Set(
      [dedupeKey, ...buildAnnouncementDedupeKeys(card)].filter(Boolean),
    ),
  ];
  if (hasAnyAnnouncementDedupeKey(store, keys)) {
    return { inserted: false, card: null };
  }
  const ai = await generateAnnouncementAiSummary({
    kind: card.kind,
    symbol: card.symbol,
    title: card.title,
    form: card.form,
    metrics: card.metrics,
  });
  card.ai = {
    summary: ai.summary,
    generatedAt: Date.now(),
    engine: ai.engine,
  };

  const deepEnrich = opts.deepEnrich !== false;
  try {
    if (deepEnrich) {
      const copy = await enrichAnnouncementCopy({
        form: card.form,
        kind: card.kind,
        title: card.title,
        symbol: card.symbol,
        edgarUrl: card.links?.edgar,
        metrics: card.metrics,
      });
      card.headline = copy.headline;
      card.detail = copy.detail;
      card.enrichedAt = copy.enrichedAt;
    } else {
      const copy = buildFilingHeadlineAndDetail(
        card.form ?? "",
        card.kind,
        card.title,
        "",
        card.metrics,
      );
      card.headline = copy.headline;
      card.detail = copy.detail;
      card.enrichedAt = Date.now();
    }
  } catch {
    card.headline = card.title || null;
    card.detail = ai.summary || null;
    card.enrichedAt = Date.now();
  }

  const result = insertAnnouncementCard(store, card, keys);
  if (!result.inserted || !result.card) {
    return { inserted: false, card: null };
  }
  store = result.store;

  const alert = shouldSendAnnouncementAlert({
    notifyOpt: notify,
    store,
    symbol: result.card.symbol,
    form: result.card.form,
    dedupeKey,
  });

  if (alert.send) {
    const notified = await notifyUsAnnouncementCard(result.card);
    result.card.notified = notified;
    markAnnouncementAlerted(store, dedupeKey);
    store.cards = store.cards.map((c) =>
      c.id === result.card.id ? result.card : c,
    );
  } else {
    result.card.notified = {
      telegramAt: null,
      emailAt: null,
      skipped: alert.reason,
    };
    store.cards = store.cards.map((c) =>
      c.id === result.card.id ? result.card : c,
    );
  }

  saveUsAnnouncementStoreSync(store);
  return { inserted: true, card: result.card };
}

/**
 * 기존 카드 중복 제거 + 메트릭/AI/소제목·상세 보강
 * @param {{ limit?: number; force?: boolean }} [opts]
 */
export async function cleanupAndEnrichAnnouncementInbox(opts = {}) {
  let store = loadUsAnnouncementStoreSync();
  const { removed } = dedupeRegisteredAnnouncementCards(store);
  saveUsAnnouncementStoreSync(store);

  store = loadUsAnnouncementStoreSync();
  const limit = Math.min(40, Math.max(1, Number(opts.limit) || 20));
  const force = opts.force === true;
  let enriched = 0;
  let metricsRefreshed = 0;

  /** @type {Map<string, Awaited<ReturnType<typeof fetchYahooConsensusSnapshot>> | null>} */
  const snapCache = new Map();

  /**
   * @param {string} sym
   */
  async function snapFor(sym) {
    const key = String(sym).toUpperCase();
    if (snapCache.has(key)) return snapCache.get(key) ?? null;
    try {
      const s = await fetchYahooConsensusSnapshot(key);
      snapCache.set(key, s);
      return s;
    } catch {
      snapCache.set(key, null);
      return null;
    }
  }

  for (const card of store.cards.slice(0, limit)) {
    const ver = Number(card.metrics?.metricVersion) || 0;
    const needMetrics = force || ver < ANNOUNCEMENT_METRIC_VERSION;
    const needCopy = force || !card.headline || !card.detail || needMetrics;

    if (!needMetrics && !needCopy) continue;

    if (needMetrics) {
      const snap = await snapFor(card.symbol);
      if (snap) {
        const prior = store.consensusSnapshots?.[card.symbol] ?? null;
        const fromYahoo = metricsFromYahooSnapshot(card.kind, snap, {
          priorQuarterEpsAvg: prior?.periods?.["0q"]?.epsAvg ?? null,
          priorForwardEps: prior?.forwardEps ?? null,
        });
        card.metrics = buildAnnouncementMetrics({
          kind: card.kind,
          symbol: card.symbol,
          ...fromYahoo,
          ...(card.kind === "consensus"
            ? {
                consensusEps:
                  fromYahoo.quarterConsensusEps ??
                  fromYahoo.consensusEps ??
                  card.metrics?.consensusEps,
                priorConsensusEps:
                  prior?.periods?.["0q"]?.epsAvg ??
                  prior?.forwardEps ??
                  card.metrics?.priorConsensusEps,
                consensusChangePct: fromYahoo.consensusChangePct,
              }
            : {}),
        });
        try {
          const ai = await generateAnnouncementAiSummary({
            kind: card.kind,
            symbol: card.symbol,
            title: card.title,
            form: card.form,
            metrics: card.metrics,
          });
          card.ai = {
            summary: ai.summary,
            generatedAt: Date.now(),
            engine: ai.engine,
          };
        } catch {
          /* keep old ai */
        }
        metricsRefreshed += 1;
      }
    }

    if (!needCopy) continue;
    try {
      const copy = await enrichAnnouncementCopy({
        form: card.form,
        kind: card.kind,
        title: card.title,
        symbol: card.symbol,
        edgarUrl: card.links?.edgar,
        metrics: card.metrics,
      });
      card.headline = copy.headline;
      card.detail = copy.detail;
      card.enrichedAt = copy.enrichedAt;
      enriched += 1;
    } catch (e) {
      liveTradeLogWarn(
        "[us-announcement] enrich fail",
        card.symbol,
        e instanceof Error ? e.message : e,
      );
    }
  }
  saveUsAnnouncementStoreSync(store);
  liveTradeLogInfo(
    "[us-announcement] cleanup/enrich",
    `removed=${removed}`,
    `enriched=${enriched}`,
    `metrics=${metricsRefreshed}`,
  );
  return {
    removed,
    enriched,
    metricsRefreshed,
    cardCount: store.cards.length,
  };
}

/**
 * @param {string} symbol
 * @param {{
 *   notify?: boolean;
 *   sinceMs?: number;
 *   filingLimit?: number;
 *   deepEnrich?: boolean;
 *   forceNotifyOff?: boolean;
 * }} [opts]
 */
export async function scanSecFilingsForSymbol(symbol, opts = {}) {
  const sym = String(symbol ?? "")
    .trim()
    .toUpperCase();
  const storeAtStart = loadUsAnnouncementStoreSync();
  const notify = opts.forceNotifyOff
    ? false
    : shouldNotifyAnnouncement(opts.notify, storeAtStart, sym);
  const backfill =
    opts.forceNotifyOff === true || !isSymbolAnnouncementPrimed(storeAtStart, sym);
  const filingLimit = Math.min(60, Math.max(1, Number(opts.filingLimit) || 15));
  const pack = await fetchRecentSecFilingsForSymbol(sym, {
    limit: filingLimit,
    sinceMs: opts.sinceMs,
  });

  /** @type {Awaited<ReturnType<typeof fetchYahooConsensusSnapshot>> | null} */
  let snap = null;
  try {
    snap = await fetchYahooConsensusSnapshot(sym);
  } catch {
    snap = null;
  }

  /** @type {import("./us-announcement-inbox-store.js").UsAnnouncementCard[]} */
  const inserted = [];
  for (const f of pack.filings) {
    const dedupeKey = buildAnnouncementDedupeKey(
      sym,
      f.kind,
      f.accession || `${f.form}|${f.filedAt}`,
    );
    const store = loadUsAnnouncementStoreSync();
    const keys = buildAnnouncementDedupeKeys({
      symbol: sym,
      kind: f.kind,
      title: f.title,
      form: f.form,
      accession: f.accession,
      filedAt: f.filedAt,
    });
    if (hasAnyAnnouncementDedupeKey(store, keys)) continue;

    let metrics = buildAnnouncementMetrics({
      kind: f.kind,
      symbol: sym,
      ...metricsFromYahooSnapshot(f.kind, snap ?? { periods: {}, forwardEps: null, trailingEps: null, lastReported: null }, {
        priorQuarterEpsAvg:
          storeAtStart.consensusSnapshots?.[sym]?.periods?.["0q"]?.epsAvg ??
          null,
        priorForwardEps:
          storeAtStart.consensusSnapshots?.[sym]?.forwardEps ?? null,
      }),
    });

    const card = {
      id: `ann_${sym}_${f.accession || f.filedAt}_${f.kind}`,
      symbol: sym,
      kind: f.kind,
      title: f.title,
      filedAt: f.filedAt,
      source: "SEC EDGAR",
      form: f.form,
      accession: f.accession,
      metrics,
      ai: { summary: "", generatedAt: 0 },
      links: {
        edgar: f.url,
        yahooAnalysis: yahooAnalysisUrl(sym),
        ir: null,
      },
      createdAt: Date.now(),
      ...(backfill ? { notified: { telegramAt: null, emailAt: null } } : {}),
    };
    const res = await commitCard(card, dedupeKey, notify, {
      deepEnrich: opts.deepEnrich !== false,
    });
    if (res.inserted && res.card) inserted.push(res.card);
  }
  return { symbol: sym, inserted, backfill, notified: notify };
}

/**
 * @param {string} symbol
 * @param {{ notify?: boolean }} [opts]
 */
export async function scanConsensusForSymbol(symbol, opts = {}) {
  const sym = String(symbol ?? "")
    .trim()
    .toUpperCase();
  const storeAtStart = loadUsAnnouncementStoreSync();
  const notify = shouldNotifyAnnouncement(opts.notify, storeAtStart, sym);
  const snap = await fetchYahooConsensusSnapshot(sym);
  let store = loadUsAnnouncementStoreSync();
  const prev = store.consensusSnapshots[sym] ?? null;

  const focusPeriod =
    snap.periods["0y"]?.epsAvg != null
      ? "0y"
      : snap.periods["+1y"]?.epsAvg != null
        ? "+1y"
        : snap.periods["0q"]?.epsAvg != null
          ? "0q"
          : null;

  const nextPeriod = focusPeriod ? snap.periods[focusPeriod] : null;
  const prevPeriod =
    prev && focusPeriod ? prev.periods?.[focusPeriod] : null;

  store.consensusSnapshots[sym] = {
    at: Date.now(),
    forwardEps: snap.forwardEps,
    periods: snap.periods,
  };
  saveUsAnnouncementStoreSync(store);

  // 첫 스냅샷(백필): 기준선만 저장, 카드·알림 없음
  if (!prev || !focusPeriod || !nextPeriod) {
    return { symbol: sym, inserted: [], baselineOnly: !prev };
  }

  if (!consensusEpsChangedEnough(prevPeriod, nextPeriod, CONSENSUS_MIN_PCT)) {
    const fwdChanged =
      prev.forwardEps != null &&
      snap.forwardEps != null &&
      Math.abs(
        pctChange(snap.forwardEps, prev.forwardEps) ?? 0,
      ) >= CONSENSUS_MIN_PCT;
    if (!fwdChanged) return { symbol: sym, inserted: [] };
  }

  // 아직 백필 전이면 기준 갱신만 하고 컨센 변경 카드/알림 생략
  if (!isSymbolAnnouncementPrimed(storeAtStart, sym)) {
    return { symbol: sym, inserted: [], backfillSkip: true };
  }

  const consensusEps =
    nextPeriod?.epsAvg ?? snap.forwardEps ?? null;
  const priorConsensusEps =
    prevPeriod?.epsAvg ?? prev.forwardEps ?? null;
  const changePct = pctChange(consensusEps, priorConsensusEps);
  const dayKey = new Date().toISOString().slice(0, 10);
  const dedupeKey = buildAnnouncementDedupeKey(
    sym,
    "consensus",
    `${focusPeriod}|${dayKey}|${consensusEps}`,
  );

  const metrics = buildAnnouncementMetrics({
    kind: "consensus",
    symbol: sym,
    ...metricsFromYahooSnapshot("consensus", snap, {
      priorQuarterEpsAvg: prev?.periods?.["0q"]?.epsAvg ?? null,
      priorForwardEps: prev?.forwardEps ?? null,
    }),
    consensusEps,
    priorConsensusEps,
    consensusChangePct: changePct,
    period: focusPeriod,
  });
  metrics.numAnalysts = nextPeriod?.numAnalysts ?? null;
  if (!metrics.consensusChangeLabel && changePct != null) {
    metrics.consensusChangeLabel = `컨센 EPS(${focusPeriod}) 직전 → 현재`;
  }

  const card = {
    id: `ann_${sym}_consensus_${dayKey}_${focusPeriod}`,
    symbol: sym,
    kind: /** @type {const} */ ("consensus"),
    title: `${sym} 컨센서스 ${focusPeriod} EPS ${changePct != null && changePct >= 0 ? "상향" : "하향"} (${changePct ?? "—"}%)`,
    filedAt: Date.now(),
    source: "Yahoo Finance",
    form: null,
    accession: null,
    metrics,
    ai: { summary: "", generatedAt: 0 },
    links: {
      edgar: null,
      yahooAnalysis: yahooAnalysisUrl(sym),
      ir: null,
    },
    createdAt: Date.now(),
  };

  const res = await commitCard(card, dedupeKey, notify);
  return {
    symbol: sym,
    inserted: res.inserted && res.card ? [res.card] : [],
  };
}

/**
 * @param {{
 *   notify?: boolean;
 *   symbols?: string[];
 *   sinceMs?: number;
 *   historyImport?: boolean;
 *   historyDays?: number;
 *   filingLimit?: number;
 * }} [opts]
 */
export async function tickUsAnnouncementInbox(opts = {}) {
  const historyImport = opts.historyImport === true;
  const historyDays = Math.min(
    730,
    Math.max(14, Number(opts.historyDays) || (historyImport ? 180 : 14)),
  );
  const sinceMs =
    Number(opts.sinceMs) ||
    Date.now() - historyDays * 24 * 60 * 60 * 1000;
  const filingLimit = historyImport
    ? Math.min(80, Math.max(20, Number(opts.filingLimit) || 40))
    : Math.min(40, Math.max(8, Number(opts.filingLimit) || 15));

  if (historyImport) {
    try {
      let store = loadUsAnnouncementStoreSync();
      dedupeRegisteredAnnouncementCards(store);
      saveUsAnnouncementStoreSync(store);
    } catch {
      /* ignore */
    }
  } else {
    try {
      await cleanupAndEnrichAnnouncementInbox({ limit: 24, force: false });
    } catch (e) {
      liveTradeLogWarn(
        "[us-announcement] cleanup skip",
        e instanceof Error ? e.message : e,
      );
    }
  }

  const store = loadUsAnnouncementStoreSync();
  const symbols = (
    Array.isArray(opts.symbols) && opts.symbols.length
      ? opts.symbols
      : store.watchlist
  )
    .map((s) => String(s).trim().toUpperCase())
    .filter(Boolean);

  /** @type {import("./us-announcement-inbox-store.js").UsAnnouncementCard[]} */
  const allInserted = [];
  const errors = [];
  let backfilled = 0;
  let notifiedInserts = 0;

  for (const sym of symbols) {
    const wasPrimed = isSymbolAnnouncementPrimed(
      loadUsAnnouncementStoreSync(),
      sym,
    );
    try {
      const a = await scanSecFilingsForSymbol(sym, {
        notify: opts.notify,
        sinceMs,
        filingLimit,
        deepEnrich: !historyImport,
        forceNotifyOff: historyImport,
      });
      allInserted.push(...a.inserted);
      if (a.backfill || historyImport) backfilled += a.inserted.length;
      else notifiedInserts += a.notified ? a.inserted.length : 0;
    } catch (e) {
      errors.push({ symbol: sym, stage: "edgar", error: String(e?.message ?? e) });
      liveTradeLogWarn(
        "[us-announcement] edgar scan",
        sym,
        e instanceof Error ? e.message : e,
      );
    }
    try {
      const b = await scanConsensusForSymbol(sym, {
        notify: historyImport ? false : opts.notify,
      });
      allInserted.push(...b.inserted);
      if (wasPrimed && b.inserted.length && !historyImport) {
        notifiedInserts +=
          opts.notify === false ? 0 : b.inserted.length;
      }
    } catch (e) {
      errors.push({
        symbol: sym,
        stage: "consensus",
        error: String(e?.message ?? e),
      });
      liveTradeLogWarn(
        "[us-announcement] consensus scan",
        sym,
        e instanceof Error ? e.message : e,
      );
    }

    let s = loadUsAnnouncementStoreSync();
    if (!isSymbolAnnouncementPrimed(s, sym)) {
      s = markSymbolAnnouncementPrimed(s, sym);
      saveUsAnnouncementStoreSync(s);
      liveTradeLogInfo("[us-announcement] primed (silent backfill)", sym);
    }
  }

  if (historyImport && allInserted.length) {
    try {
      await cleanupAndEnrichAnnouncementInbox({
        limit: Math.min(20, allInserted.length),
        force: false,
      });
    } catch {
      /* optional deep enrich */
    }
  }

  liveTradeLogInfo(
    "[us-announcement] tick done",
    `symbols=${symbols.length}`,
    `inserted=${allInserted.length}`,
    `backfill=${backfilled}`,
    `history=${historyImport ? historyDays : 0}`,
    `errors=${errors.length}`,
  );

  return {
    ok: true,
    watched: symbols.length,
    inserted: allInserted.length,
    backfilled,
    historyImport,
    historyDays: historyImport ? historyDays : null,
    cards: allInserted,
    errors,
    updatedAt: Date.now(),
  };
}

/**
 * 테스트·백테스트용 — 네트워크 없이 카드 삽입
 * @param {Partial<import("./us-announcement-inbox-store.js").UsAnnouncementCard> & { symbol: string; kind: import("./us-announcement-inbox-store.js").UsAnnouncementKind; title: string }} partial
 * @param {{ notify?: boolean; dedupeKey?: string }} [opts]
 */
export async function seedUsAnnouncementCard(partial, opts = {}) {
  const sym = String(partial.symbol).trim().toUpperCase();
  const kind = partial.kind;
  const metrics = buildAnnouncementMetrics({
    kind,
    symbol: sym,
    ...(partial.metrics || {}),
  });
  const dedupeKey =
    opts.dedupeKey ||
    buildAnnouncementDedupeKey(
      sym,
      kind,
      partial.accession || `title:${String(partial.title).trim().toLowerCase()}`,
    );
  const card = {
    id: partial.id || `ann_seed_${sym}_${Date.now()}`,
    symbol: sym,
    kind,
    title: partial.title,
    filedAt: partial.filedAt || Date.now(),
    source: partial.source || "seed",
    form: partial.form ?? null,
    accession: partial.accession ?? null,
    metrics,
    ai: { summary: "", generatedAt: 0 },
    links: {
      edgar: partial.links?.edgar ?? null,
      yahooAnalysis: partial.links?.yahooAnalysis ?? yahooAnalysisUrl(sym),
      ir: partial.links?.ir ?? null,
    },
    createdAt: Date.now(),
  };
  return commitCard(card, dedupeKey, opts.notify === true);
}

export function getUsAnnouncementInboxSnapshot() {
  const store = loadUsAnnouncementStoreSync();
  return {
    watchlist: store.watchlist,
    cards: store.cards,
    updatedAt: store.updatedAt,
    cardCount: store.cards.length,
  };
}

export function updateUsAnnouncementWatchlist(symbols) {
  let store = loadUsAnnouncementStoreSync();
  store = setWatchlistSync(store, symbols);
  saveUsAnnouncementStoreSync(store);
  return store.watchlist;
}

export function addUsAnnouncementWatchSymbol(symbol) {
  let store = loadUsAnnouncementStoreSync();
  store = addWatchSymbolSync(store, symbol);
  saveUsAnnouncementStoreSync(store);
  return store.watchlist;
}
