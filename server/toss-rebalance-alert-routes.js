/**
 * 토스 계좌 — 성장/가치 괴리 알림 설정 API (계좌관리 · 토스만)
 */
import { requireUserAuth } from "./user-auth.js";
import {
  readTossRebalanceAlertSettingsSync,
  updateTossRebalanceAlertSettingsSync,
} from "./toss-rebalance-alert-store.js";

function asyncRoute(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

/**
 * @param {import("express").Application} app
 */
export function registerTossRebalanceAlertRoutes(app) {
  app.get(
    "/api/user/toss-rebalance-alert",
    requireUserAuth,
    asyncRoute(async (req, res) => {
      const settings = readTossRebalanceAlertSettingsSync(req.user.id);
      res.json({ ok: true, settings });
    }),
  );

  app.put(
    "/api/user/toss-rebalance-alert",
    requireUserAuth,
    asyncRoute(async (req, res) => {
      const body = req.body ?? {};
      const out = updateTossRebalanceAlertSettingsSync(req.user.id, {
        enabled: body.enabled,
        thresholdPctPoints: body.thresholdPctPoints,
      });
      if (!out.ok) {
        res.status(400).json(out);
        return;
      }
      res.json({ ok: true, settings: out.settings });
    }),
  );
}
