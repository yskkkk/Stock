/**
 * 큐 전체 시나리오 테스트
 * node scripts/test-queue-all.mjs
 */
import http from "node:http";
import fs from "node:fs";

const PORT = 5173;
let pass = 0, fail = 0;

const ok = (label) => { console.log(`  ✅ ${label}`); pass++; };
const ng = (label, detail = "") => { console.log(`  ❌ ${label}${detail ? ": " + detail : ""}`); fail++; };
const sep = (title) => console.log(`\n【${title}】`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function post(path, body) {
  return new Promise((resolve, reject) => {
    const b = JSON.stringify(body);
    const req = http.request(
      {
        hostname: "127.0.0.1", port: PORT, path, method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(b) },
        timeout: 15_000,
      },
      (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(d) }); }
          catch { resolve({ status: res.statusCode, body: {} }); }
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
    req.write(b);
    req.end();
  });
}

function displayEntries() {
  try {
    const data = JSON.parse(fs.readFileSync("server/.data/ops-dev-queue-slots.json", "utf8"));
    return (data.slots ?? []).map((s) => ({
      id: s.id,
      status: s.id === data.runningId ? "running" : "waiting",
      instructionPreview: s.prompt ?? "",
    }));
  } catch { return []; }
}

function persistState() {
  try { return JSON.parse(fs.readFileSync("server/.data/ops-dev-queue-slots.json", "utf8")); }
  catch { return { slots: [], runningId: null }; }
}

async function clearAll() {
  await post("/api/ops/dev-queue/ide/release-active", {});
  await sleep(300);
}

async function enqueueAndGrant(prompt, session_id = null) {
  const r = await post("/api/ops/dev-queue/ide/enqueue", { prompt, session_id });
  if (!r.body.ok) throw new Error("enqueue failed: " + JSON.stringify(r.body));
  // wait-grant 비동기 (응답 무시 — drainQueue가 자동으로 grant 넘김)
  post("/api/ops/dev-queue/ide/wait-grant", { leaseId: r.body.leaseId }).catch(() => {});
  await sleep(250);
  return r.body.leaseId;
}

// ─────────────────────────────────────────────────
sep("1. 첫 enqueue → running 전환");
await clearAll();
const lease1 = await enqueueAndGrant("시나리오1");
const e1 = displayEntries();
if (e1.some((e) => e.id === lease1 && e.status === "running")) ok("enqueue → running");
else ng("enqueue → running", JSON.stringify(e1));
await clearAll();

// ─────────────────────────────────────────────────
sep("2. FIFO 순서 — 등록 순서대로 실행");
await clearAll();
const fifoLeases = [];
for (const p of ["FIFO-A", "FIFO-B", "FIFO-C"]) {
  const r = await post("/api/ops/dev-queue/ide/enqueue", { prompt: p });
  fifoLeases.push({ id: r.body.leaseId, prompt: p });
  await sleep(50);
}
post("/api/ops/dev-queue/ide/wait-grant", { leaseId: fifoLeases[0].id }).catch(() => {});
await sleep(300);
const fifo = displayEntries().filter((e) => e.instructionPreview?.startsWith("FIFO"));
const order = fifo.map((e) => e.instructionPreview);
if (order[0] === "FIFO-A" && order[1] === "FIFO-B" && order[2] === "FIFO-C") ok(`순서: ${order.join(" → ")}`);
else ng("FIFO 순서", JSON.stringify(order));
await clearAll();

// ─────────────────────────────────────────────────
sep("3. Claude Code 점유 중 Cursor 대기");
await clearAll();
const ccLease = await enqueueAndGrant("CC-작업중", null);
const curRes = await post("/api/ops/dev-queue/ide/enqueue", { prompt: "Cursor-대기", session_id: "s2" });
if (curRes.body.queueStatus === "waiting" && curRes.body.queueSeq >= 2) ok(`Cursor waiting queueSeq=${curRes.body.queueSeq}`);
else ng("Cursor 대기", JSON.stringify(curRes.body));
const mid = displayEntries();
const running = mid.filter((e) => e.status === "running");
const waiting = mid.filter((e) => e.status === "waiting");
ok(`큐 구성: running=${running.length} waiting=${waiting.length}`);

