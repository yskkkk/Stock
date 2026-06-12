import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { fetchValueInvestReturn } from "../api";
import { ko } from "../i18n/ko";
import { formatPercent, formatPrice } from "../lib/format";
import {
  buildValueInvestFormulaLines,
  buildValueInvestYearlyProjection,
  calcValueInvestReturn,
  type ValueInvestReturnInput,
  type ValueInvestYearlyProjectionRow,
} from "../lib/valueInvestReturnModel";
import type { ValueInvestReturnInputs, ValueInvestReturnResponse } from "../types";

const VIEWPORT_PAD = 8;
const GAP = 10;
const EST_W = 380;
const EST_H = 460;

export type ValueInvestBubbleTarget = {
  symbol: string;
  name: string;
  market: "kr" | "us";
  price?: number | null;
  currency?: string | null;
};

type Placement = "left" | "right" | "below" | "above";

type OpenState = ValueInvestBubbleTarget & {
  anchorRect: DOMRectReadOnly;
  left: number;
  top: number;
  placement: Placement;
  transform: string;
};

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function positionBubble(
  anchor: DOMRectReadOnly,
  bubbleW = EST_W,
  bubbleH = EST_H,
): Pick<OpenState, "left" | "top" | "placement" | "transform"> {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const fitsRight = anchor.right + GAP + bubbleW <= vw - VIEWPORT_PAD;
  const fitsLeft = anchor.left - GAP - bubbleW >= VIEWPORT_PAD;
  const fitsBelow = anchor.bottom + GAP + bubbleH <= vh - VIEWPORT_PAD;
  const fitsAbove = anchor.top - GAP - bubbleH >= VIEWPORT_PAD;

  if (fitsRight) {
    return {
      left: anchor.right + GAP,
      top: clamp(
        anchor.top + anchor.height / 2,
        VIEWPORT_PAD + bubbleH / 2,
        vh - VIEWPORT_PAD - bubbleH / 2,
      ),
      placement: "right",
      transform: "translate(0, -50%)",
    };
  }
  if (fitsLeft) {
    return {
      left: anchor.left - GAP,
      top: clamp(
        anchor.top + anchor.height / 2,
        VIEWPORT_PAD + bubbleH / 2,
        vh - VIEWPORT_PAD - bubbleH / 2,
      ),
      placement: "left",
      transform: "translate(-100%, -50%)",
    };
  }
  if (fitsBelow || (!fitsAbove && anchor.top < vh / 2)) {
    const left = clamp(
      anchor.left + anchor.width / 2,
      VIEWPORT_PAD + bubbleW / 2,
      vw - VIEWPORT_PAD - bubbleW / 2,
    );
    return { left, top: anchor.bottom + GAP, placement: "below", transform: "translate(-50%, 0)" };
  }
  const left = clamp(
    anchor.left + anchor.width / 2,
    VIEWPORT_PAD + bubbleW / 2,
    vw - VIEWPORT_PAD - bubbleW / 2,
  );
  return {
    left,
    top: anchor.top - GAP,
    placement: "above",
    transform: "translate(-50%, -100%)",
  };
}

function placementClass(placement: Placement) {
  return `value-invest-bubble value-invest-bubble--${placement}`;
}

function fmtMoney(value: number | null | undefined, currency?: string) {
  if (value == null || !Number.isFinite(value)) return "—";
  if (currency === "KRW") return `${Math.round(value).toLocaleString("ko-KR")}원`;
  return formatPrice(value, currency);
}

function pctInput(rate: number): string {
  return Number.isFinite(rate) ? String(roundDisplay(rate * 100)) : "";
}

function parsePctInput(raw: string) {
  const n = Number(raw);
  return Number.isFinite(n) ? n / 100 : 0;
}

function roundDisplay(n: number) {
  return Math.round(n * 100) / 100;
}

type ProjectionHighlight = "eps" | "dividend" | "price" | "all";

function moneyUnitSuffix(currency?: string, eps = false) {
  if (currency === "KRW") return eps ? ko.valueInvest.unitEpsKr : ko.valueInvest.unitKrw;
  return eps ? ko.valueInvest.unitEps : ko.valueInvest.unitUsd;
}

