import express from "express";
import { isDartEnabled } from "./dart.js";
import {
  ensureScreening,
  forceRescreen,
  getPicksState,
} from "./screener.js";
import {
  clearTodayTelegramSent,
  getTelegramNotifyStatus,
  isTelegramNotifyEnabled,
  listTodayTelegramSent,
} from "./telegram-notify.js";
import { loadNews } from "./news.js";
import { loadCryptoQuotes } from "./crypto-quotes.js";
import { loadCryptoWatchlistTen } from "./crypto-universe.js";
import { loadStock } from "./stock-data.js";
import { getMacroEventsCached } from "./macro-events.js";

function asyncRoute(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

export function createApp() {
  const app = express();
  app.use(express.json());

  app.get("/api/picks", (req, res) => {
    ensureScreening();
    res.json(getPicksState());
  });

  app.post("/api/picks/refresh", (_req, res) => {
    res.json(forceRescreen());
  });

  app.get("/api/macro-events", (_req, res) => {
    res.json(getMacroEventsCached());
  });

  app.get("/api/config", (_req, res) => {
    res.json({
      dartEnabled: isDartEnabled(),
      telegramNotify: getTelegramNotifyStatus(),
    });
  });

  app.get("/api/telegram/sent", (_req, res) => {
    if (!isTelegramNotifyEnabled()) {
      res.status(400).json({
        error: "텔레그램 알림이 설정되지 않았습니다.",
      });
      return;
    }
    const items = listTodayTelegramSent();
    const pickBySymbol = new Map();
    for (const p of [...getPicksState().kr, ...getPicksState().us]) {
      pickBySymbol.set(`${p.market}:${p.symbol}`, p);
    }
    const enriched = items.map((item) => {
      const pick = pickBySymbol.get(`${item.market}:${item.symbol}`);
      if (!pick) return item;
      return {
        ...item,
        name: item.name === item.symbol && pick.name ? pick.name : item.name,
        price: item.price ?? pick.price ?? null,
        changePercent: item.changePercent ?? pick.changePercent ?? null,
        currency: item.currency ?? pick.currency ?? null,
      };
    });
    res.json({ items: enriched, count: enriched.length });
  });

  app.post("/api/telegram/reset-sent", (_req, res) => {
    if (!isTelegramNotifyEnabled()) {
      res.status(400).json({
        ok: false,
        message: "텔레그램 알림이 설정되지 않았습니다.",
      });
      return;
    }
    const { removed } = clearTodayTelegramSent();
    res.json({
      ok: true,
      removed,
      message:
        removed > 0
          ? `오늘 알림 이력 ${removed}건을 초기화했습니다. 조건 충족 시 다시 알림됩니다.`
          : "초기화할 오늘 알림 이력이 없습니다.",
    });
  });

  app.get(
    "/api/news/:symbol",
    asyncRoute(async (req, res) => {
      try {
        const symbol = req.params.symbol.toUpperCase();
        const name = String(req.query.name ?? "");
        const data = await loadNews(symbol, name);
        res.json(data);
      } catch (err) {
        const message = err instanceof Error ? err.message : "요청 실패";
        res.status(404).json({ error: message });
      }
    }),
  );

  app.get(
    "/api/crypto-universe",
    asyncRoute(async (_req, res) => {
      try {
        const data = await loadCryptoWatchlistTen();
        res.json(data);
      } catch (err) {
        const message = err instanceof Error ? err.message : "요청 실패";
        res.status(404).json({ error: message });
      }
    }),
  );

  app.get(
    "/api/crypto-quotes",
    asyncRoute(async (req, res) => {
      try {
        const raw = String(req.query.symbols ?? "").trim();
        const symbols = raw
          ? raw
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          : undefined;
        const data = await loadCryptoQuotes(symbols);
        res.json(data);
      } catch (err) {
        const message = err instanceof Error ? err.message : "요청 실패";
        res.status(404).json({ error: message });
      }
    }),
  );

  app.get(
    "/api/stock/:symbol",
    asyncRoute(async (req, res) => {
      try {
        const symbol = req.params.symbol.toUpperCase();
        const timeframe = String(req.query.timeframe ?? req.query.period ?? "1d");
        const live = req.query.live === "1" || req.query.live === "true";
        const data = await loadStock(symbol, timeframe, { live });
        res.json(data);
      } catch (err) {
        const message = err instanceof Error ? err.message : "요청 실패";
        res.status(404).json({ error: message });
      }
    }),
  );

  app.use((err, _req, res, _next) => {
    const message = err instanceof Error ? err.message : "요청 실패";
    if (!res.headersSent) {
      res.status(500).json({ error: message });
    }
  });

  return app;
}
