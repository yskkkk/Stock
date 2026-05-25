# Stock 백엔드 버그·위험 요소 감사 보고서

| 항목 | 내용 |
|------|------|
| 작성일 | 2026-05-25 |
| 범위 | `server/**/*.js`, `server/**/*.test.js`, `scripts/**/*.mjs` |
| 제외 | `src/**` (React UI), `public/**` 정적 자산, Capacitor |
| 방법 | 코드 정적 검토, JSON 스토어·라우트·실매매·인증 경로 추적, 기존 장애(프로그램 데이터 덮어쓰기) 교차 확인 |
| DB | 없음 (전부 JSON 파일 SSOT) |

---

## 1. 요약

백엔드는 **단일 프로세스 Express + JSON 파일 저장** 구조입니다. 치명적 이슈는 (1) **인증 없는 설정 변경 API**, (2) **공개 피드백·텔레그램 조회**, (3) **접근 제어 기본 OFF 시 관리자 우회**, (4) **실매매 프로그램 소유권 검사 우회·마이그레이션 재귀속**, (5) **테스트/스크립트가 운영 `.data` 덮어쓰기**, (6) **동시 read-modify-write로 파일 손상** 에 집중됩니다.

**이미 발생한 사고(확인됨):** `live-trade-history.test.js`가 `STOCK_DATA_DIR` 미적용 시점에 `server/.data/live-trade-programs.json`·`portfolio.json`을 테스트 데이터 1건으로 덮어씀. `sim-feedback`·`dedup`에만 이전 프로그램 ID 흔적 잔존. (경로 격리·복구 스크립트는 `d52e48e` 이후 반영)

---

## 2. 심각도 정의

| 등급 | 의미 |
|------|------|
| **Critical** | 원격 악용·데이터 전역 유출·타 계정 데이터 변조·운영 데이터 파괴 |
| **High** | 다계정/다프로세스에서 데이터 손실·잘못된 귀속·권한 확대 |
| **Medium** | 부분 기능 오동작·침묵 실패·운영 가시성 저하 |
| **Low** | 테스트/문서/경미한 UX·설정 혼동 |

---

## 3. Critical

### C-01 · Picks 기술 가중치·모델 API 무인증 변경

| | |
|--|--|
| **파일** | `server/create-app.js` |
| **라인** | 394–493 (`POST /api/picks/tech-weights/apply`, `reset`, tech-models CRUD) |
| **설명** | `requireUserAuth`·`isAccessAdminRequest` 없음. 누구나 스크리너 가중치·모델 삭제/생성 가능. |
| **재현** | 공개 호스트에 `POST /api/picks/tech-weights/reset` → 전역 picks·실매매 신호 기준 변경. |
| **권장** | 관리자 전용 + 로그인 필수. 프로덕션은 IP 게이트와 병행. |

### C-02 · 피드백 inbox 전체 공개

| | |
|--|--|
| **파일** | `server/feedback-inbox.js`, `server/create-app.js` |
| **라인** | 115–121, 1735–1737 |
| **설명** | `GET /api/feedback/inbox` — 제출자 IP·UA·메시지·관리자 댓글 전체 JSON 노출. admin reply/delete만 `isAccessAdminRequest`. |
| **재현** | 비인증 `GET /api/feedback/inbox` |
| **권장** | inbox 조회는 관리자만. POST feedback은 유지 가능. |

### C-03 · 접근 제어 기본 비활성 → 관리자 판정 항상 통과

| | |
|--|--|
| **파일** | `server/access-control.js` |
| **라인** | 63–77, 115–117 |
| **설명** | `ACCESS_CONTROL_ENABLED` 미설정 시 `false` → `isAccessAdminRequest`가 **항상 true**. 공개 배포 시 `/api/access/admin/*`, admin live-trading, feedback admin 등 무력화. |
| **재현** | env 없이 인터넷 노출 서버 기동 후 admin API 호출. |
| **권장** | `NODE_ENV=production`이면 기본 ON. 문서에 `ACCESS_CONTROL_ENABLED=1` 필수 명시. |

### C-04 · `matchesUser` — 빈 `userId`면 소유권 검사 스킵

| | |
|--|--|
| **파일** | `server/live-trade-programs-store.js` |
| **라인** | 235–239 |
| **설명** | `userId`가 비어 있으면 `true` → `getLiveTradeProgramSync` / `updateLiveTradeProgramSync`가 **모든 프로그램** 접근 가능. |
| **연쇄** | `touchLiveTradeProgramRunSync` (606–615), `live-trade-auto-sell.js` `recordLiveTradeSellSync` (313, 463, 501) — `userId` 미전달. |
| **권장** | 빈 uid → deny. 내부 호출은 `program.userId` 명시. |

### C-05 · 프로그램 계정 마이그레이션이 타인 소유를 빼앗을 수 있음

