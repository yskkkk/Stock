/**
 * 계좌 보유 성향(성장/가치) 관리 API
 */
import { requireUserAuth } from "./user-auth.js";
import {
  getAccountHoldingStyleSnapshotSync,
  setAccountHoldingStyleOverrideSync,
} from "./account-holding-style-store.js";
import { isAccountHoldingStyle } from "../shared/account-holding-style-policy.js";

function asyncRoute(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

/**
 * @param {import("express").Application} app
 */
export function registerAccountHoldingStyleRoutes(app) {
  app.get(
    "/api/user/account-holding-style",
    requireUserAuth,
    asyncRoute(async (req, res) => {
      res.json(getAccountHoldingStyleSnapshotSync(req.user.id));
    }),
  );

  app.put(
    "/api/user/account-holding-style/override",
    requireUserAuth,
    asyncRoute(async (req, res) => {
      const body = req.body ?? {};
      const symbol = String(body.symbol ?? "").trim();
      let style = body.style;
      if (style === "" || style === "auto" || style === "null") style = null;
      if (style != null && !isAccountHoldingStyle(style)) {
        res.status(400).json({ ok: false, error: "invalid-style" });
        return;
      }
      if (!symbol) {
        res.status(400).json({ ok: false, error: "invalid-symbol" });
        return;
      }
      const out = setAccountHoldingStyleOverrideSync(req.user.id, symbol, style);
      if (!out.ok) {
        res.status(400).json(out);
        return;
      }
      res.json({
        ok: true,
        ...out,
        ...getAccountHoldingStyleSnapshotSync(req.user.id),
      });
    }),
  );
}
