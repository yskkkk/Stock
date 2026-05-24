/**
 * BYOK credential API
 */
import {
  deleteUserCredentialSync,
  getBithumbAccountSnapshotForUserAsync,
  getCredentialMetaSync,
  listCredentialMetaForUserSync,
  testUserCredentialAsync,
  upsertUserCredentialSync,
} from "./user-credentials-store.js";
import { isCredentialsCryptoReady } from "./credentials-crypto.js";
import { assertUserAccountPassword, requireUserAuth } from "./user-auth.js";

function asyncRoute(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

/**
 * @param {string} userId
 * @param {string} exchange
 * @param {unknown} accountPassword
 */
function requireAccountPasswordForExistingCredential(userId, exchange, accountPassword) {
  const meta = getCredentialMetaSync(userId, exchange);
  if (meta.source !== "user" || !meta.configured) return;
  assertUserAccountPassword(userId, accountPassword);
}

/**
 * @param {import("express").Application} app
 */
export function registerUserCredentialRoutes(app) {
  app.get(
    "/api/user/bithumb/account-snapshot",
    requireUserAuth,
    asyncRoute(async (req, res) => {
      try {
        const out = await getBithumbAccountSnapshotForUserAsync(req.user.id);
        res.json({ ok: true, ...out });
      } catch (e) {
        res.status(400).json({
          ok: false,
          ready: false,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }),
  );

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
        const body = req.body ?? {};
        /** @type {{ apiKey?: string; secretKey?: string; liveOrdersEnabled?: boolean }} */
        const input = {};
        if (Object.prototype.hasOwnProperty.call(body, "apiKey")) {
          input.apiKey = String(body.apiKey ?? "");
        }
        if (Object.prototype.hasOwnProperty.call(body, "secretKey")) {
          input.secretKey = String(body.secretKey ?? "").trim();
        }
        if (Object.prototype.hasOwnProperty.call(body, "accountId")) {
          input.accountId = String(body.accountId ?? "").trim();
        }
        if (Object.prototype.hasOwnProperty.call(body, "liveOrdersEnabled")) {
          input.liveOrdersEnabled = Boolean(body.liveOrdersEnabled);
        }
        requireAccountPasswordForExistingCredential(
          req.user.id,
          exchange,
          body.accountPassword,
        );
        const meta = upsertUserCredentialSync(req.user.id, exchange, input);
        res.json({ ok: true, credential: meta });
      } catch (e) {
        const code =
          e && typeof e === "object" && "code" in e ? String(e.code) : undefined;
        const status =
          code === "INVALID_ACCOUNT_PASSWORD" || code === "ACCOUNT_PASSWORD_REQUIRED"
            ? 401
            : 400;
        res.status(status).json({
          error: e instanceof Error ? e.message : String(e),
          code,
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
        if (exchange !== "bithumb" && exchange !== "toss") {
          res.status(400).json({ error: "exchange는 bithumb 또는 toss 입니다." });
          return;
        }
        requireAccountPasswordForExistingCredential(
          req.user.id,
          exchange,
          req.body?.accountPassword,
        );
        deleteUserCredentialSync(req.user.id, exchange);
        res.json({ ok: true });
      } catch (e) {
        const code =
          e && typeof e === "object" && "code" in e ? String(e.code) : undefined;
        const status =
          code === "INVALID_ACCOUNT_PASSWORD" || code === "ACCOUNT_PASSWORD_REQUIRED"
            ? 401
            : 400;
        res.status(status).json({
          error: e instanceof Error ? e.message : String(e),
          code,
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
          accountId: req.body?.accountId,
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
