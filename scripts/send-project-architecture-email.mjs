#!/usr/bin/env node
/**
 * 프로젝트 구조/흐름/핵심모듈 요약 메일
 *   node scripts/send-project-architecture-email.mjs --to samron3@naver.com
 */
import { loadEnvFile } from "../server/load-env.js";
import {
  DEFAULT_PROJECT_ARCH_TO,
  sendProjectArchitectureEmail,
} from "../server/notifications/project-architecture-email.js";

loadEnvFile();

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
let to = process.env.STOCK_AUDIT_REPORT_TO?.trim() || DEFAULT_PROJECT_ARCH_TO;
const toIdx = args.indexOf("--to");
if (toIdx >= 0 && args[toIdx + 1]) to = String(args[toIdx + 1]).trim();

// 임포트 빈도 근사치(정규식): 최근 측정값을 인라인으로 고정
const coreModules = [
  {
    module: "server/live-trade-programs-store.js",
    imports: 29,
    summary:
      "실매매/시뮬 프로그램 CRUD + 마이그레이션 + 러너 조회 SSOT.\n프로그램 상태(armed/sim), 시장 플래그, maxOpenPositions 등 정책을 제공하고 다른 모듈이 광범위하게 참조함.",
  },
  {
    module: "server/telegram-notify.js",
    imports: 17,
    summary:
      "텔레그램 발송/중복 방지/상태 조회를 담당.\n스creener·box-range·ops 알림 등 다양한 경로에서 공통 사용.",
  },
  {
    module: "server/email-sender.js",
    imports: 16,
    summary:
      "SMTP 트랜잭션 메일 공통 유틸(nodemailer).\nnotifications/* 레이어가 여기로 수렴해 사용자/운영자 메일을 발송.",
  },
  {
    module: "server/live-trade-portfolio-store.js",
    imports: 16,
    summary:
      "체결 기록/보유/손익 스냅샷을 server/.data JSON으로 관리.\nFSM·자동매도·거래소 동기화가 모두 이 레이어를 통해 기록/조회함.",
  },
  {
    module: "server/live-trade-market.js",
    imports: 16,
    summary:
      "시장 정규화(kr/us/crypto), 주문 금액→수량 변환, 최소 주문 제약 등 도메인 규칙.\n여러 매수/매도 실행 경로에서 공통 사용.",
  },
  {
    module: "server/stock-data.js",
    imports: 13,
    summary:
      "봉/시세 로딩 통합(야후·국내·코인) + 캐시/실시간 옵션.\n스크리너·박스권 탐지·차트 API 등이 여기로 수렴.",
  },
  {
    module: "server/data-path.js",
    imports: 12,
    summary:
      "server/.data 경로 SSOT(override: STOCK_DATA_DIR).\n모든 JSON 스토어/카탈로그가 이 경로 아래에 저장됨.",
  },
  {
    module: "server/box-range/constants.js",
    imports: 12,
    summary:
      "박스권 전역 상수(타임프레임, 폭%, 스캔 주기, 카탈로그 전략/디렉터리).\n탐지·스캔·FSM·UI API가 동일 파라미터로 동작하도록 묶음.",
  },
  {
    module: "server/yahoo.js",
    imports: 9,
    summary:
      "야후 세션/요청 래퍼, screener/universe/캔들 수집의 기반.\n응답 파싱/세션 클리어가 다른 모듈에서 호출됨.",
  },
  {
    module: "server/box-range/catalog-store.js",
    imports: 9,
    summary:
      "박스권 카탈로그 JSON 읽기/쓰기/인덱스/consumed 처리.\n탐지 결과를 파일로 관리하고 프로그램과 연결(sync)할 때 기준이 됨.",
  },
];

const folderRoles = [
  { path: "server/", role: "Express API + 백그라운드 폴러/러너 + JSON 스토어(서버 도메인 로직)", confidence: "확신" },
  { path: "server/box-range/", role: "박스권 탐지(SSOT)·카탈로그 스캔·실매매 FSM·스냅샷/알림", confidence: "확신" },
  { path: "server/notifications/", role: "운영/사용자 메일 리포트·캠페인 빌더(발송은 email-sender로 수렴)", confidence: "확신" },
  { path: "server/.data/", role: "런타임 JSON 데이터 저장소(프로그램/세션/포트폴리오/카탈로그 등)", confidence: "확신" },
  { path: "server/data/", role: "정적 기준 데이터(universe/names/macro 등) 번들", confidence: "확신" },
  { path: "src/", role: "React 프론트엔드(UI 탭/도크/차트) + API 클라이언트", confidence: "확신" },
  { path: "scripts/", role: "운영 스크립트(스캔/검증/메일발송/빌드 자동화)", confidence: "확신" },
  { path: "android/ · ios/", role: "Capacitor 모바일 빌드 산출물/프로젝트", confidence: "추정" },
  { path: ".cursor/ · .claude/", role: "IDE/에이전트 자동화 설정·훅·작업 기록", confidence: "추정" },
  { path: "dist/", role: "빌드 산출물(SPA). 있으면 server/create-app.js가 같은 포트에서 정적 서빙", confidence: "확신" },
];

const flow10 = [
  { line: "`server/index.js`가 env 로드 + guard 설치 후 `createApp()`로 Express 앱 생성" },
  { line: "`server/create-app.js`에서 `registerUserAuthRoutes(app)`로 인증 라우트 설치 + `/api/*` 라우트 등록" },
  { line: "로그인: `POST /api/auth/login` → `server/user-auth.js` → `createSessionSync()` → `Set-Cookie: stock_session`" },
  { line: "인증 필요 라우트: `requireUserAuth` 미들웨어가 쿠키 세션ID를 `getSessionSync()`로 검증" },
  { line: "세션 저장: `server/user-sessions-store.js` → `store-json.js` → `server/.data/user-sessions.json`(원자 저장)" },
  { line: "예) 실매매 프로그램 API: `create-app.js` → `live-trade-programs-store.js` → `server/.data/live-trade-programs.json`" },
  { line: "예) 포트폴리오/체결: `create-app.js` → `live-trade-portfolio-store.js` → `server/.data/live-trade-portfolio.json`" },
  { line: "박스권 스캔: `dev-sidecars.js` 폴러 → `box-range/catalog-scan-shared.js` → `catalog-store.js`가 `server/.data/box-range-catalog-pro/**` 갱신" },
  { line: "박스권 실매매: `box-range/runner.js`/`ws-fsm.js` → `runner-fsm.js` → 포트폴리오/박스 state 갱신" },
  { line: "알림/리포트: 도메인 이벤트 → `telegram-notify.js` 또는 `server/notifications/*` → `email-sender.js` 발송" },
];

await sendProjectArchitectureEmail({
  to,
  dryRun,
  folderRoles,
  flow10,
  coreModules,
});

console.log(JSON.stringify({ ok: true, to, dryRun }, null, 2));

