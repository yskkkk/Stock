/**
 * BYOK credential API
 */
import {
  deleteUserCredentialSync,
  getCredentialMetaSync,
  listCredentialMetaForUserSync,
  testUserCredentialAsync,
  upsertUserCredentialSync,
} from "./user-credentials-store.js";
import { isCredentialsCryptoReady } from "./credentials-crypto.js";
import { requireUserAuth } from "./user-auth.js";

function asyncRoute(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

/**
 * @param {import("express").Application} app
 */
export function registerUserCredentialRoutes(app) {
  app.get(
    "/api/user/credentials",
    requireUserAuth,
    (req, res) => {
      res.json({
        ok: true,
        cryptoReady: isCredentialsCryptoReady(),
        ...listCredentialMetaForUserSync(req.user.id),
      });
    },
  );

  app.get(
    "/api/user/credentials/:exchange",
    requireUserAuth,
    (req, res) => {
      const exchange = String(req.params.exchange ?? "").trim().toLowerCase();
      if (exchange !== "bithumb" && exchange !== "toss") {
        res.status(400).json({ error: "exchange는 bithumb 또는 toss 입니다." });
        return;
      }
      res.json({
        ok: true,
        credential: getCredentialMetaSync(req.user.id, exchange),
        cryptoReady: isCredentialsCryptoReady(),
      });
    },
  );

  app.put(
    "/api/user/credentials/:exchange",
    requireUserAuth,
    (req, res) => {
      try {
        const exchange = String(req.params.exchange ?? "").trim().toLowerCase();
        if (exchange !== "bithumb" && exchange !== "toss") {
          res.status(400).json({ error: "exchange는 bithumb 또는 toss 입니다." });
          return;
        }
        const meta = upsertUserCredentialSync(req.user.id, exchange, {
          apiKey: String(req.body?.apiKey ?? ""),
          secretKey: req.body?.secretKey,
          liveOrdersEnabled: req.body?.liveOrdersEnabled,
        });
        res.json({ ok: true, credential: meta });
      } catch (e) {
        res.status(400).json({
          error: e instanceof Error ? e.message : String(e),
        });
      }
    },
  );

  app.delete(
    "/api/user/credentials/:exchange",
    requireUserAuth,
    (req, res) => {
      try {
        const exchange = String(req.params.exchange ?? "").trim().toLowerCase();
        deleteUserCredentialSync(req.user.id, exchange);
        res.json({ ok: true });
      } catch (e) {
        res.status(400).json({
          error: e instanceof Error ? e.message : String(e),
        });
      }
    },
  );

  app.post(
    "/api/user/credentials/:exchange/test",
    requireUserAuth,
    asyncRoute(async (req, res) => {
      try {
        const exchange = String(req.params.exchange ?? "").trim().toLowerCase();
        const result = await testUserCredentialAsync(req.user.id, exchange, {
          apiKey: req.body?.apiKey,
          secretKey: req.body?.secretKey,
        });
        res.json(result);
      } catch (e) {
        res.status(400).json({
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }),
  );
}
