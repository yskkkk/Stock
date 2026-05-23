import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { viteDevPortPreemptPlugin } from "./server/vite-dev-port-preempt.js";
import { stockApiPlugin } from "./server/vite-plugin-api.js";

export default defineConfig(({ mode }) => ({
  /** Capacitor WebView — 상대 경로 번들 */
  base: mode === "capacitor" ? "./" : "/",
  plugins: [
    viteDevPortPreemptPlugin(),
    react(),
    /* Vitest는 Node에서 플러그인까지 로드하면 API·스크리너 부가 효과로 프로세스가 안 끝날 수 있음 */
    ...(process.env.VITEST ? [] : [stockApiPlugin()]),
  ],
  test: {
    environment: "jsdom",
    pool: "forks",
    include: ["src/**/*.test.{ts,tsx}", "server/**/*.test.js"],
  },
  /** LAN·공유기 포트포워딩으로 외부 접속 시 0.0.0.0 리슨 필요 */
  server: {
    port: 5173,
    host: true,
    strictPort: true,
    /** lease·이력·트랜스크립트 등 런타임 파일 변경으로 dev 서버가 재시작되지 않게 */
    watch: {
      ignored: [
        /** API·폴러 런타임 기록 — 변경 시 Vite server.restart 연쇄 방지(서버 코드 수정 후에는 dev 프로세스 재시작) */
        "**/server/**",
        "**/.git/**",
        "**/.cursor/**",
        "**/server/.data/**",
        "**/server/.logs/**",
        "**/.stock-*/**",
        "**/.stock-*",
        "**/.auto-git-sync.pause",
        "**/SERVER_IMPROVEMENTS.md",
        "**/.stock-ops-ide-lease.json",
        "**/agent-transcripts/**",
        "**/scripts/__pycache__/**",
        "**/*.log",
      ],
    },
  },
  /** `npm run preview` 시에도 동일하게 외부에서 접근 가능 */
  preview: {
    host: true,
    strictPort: true,
  },
}));
