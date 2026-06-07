import fs from "node:fs";
import path from "node:path";
import { restartNodeOrViteDev } from "./restart-node-process.js";
import { isViteRestartRecent } from "./vite-restart-marker.js";

const IGNORE =
  /(?:^|[/\\])\.(?:data|logs)(?:[/\\]|$)|\.(?:log|tmp|lock|md)$/i;
const SOURCE_RE = /\.(?:js|mjs|cjs|json|ts)$/i;

/**
 * `server/**` 는 Vite watch 제외 — 소스 변경 시 Express·라우트만 자동 갱신(Vite restart).
 * @param {import("vite").ViteDevServer | import("vite").PreviewServer} server
 */
export function installServerSourceAutoReload(server) {
  if (String(process.env.STOCK_SERVER_AUTORELOAD ?? "").trim() === "0") return;

  const serverDir = path.join(process.cwd(), "server");
  /** @type {ReturnType<typeof setTimeout> | null} */
  let timer = null;
  let reloading = false;

  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      timer = null;
      if (reloading || isViteRestartRecent(2500)) return;
      reloading = true;
      try {
        console.log("[stock-api] server source changed — reloading API…");
        await restartNodeOrViteDev(server.httpServer);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn("[stock-api] auto-reload failed:", msg);
      } finally {
        reloading = false;
      }
    }, 600);
  };

  try {
    fs.watch(serverDir, { recursive: true }, (_ev, name) => {
      const rel = String(name ?? "").replace(/\\/g, "/");
      if (!rel || IGNORE.test(rel) || !SOURCE_RE.test(rel)) return;
      schedule();
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[stock-api] server source watch unavailable:", msg);
  }
}