| | |
|--|--|
| **파일** | `server/live-trade-programs-store.js`, `server/create-app.js`, `server/user-auth.js` |
| **라인** | 341–343, 349–393; status 523; 로그인 `maybeMigrateLegacyLiveTradeDataSync` |
| **설명** | `ownerEmail` 일치 시 **다른 `userId` 프로그램을 현재 계정으로 재귀속**. status 폴링마다 `migrateProgramsForAccountSync` 실행. 과거 null 일괄 귀속도 다계정에서 최초 로그인 계정으로 몰림(사용자 신고 사례). |
| **재현** | A가 만든 프로그램에 `ownerEmail`만 B와 같게 되면 B 로그인 시 귀속 이동. |
| **권장** | 재귀속은 `userId == null` 또는 orphan만. 로그인 1회만 마이그레이션. 감사 로그. |

### C-06 · 테스트가 운영 `server/.data` 직접 기록

| | |
|--|--|
| **파일** | `server/email-verification.test.js` |
| **라인** | 15–30 |
| **설명** | `server/.data/email-verifications.json` 백업/덮어쓰기. `STOCK_DATA_DIR` 미사용. |
| **과거** | `live-trade-history.test.js` — programs/portfolio 전역 덮어쓰기(수정됨, 아래 H-17). |
| **권장** | 모든 FS 테스트는 `mkdtemp` + `STOCK_DATA_DIR`. |

---

## 4. High

### H-01 · JSON 스토어 다수 — 비원자 쓰기 + 잠금 없음

| 모듈 | 경로 | 쓰기 방식 |
|------|------|-----------|
| `users-store.js` | `users.json` | 직접 `writeFileSync` |
| `user-sessions-store.js` | `user-sessions.json` | 직접 쓰기; **세션 조회마다 prune 후 저장** |
| `user-credentials-store.js` | `user-exchange-credentials.json` | 직접 쓰기 |
| `access-control.js` | allowlist JSON | 직접 쓰기 |
| `feedback-inbox.js` | `feedback-inbox.json` | read-all → write-all |
| `picks-tech-weights-store.js` | weights | 직접 쓰기 |
| `live-trade-portfolio-store.js` | portfolio | tmp+rename (양호) but **RMW 무잠금** |
| `live-trade-programs-store.js` | programs | tmp+rename but **RMW 무잠금** |

**위험:** 동시 실매매 tick·로그인·관리 UI → torn write, 빈 배열로 parse fallback 시 **메모리상 전체 거래 소실** (`catch` → `defaultStore()`).

**권장:** 파일별 write chain (`ops-file-dev-store` 패턴), parse 실패 시 백업 파일 유지.

### H-02 · `STOCK_DATA_DIR` 미적용 모듈 (데이터 디렉터리 분열)

`resolveServerDataDir()` 사용: `live-trade-programs-store.js`, `live-trade-portfolio-store.js` (최근 수정).

**여전히 `path.join(__dirname, ".data")` 고정:**  
`users-store`, `user-sessions-store`, `user-credentials-store`, `live-trade-settings-migrate`, `live-trade-buy-guard`, `live-trade-runner`, `live-trade-sim-feedback`, `feedback-inbox`, `picks-*-store`, `ops-*-store`, `email-verification-store` 등 20+ 모듈.

**위험:** 테스트/스크립트가 env로 격리해도 credentials·users는 실경로에 남음.

### H-03 · `live-trade-settings-migrate.js` 데이터 경로 불일치

마이그레이션 플래그·로직은 고정 `.data`, programs/portfolio는 `resolveServerDataDir()`. 커스텀 data dir 배포 시 마이그레이션 누락/오적용.

### H-04 · `live-trade-buy-guard` dedup

| | |
|--|--|
| **파일** | `server/live-trade-buy-guard.js` |
| **설명** | dedup JSON 고정 `.data`; `saveDedupState` 오류 삼킴; 모듈 로드 시 1회만 메모리 로드. |
| **위험** | 중복 실매매 매수, 멀티 프로세스 dedup 불일치. |

### H-05 · `GET /api/ops/dev-queue-display` 관리자 검사 없음

| | |
|--|--|
| **파일** | `server/create-app.js` 1456–1467 |
| **설명** | IP 게이트만 통과하면 에이전트 큐·display 미러 전체 노출 (`isAccessAdminRequest` 없음). |

### H-06 · Bearer 토큰 `timingSafeEqual` 길이 불일치 예외

| | |
|--|--|
| **파일** | `server/access-control.js` 119 |
| **설명** | `Buffer` 길이 다르면 throw → 500 가능. |
| **권장** | 길이 맞춘 비교 또는 해시 후 비교. |

### H-07 · `GET /api/telegram/sent` 무인증

| | |
|--|--|
| **파일** | `server/create-app.js` 1747–1772 |
| **설명** | 텔레그램 설정만 되어 있으면 당일 알림 종목·점수 노출. reset은 admin만. |

