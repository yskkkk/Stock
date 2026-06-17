import type { ButtonHTMLAttributes } from "react";

export function RefreshIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className ?? "refresh-icon-btn__svg"}
      viewBox="0 0 24 24"
      width={16}
      height={16}
      aria-hidden
    >
      <path
        d="M21 12a9 9 0 0 0-9-9 7.5 7.5 0 0 0-5.9 2.8M3 12a9 9 0 0 0 9 9 7.5 7.5 0 0 0 5.9-2.8M21 3v5h-5M3 21v-5h5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function RefreshIconButton({
  label,
  className = "",
  type = "button",
  ...rest
}: {
  label: string;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      className={`refresh-icon-btn${className ? ` ${className}` : ""}`}
      aria-label={label}
      title={label}
      {...rest}
    >
      <RefreshIcon />
    </button>
  );
}
