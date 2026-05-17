/**
 * createApp() + dist/index.html 있을 때 GET / 가 SPA 셸을 내는지 확인.
 * ACCESS_CONTROL_DISABLED=1
 */
import http from "http";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { createApp } from "../server/create-app.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const indexHtml = path.join(root, "dist", "index.html");
if (!fs.existsSync(indexHtml)) {
  console.log("verify-express-spa-root skip (no dist/index.html — run npm run build)");
  process.exit(0);
}

process.env.ACCESS_CONTROL_DISABLED = "1";
process.env.ACCESS_ALLOW_LOCALHOST = "1";

const app = createApp();
const server = http.createServer(app);
await new Promise((resolve, reject) => {
  server.listen(0, "127.0.0.1", () => resolve());
  server.on("error", reject);
});
const addr = server.address();
const port = typeof addr === "object" && addr ? addr.port : 0;

const html = await new Promise((resolve, reject) => {
  http
    .get(
      `http://127.0.0.1:${port}/`,
      { headers: { Accept: "text/html" } },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
        res.on("error", reject);
      },
    )
    .on("error", reject);
});

server.close();

const ok = html.status === 200 && html.body.includes('id="root"');
if (!ok) {
  console.error({ status: html.status, head: html.body.slice(0, 400) });
  process.exit(1);
}
console.log("verify-express-spa-root ok", { port });
