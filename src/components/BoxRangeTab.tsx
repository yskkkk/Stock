import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchBoxRangeCatalog,
  fetchBoxRangeCatalogSymbol,
  type BoxRangeCatalogBox,
  type BoxRangeCatalogIndex,
  type BoxRangeSymbolCatalog,
} from "../api";
import { formatPrice } from "../lib/format";
import { usStockLogoUrl } from "../lib/stockLogoUrl";
import { ko } from "../i18n/ko";
import DockPanelCenterLoading from "./DockPanelCenterLoading";
import LiveTradeAuthPanel, {
  useLiveTradeAuth,
} from "./LiveTradeAuthAndCredentials";

function fmtUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return formatPrice(n, "USD");
}

function isValidCatalogBox(b: BoxRangeCatalogBox): boolean {
  return b.tradeEligible && !b.consumedAtMs;
}

function displayTicker(symbol: string): string {
  return symbol.replace(/^US_/i, "").trim().toUpperCase();
}

function BoxRangeLogoButton({
  symbol,
  name,
  eligibleCount,
  selected,
  onSelect,
}: {
  symbol: string;
  name: string;
  eligibleCount: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const logo = usStockLogoUrl(symbol);
  const ticker = displayTicker(symbol);
  const showImg = Boolean(logo) && !imgFailed;

  return (
    <li className="box-range-tab__logo-item">
      <button
        type="button"
        className={
          selected
            ? "box-range-tab__logo-btn box-range-tab__logo-btn--on"
            : "box-range-tab__logo-btn"
        }
        aria-pressed={selected}
        title={`${name} (${ticker}) · ${ko.app.boxRangeTabValidCount} ${eligibleCount}`}
        onClick={onSelect}
      >
        {showImg ? (
          <img
            className="box-range-tab__logo-img"
            src={logo!}
            alt=""
            width={40}
            height={40}
            loading="lazy"
            decoding="async"
            onError={() => setImgFailed(true)}
          />
        ) : (
          <span className="box-range-tab__logo-fallback" aria-hidden>
            {(name.trim() || ticker).slice(0, 1)}
          </span>
        )}
        <span className="box-range-tab__logo-ticker">{ticker}</span>
        {eligibleCount > 1 ? (
          <span className="box-range-tab__logo-badge" aria-hidden>
            {eligibleCount}
          </span>
        ) : null}
      </button>
    </li>
  );
}

function BoxRangePriceCard({ box }: { box: BoxRangeCatalogBox }) {
  return (
    <article className="box-range-tab__price-card">
      <header className="box-range-tab__price-card-head">
        <span className="box-range-tab__price-card-tf">{box.timeframe}</span>
        <span className="box-range-tab__price-card-tag">
          {ko.app.boxRangeCatalogTradeOn}
        </span>
      </header>
      <dl className="box-range-tab__price-card-metrics">
        <div className="box-range-tab__price-card-row">
          <dt>{ko.app.liveTradeBoxColMid}</dt>
          <dd className="box-range-tab__price-card-val">{fmtUsd(box.mid)}</dd>
        </div>
        <div className="box-range-tab__price-card-row">
          <dt>{ko.app.liveTradeBoxColTp}</dt>
          <dd className="box-range-tab__price-card-val box-range-tab__price-card-val--up">
            {fmtUsd(box.top)}
          </dd>
        </div>
        <div className="box-range-tab__price-card-row">
          <dt>{ko.app.liveTradeBoxColSl}</dt>
          <dd className="box-range-tab__price-card-val box-range-tab__price-card-val--down">
            {fmtUsd(box.bottom)}
          </dd>
        </div>
      </dl>
    </article>
  );
}

export default function BoxRangeTab() {
  const { user, authChecked, registrationOpen } = useLiveTradeAuth();
  const [index, setIndex] = useState<BoxRangeCatalogIndex | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<BoxRangeSymbolCatalog | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const loadIndex = useCallback(async () => {
    setLoadErr(null);
    try {
      const data = await fetchBoxRangeCatalog();
      setIndex(data);
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : String(e));
      setIndex(null);
    }
  }, []);

  useEffect(() => {
    if (!user) {
      setIndex(null);
      setSelected(null);
      setDetail(null);
      return;
    }
    void loadIndex();
  }, [user, loadIndex]);

  useEffect(() => {
    if (!selected || !user) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    void fetchBoxRangeCatalogSymbol(selected)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((e) => {
        if (!cancelled) {
          setLoadErr(e instanceof Error ? e.message : String(e));
          setDetail(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selected, user]);

  const logoRows = useMemo(() => {
    const list = (index?.symbols ?? []).filter((r) => r.eligibleCount > 0);
    const q = filter.trim().toUpperCase();
    if (!q) return list;
    return list.filter(
      (r) =>
        r.symbol.includes(q) ||
        displayTicker(r.symbol).includes(q) ||
        String(r.name ?? "")
          .toUpperCase()
          .includes(q),
    );
  }, [index, filter]);

  const validBoxes = useMemo(
    () => (detail?.boxes ?? []).filter(isValidCatalogBox),
    [detail],
  );

  if (!authChecked) {
    return (
      <div className="workspace box-range-tab">
        <DockPanelCenterLoading label={ko.app.marketIndicesLoading} />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="workspace box-range-tab box-range-tab--guest">
        <p className="box-range-tab__hint">{ko.app.boxRangeTabLogin}</p>
        <LiveTradeAuthPanel
          user={null}
          registrationOpen={registrationOpen}
          onAuthChange={() => void loadIndex()}
        />
      </div>
    );
  }

  return (
    <div className="workspace box-range-tab">
      <header className="box-range-tab__head card">
        <p className="box-range-tab__hint">{ko.app.boxRangeTabHint}</p>
        <input
          type="search"
          className="box-range-tab__search"
          placeholder={ko.app.boxRangeCatalogSearch}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label={ko.app.boxRangeCatalogSearch}
        />
        {loadErr ? (
          <p className="live-trading-tab__err" role="alert">
            {loadErr}
          </p>
        ) : null}
      </header>

      <div className="box-range-tab__layout card">
        <aside className="box-range-tab__logos" aria-label={ko.app.tabBoxRange}>
          {!index ? (
            <DockPanelCenterLoading label={ko.app.boxRangeCatalogLoading} />
          ) : logoRows.length === 0 ? (
            <p className="box-range-tab__empty">{ko.app.boxRangeTabNoSymbols}</p>
          ) : (
            <ul className="box-range-tab__logo-grid">
              {logoRows.map((r) => (
                <BoxRangeLogoButton
                  key={r.symbol}
                  symbol={r.symbol}
                  name={r.name}
                  eligibleCount={r.eligibleCount}
                  selected={selected === r.symbol}
                  onSelect={() => setSelected(r.symbol)}
                />
              ))}
            </ul>
          )}
        </aside>

        <section className="box-range-tab__detail" aria-live="polite">
          {!selected ? (
            <p className="box-range-tab__empty">{ko.app.boxRangeTabPickSymbol}</p>
          ) : !detail ? (
            <DockPanelCenterLoading label={ko.app.boxRangeCatalogLoading} />
          ) : (
            <>
              <h2 className="box-range-tab__title">
                {detail.name}{" "}
                <span className="box-range-tab__title-sym">
                  ({displayTicker(detail.symbol)})
                </span>
              </h2>
              {detail.scanError ? (
                <p className="live-trading-tab__err">{detail.scanError}</p>
              ) : null}
              {validBoxes.length === 0 ? (
                <p className="box-range-tab__empty">{ko.app.boxRangeTabNoValid}</p>
              ) : (
                <div className="box-range-tab__card-grid">
                  {validBoxes.map((b) => (
                    <BoxRangePriceCard key={b.catalogBoxId} box={b} />
                  ))}
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
