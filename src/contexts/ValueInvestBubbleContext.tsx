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
import {
  anchorRectForBubble,
  type BubblePointer,
} from "../lib/bubblePointerAnchor";
import {
  registerValueInvestBubbleApi,
  readValueInvestBubbleApi,
} from "../lib/valueInvestBubbleBridge";

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

type ProjectionColumn = "eps" | "dividend" | "cumulativeDividend" | "price" | "per";

function kstCalendarYear(): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === "year")?.value;
  return y ? Number(y) : new Date().getFullYear();
}

function formatProjectionCalendarYear(offsetYear: number): string {
  return `${kstCalendarYear() + offsetYear}년`;
}

function fmtProjectionPer(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value <= 0) return "—";
  return `${roundDisplay(value)}${ko.valueInvest.unitPer}`;
}

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

function projectionColumnLabel(column: ProjectionColumn) {
  switch (column) {
    case "eps":
      return ko.valueInvest.projectionEps;
    case "dividend":
      return ko.valueInvest.projectionDividend;
    case "cumulativeDividend":
      return ko.valueInvest.projectionCumDiv;
    case "price":
      return ko.valueInvest.projectionImpliedPrice;
    case "per":
      return ko.valueInvest.projectionPer;
  }
}

function projectionColumnValue(
  row: ValueInvestYearlyProjectionRow,
  column: ProjectionColumn,
  currency?: string,
  perMultiple?: number,
) {
  switch (column) {
    case "eps":
      return fmtProjectionValue(row.eps, currency, "eps");
    case "dividend":
      return fmtProjectionValue(row.dividend, currency);
    case "cumulativeDividend":
      return fmtProjectionValue(row.cumulativeDividend, currency);
    case "price":
      return fmtProjectionValue(row.impliedPrice, currency);
    case "per":
      return fmtProjectionPer(perMultiple);
  }
}

function HistoricalEpsTable({
  rows,
  currency,
}: {
  rows: { year: number; eps: number }[];
  currency?: string;
}) {
  if (!rows.length) {
    return <p className="value-invest-bubble__proj-empty">—</p>;
  }

  return (
    <table className="value-invest-bubble__proj-table value-invest-bubble__proj-table--single">
      <thead>
        <tr>
          <th>{ko.valueInvest.projectionYear}</th>
          <th>{ko.valueInvest.projectionEps}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.year}>
            <td>{`${row.year}년`}</td>
            <td className="value-invest-bubble__proj-col--highlight">
              {fmtProjectionValue(row.eps, currency, "eps")}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function YearlyProjectionTable({
  rows,
  currency,
  column,
  perMultiple,
}: {
  rows: ValueInvestYearlyProjectionRow[];
  currency?: string;
  column: ProjectionColumn;
  perMultiple?: number;
}) {
  if (!rows.length) {
    return <p className="value-invest-bubble__proj-empty">—</p>;
  }

  const valueLabel = projectionColumnLabel(column);

  return (
    <table className="value-invest-bubble__proj-table value-invest-bubble__proj-table--single">
      <thead>
        <tr>
          <th>{ko.valueInvest.projectionYear}</th>
          <th>{valueLabel}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.year}>
            <td>{formatProjectionCalendarYear(row.year)}</td>
            <td className="value-invest-bubble__proj-col--highlight">
              {projectionColumnValue(row, column, currency, perMultiple)}
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
  projectionColumn,
  projectionRows,
  historicalEpsRows,
  projectionPer,
  currency,
  pctRate,
  onPctRateChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  step?: string;
  suffix?: string;
  source?: string;
  projectionColumn?: ProjectionColumn;
  projectionRows?: ValueInvestYearlyProjectionRow[];
  historicalEpsRows?: { year: number; eps: number }[];
  projectionPer?: number;
  currency?: string;
  /** 0–1 비율 — 포커스 중 문자열 draft로 소수·빈칸 입력 허용 */
  pctRate?: number;
  onPctRateChange?: (rate: number) => void;
}) {
  const [hover, setHover] = useState(false);
  const [pctDraft, setPctDraft] = useState<string | null>(null);
  const pctMode = onPctRateChange != null;
  const showHistorical =
    hover && historicalEpsRows && historicalEpsRows.length > 0;
  const showProjection =
    hover && projectionColumn && projectionRows && projectionRows.length > 0;
  const showTable = showHistorical || showProjection;

  useEffect(() => {
    if (!pctMode) return;
    setPctDraft(null);
  }, [pctMode, pctRate]);

  const inputValue = pctMode
    ? (pctDraft ?? pctInput(pctRate ?? 0))
    : value;

  const handleInputChange = (raw: string) => {
    if (pctMode && onPctRateChange) {
      if (!/^\d*\.?\d*$/.test(raw)) return;
      setPctDraft(raw);
      if (raw !== "" && raw !== ".") {
        const n = Number(raw);
        if (Number.isFinite(n)) onPctRateChange(n / 100);
      }
      return;
    }
    onChange(raw);
  };

  const handleInputFocus = () => {
    if (pctMode) setPctDraft(pctInput(pctRate ?? 0));
  };

  const handleInputBlur = () => {
    if (pctMode && onPctRateChange && pctDraft !== null) {
      onPctRateChange(parsePctInput(pctDraft === "." ? "" : pctDraft));
      setPctDraft(null);
    }
  };

  return (
    <label className="value-invest-bubble__field">
      <span
        className={
          projectionColumn
            ? "value-invest-bubble__field-label value-invest-bubble__field-label--hint"
            : "value-invest-bubble__field-label"
        }
        title={projectionColumn ? ko.valueInvest.labelHoverHint : undefined}
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
              {showHistorical
                ? ko.valueInvest.epsHistoryTitle
                : projectionColumn
                  ? `${projectionColumnLabel(projectionColumn)} · ${ko.valueInvest.projectionTitle}`
                  : ko.valueInvest.projectionTitle}
            </span>
            {showHistorical ? (
              <HistoricalEpsTable rows={historicalEpsRows!} currency={currency} />
            ) : projectionColumn ? (
              <YearlyProjectionTable
                rows={projectionRows!}
                currency={currency}
                column={projectionColumn}
                perMultiple={projectionPer}
              />
            ) : null}
          </span>
        ) : null}
      </span>
      <span className="value-invest-bubble__field-input-wrap">
        <input
          type={pctMode ? "text" : "number"}
          inputMode={pctMode ? "decimal" : undefined}
          className="value-invest-bubble__field-input"
          value={inputValue}
          step={pctMode ? undefined : step}
          onChange={(e) => handleInputChange(e.target.value)}
          onFocus={handleInputFocus}
          onBlur={handleInputBlur}
          onClick={(e) => e.stopPropagation()}
        />
        {suffix ? <span className="value-invest-bubble__field-suffix">{suffix}</span> : null}
      </span>
      {source ? <span className="value-invest-bubble__field-source">{source}</span> : null}
    </label>
  );
}

