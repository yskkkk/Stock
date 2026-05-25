import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchBoxRangeCatalog,
  fetchBoxRangeCatalogSymbol,
  patchBoxRangeCatalogBox,
  type BoxRangeCatalogBox,
  type BoxRangeCatalogIndex,
  type BoxRangeSymbolCatalog,
} from "../api";
import { formatPrice } from "../lib/format";
import { ko } from "../i18n/ko";

function fmtUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return formatPrice(n, "USD");
}

export default function BoxRangeSp500CatalogPanel() {
  const [index, setIndex] = useState<BoxRangeCatalogIndex | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<BoxRangeSymbolCatalog | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const loadIndex = useCallback(async () => {
    setLoadErr(null);
    try {
      const data = await fetchBoxRangeCatalog();
      setIndex(data);
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void loadIndex();
  }, [loadIndex]);

  useEffect(() => {
    if (!selected) {
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
  }, [selected]);

  const rows = useMemo(() => {
    const list = index?.symbols ?? [];
    const q = filter.trim().toUpperCase();
    if (!q) return list;
    return list.filter(
      (r) =>
        r.symbol.includes(q) ||
        String(r.name ?? "")
          .toUpperCase()
          .includes(q),
    );
  }, [index, filter]);

  async function toggleEligible(box: BoxRangeCatalogBox, next: boolean) {
    if (!selected) return;
    setBusyId(box.catalogBoxId);
    try {
      await patchBoxRangeCatalogBox(selected, box.catalogBoxId, {
        tradeEligible: next,
        consumedReason: next ? undefined : "manual",
      });
      const d = await fetchBoxRangeCatalogSymbol(selected);
      setDetail(d);
      await loadIndex();
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="box-range-catalog">
      <p className="live-trading-tab__hint">{ko.app.boxRangeCatalogHint}</p>
      {loadErr ? (
        <p className="live-trading-tab__err" role="alert">
          {loadErr}
        </p>
      ) : null}
      <div className="box-range-catalog__layout">
        <aside className="box-range-catalog__symbols">
          <input
            type="search"
            className="box-range-catalog__search"
            placeholder={ko.app.boxRangeCatalogSearch}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            aria-label={ko.app.boxRangeCatalogSearch}
          />
          <ul className="box-range-catalog__symbol-list">
            {rows.map((r) => (
              <li key={r.symbol}>
                <button
                  type="button"
                  className={
                    selected === r.symbol
                      ? "box-range-catalog__symbol-btn box-range-catalog__symbol-btn--on"
                      : "box-range-catalog__symbol-btn"
                  }
                  onClick={() => setSelected(r.symbol)}
                >
                  <span className="box-range-catalog__sym">{r.symbol}</span>
                  <span className="box-range-catalog__meta">
                    {r.eligibleCount}/{r.boxCount}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </aside>
        <section className="box-range-catalog__detail">
          {!selected ? (
            <p className="box-range-catalog__empty">
              {ko.app.boxRangeCatalogPickSymbol}
            </p>
          ) : !detail ? (
            <p className="box-range-catalog__empty">
              {ko.app.boxRangeCatalogLoading}
            </p>
          ) : (
            <>
              <h4 className="box-range-catalog__title">
                {detail.name} ({detail.symbol})
              </h4>
              {detail.scanError ? (
                <p className="live-trading-tab__err">{detail.scanError}</p>
              ) : null}
              {!detail.boxes.length ? (
                <p className="box-range-catalog__empty">
                  {ko.app.boxRangeCatalogNoBoxes}
                </p>
              ) : (
                <div className="live-sim-run__table-wrap">
                  <table className="live-sim-run__table live-trading-tab__box-range-table">
                    <thead>
                      <tr>
                        <th>{ko.app.liveTradeBoxColTf}</th>
                        <th>{ko.app.liveTradeBoxColMid}</th>
                        <th>{ko.app.liveTradeBoxColTp}</th>
                        <th>{ko.app.liveTradeBoxColSl}</th>
                        <th>{ko.app.boxRangeCatalogColTrade}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.boxes.map((b) => {
                        const eligible =
                          b.tradeEligible && !b.consumedAtMs;
                        return (
                          <tr key={b.catalogBoxId}>
                            <td>{b.timeframe}</td>
                            <td className="live-sim-run__num">{fmtUsd(b.mid)}</td>
                            <td className="live-sim-run__num">{fmtUsd(b.top)}</td>
                            <td className="live-sim-run__num">
                              {fmtUsd(b.bottom)}
                            </td>
                            <td>
                              <label className="box-range-catalog__check">
                                <input
                                  type="checkbox"
                                  checked={eligible}
                                  disabled={busyId === b.catalogBoxId}
                                  onChange={(e) =>
                                    void toggleEligible(b, e.target.checked)
                                  }
                                />
                                <span>
                                  {eligible
                                    ? ko.app.boxRangeCatalogTradeOn
                                    : ko.app.boxRangeCatalogTradeOff}
                                </span>
                              </label>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
