import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { stockApiPlugin } from "./server/vite-plugin-api.js";

export default defineConfig({
  plugins: [
    react(),
    /* Vitest는 Node에서 플러그인까지 로드하면 API·스크리너 부가 효과로 프로세스가 안 끝날 수 있음 */
    ...(process.env.VITEST ? [] : [stockApiPlugin()]),
  ],
  test: {
    environment: "jsdom",
    pool: "forks",
    include: ["src/**/*.test.{ts,tsx}"],
  },
  /** LAN·공유기 포트포워딩으로 외부 접속 시 0.0.0.0 리슨 필요 */
  server: {
    port: 5173,
    host: true,
    strictPort: true,
  },
  /** `npm run preview` 시에도 동일하게 외부에서 접근 가능 */
  preview: {
    host: true,
    strictPort: true,
  },
});