function fmtProjectionValue(
  value: number | null | undefined,
  currency?: string,
  mode: "money" | "eps" = "money",
) {
  if (value == null || !Number.isFinite(value)) return "—";
  if (currency === "KRW") {
    const n = Math.round(value);
    return `${n.toLocaleString("ko-KR")}${mode === "eps" ? "원/주" : "원"}`;
  }
  const n = Math.round(value * 100) / 100;
  return mode === "eps" ? `${n} USD/주` : formatPrice(n, currency ?? "USD");
}

function YearlyProjectionTable({
  rows,
  currency,
  highlight = "all",
}: {
  rows: ValueInvestYearlyProjectionRow[];
  currency?: string;
  highlight?: ProjectionHighlight;
}) {
  if (!rows.length) {
    return <p className="value-invest-bubble__proj-empty">—</p>;
  }
  const col = (key: ProjectionHighlight) =>
    highlight === "all" || highlight === key
      ? "value-invest-bubble__proj-col--highlight"
      : undefined;

  return (
    <table className="value-invest-bubble__proj-table">
      <thead>
        <tr>
          <th>{ko.valueInvest.projectionYear}</th>
          <th className={col("eps")}>{ko.valueInvest.projectionEps}</th>
          <th className={col("dividend")}>{ko.valueInvest.projectionDividend}</th>
          <th className={col("dividend")}>{ko.valueInvest.projectionCumDiv}</th>
          <th className={col("price")}>{ko.valueInvest.projectionImpliedPrice}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.year}>
            <td>{row.year}</td>
            <td className={col("eps")}>{fmtProjectionValue(row.eps, currency, "eps")}</td>
            <td className={col("dividend")}>
              {fmtProjectionValue(row.dividend, currency)}
            </td>
            <td className={col("dividend")}>
              {fmtProjectionValue(row.cumulativeDividend, currency)}
            </td>
            <td className={col("price")}>
              {fmtProjectionValue(row.impliedPrice, currency)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function InputField({
  label,
  value,
  onChange,
  step = "any",
  suffix,
  source,
  hoverHighlight,
  projectionRows,
  currency,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  step?: string;
  suffix?: string;
  source?: string;
  hoverHighlight?: ProjectionHighlight;
  projectionRows?: ValueInvestYearlyProjectionRow[];
  currency?: string;
}) {
  const [hover, setHover] = useState(false);
  const showTable = hover && projectionRows && projectionRows.length > 0;

  return (
    <label className="value-invest-bubble__field">
      <span
        className="value-invest-bubble__field-label value-invest-bubble__field-label--hint"
        title={ko.valueInvest.labelHoverHint}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onFocus={() => setHover(true)}
        onBlur={() => setHover(false)}
        tabIndex={0}
      >
        {label}
        {showTable ? (
          <span
            className="value-invest-bubble__hover-pop"
            role="tooltip"
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
          >
            <span className="value-invest-bubble__hover-pop-title">
              {ko.valueInvest.projectionTitle}
            </span>
            <YearlyProjectionTable
              rows={projectionRows}
              currency={currency}
              highlight={hoverHighlight ?? "all"}
            />
          </span>
        ) : null}
      </span>
      <span className="value-invest-bubble__field-input-wrap">
        <input
          type="number"
          className="value-invest-bubble__field-input"
          value={value}
          step={step}
          onChange={(e) => onChange(e.target.value)}
          onClick={(e) => e.stopPropagation()}
        />
        {suffix ? <span className="value-invest-bubble__field-suffix">{suffix}</span> : null}
      </span>
      {source ? <span className="value-invest-bubble__field-source">{source}</span> : null}
    </label>
  );
}

type Ctx = {
  showValueInvestBubble: (anchor: HTMLElement, target: ValueInvestBubbleTarget) => void;
  closeValueInvestBubble: () => void;
};

const ValueInvestBubbleContext = createContext<Ctx | null>(null);

export function useValueInvestBubble() {
  const ctx = useContext(ValueInvestBubbleContext);
  if (!ctx) {
    throw new Error("useValueInvestBubble must be used within ValueInvestBubbleProvider");
  }
  return ctx;
}

export function useOptionalValueInvestBubble(): Ctx | null {
  return useContext(ValueInvestBubbleContext);
}

export function ValueInvestBubbleProvider({ children }: { children: ReactNode }) {
  const bubbleId = useId();
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState<OpenState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<ValueInvestReturnResponse | null>(null);
  const [inputs, setInputs] = useState<ValueInvestReturnInputs | null>(null);
  const fetchSeq = useRef(0);

  const closeValueInvestBubble = useCallback(() => {
    setOpen(null);
    setLoading(false);
    setError(null);
    setPayload(null);
    setInputs(null);
  }, []);

  const showValueInvestBubble = useCallback(
    (anchor: HTMLElement, target: ValueInvestBubbleTarget) => {
      const anchorRect = anchor.getBoundingClientRect();
      setOpen({
        ...target,
        anchorRect,
        ...positionBubble(anchorRect),
      });
      setLoading(true);
      setError(null);
      setPayload(null);
      setInputs(null);

      const seq = ++fetchSeq.current;
      void (async () => {
        try {
          const livePrice =
            target.price != null && Number.isFinite(target.price) && target.price > 0
              ? target.price
              : undefined;
          const data = await fetchValueInvestReturn(target.symbol, { price: livePrice });
          if (seq !== fetchSeq.current) return;
          const mergedInputs = { ...data.inputs };
          if (livePrice != null) {
            mergedInputs.currentPrice = livePrice;
          }
          setPayload({
            ...data,
            inputSources: {
              ...data.inputSources,
              ...(livePrice != null
                ? { currentPrice: ko.valueInvest.livePriceSource }
                : {}),
            },
          });
          setInputs(mergedInputs);
        } catch (err: unknown) {
          if (seq !== fetchSeq.current) return;
          setError(err instanceof Error ? err.message : String(err));
        } finally {
          if (seq === fetchSeq.current) setLoading(false);
        }
      })();
    },
    [],
  );

  useLayoutEffect(() => {
    if (!open || !bubbleRef.current) return;
    const bubble = bubbleRef.current;
    const bw = bubble.offsetWidth;
    const bh = bubble.offsetHeight;
    if (!bw || !bh) return;
    const next = positionBubble(open.anchorRect, bw, bh);
    if (
      next.left === open.left &&
      next.top === open.top &&
      next.placement === open.placement &&
      next.transform === open.transform
    ) {
      return;
    }
    setOpen((cur) => (cur ? { ...cur, ...next } : cur));
  }, [open?.symbol, open?.anchorRect, inputs, loading, error, payload]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeValueInvestBubble();
    };
    const onPointer = (e: PointerEvent) => {
      const el = bubbleRef.current;
      if (el?.contains(e.target as Node)) return;
      closeValueInvestBubble();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer, true);
    };
  }, [open, closeValueInvestBubble]);

  const calcInput = useMemo((): ValueInvestReturnInput | null => {
    if (!inputs) return null;
    return {
      currentPrice: inputs.currentPrice,
      currentEps: inputs.currentEps,
      growthRate: inputs.growthRate,
      averagePer: inputs.averagePer,
      payoutRatio: inputs.payoutRatio,
      targetReturnRate: inputs.targetReturnRate,
      years: inputs.years,
    };
  }, [inputs]);

  const result = useMemo(() => {
    if (!calcInput) return null;
    return calcValueInvestReturn(calcInput);
  }, [calcInput]);

  const formulaLines = useMemo(() => {
    if (!calcInput || !result) return [];
    return buildValueInvestFormulaLines(calcInput, result, {
      epsAtEnd: ko.valueInvest.formulaEpsAtEnd,
      totalEps: ko.valueInvest.formulaTotalEps,
      futurePrice: ko.valueInvest.formulaFuturePrice,
      dividends: ko.valueInvest.formulaDividends,
      totalReturn: ko.valueInvest.formulaTotalReturn,
      cagr: ko.valueInvest.formulaCagr,
      fairPrice: ko.valueInvest.formulaFairPrice,
    });
  }, [calcInput, result]);

  const currency = payload?.currency ?? open?.currency ?? undefined;

  const projectionRows = useMemo(() => {
    if (!inputs) return [];
    return buildValueInvestYearlyProjection({
      currentEps: inputs.currentEps,
      growthRate: inputs.growthRate,
      payoutRatio: inputs.payoutRatio,
      averagePer: inputs.averagePer,
      years: inputs.years,
    });
  }, [inputs]);

  const priceSuffix = moneyUnitSuffix(currency);
  const epsSuffix = moneyUnitSuffix(currency, true);

  const bubble =
    open && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={bubbleRef}
            id={bubbleId}
            role="dialog"
            aria-label={ko.valueInvest.bubbleAria}
            className={placementClass(open.placement)}
            style={{
              left: `${open.left}px`,
              top: `${open.top}px`,
              transform: open.transform,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <header className="value-invest-bubble__head">
              <div>
                <p className="value-invest-bubble__name">{open.name}</p>
                <p className="value-invest-bubble__sym">{open.symbol}</p>
              </div>
              <button
                type="button"
                className="value-invest-bubble__close"
                aria-label={ko.valueInvest.close}
                onClick={closeValueInvestBubble}
              >
                ×
              </button>
            </header>

            {loading ? (
              <p className="value-invest-bubble__muted">{ko.valueInvest.loading}</p>
            ) : null}
            {error ? (
              <p className="value-invest-bubble__error" role="alert">
                {error}
              </p>
            ) : null}

            {inputs ? (
              <div className="value-invest-bubble__body">
                <section className="value-invest-bubble__inputs" aria-label={ko.valueInvest.inputsTitle}>
                  <InputField
                    label={ko.valueInvest.currentPrice}
                    value={String(inputs.currentPrice)}
                    suffix={priceSuffix}
                    hoverHighlight="all"
                    projectionRows={projectionRows}
                    currency={currency}
                    onChange={(v) =>
                      setInputs((cur) =>
                        cur ? { ...cur, currentPrice: Number(v) || 0 } : cur,
                      )
                    }
                    source={payload?.inputSources.currentPrice}
                  />
                  <InputField
                    label={ko.valueInvest.currentEps}
                    value={String(inputs.currentEps)}
                    suffix={epsSuffix}
                    hoverHighlight="eps"
                    projectionRows={projectionRows}
                    currency={currency}
                    onChange={(v) =>
                      setInputs((cur) => (cur ? { ...cur, currentEps: Number(v) || 0 } : cur))
                    }
                    source={payload?.inputSources.currentEps}
                  />
                  <InputField
                    label={ko.valueInvest.growthRate}
                    value={pctInput(inputs.growthRate)}
                    suffix="%"
                    step="0.1"
                    hoverHighlight="eps"
                    projectionRows={projectionRows}
                    currency={currency}
                    onChange={(v) =>
                      setInputs((cur) =>
                        cur ? { ...cur, growthRate: parsePctInput(v) } : cur,
                      )
                    }
                    source={payload?.growthSource ?? undefined}
                  />
                  <InputField
                    label={ko.valueInvest.averagePer}
                    value={String(inputs.averagePer)}
                    step="0.1"
                    suffix={ko.valueInvest.unitPer}
                    hoverHighlight="price"
                    projectionRows={projectionRows}
                    currency={currency}
                    onChange={(v) =>
                      setInputs((cur) =>
                        cur ? { ...cur, averagePer: Number(v) || 0 } : cur,
                      )
                    }
                    source={payload?.inputSources.averagePer}
                  />
                  <InputField
                    label={ko.valueInvest.payoutRatio}
                    value={pctInput(inputs.payoutRatio)}
                    suffix="%"
                    step="0.1"
                    hoverHighlight="dividend"
                    projectionRows={projectionRows}
                    currency={currency}
                    onChange={(v) =>
                      setInputs((cur) =>
                        cur ? { ...cur, payoutRatio: parsePctInput(v) } : cur,
                      )
                    }
                    source={payload?.payoutSource ?? undefined}
                  />
                  <InputField
                    label={ko.valueInvest.targetReturn}
                    value={pctInput(inputs.targetReturnRate)}
                    suffix="%"
                    step="0.1"
                    hoverHighlight="all"
                    projectionRows={projectionRows}
                    currency={currency}
                    onChange={(v) =>
                      setInputs((cur) =>
                        cur ? { ...cur, targetReturnRate: parsePctInput(v) } : cur,
                      )
                    }
                  />
                  <InputField
                    label={ko.valueInvest.years}
                    value={String(inputs.years)}
                    step="1"
                    suffix={ko.valueInvest.yearsUnit}
                    hoverHighlight="all"
                    projectionRows={projectionRows}
                    currency={currency}
                    onChange={(v) =>
                      setInputs((cur) =>
                        cur
                          ? { ...cur, years: Math.max(1, Math.min(30, Math.floor(Number(v) || 10))) }
                          : cur,
                      )
                    }
                  />
                </section>

                {payload?.missing.length ? (
                  <ul className="value-invest-bubble__missing">
                    {payload.missing.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                ) : null}

                {payload?.warnings?.length ? (
                  <ul className="value-invest-bubble__warnings">
                    <li className="value-invest-bubble__warnings-title">
                      {ko.valueInvest.warningsTitle}
                    </li>
                    {payload.warnings.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                ) : null}

                {result ? (
                  <section className="value-invest-bubble__results" aria-label={ko.valueInvest.resultsTitle}>
                    <div className="value-invest-bubble__result-grid">
                      <div className="value-invest-bubble__result-card value-invest-bubble__result-card--primary">
                        <span className="value-invest-bubble__result-label">
                          {ko.valueInvest.fairBuyPrice}
                        </span>
                        <strong className="value-invest-bubble__result-value">
                          {fmtMoney(result.fairBuyPrice, currency)}
                        </strong>
                      </div>
                      <div className="value-invest-bubble__result-card">
                        <span className="value-invest-bubble__result-label">
                          {ko.valueInvest.cagr}
                        </span>
                        <strong className="value-invest-bubble__result-value">
                          {result.cagrPct != null ? formatPercent(result.cagrPct) : "—"}
                        </strong>
                      </div>
                    </div>
                    <dl className="value-invest-bubble__detail">
                      <div>
                        <dt>{ko.valueInvest.futurePrice}</dt>
                        <dd>{fmtMoney(result.futurePrice, currency)}</dd>
                      </div>
                      <div>
                        <dt>{ko.valueInvest.totalDividends}</dt>
                        <dd>{fmtMoney(result.totalDividends, currency)}</dd>
                      </div>
                      <div>
                        <dt>{ko.valueInvest.totalReturn}</dt>
                        <dd>{fmtMoney(result.totalReturn, currency)}</dd>
                      </div>
                      <div>
                        <dt>{ko.valueInvest.totalEps}</dt>
                        <dd>{fmtMoney(result.totalEps, currency)}</dd>
                      </div>
                      <div>
                        <dt>{ko.valueInvest.epsAtEnd}</dt>
                        <dd>{fmtMoney(result.epsAtEnd, currency)}</dd>
                      </div>
                    </dl>
                    {formulaLines.length ? (
                      <section
                        className="value-invest-bubble__formulas"
                        aria-label={ko.valueInvest.formulasTitle}
                      >
                        <p className="value-invest-bubble__formulas-title">
                          {ko.valueInvest.formulasTitle}
                        </p>
                        <ul>
                          {formulaLines.map((line) => (
                            <li key={line.label}>
                              <span className="value-invest-bubble__formula-label">
                                {line.label}
                              </span>
                              <span className="value-invest-bubble__formula-expr">
                                {line.formula}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </section>
                    ) : null}
                  </section>
                ) : (
                  <p className="value-invest-bubble__muted">{ko.valueInvest.unavailable}</p>
                )}

                <p className="value-invest-bubble__disclaimer">
                  {payload?.disclaimer ?? ko.valueInvest.disclaimer}
                </p>
              </div>
            ) : null}
          </div>,
          document.body,
        )
      : null;

  const ctx = useMemo(
    () => ({ showValueInvestBubble, closeValueInvestBubble }),
    [showValueInvestBubble, closeValueInvestBubble],
  );

  return (
    <ValueInvestBubbleContext.Provider value={ctx}>
      {children}
      {bubble}
    </ValueInvestBubbleContext.Provider>
  );
}
