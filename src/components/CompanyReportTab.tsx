import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  deleteCompanyReport,
  fetchCompanyReport,
  fetchCompanyReports,
  fetchStockSearch,
  generateCompanyReport,
  type CompanyReport,
  type CompanyReportListItem,
} from "../api";
import { ko } from "../i18n/ko";
import { formatPercent, formatPrice } from "../lib/format";
import type { Market, StockSearchQuoteRow } from "../types";
import {
  loadStockSearchHot,
  peekStockSearchHotPrefetch,
} from "../lib/tabPrefetch";
import CompanyReportChartView from "./CompanyReportChartView";
import "./company-report-tab.css";

const HANGUL_RE = /[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7A3]/;

function looksUsAlternateQuery(q: string) {
  return /[A-Za-z]/.test(q);
}

function looksKrAlternateQuery(q: string) {
  const t = q.trim();
  if (/^\d{1,6}$/.test(t)) return true;
  return HANGUL_RE.test(t);
}

function formatWhen(ms: number) {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  try {
    return new Date(ms).toLocaleString("ko-KR", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

function splitParas(text: string | null | undefined): string[] {
  const raw = String(text ?? "").trim();
  if (!raw) return [];
  return raw
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

type ReportBlock = { heading?: string; paras: string[] };

function parseReportBlocks(text: string | null | undefined): ReportBlock[] {
  const raw = String(text ?? "").trim();
  if (!raw) return [];
  if (!/^##\s/m.test(raw)) {
    return [{ paras: splitParas(raw) }];
  }
  return raw
    .split(/\n(?=##\s)/)
    .map((part) => {
      const lines = part.split("\n");
      const first = lines[0] ?? "";
      const m = first.match(/^##\s+(.+)$/);
      if (m) {
        return {
          heading: m[1].trim(),
          paras: splitParas(lines.slice(1).join("\n")),
        };
      }
      return { paras: splitParas(part) };
    })
    .filter((b) => b.heading || b.paras.length);
}

function renderParas(paras: string[]): ReactNode[] {
  const nodes: ReactNode[] = [];
  let i = 0;
  while (i < paras.length) {
    const m = paras[i].match(/^\d+[.)]\s+(.+)$/);
    if (m) {
      const items: string[] = [];
      while (i < paras.length) {
        const nm = paras[i].match(/^\d+[.)]\s+(.+)$/);
        if (!nm) break;
        items.push(nm[1].trim());
        i += 1;
      }
      nodes.push(
        <ol key={`ol-${items[0]?.slice(0, 24) ?? i}`} className="co-report__list">
          {items.map((item) => (
            <li key={item.slice(0, 64)}>{item}</li>
          ))}
        </ol>,
      );
      continue;
    }
    nodes.push(
      <p key={paras[i].slice(0, 64)} className="co-report__p">
        {paras[i]}
      </p>,
    );
    i += 1;
  }
  return nodes;
}

function sectionAnchorId(heading: string): string {
  const slug = String(heading)
    .trim()
    .replace(/[^\w가-힣·\-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 72);
  return `co-report-sec-${slug || "x"}`;
}

function tocTargetHeading(line: string): string | null {
  const t = String(line ?? "").trim();
  if (!t) return null;
  const m = t.match(/^\d+[.)]\s*(.+)$/);
  return (m?.[1] ?? t).trim() || null;
}

function scrollToSection(heading: string) {
  const el = document.getElementById(sectionAnchorId(heading));
  if (!el) return;
  const bar = document.querySelector(".co-report__page-bar");
  const offset =
    bar instanceof HTMLElement ? bar.getBoundingClientRect().height + 8 : 12;
  const top = el.getBoundingClientRect().top + window.scrollY - offset;
  window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
}

export default function CompanyReportTab() {
  const [market, setMarket] = useState<Market>("us");
  const [input, setInput] = useState("");
  const [debounced, setDebounced] = useState("");
  const [quotes, setQuotes] = useState<StockSearchQuoteRow[]>([]);
  const [hotQuotes, setHotQuotes] = useState<StockSearchQuoteRow[]>(
    () => peekStockSearchHotPrefetch(market) ?? [],
  );
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchErr, setSearchErr] = useState<string | null>(null);

  const [reports, setReports] = useState<CompanyReportListItem[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listErr, setListErr] = useState<string | null>(null);

  const [generating, setGenerating] = useState(false);
  const [genErr, setGenErr] = useState<string | null>(null);
  const [genStatus, setGenStatus] = useState<string | null>(null);

  const [selected, setSelected] = useState<CompanyReport | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const searchAbortRef = useRef<AbortController | null>(null);

  const loadList = useCallback(async () => {
    setListErr(null);
    try {
      const res = await fetchCompanyReports({ limit: 100 });
      setReports(res.reports);
    } catch (e) {
      setListErr(e instanceof Error ? e.message : ko.companyReport.loadFail);
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(input.trim()), 280);
    return () => window.clearTimeout(t);
  }, [input]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const rows = await loadStockSearchHot(market);
        if (!cancelled) setHotQuotes(rows);
      } catch {
        if (!cancelled) setHotQuotes([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [market]);

  useEffect(() => {
    searchAbortRef.current?.abort();
    if (debounced.length < 1) {
      setQuotes([]);
      setSearchLoading(false);
      setSearchErr(null);
      return;
    }
    const ac = new AbortController();
    searchAbortRef.current = ac;
    setSearchLoading(true);
    setSearchErr(null);
    void (async () => {
      try {
        const primary = await fetchStockSearch(debounced, market, ac.signal, {
          lite: true,
        });
        let rows = primary.quotes ?? [];
        const altMarket: Market | null =
          market === "kr" && looksUsAlternateQuery(debounced)
            ? "us"
            : market === "us" && looksKrAlternateQuery(debounced)
              ? "kr"
              : null;
        if (altMarket && rows.length < 4) {
          try {
            const alt = await fetchStockSearch(debounced, altMarket, ac.signal, {
              lite: true,
            });
            const seen = new Set(rows.map((r) => r.symbol.toUpperCase()));
            for (const r of alt.quotes ?? []) {
              const k = r.symbol.toUpperCase();
              if (seen.has(k)) continue;
              seen.add(k);
              rows.push(r);
            }
          } catch {
            /* ignore alt */
          }
        }
        if (!ac.signal.aborted) setQuotes(rows);
      } catch (e) {
        if (ac.signal.aborted) return;
        setQuotes([]);
        setSearchErr(
          e instanceof Error ? e.message : ko.companyReport.searchFail,
        );
      } finally {
        if (!ac.signal.aborted) setSearchLoading(false);
      }
    })();
    return () => ac.abort();
  }, [debounced, market]);

  const listRows = debounced.length >= 1 ? quotes : hotQuotes;

  const openReport = useCallback(async (id: string) => {
    setDetailLoading(true);
    setGenErr(null);
    try {
      const res = await fetchCompanyReport(id);
      setSelected(res.report);
    } catch (e) {
      setGenErr(e instanceof Error ? e.message : ko.companyReport.openFail);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const onGenerate = useCallback(
    async (row: StockSearchQuoteRow) => {
      const sym = String(row.symbol ?? "").trim();
      if (!sym) return;
      setGenerating(true);
      setGenErr(null);
      setGenStatus(
        ko.companyReport.generating.replace("{sym}", sym.toUpperCase()),
      );
      try {
        const res = await generateCompanyReport({
          symbol: sym,
          name: row.name,
          market: row.market === "kr" ? "kr" : "us",
        });
        setSelected(res.report);
        await loadList();
        setGenStatus(ko.companyReport.generateDone);
      } catch (e) {
        setGenErr(
          e instanceof Error ? e.message : ko.companyReport.generateFail,
        );
        setGenStatus(null);
      } finally {
        setGenerating(false);
      }
    },
    [loadList],
  );

  const onDelete = useCallback(
    async (id: string) => {
      if (!window.confirm(ko.companyReport.deleteConfirm)) return;
      try {
        await deleteCompanyReport(id);
        if (selected?.id === id) setSelected(null);
        await loadList();
      } catch (e) {
        setGenErr(e instanceof Error ? e.message : ko.companyReport.deleteFail);
      }
    },
    [loadList, selected?.id],
  );

  const blocks = useMemo(
    () => parseReportBlocks(selected?.body),
    [selected?.body],
  );

  if (selected) {
    return (
      <div className="co-report co-report--page">
        <div className="co-report__page-bar">
          <button
            type="button"
            className="co-report__btn co-report__btn--back"
            onClick={() => setSelected(null)}
          >
            {ko.companyReport.backToList}
          </button>
          <div className="co-report__page-bar-meta">
            <span className="co-report__sym">{selected.symbol}</span>
            <span className="co-report__market">
              {selected.market === "kr" ? "KR" : "US"}
            </span>
          </div>
          <button
            type="button"
            className="co-report__btn co-report__btn--danger"
            onClick={() => void onDelete(selected.id)}
          >
            {ko.companyReport.delete}
          </button>
        </div>
        <article className="co-report__page" aria-labelledby="co-report-title">
          <header className="co-report__page-head">
            <p className="co-report__page-meta">
              {formatWhen(selected.createdAt)}
              {selected.sources?.length
                ? ` · ${selected.sources.join(", ")}`
                : ""}
            </p>
            <h2 id="co-report-title" className="co-report__page-title">
              {selected.title}
            </h2>
            {selected.summary ? (
              <p className="co-report__page-lead">{selected.summary}</p>
            ) : null}
          </header>
          <div className="co-report__page-body">
            {blocks.length ? (
              blocks.map((block, i) => {
                const isToc = block.heading === "목차";
                return (
                  <section
                    key={`${block.heading ?? "p"}-${i}`}
                    id={
                      block.heading && !isToc
                        ? sectionAnchorId(block.heading)
                        : undefined
                    }
                    className={
                      isToc
                        ? "co-report__block co-report__block--toc"
                        : "co-report__block"
                    }
                  >
                    {block.heading ? (
                      <h3 className="co-report__h">{block.heading}</h3>
                    ) : null}
                    {!isToc && block.heading
                      ? (selected.charts ?? [])
                          .filter((c) => c.section === block.heading)
                          .map((c) => (
                            <CompanyReportChartView key={c.id} chart={c} />
                          ))
                      : null}
                    {isToc ? (
                      <div className="co-report__toc">
                        <p className="co-report__toc-hint">
                          {ko.companyReport.tocHint}
                        </p>
                        {block.paras.map((para, ti) => {
                          const target = tocTargetHeading(para);
                          if (!target) return null;
                          const num = para.match(/^(\d+)[.)]/)?.[1];
                          return (
                            <button
                              key={`toc-${ti}-${target}`}
                              type="button"
                              className="co-report__toc-link"
                              onClick={() => scrollToSection(target)}
                            >
                              {num ? (
                                <span className="co-report__toc-num" aria-hidden>
                                  {num}
                                </span>
                              ) : null}
                              <span>{target}</span>
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="co-report__content">
                        {renderParas(block.paras)}
                      </div>
                    )}
                  </section>
                );
              })
            ) : (
              <p className="co-report__p">{ko.companyReport.bodyEmpty}</p>
            )}
          </div>
        </article>
      </div>
    );
  }

  return (
    <div className="co-report">
      <header className="co-report__header">
        <div>
          <h2 className="co-report__title">{ko.companyReport.title}</h2>
          <p className="co-report__sub">{ko.companyReport.subtitle}</p>
        </div>
        <button
          type="button"
          className="co-report__btn"
          disabled={listLoading || generating}
          onClick={() => {
            setListLoading(true);
            void loadList();
          }}
        >
          {ko.companyReport.reload}
        </button>
      </header>

      {(genErr || listErr || genStatus || generating || detailLoading) && (
        <div className="co-report__status" role="status">
          {genErr ? <p className="co-report__err">{genErr}</p> : null}
          {listErr ? <p className="co-report__err">{listErr}</p> : null}
          {genStatus && !genErr ? (
            <p className="co-report__hint">{genStatus}</p>
          ) : null}
          {generating || detailLoading ? (
            <p className="co-report__hint">{ko.companyReport.pleaseWait}</p>
          ) : null}
        </div>
      )}

      <div className="co-report__layout">
        <aside className="co-report__side">
          <section
            className="co-report__search card"
            aria-label={ko.companyReport.searchLabel}
          >
            <div className="panel-head">
              <h3 className="panel-title">{ko.companyReport.searchLabel}</h3>
              <div className="co-report__market-toggle" role="group">
                <button
                  type="button"
                  className={
                    market === "kr"
                      ? "co-report__chip co-report__chip--active"
                      : "co-report__chip"
                  }
                  onClick={() => setMarket("kr")}
                >
                  KR
                </button>
                <button
                  type="button"
                  className={
                    market === "us"
                      ? "co-report__chip co-report__chip--active"
                      : "co-report__chip"
                  }
                  onClick={() => setMarket("us")}
                >
                  US
                </button>
              </div>
            </div>
            <div className="co-report__search-body">
              <label className="co-report__sr" htmlFor="co-report-search">
                {ko.companyReport.searchPlaceholder}
              </label>
              <input
                id="co-report-search"
                className="co-report__input"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={ko.companyReport.searchPlaceholder}
                autoComplete="off"
                disabled={generating}
              />
              {searchErr ? <p className="co-report__err">{searchErr}</p> : null}
              <ul className="co-report__quote-list">
                {searchLoading ? (
                  <li className="co-report__empty">{ko.companyReport.searching}</li>
                ) : listRows.length === 0 ? (
                  <li className="co-report__empty">
                    {debounced
                      ? ko.companyReport.searchEmpty
                      : ko.companyReport.hotHint}
                  </li>
                ) : (
                  listRows.slice(0, 24).map((row) => {
                    const code = row.symbol.replace(/\.(KS|KQ)$/i, "");
                    const name = row.nameKo?.trim() || row.name;
                    return (
                      <li
                        key={`${row.market}-${row.symbol}`}
                        className="co-report__quote-item"
                      >
                        <button
                          type="button"
                          className="co-report__quote-main"
                          disabled={generating}
                          onClick={() => void onGenerate(row)}
                        >
                          <span className="co-report__quote-code">{code}</span>
                          <span className="co-report__quote-name">{name}</span>
                          <span className="co-report__quote-px">
                            {row.price != null
                              ? formatPrice(row.price, row.currency)
                              : "—"}
                            {row.changePercent != null
                              ? ` ${formatPercent(row.changePercent)}`
                              : ""}
                          </span>
                        </button>
                        <button
                          type="button"
                          className="co-report__btn co-report__btn--primary"
                          disabled={generating}
                          onClick={() => void onGenerate(row)}
                        >
                          {generating
                            ? ko.companyReport.generatingShort
                            : ko.companyReport.generate}
                        </button>
                      </li>
                    );
                  })
                )}
              </ul>
            </div>
          </section>
        </aside>

        <main className="co-report__main">
          <h3 className="co-report__list-title">
            {ko.companyReport.listTitle}
            {!listLoading ? (
              <span className="co-report__count">
                {ko.companyReport.count.replace("{n}", String(reports.length))}
              </span>
            ) : null}
          </h3>
          {listLoading ? (
            <p className="co-report__empty">{ko.companyReport.loading}</p>
          ) : reports.length === 0 ? (
            <p className="co-report__empty">{ko.companyReport.listEmpty}</p>
          ) : (
            <ul className="co-report__cards">
              {reports.map((r) => (
                <li key={r.id} className="co-report__card-wrap">
                  <button
                    type="button"
                    className="co-report__card"
                    onClick={() => void openReport(r.id)}
                  >
                    <div className="co-report__card-top">
                      <span className="co-report__sym">{r.symbol}</span>
                      <span className="co-report__market">
                        {r.market === "kr" ? "KR" : "US"}
                      </span>
                      <time
                        className="co-report__time"
                        dateTime={new Date(r.createdAt).toISOString()}
                      >
                        {formatWhen(r.createdAt)}
                      </time>
                    </div>
                    <strong className="co-report__card-title">{r.title}</strong>
                    {r.summary ? (
                      <p className="co-report__card-sum">{r.summary}</p>
                    ) : null}
                  </button>
                  <button
                    type="button"
                    className="co-report__btn co-report__btn--ghost"
                    onClick={() => void onDelete(r.id)}
                  >
                    {ko.companyReport.delete}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </main>
      </div>
    </div>
  );
}
