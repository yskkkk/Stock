import { loadEnvFile } from "../server/load-env.js";
loadEnvFile();
import { dispatchNextVirtualUserImplement } from "../server/virtual-user-auto-implement.js";
import { ensureVirtualUserAutoImproveOnBoot } from "../server/virtual-user-api-guard.js";
import { reviewPendingVirtualFeedbackBatchSync } from "../server/virtual-user-manager.js";

ensureVirtualUserAutoImproveOnBoot();
reviewPendingVirtualFeedbackBatchSync({ limit: 20 });
const r = await dispatchNextVirtualUserImplement({ force: true });
console.log(JSON.stringify(r, null, 2));
