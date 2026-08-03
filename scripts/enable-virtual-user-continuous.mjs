import { loadEnvFile } from "../server/load-env.js";
loadEnvFile();
import {
  ensureDefaultPersonasPresentSync,
  getVirtualUserContinuousSync,
} from "../server/virtual-user-store.js";
import { ensureVirtualUserAutoImproveOnBoot } from "../server/virtual-user-api-guard.js";

ensureDefaultPersonasPresentSync();
const boot = ensureVirtualUserAutoImproveOnBoot();
const c = getVirtualUserContinuousSync();
console.log(
  JSON.stringify(
    {
      boot,
      enabled: c.enabled,
      autoImplement: c.autoImplement,
      paused: c.pausedByApiExhaustion,
    },
    null,
    2,
  ),
);
