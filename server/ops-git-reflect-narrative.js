/**
 * Git 반영 → 텔레그램용 짧은 설명문 (파일 경로·목록 없음).
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function gitOut(args) {
  return execFileSync("git", args, {
    cwd: REPO,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

/** @param {string} raw */
function stripHashFromOneline(raw) {
  const t = String(raw).trim();
  const sp = t.indexOf(" ");
  return sp > 0 ? t.slice(sp + 1).trim() : t;
}

/**
 * @param {string} range `A..B` or `-1`
 * @returns {string[]}
 */
function commitSubjectsInRange(range) {
  try {
    const args = ["log", "--format=%s"];
    if (range === "-1") {
      args.push("-n", "1");
    } else {
      args.push(range);
    }
    const out = gitOut(args);
    return out.split("\n").map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * @param {string} oldRev
 * @param {string} newRev
 * @returns {string}
 */
function changeScaleSentence(oldRev, newRev) {
  try {
    const stat = gitOut([
      "diff",
      "--shortstat",
      String(oldRev),
      String(newRev),
    ]).trim();
    if (!stat) return "";
    const mFiles = stat.match(/(\d+)\s+files?\s+changed/);
    const mIns = stat.match(/(\d+)\s+insertions?\(\+\)/);
    const mDel = stat.match(/(\d+)\s+deletions?\(-\)/);
    const parts = [];
    if (mFiles) parts.push(`${mFiles[1]}개 파일`);
    if (mIns || mDel) {
      const ins = mIns ? `추가 ${mIns[1]}줄` : "";
      const del = mDel ? `삭제 ${mDel[1]}줄` : "";
      parts.push([ins, del].filter(Boolean).join(" · "));
    }
    return parts.length ? `변경 규모: ${parts.join(", ")}.` : "";
  } catch {
    return "";
  }
}

/** @param {string[]} subjects */
function inferThemeLabels(subjects) {
  const rules = [
    { re: /telegram|텔레그램/i, label: "텔레그램·알림" },
    { re: /ops|에이전트|cursor|queue|큐/i, label: "웹·IDE 운영·에이전트" },
    { re: /auto-git|git|pull|push|deploy/i, label: "Git·서버 동기화" },
    { re: /vite|dev|5173|port/i, label: "개발 서버(Vite)" },
    { re: /sim|live-trade|실매매|매매/i, label: "시뮬·실매매" },
    { re: /crypto|암호|bithumb/i, label: "암호화폐" },
    { re: /pick|screener|추천|종목/i, label: "종목·스크리너" },
    { re: /macro|경제|지표/i, label: "경제 지표" },
    { re: /i18n|locale|ko\b/i, label: "다국어" },
    { re: /ui|css|tsx|화면|모바일/i, label: "화면·UI" },
    { re: /access|접근|ip\b/i, label: "접근 제어" },
    { re: /^fix|버그|수정/i, label: "버그·오류 수정" },
    { re: /^feat|기능/i, label: "기능 추가" },
    { re: /^chore|refactor/i, label: "정리·리팩터" },
    { re: /^test|vitest/i, label: "테스트" },
  ];
  const hit = new Set();
  const blob = subjects.join("\n");
  for (const { re, label } of rules) {
    if (re.test(blob)) hit.add(label);
  }
  return [...hit].slice(0, 6);
}

/**
 * @param {string[]} subjects
 * @param {number} max
 */
function formatCommitBullets(subjects, max = 8) {
  const lines = [];
  for (const s of subjects.slice(0, max)) {
    const clean = s.replace(/^(\w+)(?:\([^)]*\))?!?:\s*/, "").trim() || s;
    lines.push(`· ${clean}`);
  }
  if (subjects.length > max) {
    lines.push(`· … 외 ${subjects.length - max}건`);
  }
  return lines;
}

/**
 * @param {{
 *   intro: string;
 *   subjects: string[];
 *   scale?: string;
 *   footer?: string;
 * }} p
 */
function assembleNarrative(p) {
  const parts = [p.intro];
  const themes = inferThemeLabels(p.subjects);
  if (themes.length) {
    parts.push(`\n다룬 영역: ${themes.join(", ")}.`);
  }
  if (p.subjects.length) {
    parts.push("\n반영 내용:");
    parts.push(formatCommitBullets(p.subjects).join("\n"));
  }
  if (p.scale) parts.push(`\n${p.scale}`);
  if (p.footer) parts.push(`\n${p.footer}`);
  return parts.join("").trim();
}

/**
 * pull·push 등 구간 — auto-git·IDE 등.
 * @param {string} oldRev
 * @param {string} newRev
 */
export function summarizeGitPullRangeForNotify(oldRev, newRev) {
  if (String(oldRev) === String(newRev)) {
    return summarizeGitReflectionForNotify("local");
  }
  try {
    const branch = gitOut(["rev-parse", "--abbrev-ref", "HEAD"]);
    const subjects = commitSubjectsInRange(`${String(oldRev)}..${String(newRev)}`);
    const n = subjects.length;
    const intro =
      n === 0
        ? `서버(${branch})에 원격 변경이 합쳐졌습니다. (커밋 메시지 없음)`
        : n === 1
          ? `서버(${branch})에 업데이트 1건이 적용되었습니다.`
          : `서버(${branch})에 업데이트 ${n}건이 순서대로 적용되었습니다.`;
    const scale = changeScaleSentence(oldRev, newRev);
    return assembleNarrative({
      intro,
      subjects,
      scale,
      footer:
        "이후 서버가 의존성·빌드를 갱신하고 재시작될 수 있습니다.",
    });
  } catch (e) {
    return `서버에 Git 변경이 반영되었습니다. (요약 생성 실패: ${
      e instanceof Error ? e.message : String(e)
    })`;
  }
}

/**
 * @param {"local"|"cloud"} mode
 */
export function summarizeGitReflectionForNotify(mode) {
  try {
    const branch = gitOut(["rev-parse", "--abbrev-ref", "HEAD"]);
    const oneline = gitOut(["log", "-1", "--oneline", "-n", "1"]);
    const subject = stripHashFromOneline(oneline);
    const subjects = subject ? [subject] : [];

    const via =
      mode === "cloud"
        ? "클라우드 에이전트가 GitHub에 올린 뒤, 이 서버가 원격과 맞춘"
        : "이 서버(웹 에이전트 후처리)에서 커밋·푸시한";

    const intro = `${via} 최신 작업이 ${branch}에 반영되었습니다.`;
    let scale = "";
    try {
      const stat = gitOut(["show", "-1", "--shortstat", "--pretty=format:"]).trim();
      if (stat) {
        const mFiles = stat.match(/(\d+)\s+files?\s+changed/);
        const mIns = stat.match(/(\d+)\s+insertions?\(\+\)/);
        const mDel = stat.match(/(\d+)\s+deletions?\(-\)/);
        const parts = [];
        if (mFiles) parts.push(`${mFiles[1]}개 파일`);
        if (mIns || mDel) {
          parts.push(
            [mIns ? `추가 ${mIns[1]}줄` : "", mDel ? `삭제 ${mDel[1]}줄` : ""]
              .filter(Boolean)
              .join(" · "),
          );
        }
        if (parts.length) scale = `변경 규모: ${parts.join(", ")}.`;
      }
    } catch {
      /* ignore */
    }

    return assembleNarrative({ intro, subjects, scale });
  } catch (e) {
    return `개발 작업이 저장소에 반영되었습니다. (요약 생성 실패: ${
      e instanceof Error ? e.message : String(e)
    })`;
  }
}
