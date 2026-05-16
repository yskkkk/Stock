export function formatMacroCountdown(msLeft: number): string {
  if (msLeft <= 0) return "00:00:00";
  const totalSec = Math.floor(msLeft / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, "0");

  if (days > 0) {
    return `${days}일 ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  }
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

export function formatMacroWhen(at: number, _timezone?: string): string {
  return new Date(at).toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function macroUrgency(msLeft: number): "live" | "soon" | "normal" {
  if (msLeft <= 0) return "live";
  if (msLeft < 2 * 60 * 60 * 1000) return "soon";
  return "normal";
}
