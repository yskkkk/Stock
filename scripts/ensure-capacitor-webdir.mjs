/**
 * Capacitor webDir 최소 셸 — 실제 UI는 capacitor server.url(고정 URL)에서 로드
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");

const INDEX = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>종목 대시보드</title>
</head>
<body>
  <p style="font-family:system-ui,sans-serif;padding:24px">서버에 연결하는 중…</p>
</body>
</html>
`;

export function ensureCapacitorWebdir() {
  fs.mkdirSync(DIST, { recursive: true });
  fs.writeFileSync(path.join(DIST, "index.html"), INDEX, "utf8");
}
