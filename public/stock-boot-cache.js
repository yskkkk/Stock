/** @typedef {{ reload?: boolean; resetPurgeFlag?: boolean }} StockBootCacheClearOptions */

(function () {
  var PURGE_VERSION_KEY = "stock-pwa-boot-purge-version";
  var PURGE_VERSION = "3";

  function isViteDevBoot() {
    try {
      var port = String(location.port || "");
      if (port === "5173" || port === "4173") return true;
      if (location.hostname === "localhost" || location.hostname === "127.0.0.1") {
        return port === "" || port === "5173" || port === "4173";
      }
    } catch (e) {}
    return false;
  }

  function bootTimeoutMs() {
    return isViteDevBoot() ? 30000 : 15000;
  }

  function cacheHintText() {
    if (isViteDevBoot()) {
      return "개발 서버(Vite)는 모듈 로딩이 느릴 수 있습니다. Wi‑Fi·서버 실행 상태를 확인한 뒤 다시 시도해 주세요.";
    }
    var ua = "";
    try {
      ua = String(navigator.userAgent || "");
    } catch (e) {}
    if (/Safari/i.test(ua) && !/Chrome|CriOS|Edg/i.test(ua)) {
      return "캐시·네트워크 문제일 수 있습니다. Safari 설정 → 고급 → 웹 사이트 데이터에서 이 사이트를 삭제한 뒤 새로고침해 주세요.";
    }
    return "캐시·네트워크 문제일 수 있습니다. 아래 «캐시 삭제 후 재시도»를 누르거나 브라우저에서 이 사이트 데이터를 삭제해 주세요.";
  }

  /**
   * @param {StockBootCacheClearOptions} [opts]
   */
  function clearAll(opts) {
    var reload = !opts || opts.reload !== false;
    var tasks = [];
    if ("caches" in window) {
      tasks.push(
        caches.keys().then(function (keys) {
          return Promise.all(
            keys.map(function (k) {
              return caches.delete(k);
            }),
          );
        }),
      );
    }
    if ("serviceWorker" in navigator) {
      tasks.push(
        navigator.serviceWorker.getRegistrations().then(function (regs) {
          return Promise.all(
            regs.map(function (r) {
              return r.unregister();
            }),
          );
        }),
      );
    }
    return Promise.all(tasks)
      .then(function () {
        if (opts && opts.resetPurgeFlag) {
          try {
            localStorage.removeItem(PURGE_VERSION_KEY);
          } catch (e) {}
        }
      })
      .finally(function () {
        if (reload) location.reload();
      });
  }

  /** 프로덕션 첫 방문·버전 갱신 시 구 SW·캐시 정리 */
  function runVersionedBootPurge() {
    if (isViteDevBoot()) return;
    try {
      if (localStorage.getItem(PURGE_VERSION_KEY) === PURGE_VERSION) return;
      localStorage.setItem(PURGE_VERSION_KEY, PURGE_VERSION);
    } catch (e) {
      return;
    }
    if (!("serviceWorker" in navigator) && !("caches" in window)) return;
    var reloaded = false;
    function maybeReload() {
      if (reloaded) return;
      reloaded = true;
      if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        location.reload();
      }
    }
    clearAll({ reload: false }).then(maybeReload).catch(function () {});
  }

  window.__stockBootCache = {
    isViteDevBoot: isViteDevBoot,
    bootTimeoutMs: bootTimeoutMs,
    cacheHintText: cacheHintText,
    clearAll: clearAll,
    runVersionedBootPurge: runVersionedBootPurge,
  };

  runVersionedBootPurge();
})();
