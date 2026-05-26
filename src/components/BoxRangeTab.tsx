import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchBoxRangeCatalog,
  fetchBoxRangeCatalogSymbol,
  type BoxRangeCatalogBox,
  type BoxRangeCatalogIndex,
  type BoxRangeCatalogMarket,
  type BoxRangeSymbolCatalog,
} from "../api";
import { formatPrice } from "../lib/format";
import { cryptoCoinIconUrl, cryptoIconSlug } from "../lib/cryptoCoinIcon";
import { krStockLogoUrl, usStockLogoUrl } from "../lib/stockLogoUrl";
import { ko } from "../i18n/ko";
import DockPanelCenterLoading from "./DockPanelCenterLoading";
import LiveTradeAuthPanel, {
  useLiveTradeAuth,
} from "./LiveTradeAuthAndCredentials";

function fmtPrice(
  n: number | null | undefined,
  market: BoxRangeCatalogMarket,
): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (market === "crypto" || market === "kr") return formatPrice(n, "KRW");
  return formatPrice(n, "USD");
}

function isValidCatalogBox(b: BoxRangeCatalogBox): boolean {
  return b.tradeEligible && !b.consumedAtMs;
}

function displayTicker(symbol: string, market: BoxRangeCatalogMarket): string {
  if (market === "crypto") {
    const s = symbol.trim().toUpperCase();
    if (s.endsWith("-USDT")) return s.slice(0, -5);
    return s;
  }
  if (market === "kr") {
    return symbol.replace(/^KR_/i, "").trim();
  }
  return symbol.replace(/^US_/i, "").trim().toUpperCase();
}

function cryptoKoFromName(name: string): string {
  const slash = String(name ?? "").split("/");
  if (slash.length > 1) {
    const ko = slash[slash.length - 1].trim();
    if (/[\uAC00-\uD7A3]/.test(ko)) return ko;
  }
  const m = String(name ?? "").match(/[\uAC00-\uD7A3][\uAC00-\uD7A3·\s]*/);
  return m ? m[0].trim() : "";
}

/** 국내: 종목명 · 미국: 한글명(티커) · 코인: 한글명(티커) */
function displaySymbolLabel(
  symbol: string,
  name: string,
  market: BoxRangeCatalogMarket,
  nameKo?: string,
): string {
  const ticker = displayTicker(symbol, market);
  if (market === "kr") {
    const n = String(name ?? "").trim();
    return n || ticker;
  }
  if (market === "us") {
    const ko = String(nameKo ?? "").trim();
    return ko ? `${ko} (${ticker})` : ticker;
  }
  if (market === "crypto") {
    const ko = cryptoKoFromName(name);
    return ko ? `${ko} (${ticker})` : ticker;
  }
  return ticker;
}

function logoUrlForSymbol(
  symbol: string,
  market: BoxRangeCatalogMarket,
): string | null {
  if (market === "crypto") {
    const slug = cryptoIconSlug(symbol, "crypto");
    return slug ? cryptoCoinIconUrl(slug) : null;
  }
  if (market === "kr") {
    const bare = symbol
      .replace(/^KR_/i, "")
      .replace(/\.(KS|KQ)$/i, "")
      .trim();
    const code =
      /^\d{6}$/.test(bare) ? bare : symbol.replace(/^KR_/i, "").trim();
    return krStockLogoUrl(
      /^\d{6}$/.test(code) ? `KR_${code}` : symbol,
    );
  }
  return usStockLogoUrl(symbol);
}

function BoxRangeLogoButton({
  symbol,
  name,
  nameKo,
  eligibleCount,
  selected,
  market,
  onSelect,
}: {
  symbol: string;
  name: string;
  nameKo?: string;
  eligibleCount: number;
  selected: boolean;
  market: BoxRangeCatalogMarket;
  onSelect: () => void;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const logo = logoUrlForSymbol(symbol, market);
  const ticker = displayTicker(symbol, market);
  const label = displaySymbolLabel(symbol, name, market, nameKo);
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
        <span className="box-range-tab__logo-ticker">{label}</span>
        {eligibleCount > 1 ? (
          <span className="box-range-tab__logo-badge" aria-hidden>
            {eligibleCount}
          </span>
        ) : null}
      </button>
    </li>
  );
}

