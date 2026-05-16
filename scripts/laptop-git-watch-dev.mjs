/**
 * 노트북 전용: 원격(GitHub 등)에 새 커밋이 올라오면 pull 후 `npm run dev`를 다시 띄움.
 *
 * [노트북 — 처음 한 번]
 *   git clone <저장소 URL>
 *   cd <프로젝트 폴더>
 *   npm install
 *
 * [노트북 — 매번 서버 켤 때]
 *   npm run dev:watch
 *   (이 창은 닫지 말고 두기)
 *
 * [개발하는 PC — 코드 올릴 때]
 *   git add / commit / push (노트북이 pull 하는 브랜치와 같아야 함)
 *
 * 환경변수(선택):
 *   WATCH_INTERVAL_MS — 원격 확인 주기(ms). 기본 30000(30초)
 */
import { execSync, spawn } from "node:child_process";
import process from "node:process";
import treeKill from "tree-kill";

const INTERVAL_MS = Number(process.env.WATCH_INTERVAL_MS) || 30_000;
const ROOT = process.cwd();

function execGit(cmd, { inherit = false } = {}) {
  return execSync(cmd, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: inherit ? "inherit" : "pipe",
  });
}

function currentBranch() {
  return execGit("git rev-parse --abbrev-ref HEAD").trim();
}

function revParse(ref) {
  return execGit(`git rev-parse ${ref}`).trim();
}

let devProc = null;

function stopDev() {
  return new Promise((resolve) => {
    if (!devProc || !devProc.pid) {
      devProc = null;
      resolve();
      return;
    }
    const pid = devProc.pid;
    devProc = null;
    treeKill(pid, "SIGTERM", (err) => {
      if (err) console.warn("[dev:watch] 종료 경고:", err.message);
      resolve();
    });
  });
}

function startDev() {
  devProc = spawn("npm", ["run", "dev"], {
    cwd: ROOT,
    shell: true,
    stdio: "inherit",
    env: process.env,
  });
  devProc.on("exit", (code, signal) => {
    console.log(
      `[dev:watch] npm run dev 종료 code=${code} signal=${signal ?? ""}`,
    );
  });
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const shutdown = async () => {
    console.log("\n[dev:watch] 종료 중…");
    await stopDev();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  try {
    execGit("git rev-parse --is-inside-work-tree", {});
  } catch {
    console.error("[dev:watch] Git 저장소가 아닙니다. clone 한 폴더에서 실행하세요.");
    process.exit(1);
  }

  const branch = currentBranch();
  const remoteRef = `origin/${branch}`;
  console.log(
    `[dev:watch] 브랜치 '${branch}' 감시 · ${INTERVAL_MS / 1000}초마다 확인 · Ctrl+C 로 종료`,
  );

  startDev();

  for (;;) {
    await sleep(INTERVAL_MS);
    try {
      execGit(`git fetch origin ${branch}`, { inherit: true });
      const local = revParse("HEAD");
      const remote = revParse(remoteRef);
      if (local === remote) continue;

      console.log(`[dev:watch] 원격에 새 커밋 있음 → pull 후 서버 재시작`);
      await stopDev();
      execGit(`git pull --ff-only origin ${branch}`, { inherit: true });
      startDev();
    } catch (e) {
      console.error(
        "[dev:watch] fetch/pull 실패 (네트워크·충돌·로그인 확인):",
        e?.message ?? e,
      );
      if (!devProc) startDev();
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
