/**
 * ios-native Info.plist에 STOCK_SERVER_URL 주입 (+ http 시 ATS 허용)
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { resolveMobileServerUrl } from "./resolve-mobile-server-url.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const PLIST = path.join(
  ROOT,
  "ios-native",
  "StockDashboard",
  "StockDashboard",
  "Info.plist",
);

function escapeXml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function injectAtsForHttp(plist, url) {
  if (!url.startsWith("http://")) return plist;
  if (plist.includes("<key>NSAppTransportSecurity</key>")) {
    return plist.replace(
      /<key>NSAppTransportSecurity<\/key>\s*<dict>[\s\S]*?<\/dict>/,
      `<key>NSAppTransportSecurity</key>
	<dict>
		<key>NSAllowsArbitraryLoads</key>
		<true/>
	</dict>`,
    );
  }
  return plist.replace(
    "</dict>\n</plist>",
    `	<key>NSAppTransportSecurity</key>
	<dict>
		<key>NSAllowsArbitraryLoads</key>
		<true/>
	</dict>
</dict>
</plist>`,
  );
}

export function injectIosNativeServerUrl(opts = {}) {
  const url = resolveMobileServerUrl({
    required: opts.required !== false,
    allowLanFallback: opts.allowLanFallback === true,
  });
  let plist = fs.readFileSync(PLIST, "utf8");
  plist = plist.replace(
    /<key>STOCK_SERVER_URL<\/key>\s*<string>[^<]*<\/string>/,
    `<key>STOCK_SERVER_URL</key>\n\t<string>${escapeXml(url)}</string>`,
  );
  plist = injectAtsForHttp(plist, url);
  fs.writeFileSync(PLIST, plist, "utf8");
  return url;
}

if (process.argv[1]?.endsWith("inject-ios-native-url.mjs")) {
  const url = injectIosNativeServerUrl({ required: true, allowLanFallback: false });
  console.log(`[ios-native] STOCK_SERVER_URL → ${url}`);
}
