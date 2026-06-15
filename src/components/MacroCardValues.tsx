import { ko } from "../i18n/ko";

function ValueRow({
  label,
  value,
  pending,
  className,
}: {
  label: string;
  value?: string | null;
  pending: string;
  className?: string;
}) {
  const text = value?.trim() || pending;
  const isPending = !value?.trim();
  return (
    <p className={className ?? "macro-card__forecast"}>
      <span className="macro-card__forecast-k">{label}</span>
      <span className="macro-card__forecast-sep" aria-hidden>
        {" "}
        ·{" "}
      </span>
      <span
        className={
          isPending
            ? "macro-card__forecast-v macro-card__forecast-v--pending"
            : "macro-card__forecast-v"
        }
      >
        {text}
      </span>
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
  return (
    <div className="macro-card__values">
      <ValueRow
        label={ko.macro.forecastLabel}
        value={forecast}
        pending={ko.macro.forecastPending}
      />
      <ValueRow
        label={ko.macro.currentLabel}
        value={previous}
        pending={ko.macro.currentPending}
        className="macro-card__forecast macro-card__previous"
      />
    </div>
  );
}
