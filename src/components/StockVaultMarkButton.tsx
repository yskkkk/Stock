import type { ButtonHTMLAttributes, MouseEvent } from "react";

export function VaultBookmarkIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      className="stock-vault-mark__icon"
      viewBox="0 0 24 24"
      width={15}
      height={15}
      aria-hidden
    >
      {filled ? (
        <path
          fill="currentColor"
          d="M6 4a2 2 0 0 0-2 2v14l8-4.5 8 4.5V6a2 2 0 0 0-2-2H6z"
        />
      ) : (
        <path
          fill="none"
          stroke="currentColor"
          strokeWidth="1.65"
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M6 4a2 2 0 0 0-2 2v14l8-4.5 8 4.5V6a2 2 0 0 0-2-2H6z"
        />
      )}
    </svg>
  );
}

export function VaultSectorLeaderIcon() {
  return (
    <svg
      className="stock-vault-tab__crown"
      viewBox="0 0 24 24"
      width={14}
      height={14}
      aria-hidden
    >
      <path
        fill="currentColor"
        d="M5 16h14l-1.2-8.5-3.3 2.8L12 4 9.5 10.3 6.2 7.5 5 16zm0 2v2h14v-2H5z"
      />
    </svg>
  );
}

export default function StockVaultMarkButton({
  saved,
  label,
  variant = "inline",
  className = "",
  onClick,
  ...rest
}: {
  saved: boolean;
  label: string;
  variant?: "inline" | "compact";
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type" | "aria-label" | "title">) {
  const handleClick = (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    onClick?.(e);
  };

  return (
    <button
      type="button"
      className={[
        "stock-vault-mark",
        variant === "inline" ? "stock-vault-mark--inline" : "stock-vault-mark--compact",
        saved ? "stock-vault-mark--saved" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      aria-label={label}
      aria-pressed={saved}
      title={label}
      onClick={handleClick}
      {...rest}
    >
      <VaultBookmarkIcon filled={saved} />
    </button>
  );
}
