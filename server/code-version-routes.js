/**
 * 코드 버전·롤백 API
 */
import { requireAccessAdmin } from "./route-guards.js";
import {
  createCodeVersionSync,
  ensureBaselineCodeVersionSync,
  listCodeVersionsSync,
  migrateBaselineToPreVirtualUserSync,
  readCodeVersionStoreSync,
  rollbackToCodeVersionSync,
} from "./code-version-store.js";
import { getCodeBranch, getCodeHeadShort, getCodeWorktreeState } from "./code-version-git.js";

/**
 * @param {import("express").Express} app
 * @param {(handler: (req: any, res: any) => Promise<void>) => import("express").RequestHandler} asyncRoute
 */
export function registerCodeVersionRoutes(app, asyncRoute) {
  app.get(
    "/api/code-versions",
    requireAccessAdmin,
    asyncRoute(async (_req, res) => {
      migrateBaselineToPreVirtualUserSync();
      ensureBaselineCodeVersionSync();
      const store = readCodeVersionStoreSync();
      const wt = getCodeWorktreeState();
      res.json({
        ok: true,
        baselineId: store.baselineId,
        lockedBaselineSha: store.lockedBaselineSha,
        versions: store.versions,
        headShort: getCodeHeadShort(),
        branch: getCodeBranch(),
        dirty: wt.dirty,
      });
    }),
  );

  app.post(
    "/api/code-versions/baseline",
    requireAccessAdmin,
    asyncRoute(async (req, res) => {
      const force = req.body?.force === true;
      const result = force
        ? ensureBaselineCodeVersionSync({
            force: true,
            pinToPreVirtualUser: true,
          })
        : (() => {
            const m = migrateBaselineToPreVirtualUserSync();
            return m.ok
              ? m
              : ensureBaselineCodeVersionSync({ pinToPreVirtualUser: true });
          })();
      if (!result.ok) {
        res.status(400).json(result);
        return;
      }
      res.json({
        ok: true,
        version: result.version,
        created: Boolean(result.created || result.migrated),
        versions: listCodeVersionsSync(),
        lockedBaselineSha: readCodeVersionStoreSync().lockedBaselineSha,
      });
    }),
  );

  app.post(
    "/api/code-versions",
    requireAccessAdmin,
    asyncRoute(async (req, res) => {
      const label = String(req.body?.label ?? "").trim() || "수동 스냅샷";
      const result = createCodeVersionSync({
        label,
        kind: "manual",
        note: String(req.body?.note ?? "").slice(0, 400),
        commitIfDirty: req.body?.commitIfDirty === true,
      });
      if (!result.ok) {
        res.status(400).json(result);
        return;
      }
      res.json(result);
    }),
  );

  app.post(
    "/api/code-versions/:id/rollback",
    requireAccessAdmin,
    asyncRoute(async (req, res) => {
      const id = String(req.params.id ?? "").trim();
      if (!id) {
        res.status(400).json({ ok: false, error: "version id 필요" });
        return;
      }
      const result = rollbackToCodeVersionSync(id);
      if (!result.ok) {
        res.status(400).json(result);
        return;
      }
      res.json({
        ...result,
        versions: listCodeVersionsSync(),
        headShort: getCodeHeadShort(),
      });
    }),
  );
}
