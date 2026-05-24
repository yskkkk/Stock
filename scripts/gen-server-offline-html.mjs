/**
 * public/server-offline.html — UTF-8 SSOT (Windows/에디터 깨짐 방지)
 * HTML 본문·스크립트 문자열은 \\uXXXX 이스케이프만 사용(파일 ASCII-safe).
 */
import { writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { loadEnvFile } from "../server/load-env.js";
import { resolveServerOpenClientTelegramCreds } from "../server/server-open-request-notify.js";

const out = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "public",
  "server-offline.html",
);

const html = `<!DOCTYPE html>
<html lang="ko">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="theme-color" content="#0a0e13" />
    <meta name="robots" content="noindex" />
    <title>\uC11C\uBC84 \uC5F0\uACB0 \uB300\uAE30 \u2014 YSTOCK</title>
    <!--STOCK_SERVER_OPEN_CONFIG-->
    <style>
      :root { --bg:#0a0e13; --card:#161d27; --border:rgba(148,163,184,.14); --text:#eef2f7; --dim:#9aa8bc; --muted:#6d7d92; --accent:#5eead4; --warn:#fbbf24; }
      * { box-sizing:border-box; }
      html,body { margin:0; min-height:100dvh; }
      body { font-family:"Pretendard",system-ui,sans-serif; background:radial-gradient(1200px 600px at 50% -10%,rgba(94,234,212,.08),transparent 60%),var(--bg); color:var(--text); display:flex; align-items:center; justify-content:center; padding:max(1.25rem,env(safe-area-inset-top,0)) max(1rem,env(safe-area-inset-right,0)) max(1.25rem,env(safe-area-inset-bottom,0)) max(1rem,env(safe-area-inset-left,0)); }
      .card { width:min(440px,100%); padding:1.35rem 1.4rem; background:var(--card); border:1px solid var(--border); border-radius:12px; box-shadow:0 8px 32px rgba(0,0,0,.35); }
      .badge { display:inline-flex; align-items:center; gap:.35rem; margin:0 0 .75rem; padding:.22rem .55rem; border-radius:999px; background:rgba(251,191,36,.12); color:var(--warn); font-size:.72rem; font-weight:700; }
      .badge::before { content:""; width:.45rem; height:.45rem; border-radius:50%; background:currentColor; }
      h1 { margin:0 0 .55rem; font-size:1.25rem; line-height:1.35; }
      p { margin:0 0 .85rem; color:var(--dim); font-size:.92rem; line-height:1.55; }
      .actions { display:flex; flex-wrap:wrap; gap:.5rem; }
      button { appearance:none; border:none; cursor:pointer; font:inherit; }
      .btn { padding:.55rem .95rem; border-radius:8px; font-size:.88rem; font-weight:700; }
      .btn--primary { background:var(--accent); color:#0a0e13; }
      .btn--notify { background:rgba(94,234,212,.14); color:var(--accent); border:1px solid rgba(94,234,212,.35); }
      .btn--ghost { background:transparent; color:var(--dim); border:1px solid var(--border); }
      .btn:disabled { opacity:.55; cursor:wait; }
      #status { min-height:1.2rem; margin-top:.75rem; font-size:.8rem; color:var(--muted); }
      #status.err { color:#f87171; }
    </style>
  </head>
  <body>
    <main class="card" aria-live="polite">
      <p class="badge">\uC11C\uBC84 \uC751\uB2F5 \uC5C6\uC74C</p>
      <h1>Stock \uC11C\uBC84\uAC00 \uAE49\uC838 \uC788\uC2B5\uB2C8\uB2E4</h1>
      <p id="lead">\uC11C\uBC84\uC5D0 \uC5F0\uACB0\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4. \uC544\uB798 \uBC84\uD2BC\uC73C\uB85C \uAD00\uB9AC\uC790\uC5D0\uAC8C \uC624\uD508 \uC694\uCCAD \uC54C\uB9BC\uC744 \uBCF4\uB0BC \uC218 \uC788\uC2B5\uB2C8\uB2E4.</p>
      <div class="actions">
        <button type="button" class="btn btn--notify" id="notify">\uD14C\uB808\uADF8\uB7A8 \uC54C\uB9BC \uBCF4\uB0B4\uAE30</button>
        <button type="button" class="btn btn--primary" id="retry">\uB2E4\uC2DC \uC5F0\uACB0</button>
        <button type="button" class="btn btn--ghost" id="reload">\uC0C8\uB85C\uACE0\uCE68</button>
      </div>
      <p id="status" role="status"></p>
    </main>
    <script>
      (function () {
        var statusEl = document.getElementById("status");
        var notifyBtn = document.getElementById("notify");
        var retryBtn = document.getElementById("retry");
        var reloadBtn = document.getElementById("reload");

        function setStatus(msg, isErr) {
          statusEl.textContent = msg || "";
          statusEl.className = isErr ? "err" : "";
        }

        function kstLabel() {
          try {
            return new Date().toLocaleString("ko-KR", {
              timeZone: "Asia/Seoul",
              month: "2-digit",
              day: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
              hour12: false,
            });
          } catch (e) {
            return new Date().toISOString();
          }
        }

        function buildTelegramText() {
          var lines = [
            "<b>Stock \\uC11C\\uBC84 \\uC624\\uD508 \\uC694\\uCCAD</b>",
            "",
            "\\uD83C\\uDF10 " + (location.origin || location.hostname || "\\u2014"),
            "\\uD83D\\uDCE1 client",
          ];
          if (navigator.userAgent) {
            var ua = navigator.userAgent;
            if (ua.length > 120) ua = ua.slice(0, 117) + "\\u2026";
            lines.push("\\uD83D\\uDCF1 " + ua);
          }
          lines.push("", "<i>\\uD83D\\uDD50 " + kstLabel() + " KST</i>");
          return lines.join("\\n");
        }

        async function sendViaApi() {
          var ctrl = new AbortController();
          var timer = setTimeout(function () { ctrl.abort(); }, 4000);
          try {
            var res = await fetch("/api/server-open-request", {
              method: "POST",
              credentials: "same-origin",
              cache: "no-store",
              signal: ctrl.signal,
            });
            clearTimeout(timer);
            if (!res.ok) return null;
            var body = await res.json();
            return body && body.ok ? body : null;
          } catch (e) {
            clearTimeout(timer);
            return null;
          }
        }

        async function sendViaClientTelegram() {
          var cfg = window.__STOCK_SERVER_OPEN__;
          if (!cfg || !cfg.token || !cfg.chatId) return false;
          try {
            var res = await fetch(
              "https://api.telegram.org/bot" + cfg.token + "/sendMessage",
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  chat_id: cfg.chatId,
                  text: buildTelegramText(),
                  parse_mode: "HTML",
                  disable_web_page_preview: true,
                }),
              },
            );
            if (!res.ok) return false;
            var body = await res.json();
            return body && body.ok;
          } catch (e) {
            return false;
          }
        }

        async function sendNotify() {
          notifyBtn.disabled = true;
          setStatus("\\uC54C\\uB9BC \\uC804\\uC1A1 \\uC911\\u2026");
          var apiResult = await sendViaApi();
          var ok = !!(apiResult && apiResult.ok);
          var skipped = !!(apiResult && apiResult.skipped);
          if (!ok) ok = await sendViaClientTelegram();
          if (ok) {
            setStatus(
              skipped
                ? "\\uCD5C\\uADFC\\uC5D0 \\uC774\\uBBF8 \\uC694\\uCCAD\\uC744 \\uBCF4\\uB0C8\\uC2B5\\uB2C8\\uB2E4."
                : "\\uD14C\\uB808\\uADF8\\uB7A8\\uC73C\\uB85C \\uC11C\\uBC84 \\uC624\\uD508 \\uC694\\uCCAD\\uC744 \\uBCF4\\uB0C4\\uC2B5\\uB2C8\\uB2E4.",
            );
          } else {
            var cfg = window.__STOCK_SERVER_OPEN__;
            setStatus(
              cfg && cfg.token && cfg.chatId
                ? "\\uC54C\\uB9BC \\uC804\\uC1A1\\uC5D0 \\uC2E4\\uD328\\uD588\\uC2B5\\uB2C8\\uB2E4. \\uC7A0\\uC2DC \\uD6C4 \\uB2E4\\uC2DC \\uC2DC\\uB3C4\\uD574 \\uC8FC\\uC138\\uC694."
                : "\\uC11C\\uBC84\\uAC00 \\uAF2E\\uC838 \\uC788\\uC5B4 \\uC54C\\uB9BC\\uC744 \\uBCF4\\uB0BC \\uC218 \\uC5C6\\uC2B5\\uB2C8\\uB2E4. \\uAC1C\\uBC1C PC\\uC5D0\\uC11C \\uC11C\\uBC84\\uB97C \\uAE30\\uB3D9\\uD574 \\uC8FC\\uC138\\uC694.",
              true,
            );
          }
          notifyBtn.disabled = false;
        }

        async function probe() {
          retryBtn.disabled = true;
          setStatus("\\uC5F0\\uACB0 \\uD655\\uC778 \\uC911\\u2026");
          try {
            var ctrl = new AbortController();
            var timer = setTimeout(function () { ctrl.abort(); }, 8000);
            var res = await fetch("/api/health", {
              cache: "no-store",
              credentials: "same-origin",
              signal: ctrl.signal,
            });
            clearTimeout(timer);
            if (!res.ok) throw new Error("bad");
            var body = await res.json();
            if (!body || !body.ok) throw new Error("bad");
            setStatus("\\uC5F0\\uACB0\\uB418\\uC5C8\\uC2B5\\uB2C8\\uB2E4. \\uC571\\uC73C\\uB85C \\uC774\\uB3D9\\uD569\\uB2C8\\uB2E4.");
            location.replace("/");
          } catch (e) {
            setStatus("\\uC544\\uC9C1 \\uC11C\\uBC84\\uC5D0 \\uC5F0\\uACB0\\uD560 \\uC218 \\uC5C6\\uC2B5\\uB2C8\\uB2E4.", true);
          } finally {
            retryBtn.disabled = false;
          }
        }

        notifyBtn.addEventListener("click", function () { void sendNotify(); });
        retryBtn.addEventListener("click", function () { void probe(); });
        reloadBtn.addEventListener("click", function () { location.reload(); });
      })();
    </script>
  </body>
</html>`;

loadEnvFile();

function buildConfigInject() {
  const creds = resolveServerOpenClientTelegramCreds();
  if (!creds) return "<!-- server-open: client telegram disabled -->";
  const payload = JSON.stringify({
    token: creds.token,
    chatId: creds.chatId,
  });
  return `<script>window.__STOCK_SERVER_OPEN__=${payload};</script>`;
}

writeFileSync(
  out,
  html.replace("<!--STOCK_SERVER_OPEN_CONFIG-->", buildConfigInject()),
  "utf8",
);
console.log("gen server-offline.html ok");
