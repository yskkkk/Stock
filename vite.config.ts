import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { stockApiPlugin } from "./server/vite-plugin-api.js";

export default defineConfig({
  plugins: [react(), stockApiPlugin()],
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
