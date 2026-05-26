import { memo, useCallback, useEffect, useRef, useState } from "react";
import { fetchStockSearch, fetchStockSearchHot, fetchStockTechnical } from "../api";
import {
  resolvePickSignalIds,
  signalChipMeta,
} from "../constants/signalChips";
import { ko } from "../i18n/ko";
import type {
  Market,
  StockPick,
  StockSearchQuoteRow,
  StockTechnicalResponse,
} from "../types";
import PickQuoteStrip from "./PickQuoteStrip";
import { formatPercent, formatPrice, formatTurnover } from "../lib/format";
import { resolveUsQuoteDisplay } from "../lib/usQuoteDisplay";
import StockTechnicalAnalysisPanel, {
  type StockTechnicalAnalysisSlot,
} from "./StockTechnicalAnalysisPanel";

const HANGUL_RE = /[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7A3]/;
/** 검색 직후 기술분석 선로드 상한(나머지는 선택 시) */
const TECH_SEARCH_PREFETCH = 6;
const HOT_REFRESH_MS = 120_000;

function looksUsAlternateQuery(q: string) {
  return /[A-Za-z]/.test(q);
}

function looksKrAlternateQuery(q: string) {
  const t = q.trim();
  if (/^\d{1,6}$/.test(t)) return true;
  return HANGUL_RE.test(t);
}

type TechnicalSlot =
  | { status: "loading" }
  | { status: "ok"; data: StockTechnicalResponse }
  | { status: "err"; message?: string };

export interface StockSearchTabProps {
  market: Market;
  /** 실거래 등 외부에서 넘어온 심볼 — 검색창·결과 목록 자동 조회 */
  seedQuery?: string | null;
  selectedSymbol: string | null;
  /** 차트·선택 종목 — 검색창 바로 아래 고정 */
  selectedPick?: StockPick | null;
  onSelectPick: (pick: StockPick) => void;
  /** 교차 시장 검색으로 탭을 맞출 때 */
  onLookupMarketChange: (market: Market) => void;
  onNews: (pick: StockPick) => void;
  onReason: (pick: StockPick) => void;
  /** 스크리너와 동일 기술 점수·신호가 도착하면 현재 선택 종목만 병합(차트 재요청 방지) */
  onLookupPickPatch?: (patch: {
    symbol: string;
    market: Market;
    score: number;
    signalIds: string[];
    signals: string[];
  }) => void;
  usQuoteInKrw?: boolean;
  onToggleUsQuoteKrw?: () => void;
  usdKrwRate?: number | null;
  usdKrwValDate?: string | null;
}

function pickToQuoteRow(pick: StockPick): StockSearchQuoteRow {
  return {
    symbol: pick.symbol,
    name: pick.name,
    market: pick.market,
    nameKo: pick.nameKo,
    nameEn: pick.nameEn,
    price: pick.price,
    changePercent: pick.changePercent,
    currency: pick.currency,
    turnover: pick.turnover,
  };
}

function rowToPick(row: StockSearchQuoteRow): StockPick {
  const pick: StockPick = {
    symbol: row.symbol,
    name: row.name,
    market: row.market,
    score: 0,
    signals: [],
  };
  const koName = row.nameKo?.trim();
  const enName = row.nameEn?.trim();
  if (koName) pick.nameKo = koName;
  if (enName) pick.nameEn = enName;
  if (row.price != null && Number.isFinite(row.price)) pick.price = row.price;
  if (row.changePercent != null && Number.isFinite(row.changePercent)) {
    pick.changePercent = row.changePercent;
  }
  if (row.currency?.trim()) pick.currency = row.currency.trim();
  if (row.turnover != null && Number.isFinite(row.turnover) && row.turnover > 0) {
    pick.turnover = row.turnover;
  }
  return pick;
}

function mergeTechnical(
  base: StockPick,
  slot: TechnicalSlot | undefined,
): StockPick {
  if (!slot || slot.status === "loading") return base;
  if (slot.status === "err") return base;
  return {
    ...base,
    score: slot.data.score,
    signalIds: slot.data.signalIds,
    signals: slot.data.signals,
  };
}

function scoreDisplay(slot: TechnicalSlot | undefined): string | number {
  if (!slot || slot.status === "loading") return "…";
  if (slot.status === "err") return "—";
  return slot.data.score;
}