function BoxRangePriceCard({
  box,
  market,
}: {
  box: BoxRangeCatalogBox;
  market: BoxRangeCatalogMarket;
}) {
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
          <dd className="box-range-tab__price-card-val">{fmtPrice(box.mid, market)}</dd>
        </div>
        <div className="box-range-tab__price-card-row">
          <dt>{ko.app.liveTradeBoxColTp}</dt>
          <dd className="box-range-tab__price-card-val box-range-tab__price-card-val--up">
            {fmtPrice(box.top, market)}
          </dd>
        </div>
        <div className="box-range-tab__price-card-row">
          <dt>{ko.app.liveTradeBoxColSl}</dt>
          <dd className="box-range-tab__price-card-val box-range-tab__price-card-val--down">
            {fmtPrice(box.bottom, market)}
          </dd>
        </div>
      </dl>
    </article>
  );
}

export default function BoxRangeTab() {
  const { user, authChecked, registrationOpen } = useLiveTradeAuth();
  const [catalogMarket, setCatalogMarket] =
    useState<BoxRangeCatalogMarket>("us");
  const [index, setIndex] = useState<BoxRangeCatalogIndex | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<BoxRangeSymbolCatalog | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const loadIndex = useCallback(async () => {
    setLoadErr(null);
    try {
      const data = await fetchBoxRangeCatalog(catalogMarket);
      setIndex(data);
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : String(e));
      setIndex(null);
    }
  }, [catalogMarket]);

  useEffect(() => {
    if (!user) {
      setIndex(null);
      setSelected(null);
      setDetail(null);
      return;
    }
    setSelected(null);
    setDetail(null);
    void loadIndex();
  }, [user, loadIndex]);

  useEffect(() => {
    if (!selected || !user) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    void fetchBoxRangeCatalogSymbol(selected, catalogMarket)
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
  }, [selected, user, catalogMarket]);

  const logoRows = useMemo(() => {
    const list = (index?.symbols ?? []).filter((r) => r.eligibleCount > 0);
    const q = filter.trim().toUpperCase();
    if (!q) return list;
    return list.filter(
      (r) =>
        r.symbol.includes(q) ||
        displayTicker(r.symbol, catalogMarket).includes(q) ||
        String(r.name ?? "")
          .toUpperCase()
          .includes(q),
    );
  }, [index, filter, catalogMarket]);

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
        <div
          className="box-range-tab__market-segment live-trading-tab__segment"
          role="group"
          aria-label={ko.app.boxRangeTabMarketLabel}
        >
          <button
            type="button"
            className={
              catalogMarket === "us"
                ? "live-trading-tab__segment-btn live-trading-tab__segment-btn--on"
                : "live-trading-tab__segment-btn"
            }
            aria-pressed={catalogMarket === "us"}
            onClick={() => setCatalogMarket("us")}
          >
            {ko.app.boxRangeTabMarketUs}
          </button>
          <button
            type="button"
            className={
              catalogMarket === "kr"
                ? "live-trading-tab__segment-btn live-trading-tab__segment-btn--on"
                : "live-trading-tab__segment-btn"
            }
            aria-pressed={catalogMarket === "kr"}
            onClick={() => setCatalogMarket("kr")}
          >
            {ko.app.boxRangeTabMarketKr}
          </button>
          <button
            type="button"
            className={
              catalogMarket === "crypto"
                ? "live-trading-tab__segment-btn live-trading-tab__segment-btn--on"
                : "live-trading-tab__segment-btn"
            }
            aria-pressed={catalogMarket === "crypto"}
            onClick={() => setCatalogMarket("crypto")}
          >
            {ko.app.boxRangeTabMarketCrypto}
          </button>
        </div>
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
                  nameKo={r.nameKo}
                  eligibleCount={r.eligibleCount}
                  selected={selected === r.symbol}
                  market={catalogMarket}
                  onSelect={() => setSelected(r.symbol)}
                />
              ))}
            </ul>
          )}
        </aside>

        <section className="box-range-tab__detail" aria-live="polite">
          {!selected ? (
            null
          ) : !detail ? (
            <DockPanelCenterLoading label={ko.app.boxRangeCatalogLoading} />
          ) : (
            <>
              <h2 className="box-range-tab__title">
                {detail.name}{" "}
                <span className="box-range-tab__title-sym">
                  ({displayTicker(detail.symbol, catalogMarket)})
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
                    <BoxRangePriceCard
                      key={b.catalogBoxId}
                      box={b}
                      market={catalogMarket}
                    />
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