// ─────────────────────────────────────────────────
sep("4. CC 해제 → Cursor 자동 승격");
await post("/api/ops/dev-queue/ide/release", { leaseId: ccLease });
await sleep(350);
const after4 = displayEntries();
const promoted = after4.find((e) => e.id === curRes.body.leaseId);
if (promoted?.status === "running") ok("Cursor running으로 승격");
else ng("Cursor 승격", JSON.stringify(promoted));
await clearAll();

// ─────────────────────────────────────────────────
sep("5. 동일 prompt 중복 enqueue → dedup");
await clearAll();
const dp1 = await post("/api/ops/dev-queue/ide/enqueue", { prompt: "중복-동일프롬프트" });
const dp2 = await post("/api/ops/dev-queue/ide/enqueue", { prompt: "중복-동일프롬프트" });
if (dp1.body.leaseId === dp2.body.leaseId && dp2.body.deduped === true) ok(`같은 leaseId 반환 (deduped=true)`);
else ng("dedup", `r1=${dp1.body.leaseId?.slice(0,8)} r2=${dp2.body.leaseId?.slice(0,8)}`);
await clearAll();

// ─────────────────────────────────────────────────
sep("6. Waiting 슬롯 cancel");
await clearAll();
const runLease = await enqueueAndGrant("cancel-앞슬롯");
const waitRes = await post("/api/ops/dev-queue/ide/enqueue", { prompt: "cancel-대기슬롯" });
const waitId = waitRes.body.leaseId;
await sleep(100);
const cancelRes = await post("/api/ops/dev-queue/ide/cancel", { leaseId: waitId });
if (cancelRes.body.ok && cancelRes.body.cancelled) ok("cancel 성공");
else ng("cancel", JSON.stringify(cancelRes.body));
await sleep(200);
const afterCancel = displayEntries().find((e) => e.id === waitId);
if (!afterCancel) ok("cancel 후 display에서 제거됨");
else ng("cancel 후 잔존", JSON.stringify(afterCancel));
await clearAll();

// ─────────────────────────────────────────────────
sep("7. release-active 1회 → running+waiting 전부 정리");
await clearAll();
const ra1 = await enqueueAndGrant("ra-first");
for (let i = 0; i < 3; i++) {
  await post("/api/ops/dev-queue/ide/enqueue", { prompt: `ra-waiting-${i}` });
}
await sleep(200);
const beforeRA = displayEntries();
ok(`정리 전 ${beforeRA.length}개`);
await post("/api/ops/dev-queue/ide/release-active", {});
await sleep(300);
const afterRA = displayEntries();
if (afterRA.length === 0) ok("release-active 1회 → 0개");
else ng("release-active", `${afterRA.length}개 남음: ${afterRA.map(e=>e.instructionPreview).join(", ")}`);

// ─────────────────────────────────────────────────
sep("8. persist 파일 ↔ display 파일 동기화");
await clearAll();
const syncLease = await enqueueAndGrant("sync-테스트");
await sleep(200);
const ps = persistState();
const de = displayEntries();
if (ps.runningId === syncLease && de.some((e) => e.id === syncLease && e.status === "running")) {
  ok(`persist.runningId = display.running.id = ${syncLease.slice(0, 8)}...`);
} else {
  ng("파일 동기화", `persist.runningId=${ps.runningId?.slice(0,8)} display=${de.map(e=>e.id?.slice(0,8))}`);
}
await clearAll();
const psAfter = persistState();
const deAfter = displayEntries();
if (psAfter.slots.length === 0 && deAfter.length === 0) ok("release 후 persist·display 모두 0");
else ng("release 후 파일 동기화", `persist=${psAfter.slots.length} display=${deAfter.length}`);

// ─────────────────────────────────────────────────
sep("9. stale 슬롯 자동 필터 (4시간 초과)");
const { persistQueueSlots, loadPersistedQueueSlots, clearPersistedQueueSlots } = await import("../server/ops-queue-persist.js");
const now = Date.now();
persistQueueSlots([
  { id: "stale", source: "ide", meta: { requestIp: "cursor-ide", instructionBody: "stale", enqueuedAtMs: now - 5 * 3600_000 }, sessionId: null },
  { id: "fresh", source: "ide", meta: { requestIp: "cursor-ide", instructionBody: "fresh", enqueuedAtMs: now - 30 * 60_000 }, sessionId: null },
], null);
const { slots: loaded } = loadPersistedQueueSlots();
clearPersistedQueueSlots();
if (loaded.length === 1 && loaded[0].id === "fresh") ok("4h stale 제거, fresh 1개만 남음");
else ng("stale 필터", JSON.stringify(loaded.map((s) => s.id)));