type Ctx = {
  showValueInvestBubble: (
    anchor: HTMLElement,
    target: ValueInvestBubbleTarget,
    pointer?: BubblePointer | null,
  ) => void;
  closeValueInvestBubble: () => void;
  openSymbol: string | null;
};

const ValueInvestBubbleContext = createContext<Ctx | null>(null);

function useResolvedValueInvestBubbleCtx(): Ctx | null {
  const fromContext = useContext(ValueInvestBubbleContext);
  if (fromContext) return fromContext;
  return readValueInvestBubbleApi();
}

export function useValueInvestBubble() {
  const ctx = useResolvedValueInvestBubbleCtx();
  if (!ctx) {
    throw new Error("useValueInvestBubble must be used within ValueInvestBubbleProvider");
  }
  return ctx;
}

export function useOptionalValueInvestBubble(): Ctx | null {
  return useResolvedValueInvestBubbleCtx();
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
    (
      anchor: HTMLElement,
      target: ValueInvestBubbleTarget,
      pointer?: BubblePointer | null,
    ) => {
      const anchorRect = anchorRectForBubble(anchor, pointer);
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
      const target = e.target as Node;
      if (el?.contains(target)) return;
      if ((target as Element).closest?.(".earnings-icon-rail__bubble")) return;
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
                    historicalEpsRows={payload?.epsHistory}
                    currency={currency}
                    onChange={(v) =>
                      setInputs((cur) => (cur ? { ...cur, currentEps: Number(v) || 0 } : cur))
                    }
                    source={payload?.inputSources.currentEps}
                  />
                  <InputField
                    label={ko.valueInvest.growthRate}
                    value=""
                    suffix="%"
                    step="0.1"
                    projectionColumn="eps"
                    projectionRows={projectionRows}
                    currency={currency}
                    onChange={() => {}}
                    pctRate={inputs.growthRate}
                    onPctRateChange={(rate) =>
                      setInputs((cur) => (cur ? { ...cur, growthRate: rate } : cur))
                    }
                    source={payload?.growthSource ?? undefined}
                  />
                  <InputField
                    label={ko.valueInvest.averagePer}
                    value={String(inputs.averagePer)}
                    step="0.1"
                    suffix={ko.valueInvest.unitPer}
                    projectionColumn="per"
                    projectionRows={projectionRows}
                    projectionPer={inputs.averagePer}
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
                    value=""
                    suffix="%"
                    step="0.1"
                    projectionColumn="dividend"
                    projectionRows={projectionRows}
                    currency={currency}
                    onChange={() => {}}
                    pctRate={inputs.payoutRatio}
                    onPctRateChange={(rate) =>
                      setInputs((cur) => (cur ? { ...cur, payoutRatio: rate } : cur))
                    }
                    source={payload?.payoutSource ?? undefined}
                  />
                  <InputField
                    label={ko.valueInvest.targetReturn}
                    value=""
                    suffix="%"
                    step="0.1"
                    onChange={() => {}}
                    pctRate={inputs.targetReturnRate}
                    onPctRateChange={(rate) =>
                      setInputs((cur) => (cur ? { ...cur, targetReturnRate: rate } : cur))
                    }
                  />
                  <InputField
                    label={ko.valueInvest.years}
                    value={String(inputs.years)}
                    step="1"
                    suffix={ko.valueInvest.yearsUnit}
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
    () => ({
      showValueInvestBubble,
      closeValueInvestBubble,
      openSymbol: open?.symbol ?? null,
    }),
    [showValueInvestBubble, closeValueInvestBubble, open?.symbol],
  );

  registerValueInvestBubbleApi(ctx);
  useEffect(() => () => registerValueInvestBubbleApi(null), []);

  return (
    <ValueInvestBubbleContext.Provider value={ctx}>
      {children}
      {bubble}
    </ValueInvestBubbleContext.Provider>
  );
}