/** 검색창에 심볼만 넣고 Enter 했을 때 최소 `StockPick` 추정 */
function pickFromDirectInput(raw: string, market: Market): StockPick | null {
  const t = raw.trim();
  if (!t) return null;
  if (market === "kr") {
    if (/^\d{1,6}$/.test(t)) {
      const code = t.padStart(6, "0");
      return {
        symbol: `${code}.KS`,
        name: code,
        market: "kr",
        score: 0,
        signals: [],
      };
    }
    if (/^\d{6}\.(KS|KQ)$/i.test(t)) {
      const sym = t.toUpperCase();
      return { symbol: sym, name: sym, market: "kr", score: 0, signals: [] };
    }
  }
  const sym = t.toUpperCase().replace(/\s+/g, "");
  if (!/^[A-Z0-9.\-^]{1,24}$/.test(sym)) return null;
  return { symbol: sym, name: sym, market, score: 0, signals: [] };
}

function technicalSlotDigest(s: TechnicalSlot | undefined): string {
  if (!s) return "";
  if (s.status === "loading") return "L";
  if (s.status === "err") return `E:${s.message ?? ""}`;
  const d = s.data;
  return `O:${d.score}:${d.signalIds.join("|")}:${d.signals.join("|")}`;
}

function sameQuoteRow(a: StockSearchQuoteRow, b: StockSearchQuoteRow): boolean {
  if (a === b) return true;
  return (
    a.symbol === b.symbol &&
    a.name === b.name &&
    a.price === b.price &&
    a.changePercent === b.changePercent &&
    (a.currency ?? "") === (b.currency ?? "") &&
    a.turnover === b.turnover
  );
}

function StockSearchHotRow({
  row,
  isActive,
  onSelectPick,
  usQuoteInKrw = false,
  usdKrwRate = null,
}: {
  row: StockSearchQuoteRow;
  isActive: boolean;
  onSelectPick: (pick: StockPick) => void;
  usQuoteInKrw?: boolean;
  usdKrwRate?: number | null;
}) {
  const pick = rowToPick(row);
  const hasPrice = row.price != null && Number.isFinite(row.price);
  const quoteDisplay = resolveUsQuoteDisplay(
    row.price,
    row.currency,
    row.market,
    usQuoteInKrw,
    usdKrwRate ?? null,
  );
  const chg = row.changePercent;
  const chgUp = chg != null && chg >= 0;
  const code = row.symbol.replace(/\.(KS|KQ)$/i, "");
  const cur = quoteDisplay.currency ?? row.currency ?? undefined;
  const turnoverDisplay = resolveUsQuoteDisplay(
    row.turnover,
    row.currency,
    row.market,
    usQuoteInKrw,
    usdKrwRate ?? null,
  );

  return (
    <li
      className={isActive ? "stock-hot-item stock-hot-item--active" : "stock-hot-item"}
    >
      <button
        type="button"
        className="stock-hot-item__btn"
        onClick={() => onSelectPick(pick)}
      >
        <span className="stock-hot-item__identity">
          <span className="stock-hot-item__name" title={row.name}>
            {row.name}
          </span>
          <span className="stock-hot-item__code">{code}</span>
        </span>
        {hasPrice ? (
          <>
            {row.turnover != null &&
            Number.isFinite(row.turnover) &&
            row.turnover > 0 ? (
              <span className="stock-hot-item__turnover" title={ko.app.pickTurnoverTitle}>
                {formatTurnover(
                  turnoverDisplay.price ?? undefined,
                  turnoverDisplay.currency ?? cur,
                  { plainSymbols: true },
                )}
              </span>
            ) : null}
            <span className="stock-hot-item__quote">
              <span className="stock-hot-item__price">
                {formatPrice(quoteDisplay.price ?? undefined, cur)}
              </span>
              {chg != null && Number.isFinite(chg) ? (
                <span
                  className={
                    chgUp
                      ? "stock-hot-item__chg stock-hot-item__chg--up"
                      : "stock-hot-item__chg stock-hot-item__chg--down"
                  }
                >
                  {formatPercent(chg)}
                </span>
              ) : null}
            </span>
          </>
        ) : (
          <span className="stock-hot-item__pending">{ko.app.stockLookupQuotePending}</span>
        )}
      </button>
    </li>
  );
}

