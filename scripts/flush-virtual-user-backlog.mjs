import { loadEnvFile } from "../server/load-env.js";
loadEnvFile();
import { ensureVirtualUserAutoImproveOnBoot } from "../server/virtual-user-api-guard.js";
import { reviewPendingVirtualFeedbackBatchSync } from "../server/virtual-user-manager.js";
import {
  ensureDefaultPersonasPresentSync,
  getVirtualUserContinuousSync,
  listVirtualFeedbackSync,
  trimVirtualFeedbackList,
  readVirtualUserStoreSync,
  writeVirtualUserStoreSync,
} from "../server/virtual-user-store.js";

ensureDefaultPersonasPresentSync();
const boot = ensureVirtualUserAutoImproveOnBoot();

const store = readVirtualUserStoreSync();
const before = store.feedback.length;
store.feedback = trimVirtualFeedbackList(store.feedback);
if (store.feedback.length !== before) {
  writeVirtualUserStoreSync(store);
}

let reviewed = 0;
for (let i = 0; i < 20; i += 1) {
  const r = reviewPendingVirtualFeedbackBatchSync({ limit: 20 });
  reviewed += Number(r.reviewed) || 0;
  if (!r.reviewed) break;
}

const counts = {};
for (const f of listVirtualFeedbackSync()) {
  counts[f.status] = (counts[f.status] || 0) + 1;
}
const c = getVirtualUserContinuousSync();
console.log(
  JSON.stringify(
    {
      boot,
      reviewed,
      counts,
      enabled: c.enabled,
      autoImplement: c.autoImplement,
    },
    null,
    2,
  ),
);
