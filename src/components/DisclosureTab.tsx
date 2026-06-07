import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchDartCompanies,
  fetchDartDisclosuresSearch,
  fetchDartStatus,
  type DartCompanyRow,
  type DartDisclosureRow,
} from "../api";
import { ko } from "../i18n/ko";
import { formatNewsDate } from "../lib/format";

const DAY_OPTIONS = [30, 90, 180, 365] as const;

function openExternal(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}

export default function DisclosureTab() {
  const [dartEnabled, setDartEnabled] = useState<boolean | null>(null);
  const [corpCount, setCorpCount] = useState(0);

  const [companyQuery, setCompanyQuery] = useState("");
  const [companies, setCompanies] = useState<DartCompanyRow[]>([]);
  const [companiesLoading, setCompaniesLoading] = useState(false);
  const [companiesErr, setCompaniesErr] = useState<string | null>(null);

  const [selected, setSelected] = useState<DartCompanyRow | null>(null);

  const [reportQuery, setReportQuery] = useState("");
  const [days, setDays] = useState<(typeof DAY_OPTIONS)[number]>(90);
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<DartDisclosureRow[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [listLoading, setListLoading] = useState(false);
  const [listErr, setListErr] = useState<string | null>(null);

  const companyDebounceRef = useRef<number | null>(null);
  const listSeqRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    void fetchDartStatus()
      .then((s) => {
        if (cancelled) return;
        setDartEnabled(s.enabled);
        setCorpCount(s.corpCount);
      })
      .catch(() => {
        if (!cancelled) setDartEnabled(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (companyDebounceRef.current != null) {
      window.clearTimeout(companyDebounceRef.current);
    }
    const q = companyQuery.trim();
    if (q.length < 1) {
      setCompanies([]);
      setCompaniesErr(null);
      setCompaniesLoading(false);
      return;
    }
    setCompaniesLoading(true);
    companyDebounceRef.current = window.setTimeout(() => {
      void fetchDartCompanies(q, 30)
        .then((rows) => {
          setCompanies(rows);
          setCompaniesErr(null);
        })
        .catch((e) => {
          setCompanies([]);
          setCompaniesErr(e instanceof Error ? e.message : String(e));
        })
        .finally(() => setCompaniesLoading(false));
    }, 280);
    return () => {
      if (companyDebounceRef.current != null) {
        window.clearTimeout(companyDebounceRef.current);
      }
    };
  }, [companyQuery]);

  const loadDisclosures = useCallback(
    async (opts?: { nextPage?: number; append?: boolean }) => {
      const nextPage = opts?.nextPage ?? 1;
      const append = opts?.append ?? false;
      const seq = ++listSeqRef.current;
      setListLoading(true);
      if (!append) setListErr(null);
      try {
        const data = await fetchDartDisclosuresSearch({
          corpCode: selected?.corpCode,
          symbol: selected?.symbol,
          query: reportQuery.trim() || undefined,
          days,
          page: nextPage,
          pageSize: 40,
        });
        if (seq !== listSeqRef.current) return;
        setItems((prev) => (append ? [...prev, ...data.items] : data.items));
        setHasMore(data.hasMore);
        setPage(data.page);
        if (!data.enabled) setDartEnabled(false);
      } catch (e) {
        if (seq !== listSeqRef.current) return;
        setListErr(e instanceof Error ? e.message : String(e));
        if (!append) setItems([]);
      } finally {
        if (seq === listSeqRef.current) setListLoading(false);
      }
    },
    [selected, reportQuery, days],
  );

  useEffect(() => {
    if (dartEnabled === false) return;
    if (!selected && !reportQuery.trim()) {
      setItems([]);
      setHasMore(false);
      return;
    }
    void loadDisclosures({ nextPage: 1, append: false });
  }, [selected, reportQuery, days, dartEnabled, loadDisclosures]);

  const statusLine = useMemo(() => {
    if (dartEnabled === null) return ko.dart.statusLoading;
    if (!dartEnabled) return ko.dart.statusDisabled;
    if (corpCount > 0) return ko.dart.statusReady.replace("{n}", String(corpCount));
    return ko.dart.statusPartial;
  }, [dartEnabled, corpCount]);

  return (
    <div className="workspace disclosure-tab">
      <section className="disclosure-tab__hero card">
        <div className="disclosure-tab__hero-head">
          <h2 className="disclosure-tab__title">{ko.dart.title}</h2>
          <p className="disclosure-tab__hint">{ko.dart.hint}</p>
        </div>
        <p className="disclosure-tab__status">{statusLine}</p>
        {!dartEnabled && dartEnabled !== null ? (
          <p className="disclosure-tab__setup">{ko.dart.setupHint}</p>
        ) : null}
      </section>

      <div className="disclosure-tab__grid">
        <section className="disclosure-tab__panel card" aria-label={ko.dart.companySearchAria}>
          <label className="disclosure-tab__label" htmlFor="dart-company-q">
            {ko.dart.companyLabel}
          </label>
          <input
            id="dart-company-q"
            className="disclosure-tab__input"
            type="search"
            placeholder={ko.dart.companyPlaceholder}
            value={companyQuery}
            onChange={(e) => setCompanyQuery(e.target.value)}
            disabled={!dartEnabled}
            autoComplete="off"
          />
          {companiesLoading ? (
            <p className="disclosure-tab__muted">{ko.dart.loading}</p>
          ) : companiesErr ? (
            <p className="disclosure-tab__error" role="alert">
              {companiesErr}
            </p>
          ) : companies.length === 0 && companyQuery.trim() ? (
            <p className="disclosure-tab__muted">{ko.dart.noCompanies}</p>
          ) : (
            <ul className="disclosure-tab__company-list">
              {companies.map((c) => (
                <li key={c.corpCode}>
                  <button
                    type="button"
                    className={
                      selected?.corpCode === c.corpCode
                        ? "disclosure-tab__company disclosure-tab__company--active"
                        : "disclosure-tab__company"
                    }
                    onClick={() => {
                      setSelected(c);
                      setPage(1);
                    }}
                  >
                    <span className="disclosure-tab__company-name">{c.corpName}</span>
                    <span className="disclosure-tab__company-code">{c.stockCode}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {selected ? (
            <div className="disclosure-tab__selected">
              <span>{ko.dart.selected}: </span>
              <strong>{selected.corpName}</strong>
              <button
                type="button"
                className="btn btn--ghost disclosure-tab__clear"
                onClick={() => {
                  setSelected(null);
                  setPage(1);
                }}
              >
                {ko.dart.clearSelection}
              </button>
            </div>
          ) : null}
        </section>

        <section className="disclosure-tab__panel card disclosure-tab__panel--list" aria-label={ko.dart.listAria}>
          <div className="disclosure-tab__filters">
            <label className="disclosure-tab__label" htmlFor="dart-report-q">
              {ko.dart.reportLabel}
            </label>
            <input
              id="dart-report-q"
              className="disclosure-tab__input"
              type="search"
              placeholder={ko.dart.reportPlaceholder}
              value={reportQuery}
              onChange={(e) => {
                setReportQuery(e.target.value);
                setPage(1);
              }}
              disabled={!dartEnabled}
              autoComplete="off"
            />
            <div className="disclosure-tab__days" role="group" aria-label={ko.dart.periodLabel}>
              {DAY_OPTIONS.map((d) => (
                <button
                  key={d}
                  type="button"
                  className={days === d ? "disclosure-tab__day active" : "disclosure-tab__day"}
                  onClick={() => {
                    setDays(d);
                    setPage(1);
                  }}
                  disabled={!dartEnabled}
                >
                  {ko.dart.periodDays.replace("{n}", String(d))}
                </button>
              ))}
            </div>
          </div>

          {!selected && !reportQuery.trim() ? (
            <p className="disclosure-tab__muted disclosure-tab__idle">{ko.dart.idle}</p>
          ) : listLoading && items.length === 0 ? (
            <p className="disclosure-tab__muted">{ko.dart.loading}</p>
          ) : listErr ? (
            <p className="disclosure-tab__error" role="alert">
              {listErr}
            </p>
          ) : items.length === 0 ? (
            <p className="disclosure-tab__muted">{ko.dart.noDisclosures}</p>
          ) : (
            <ul className="disclosure-tab__list">
              {items.map((it) => (
                <li key={it.id}>
                  <button
                    type="button"
                    className="disclosure-tab__item"
                    onClick={() => openExternal(it.url)}
                  >
                    <span className="disclosure-tab__item-top">
                      <span className="news-badge disclosure">{ko.dart.badge}</span>
                      <time dateTime={new Date(it.publishedAt).toISOString()}>
                        {formatNewsDate(it.publishedAt)}
                      </time>
                    </span>
                    <span className="disclosure-tab__item-title">{it.title}</span>
                    <span className="disclosure-tab__item-meta">
                      {[it.corpName, it.stockCode, it.flrNm].filter(Boolean).join(" · ")}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {hasMore && items.length > 0 ? (
            <button
              type="button"
              className="btn btn--secondary disclosure-tab__more"
              disabled={listLoading}
              onClick={() => void loadDisclosures({ nextPage: page + 1, append: true })}
            >
              {listLoading ? ko.dart.loading : ko.dart.loadMore}
            </button>
          ) : null}
        </section>
      </div>
    </div>
  );
}