interface StockSearchPickRowProps {
  row: StockSearchQuoteRow;
  slot: TechnicalSlot | undefined;
  isActive: boolean;
  analysisOpen: boolean;
  onSelectPick: (pick: StockPick) => void;
  onNews: (pick: StockPick) => void;
  onReason: (pick: StockPick) => void;
  onAnalyze: (row: StockSearchQuoteRow) => void;
  usQuoteInKrw?: boolean;
  usdKrwRate?: number | null;
}

const StockSearchPickRow = memo(
  function StockSearchPickRow({
    row,
    slot,
    isActive,
    analysisOpen,
    onSelectPick,
    onNews,
    onReason,
    onAnalyze,
    usQuoteInKrw = false,
    usdKrwRate = null,
  }: StockSearchPickRowProps) {
    const pick = mergeTechnical(rowToPick(row), slot);
    const signalIds = resolvePickSignalIds(pick);
    const hasPrice = row.price != null && Number.isFinite(row.price);
    const quoteDisplay = resolveUsQuoteDisplay(
      row.price,
      row.currency,
      row.market,
      usQuoteInKrw,
      usdKrwRate ?? null,
    );
    const turnoverDisplay = resolveUsQuoteDisplay(
      pick.turnover,
      row.currency,
      row.market,
      usQuoteInKrw,
      usdKrwRate ?? null,
    );

    return (
      <li className={isActive ? "pick-item active" : "pick-item"}>
        <button
          type="button"
          className="pick-row"
          onClick={() => onSelectPick(pick)}
        >
          <div className="pick-head">
            <span className="pick-name" title={row.name}>
              {row.name}
            </span>
            <span className="pick-score">{scoreDisplay(slot)}</span>
          </div>
          {hasPrice ? (
            <div className="stock-search-tab__quote-line">
              <PickQuoteStrip
                symbol={row.symbol}
                price={quoteDisplay.price}
                currency={quoteDisplay.currency}
                changePercent={row.changePercent}
                turnover={turnoverDisplay.price ?? pick.turnover}
              />
            </div>
          ) : (
            <span className="stock-search-tab__quote-pending">
              {ko.app.stockLookupQuotePending}
            </span>
          )}
          {signalIds.length > 0 && (
            <div className="pick-signals">
              {signalIds.map((id) => {
                const chip = signalChipMeta(id);
                return (
                  <span
                    key={id}
                    className={chip.className}
                    title={chip.label}
                  >
                    {chip.short}
                  </span>
                );
              })}
            </div>
          )}
        </button>
        <div className="pick-actions">
          <button
            type="button"
            className={
              analysisOpen
                ? "pick-action pick-action--analyze active"
                : "pick-action pick-action--analyze"
            }
            aria-pressed={analysisOpen}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onAnalyze(row);
            }}
          >
            <span className="pick-action__icon" aria-hidden>
              ◈
            </span>
            {ko.app.stockLookupAnalysis}
          </button>
          <button
            type="button"
            className="pick-action pick-action--reason"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onReason(pick);
            }}
          >
            <span className="pick-action__icon" aria-hidden>
              ◆
            </span>
            이유
          </button>
          <button
            type="button"
            className="pick-action pick-action--news"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onNews(pick);
            }}
          >
            <span className="pick-action__icon" aria-hidden>
              ▸
            </span>
            뉴스
          </button>
        </div>
      </li>
    );
  },
  (prev, next) =>
    prev.isActive === next.isActive &&
    sameQuoteRow(prev.row, next.row) &&
    technicalSlotDigest(prev.slot) === technicalSlotDigest(next.slot) &&
    prev.onSelectPick === next.onSelectPick &&
    prev.analysisOpen === next.analysisOpen &&
    prev.onNews === next.onNews &&
    prev.onReason === next.onReason &&
    prev.onAnalyze === next.onAnalyze &&
    prev.usQuoteInKrw === next.usQuoteInKrw &&
    prev.usdKrwRate === next.usdKrwRate &&
    prev.usdKrwValDate === next.usdKrwValDate,
);

