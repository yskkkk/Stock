import {
  isIpHost,
  resolvePublicHttpsOrigin,
  validateIosOtaHttpsOrigin,
} from "./public-app-origin.js";

export const IOS_OTA_BUNDLE_ID = "com.stock.dashboard";
export const IOS_OTA_BUNDLE_VERSION = "1.0.0";
export const IOS_OTA_TITLE = "종목 대시보드";

/**
 * @param {string} httpsOrigin
 * @returns {string}
 */
export function buildIosOtaManifestXml(httpsOrigin) {
  const base = httpsOrigin.replace(/\/+$/, "");
  const ipaUrl = `${base}/downloads/stock-dashboard.ipa`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>items</key>
	<array>
		<dict>
			<key>assets</key>
			<array>
				<dict>
					<key>kind</key>
					<string>software-package</string>
					<key>url</key>
					<string>${ipaUrl}</string>
				</dict>
			</array>
			<key>metadata</key>
			<dict>
				<key>bundle-identifier</key>
				<string>${IOS_OTA_BUNDLE_ID}</string>
				<key>bundle-version</key>
				<string>${IOS_OTA_BUNDLE_VERSION}</string>
				<key>kind</key>
				<string>software</string>
				<key>title</key>
				<string>${IOS_OTA_TITLE}</string>
			</dict>
		</dict>
	</array>
</dict>
</plist>
`;
}

/**
 * @param {{ requestHost?: string; requestIsSecure?: boolean }} [ctx]
 */
export function getIosInstallStatus(ctx = {}) {
  const httpsOrigin = resolvePublicHttpsOrigin();
  const originCheck = validateIosOtaHttpsOrigin(httpsOrigin);
  const requestHost = String(ctx.requestHost ?? "").trim().toLowerCase();

  let manifestUrl = null;
  let itmsInstallUrl = null;
  if (originCheck.ok && httpsOrigin) {
    manifestUrl = `${httpsOrigin}/downloads/ios-manifest.plist`;
    itmsInstallUrl =
      "itms-services://?action=download-manifest&url=" +
      encodeURIComponent(manifestUrl);
  }

  const httpsInstallPageUrl = httpsOrigin
    ? `${httpsOrigin}/install-ios.html`
    : null;

  let onTrustedOrigin = false;
  if (httpsOrigin && requestHost) {
    try {
      onTrustedOrigin =
        requestHost === new URL(httpsOrigin).hostname.toLowerCase();
    } catch {
      onTrustedOrigin = false;
    }
  }

  const requestIsIp = isIpHost(requestHost);
  const requestLooksInsecure =
    ctx.requestIsSecure === false ||
    (requestHost && requestIsIp && process.env.STOCK_IOS_OTA_ALLOW_IP !== "1");

  let blockReason = null;
  if (!originCheck.ok) {
    blockReason = originCheck.reason ?? "no_https_origin";
  } else if (requestLooksInsecure && !onTrustedOrigin) {
    blockReason = requestIsIp ? "cert_ip" : "wrong_host";
  }

  return {
    httpsOrigin,
    httpsInstallPageUrl,
    onTrustedOrigin,
    requestHost: requestHost || null,
    ota: {
      manifestUrl,
      itmsInstallUrl,
      originOk: originCheck.ok,
      originBlockReason: originCheck.ok ? null : originCheck.reason,
      blockReason,
      canInstall: originCheck.ok && !blockReason,
    },
  };
}
