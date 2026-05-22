import { killProcessOnPort } from "./kill-tcp-port.js";

function devPortPreemptDisabled() {
  const v = String(process.env.STOCK_DEV_KILL_PORT ?? "")
    .trim()
    .toLowerCase();
  return v === "0" || v === "false" || v === "no" || v === "off";
}

/**
 * `npm run dev` 시 5173(또는 Vite server.port)이 이미 열려 있으면 점유 프로세스를 종료한 뒤 기동.
 * @returns {import("vite").Plugin}
 */
export function viteDevPortPreemptPlugin() {
  return {
    name: "stock-dev-port-preempt",
    apply: "serve",
    configureServer(server) {
      if (devPortPreemptDisabled()) return;
      const port = Number(server.config.server?.port) || 5173;
      const { killed } = killProcessOnPort(port, { exceptPids: [process.pid] });
      if (killed.length) {
        console.info(
          `[dev] 포트 ${port} 사용 중이어서 종료 후 재시작합니다 (pid: ${killed.join(", ")})`,
        );
      }
    },
  };
}