export default function StockSearchTab({
  market,
  seedQuery = null,
  selectedSymbol,
  selectedPick = null,
  onSelectPick,
  onLookupMarketChange,
  onNews,
  onReason,
  onLookupPickPatch,
  usQuoteInKrw = false,
  onToggleUsQuoteKrw,
  usdKrwRate = null,
  usdKrwValDate = null,
}: StockSearchTabProps) {
  const [input, setInput] = useState("");
  const [debounced, setDebounced] = useState("");
  const [quotes, setQuotes] = useState<StockSearchQuoteRow[]>([]);
  const [hotQuotes, setHotQuotes] = useState<StockSearchQuoteRow[]>([]);
  const [hotLoading, setHotLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [techBySym, setTechBySym] = useState<Record<string, TechnicalSlot>>({});
  const [analysisTarget, setAnalysisTarget] = useState<{
    symbol: string;
    name: string;
  } | null>(null);
  const [analysisSlot, setAnalysisSlot] =
    useState<StockTechnicalAnalysisSlot | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const analysisAbortRef = useRef<AbortController | null>(null);
  const selectedSymRef = useRef<string | null>(null);
  selectedSymRef.current = selectedSymbol;

  useEffect(() => {
    const q = seedQuery?.trim();
    if (!q) return;
    setInput(q);
    setDebounced(q);
  }, [seedQuery]);

  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(input.trim()), 260);
    return () => window.clearTimeout(id);
  }, [input]);

  useEffect(() => {
    if (debounced.length >= 1) {
      setHotQuotes([]);
      setHotLoading(false);
      return;
    }

    const ac = new AbortController();
    setHotLoading(true);

    void (async () => {
      try {
        const data = await fetchStockSearchHot(market, ac.signal);
        if (ac.signal.aborted) return;
        setHotQuotes(data.quotes);
      } catch (err: unknown) {
        if (ac.signal.aborted) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        setHotQuotes([]);
      } finally {
        if (!ac.signal.aborted) setHotLoading(false);
      }
    })();

    const refreshId = window.setInterval(() => {
      void fetchStockSearchHot(market)
        .then((data) => setHotQuotes(data.quotes))
        .catch(() => {});
    }, HOT_REFRESH_MS);

    return () => {
      ac.abort();
      window.clearInterval(refreshId);
    };
  }, [debounced, market]);

  useEffect(() => {
    if (debounced.length < 1) {
      setQuotes([]);
      setError(null);
      setLoading(false);
      return;
    }

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const primary = await fetchStockSearch(debounced, market, ac.signal);
        if (ac.signal.aborted) return;
        if (primary.quotes.length > 0) {
          setQuotes(primary.quotes);
          return;
        }

        const alt: Market = market === "kr" ? "us" : "kr";
        const tryAlt =
          (market === "kr" && looksUsAlternateQuery(debounced)) ||
          (market === "us" && looksKrAlternateQuery(debounced));
        if (!tryAlt) {
          setQuotes([]);
          return;
        }

        const secondary = await fetchStockSearch(debounced, alt, ac.signal);
        if (ac.signal.aborted) return;
        if (secondary.quotes.length > 0) {
          onLookupMarketChange(alt);
          setQuotes(secondary.quotes);
        } else {
          setQuotes([]);
        }
      } catch (err: unknown) {
        if (ac.signal.aborted) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        setQuotes([]);
        setError(err instanceof Error ? err.message : ko.app.stockLookupError);
      } finally {
        if (!ac.signal.aborted) setLoading(false);
      }
    })();

    return () => ac.abort();
  }, [debounced, market, onLookupMarketChange]);

  const loadTechnicalForSymbol = useCallback(
    async (row: StockSearchQuoteRow, signal: AbortSignal) => {
      const sym = row.symbol.trim().toUpperCase();
      try {
        const data = await fetchStockTechnical(row.symbol, { signal });
        if (signal.aborted) return;
        setTechBySym((prev) => ({
          ...prev,
          [row.symbol]: { status: "ok", data },
        }));
        const sel = (selectedSymRef.current ?? "").trim().toUpperCase();
        if (
          onLookupPickPatch &&
          sel &&
          sel === sym
        ) {
          onLookupPickPatch({
            symbol: data.symbol,
            market: row.market,
            score: data.score,
            signalIds: data.signalIds,
            signals: data.signals,
          });
        }
      } catch (e: unknown) {
        if (signal.aborted) return;
        if (e instanceof DOMException && e.name === "AbortError") return;
        setTechBySym((prev) => ({
          ...prev,
          [row.symbol]: {
            status: "err",
            message: e instanceof Error ? e.message : "",
          },
        }));
      }
    },
    [onLookupPickPatch],
  );

  useEffect(() => {
    if (quotes.length === 0) {
      setTechBySym({});
      return;
    }

    const ac = new AbortController();
    const norm = (s: string) => s.trim().toUpperCase();
    const sel = norm(selectedSymRef.current ?? "");
    const prefetchRows: StockSearchQuoteRow[] = [];
    const seen = new Set<string>();
    for (const r of quotes.slice(0, TECH_SEARCH_PREFETCH)) {
      const k = norm(r.symbol);
      if (seen.has(k)) continue;
      seen.add(k);
      prefetchRows.push(r);
    }
    if (sel) {
      const hit = quotes.find((r) => norm(r.symbol) === sel);
      if (hit && !seen.has(sel)) prefetchRows.push(hit);
    }

    const init: Record<string, TechnicalSlot> = {};
    for (const r of prefetchRows) {
      init[r.symbol] = { status: "loading" };
    }
    setTechBySym(init);

    void (async () => {
      await Promise.all(
        prefetchRows.map((row) => loadTechnicalForSymbol(row, ac.signal)),
      );
    })();

    return () => ac.abort();
  }, [quotes, loadTechnicalForSymbol]);

  /** 선로드 밖 종목 선택 시 점수·신호만 추가 요청 */
  useEffect(() => {
    if (!selectedSymbol || quotes.length === 0) return;
    const norm = (s: string) => s.trim().toUpperCase();
    const sel = norm(selectedSymbol);
    const row = quotes.find((r) => norm(r.symbol) === sel);
    if (!row) return;
    const slot = techBySym[row.symbol];
    if (slot?.status === "ok" || slot?.status === "loading") return;

    const ac = new AbortController();
    setTechBySym((prev) => ({
      ...prev,
      [row.symbol]: { status: "loading" },
    }));
    void loadTechnicalForSymbol(row, ac.signal);
    return () => ac.abort();
  }, [selectedSymbol, quotes, techBySym, loadTechnicalForSymbol]);

  /** 검색 결과 첫 종목을 기본 선택(선택이 없거나 결과에 없을 때만) */
  useEffect(() => {
    if (quotes.length === 0) return;
    const norm = (s: string | null | undefined) => (s ?? "").trim().toUpperCase();
    const sel = norm(selectedSymbol);
    const still = sel && quotes.some((r) => norm(r.symbol) === sel);
    if (!still) {
      if (selectedSymbol) return;
      onSelectPick(rowToPick(quotes[0]));
    }
  }, [quotes, selectedSymbol, onSelectPick]);

  const tryDirectSubmit = useCallback(() => {
    const pick = pickFromDirectInput(input, market);
    if (pick) onSelectPick(pick);
  }, [input, market, onSelectPick]);

  const runAnalysis = useCallback((row: StockSearchQuoteRow) => {
    analysisAbortRef.current?.abort();
    const ac = new AbortController();
    analysisAbortRef.current = ac;
    setAnalysisTarget({ symbol: row.symbol, name: row.name });
    setAnalysisSlot({ status: "loading" });
    onSelectPick(mergeTechnical(rowToPick(row), techBySym[row.symbol]));
    void (async () => {
      try {
        const data = await fetchStockTechnical(row.symbol, { signal: ac.signal });
        if (ac.signal.aborted) return;
        setAnalysisSlot({ status: "ok", data });
        setTechBySym((prev) => ({
          ...prev,
          [row.symbol]: { status: "ok", data },
        }));
        const sym = row.symbol.trim().toUpperCase();
        const sel = (selectedSymRef.current ?? "").trim().toUpperCase();
        if (onLookupPickPatch && sel && sel === sym) {
          onLookupPickPatch({
            symbol: data.symbol,
            market: row.market,
            score: data.score,
            signalIds: data.signalIds,
            signals: data.signals,
          });
        }
      } catch (e: unknown) {
        if (ac.signal.aborted) return;
        if (e instanceof DOMException && e.name === "AbortError") return;
        setAnalysisSlot({
          status: "err",
          message: e instanceof Error ? e.message : "",
        });
      }
    })();
  }, [onLookupPickPatch, techBySym, onSelectPick]);

  const handleAnalyze = useCallback(
    (row: StockSearchQuoteRow) => {
      if (
        analysisTarget?.symbol === row.symbol &&
        analysisSlot != null
      ) {
        setAnalysisTarget(null);
        setAnalysisSlot(null);
        analysisAbortRef.current?.abort();
        return;
      }
      runAnalysis(row);
    },
    [analysisTarget?.symbol, analysisSlot, runAnalysis],
  );

  useEffect(() => () => analysisAbortRef.current?.abort(), []);

  const pinnedPick =
    selectedPick && selectedPick.market === market ? selectedPick : null;
  const pinnedSym = pinnedPick?.symbol.trim().toUpperCase() ?? "";
  const hotWithoutPinned = pinnedSym
    ? hotQuotes.filter((r) => r.symbol.trim().toUpperCase() !== pinnedSym)
    : hotQuotes;
  const quotesWithoutPinned = pinnedSym
    ? quotes.filter((r) => r.symbol.trim().toUpperCase() !== pinnedSym)
    : quotes;

  return (
    <div className="stock-search-tab">
      <div className="pick-toolbar stock-search-tab__toolbar">
        <input
          type="search"
          className="pick-search"
          placeholder={ko.app.stockLookupPlaceholder}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            if (quotes.length > 0) {
              const row = quotes[0];
              onSelectPick(mergeTechnical(rowToPick(row), techBySym[row.symbol]));
              return;
            }
            tryDirectSubmit();
          }}
          aria-label={ko.app.stockLookupAria}
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      {pinnedPick ? (
        <ul
          className="pick-list stock-search-tab__list stock-search-tab__selected-pin"
          aria-label={ko.app.stockLookupSelectedPin}
        >
          <StockSearchHotRow
            row={pickToQuoteRow(pinnedPick)}
            isActive
            onSelectPick={onSelectPick}
            usQuoteInKrw={usQuoteInKrw}
            usdKrwRate={usdKrwRate}
          />
        </ul>
      ) : null}
      {loading && (
        <p className="picks-empty picks-empty--muted">{ko.app.stockLookupLoading}</p>
      )}
      {!loading && error && (
        <p className="picks-empty picks-empty--warn" role="alert">
          {error}
        </p>
      )}
      {!loading && !error && debounced.length < 1 && (
        <>
          {hotLoading && hotWithoutPinned.length === 0 && !pinnedPick ? (
            <p className="picks-empty picks-empty--muted">
              {ko.app.stockLookupHotLoading}
            </p>
          ) : hotWithoutPinned.length > 0 ? (
            <>
              <ul className="pick-list stock-search-tab__list stock-search-tab__hot-list">
                {hotWithoutPinned.map((row) => (
                  <StockSearchHotRow
                    key={row.symbol}
                    row={row}
                    isActive={selectedSymbol === row.symbol}
                    onSelectPick={onSelectPick}
                    usQuoteInKrw={usQuoteInKrw}
                    usdKrwRate={usdKrwRate}
                  />
                ))}
              </ul>
            </>
          ) : !pinnedPick ? (
            <p className="picks-empty">{ko.app.stockLookupIdle}</p>
          ) : null}
        </>
      )}
      {!loading && !error && debounced.length >= 1 && quotes.length === 0 && (
        <p className="picks-empty">{ko.app.stockLookupNoHits}</p>
      )}
      {!loading && !error && quotesWithoutPinned.length > 0 && (
        <ul className="pick-list stock-search-tab__list">
          {quotesWithoutPinned.map((row) => (
            <StockSearchPickRow
              key={row.symbol}
              row={row}
              slot={techBySym[row.symbol]}
              isActive={selectedSymbol === row.symbol}
              analysisOpen={analysisTarget?.symbol === row.symbol}
              onSelectPick={onSelectPick}
              onNews={onNews}
              onReason={onReason}
              onAnalyze={handleAnalyze}
              usQuoteInKrw={usQuoteInKrw}
              usdKrwRate={usdKrwRate}
            />
          ))}
        </ul>
      )}
      {analysisTarget && analysisSlot && (
        <StockTechnicalAnalysisPanel
          symbol={analysisTarget.symbol}
          displayName={analysisTarget.name}
          slot={analysisSlot}
          onClose={() => {
            setAnalysisTarget(null);
            setAnalysisSlot(null);
            analysisAbortRef.current?.abort();
          }}
        />
      )}
    </div>
  );
}