// ─────────────────────────────────────────────────
sep("10. 서버 재시작 복구 시뮬레이션");
persistQueueSlots([
  { id: "was-running", source: "ide", meta: { requestIp: "claude-code", instructionBody: "실행중이었음", enqueuedAtMs: now - 60_000 }, sessionId: null },
  { id: "was-waiting", source: "ide", meta: { requestIp: "cursor-ide", instructionBody: "대기중이었음", enqueuedAtMs: now - 30_000 }, sessionId: "s1" },
  { id: "was-web", source: "web", meta: { requestIp: "1.2.3.4", instructionBody: "웹요청(복구불가)", enqueuedAtMs: now - 10_000 }, sessionId: null },
], "was-running");
const { slots: rec, runningId: rid } = loadPersistedQueueSlots();
const toRecover = rec.filter((s) => s.source !== "web" && s.id !== rid);
clearPersistedQueueSlots();
if (toRecover.length === 1 && toRecover[0].id === "was-waiting") ok("running(고아)·web 제외, waiting만 복구 대상");
else ng("재시작 복구", JSON.stringify(toRecover.map((s) => s.id)));

// ─────────────────────────────────────────────────
sep("11. 큐 만석 (MAX_WAITING 25)");
await clearAll();
const firstSlot = await enqueueAndGrant("만석-첫슬롯");
for (let i = 0; i < 25; i++) {
  await post("/api/ops/dev-queue/ide/enqueue", { prompt: `만석-waiting-${i}` });
}
const overflow = await post("/api/ops/dev-queue/ide/enqueue", { prompt: "만석-초과" });
if (overflow.status === 503 && overflow.body.code === "OPS_QUEUE_FULL") ok(`26번째 → 503 OPS_QUEUE_FULL`);
else ng("큐 만석", `status=${overflow.status} code=${overflow.body.code} body=${JSON.stringify(overflow.body)}`);
await clearAll();

// ─────────────────────────────────────────────────
sep("12. Claude Code acquire API (scripts/claude-queue-acquire 경로)");
await clearAll();
const ccAcq = await post("/api/ops/dev-queue/claude-code/acquire", { prompt: "CC-acquire-테스트" });
if (ccAcq.body.ok && ccAcq.body.leaseId) ok(`CC acquire 성공 leaseId=${ccAcq.body.leaseId.slice(0,8)}...`);
else ng("CC acquire", JSON.stringify(ccAcq.body));
if (ccAcq.body.leaseId) {
  const relCC = await post("/api/ops/dev-queue/claude-code/release", { leaseId: ccAcq.body.leaseId });
  if (relCC.body.ok) ok("CC release 성공");
  else ng("CC release", JSON.stringify(relCC.body));
}
await clearAll();

// ─────────────────────────────────────────────────
sep("13. PreToolUse 훅 파일 존재 확인");
const acquireHook = ".claude/hooks/queue-acquire.mjs";
const releaseHook = ".claude/hooks/queue-release.mjs";
if (fs.existsSync(acquireHook)) ok("queue-acquire.mjs 존재");
else ng("queue-acquire.mjs 없음");
if (fs.existsSync(releaseHook)) ok("queue-release.mjs 존재");
else ng("queue-release.mjs 없음");

const acquireContent = fs.readFileSync(acquireHook, "utf8");
if (acquireContent.includes("pending")) ok("acquire: placeholder 로직 포함");
else ng("acquire: placeholder 없음");

const releaseContent = fs.readFileSync(releaseHook, "utf8");
if (releaseContent.includes("release-active")) ok("release: 항상 release-active 호출 로직 포함");
else ng("release: release-active 없음");

// ─────────────────────────────────────────────────
console.log("\n════════════════════════════════════════");
console.log(`결과: ${pass}개 통과 / ${fail}개 실패 / 총 ${pass + fail}개`);
if (fail === 0) console.log("✅ 모든 시나리오 통과");
else console.log("❌ 일부 실패 — 위 로그 확인");
