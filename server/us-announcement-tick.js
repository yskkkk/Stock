/**
 * 미국 발표 인박스 — 워치리스트 스캔·카드 생성
 */
import {
  addWatchSymbolSync,
  buildAnnouncementDedupeKey,
  hasSeenAnnouncementKey,
  insertAnnouncementCard,
  isSymbolAnnouncementPrimed,
  loadUsAnnouncementStoreSync,
  markSymbolAnnouncementPrimed,
  saveUsAnnouncementStoreSync,
  setWatchlistSync,
  shouldNotifyAnnouncement,
  shouldSendAnnouncementAlert,
  markAnnouncementNotified,
} from "./us-announcement-inbox-store.js";
import { fetchRecentSecFilingsForSymbol } from "./us-announcement-edgar.js";
import {
  consensusEpsChangedEnough,
  fetchYahooConsensusSnapshot,
} from "./us-announcement-consensus.js";
import {
  buildAnnouncementMetrics,
  generateAnnouncementAiSummary,
  pctChange,
} from "./us-announcement-analyze.js";
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
 */
async function commitCard(card, dedupeKey, notify = true) {
  let store = loadUsAnnouncementStoreSync();
  if (hasSeenAnnouncementKey(store, dedupeKey)) {
    return { inserted: false, card: null };
  }
  const ai = await generateAnnouncementAiSummary({
    kind: card.kind,
    symbol: card.symbol,
    title: card.title,
    metrics: card.metrics,
  });
  card.ai = {
    summary: ai.summary,
    generatedAt: Date.now(),
    engine: ai.engine,
  };
  const result = insertAnnouncementCard(store, card, dedupeKey);
  if (!result.inserted || !result.card) {
    return { inserted: false, card: null };
  }
  store = result.store;

  const alert = shouldSendAnnouncementAlert({
    notifyOpt: notify,
    store,
    symbol: result.card.symbol,
    kind: result.card.kind,
    form: result.card.form,
  });

  if (alert.send) {
    const notified = await notifyUsAnnouncementCard(result.card);
    result.card.notified = notified;
    if (alert.key && (notified.telegramAt || notified.emailAt)) {
      markAnnouncementNotified(store, alert.key);
    } else if (alert.key) {
      // 발송 시도는 했으나 채널 미설정 — 쿨다운만 걸어 중복 시도 폭주 방지
      markAnnouncementNotified(store, alert.key);
    }
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
 * @param {string} symbol
 * @param {{ notify?: boolean; sinceMs?: number }} [opts]
 */
export async function scanSecFilingsForSymbol(symbol, opts = {}) {
  const sym = String(symbol ?? "")
    .trim()
    .toUpperCase();
  const storeAtStart = loadUsAnnouncementStoreSync();
  const notify = shouldNotifyAnnouncement(opts.notify, storeAtStart, sym);
  const backfill = !isSymbolAnnouncementPrimed(storeAtStart, sym);
  const pack = await fetchRecentSecFilingsForSymbol(sym, {
    limit: 15,
    sinceMs: opts.sinceMs,
  });
  /** @type {import("./us-announcement-inbox-store.js").UsAnnouncementCard[]} */
  const inserted = [];
  for (const f of pack.filings) {
    const dedupeKey = buildAnnouncementDedupeKey(
      sym,
      f.kind,
      f.accession || `${f.form}|${f.filedAt}`,
    );
    const store = loadUsAnnouncementStoreSync();
    if (hasSeenAnnouncementKey(store, dedupeKey)) continue;

    let metrics = buildAnnouncementMetrics({
      kind: f.kind,
      symbol: sym,
    });
    try {
      const snap = await fetchYahooConsensusSnapshot(sym);
      metrics = buildAnnouncementMetrics({
        kind: f.kind,
        symbol: sym,
        consensusEps: snap.forwardEps,
        trailingEps: snap.trailingEps,
        period: "0y",
      });
    } catch {
      /* consensus optional for filings */
    }

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
    const res = await commitCard(card, dedupeKey, notify);
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
    consensusEps,
    priorConsensusEps,
    trailingEps: snap.trailingEps,
    consensusChangePct: changePct,
    period: focusPeriod,
  });
  metrics.numAnalysts = nextPeriod?.numAnalysts ?? null;

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
 * @param {{ notify?: boolean; symbols?: string[]; sinceMs?: number }} [opts]
 */
export async function tickUsAnnouncementInbox(opts = {}) {
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
        sinceMs: opts.sinceMs,
      });
      allInserted.push(...a.inserted);
      if (a.backfill) backfilled += a.inserted.length;
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
      const b = await scanConsensusForSymbol(sym, { notify: opts.notify });
      allInserted.push(...b.inserted);
      if (wasPrimed && b.inserted.length) {
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

    // 기존 공시·컨센 기준선 등록 완료 → 이후 신규만 알림
    let s = loadUsAnnouncementStoreSync();
    if (!isSymbolAnnouncementPrimed(s, sym)) {
      s = markSymbolAnnouncementPrimed(s, sym);
      saveUsAnnouncementStoreSync(s);
      liveTradeLogInfo("[us-announcement] primed (silent backfill)", sym);
    }
  }

  liveTradeLogInfo(
    "[us-announcement] tick done",
    `symbols=${symbols.length}`,
    `inserted=${allInserted.length}`,
    `backfill=${backfilled}`,
    `errors=${errors.length}`,
  );

  return {
    ok: true,
    watched: symbols.length,
    inserted: allInserted.length,
    backfilled,
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
      partial.accession || partial.id || `${partial.title}|${Date.now()}`,
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