### H-08 · status 폴링마다 프로그램 마이그레이션

| | |
|--|--|
| **파일** | `server/live-trade-programs-store.js` `listLiveTradeProgramsSync` |
| **설명** | 매 status 요청마다 `migrateProgramsForAccountSync` — sole-Bithumb orphan reclaim 등 부작용 누적 가능. |

### H-09 · 복구·귀속 스크립트 하드코딩 경로

| | |
|--|--|
| **파일** | `scripts/restore-live-trade-programs-from-artifacts.mjs`, `scripts/assign-live-trade-program-owner.mjs` |
| **설명** | 항상 `../server/.data`. `STOCK_DATA_DIR`·dry-run 없음. |

### H-10 · 로그인 rate limit 없음

| | |
|--|--|
| **파일** | `server/user-auth.js` |
| **설명** | 이메일 인증 cooldown만 있음. 공개 호스트 credential stuffing 가능. |

---

## 5. Medium

| ID | 파일 | 요약 |
|----|------|------|
| M-01 | `live-trade-portfolio-store.js` | `tradesVisibleToUser` — 빈 userId면 allowed 집합이 전 프로그램 |
| M-02 | `ops-file-dev-store.js` | `writeChain.catch(() => {})` — 큐 디스크 쓰기 실패 침묵 |
| M-03 | `ops-dev-queue-live-store.js` | display 미러 RMW, 멀티 프로세스 stale |
| M-04 | `access-admin-live-trading.js` | admin payload에 타 사용자 armed 프로그램·userId |
| M-05 | `create-app.js` | `isLoopbackDevQueueRequest` — IP 없을 때 loopback remoteAddress 허용 |
| M-06 | `process-guards.js` | `unhandledRejection` 로그만, 프로세스 계속 |
| M-07 | `macro-events.js` | enrichment `.catch(() => {})` |
| M-08 | `live-trade-runner.js` | orphan order log 고정 `.data`, append 실패 무시 |
| M-09 | `access-admin-live-trading.test.js` | 실제 `.data` 프로그램 읽음, CI/로컬 데이터 의존 |
| M-10 | `create-app.js` `/api/config` | access control OFF일 때 `accessAdmin: true` — 클라이언트 오판 |
| M-11 | `user-sessions-store.js` | getSession 시마다 disk write — 성능·손상 위험 |
| M-12 | `live-trade-programs-store.js` | parse 실패 시 빈 programs — UI “전부 사라짐”처럼 보임 |

---

## 6. Low

| ID | 요약 |
|----|------|
| L-01 | `live-trade-history.test.js` — `STOCK_DATA_DIR` 격리 패턴 양호(템플릿으로 확대) |
| L-02 | `mobile-apk-download.js` — 사용자 입력 경로 traversal 없음 |
| L-03 | `news.js` / `create-app.js` news route — SQL 없음, symbol regex 제한 |
| L-04 | `user-credentials-store.js` — API meta에 raw secret 미노출(양호) |

---

## 7. 실매매·빗썸 서브시스템 메모

| 영역 | 상태 |
|------|------|
| Runner | `userId` 없는 armed 프로그램 매수 중단 (양호) |
| Exchange sync | `recordLiveTradeSellSync`에 uid 전달 (양호) |
| Auto-sell | 일부 sell 기록·touch에 userId 누락 (C-04 연계) |
| BYOK credentials | userId+exchange per row; 프로그램과 accountId 직접 연결 필드 없음 — “계정별 봇”은 **로그인 userId** 로만 구분 |

---

## 8. 권장 조치 우선순위

1. **즉시:** C-01, C-02, C-03 (공개 서버인 경우)  
2. **이번 주:** C-04, C-05, H-01, H-06, C-06 / H-17 테스트 격리 전면 적용  
3. **다음:** H-02 `resolveServerDataDir` 일원화, H-08 마이그레이션 빈도 축소  
4. **운영:** `.data` 일일 백업, programs/portfolio 복구 runbook (`scripts/restore-*.mjs`)

---

## 9. 참고 — 양호 패턴

- `live-trade-programs-store` / `portfolio` 쓰기: tmp + `renameSync`  
- `server/data-path.js` + `STOCK_DATA_DIR` (programs/portfolio)  
- `requireUserAuth` on `/api/live-trading/*` 대부분  
- Credentials API: 암호화 저장, meta만 노출  

---

## 10. 변경 이력 (본 보고서 관련 코드)

| 커밋 | 내용 |
|------|------|
| `7f63326` | ownerEmail 기반 프로그램 귀속 |
| `d52e48e` | 테스트 data 격리, artifacts 복구 스크립트 |

---

*본 문서는 정적 분석 결과이며, 런타임 침투 테스트·부하 테스트는 포함하지 않습니다.*
