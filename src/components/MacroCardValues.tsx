import { ko } from "../i18n/ko";

function ValueRow({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <p className={className ?? "macro-card__forecast"}>
      <span className="macro-card__forecast-k">{label}</span>
      <span className="macro-card__forecast-sep" aria-hidden>
        {" "}
        ·{" "}
      </span>
      <span className="macro-card__forecast-v">{value}</span>
    </p>
  );
}

export default function MacroCardValues({
  forecast,
  previous,
}: {
  forecast?: string | null;
  previous?: string | null;
}) {
  const forecastText = forecast?.trim() ?? "";
  const previousText = previous?.trim() ?? "";
  if (!forecastText && !previousText) return null;

  return (
    <div className="macro-card__values">
      {forecastText ? (
        <ValueRow label={ko.macro.forecastLabel} value={forecastText} />
      ) : null}
      {previousText ? (
        <ValueRow
          label={ko.macro.currentLabel}
          value={previousText}
          className="macro-card__forecast macro-card__previous"
        />
      ) : null}
    </div>
  );
}

/** 카드 aria-label용 — 값 있는 항목만 */
export function macroCardValuesAriaParts(
  forecast?: string | null,
  previous?: string | null,
): string[] {
  const parts: string[] = [];
  const fc = forecast?.trim();
  const pv = previous?.trim();
  if (fc) parts.push(`${ko.macro.forecastLabel} ${fc}`);
  if (pv) parts.push(`${ko.macro.currentLabel} ${pv}`);
  return parts;
}
