/**
 * preview로 GET / 호출 — SPA index(id=root + 메인 번들) 응답 확인.
 * 접근 게이트 우회: ACCESS_CONTROL_DISABLED=1
 */
import { spawn } from "child_process";
import http from "http";
import { fileURLToPath } from "url";
import path from "path";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = 5280 + Math.floor(Math.random() * 60);
process.chdir(root);

const env = {
  ...process.env,
  ACCESS_CONTROL_DISABLED: "1",
  ACCESS_ALLOW_LOCALHOST: "1",
};

const sp = spawn("npx", ["vite", "preview", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  cwd: root,
  env,
  shell: true,
  stdio: ["ignore", "pipe", "pipe"],
});

await new Promise((resolve, reject) => {
  let out = "";
  let settled = false;
  const t = setTimeout(() => {
    if (settled) return;
    settled = true;
    try {
      sp.kill("SIGTERM");
    } catch {
      /* ignore */
    }
    reject(new Error("preview start timeout\n" + out.slice(-600)));
  }, 22000);
  const check = (b) => {
    out += b.toString();
    if (settled) return;
    if (out.includes(String(port)) && (out.includes("Local:") || out.includes("127.0.0.1"))) {
      settled = true;
      clearTimeout(t);
      resolve();
    }
  };
  sp.stdout.on("data", check);
  sp.stderr.on("data", check);
  sp.on("error", (e) => {
    if (settled) return;
    settled = true;
    clearTimeout(t);
    reject(e);
  });
});

const html = await new Promise((resolve, reject) => {
  http.get(
    `http://127.0.0.1:${port}/`,
    { headers: { Accept: "text/html" } },
    (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      res.on("error", reject);
    },
  ).on("error", reject);
});

try {
  sp.kill("SIGTERM");
} catch {
  /* ignore */
}
if (sp.pid && process.platform === "win32") {
  try {
    const { execFileSync } = await import("child_process");
    execFileSync("taskkill", ["/PID", String(sp.pid), "/T", "/F"], { stdio: "ignore" });
  } catch {
    /* ignore */
  }
} else if (sp.pid) {
  try {
    process.kill(-sp.pid, "SIGKILL");
  } catch {
    try {
      sp.kill("SIGKILL");
    } catch {
      /* ignore */
    }
  }
}

const hasRoot = html.includes('id="root"');
const hasMainBundle = /\/assets\/index-[^"']+\.js/.test(html);
if (!hasRoot || !hasMainBundle) {
  console.error({ hasRoot, hasMainBundle, head: html.slice(0, 600) });
  process.exit(1);
}
console.log("verify-entry-http ok", { port });
process.exit(0);
