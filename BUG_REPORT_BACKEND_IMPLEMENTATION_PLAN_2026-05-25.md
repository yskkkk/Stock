# Stock 백엔드 버그 수정 — 안전 반영 가이드 (구현 설계서)

| 항목 | 내용 |
|------|------|
| 작성일 | 2026-05-25 |
| 근거 문서 | [BUG_REPORT_BACKEND_2026-05-25.md](./BUG_REPORT_BACKEND_2026-05-25.md) · [BUG_REPORT_BACKEND_FIX_RISKS_2026-05-25.md](./BUG_REPORT_BACKEND_FIX_RISKS_2026-05-25.md) |
| 범위 | `server/**`, `scripts/**`, `server/**/*.test.js` — **UI(`src/**`) 미포함·본 문서에서 다루지 않음** |
| 성격 | **코드 반영 없음** — 구현 순서·모듈 분리·검증·롤백만 정의 |

---

## 1. 목표

1. 감사 보고서의 **실제 버그**를 닫는다.  
2. FIX_RISKS에서 정리한 **회귀(러너 정지·로컬 차단·데이터 고착)** 를 피한다.  
3. 변경을 **단계별·되돌릴 수 있게** 배포한다.

**원칙**

- HTTP 경계(인증)와 **내부 시스템 열거(runner/admin)** 를 코드 레벨에서 분리한다.  
- JSON 스토어는 **경로 일원화 → 쓰기 직렬화 → parse 실패 시 읽기 거부** 순으로 간다.  
- 프로그램 `userId` 변경은 **자동 범위를 좁히고**, 수동은 스크립트+백업으로만 한다.

---

## 2. 현재 구조에서 꼭 알 것 (코드 사실)

| 사실 | 위치 | 구현 시 함의 |
|------|------|----------------|
| `matchesUser(_, "")` → **true** | `live-trade-programs-store.js` 235–239 | 사용자 API와 **전역 runner 열거가 같은 함수**에 묶여 있음 |
| `listArmedLiveTradeProgramsSync` → `listLiveTradeProgramsSync()` **무인자** | 405–407 | 빈 uid로 **전 계정 armed** 조회 — runner 필수 |
| `listLiveTradeProgramsSync(userId)` 호출 시 **migrate 실행** | 284–291 | status 폴링마다 디스크 RMW |
| `ownerEmail` 일치 시 **타인 `userId` 재귀속** | 341–343 | 수정 시 정책 명시 필요 |
| programs/portfolio만 `resolveServerDataDir()` | `data-path.js` | users/credentials/dedup는 **여전히 고정 `.data`** |
| picks tech API **무인증** | `create-app.js` 394–493 | `requireUserAuth` 없음 |
| `ACCESS_CONTROL_ENABLED` 기본 **false** | `access-control.js` 75–76 | `isAccessAdminRequest` 기본 true |
| write chain 패턴 존재 | `ops-file-dev-store.js` `chain()` | portfolio/programs에 **이식 후보** |

---

## 3. 권장 아키텍처 (반영 전 설계)

### 3.1 프로그램 스토어 API 3계층

```
readProgramsStoreSync()                    // raw 전체 (마이그레이션·admin·runner만)
listLiveTradeProgramsForUserSync(uid, email?)  // HTTP·portfolio·status — 소유권 필터 + (선택) migrate
listArmedLiveTradeProgramsForRunnerSync()  // runner/auto-sell/exchange-sync — 소유권 무관, armed/sim만
getLiveTradeProgramForUserSync(id, uid)
getLiveTradeProgramForRunnerSync(id)     // runner touch·auto-sell·내부 heal
updateLiveTradeProgramForUserSync(id, patch, uid)
updateLiveTradeProgramForRunnerSync(id, patch)  // prog.userId 필수, HTTP 미노출
```

- **`matchesUser` 변경:** `listLiveTradeProgramsForUserSync` / `get/updateForUser` 에만 적용. **빈 uid → deny.**  
- **기존 `listLiveTradeProgramsSync()` 무인자:** deprecated → 내부적으로 `readStore` + filter 또는 `ForRunner`로 이름 변경해 **HTTP에서 import 금지** (주석 + grep CI).

### 3.2 마이그레이션 정책 (파일 + 1회 플래그)

| 조건 | 동작 |
|------|------|
| `userId == null` && (`ownerEmail === 로그인 email` \|\| 단일 사용자 서버) | 귀속 |
| `userId`가 users.json에 **없음** (orphan) && (`ownerEmail` 일치 \|\| sole-Bithumb+crypto) | 귀속 |
| `userId`가 **다른 살아있는 계정** | **절대 자동 변경** — 스크립트만 |
| `ownerEmail`만 같고 `userId`가 타인 | **자동 변경 금지** (현 341–343 제거) |

**실행 시점:** `maybeMigrateLegacyLiveTradeDataSync` — **로그인·회원가입 1회만**.  
`listLiveTradeProgramsForUserSync` 에서 **migrate 호출 제거** (H-08).

**플래그:** `server/.data/.live-trade-account-migrate-v2.json` — `{ "doneUserIds": ["..."] }` 로 사용자별 1회.

### 3.3 데이터 디렉터리

- `server/data-path.js` — `resolveServerDataDir()` SSOT.  
- **모든** `path.join(__dirname, ".data")` 제거 → import `resolveServerDataDir`.  
- 마이그레이션 플래그·dedup·orphan log·settings-migrate 동일 경로.

### 3.4 JSON 쓰기

- **읽기:** parse 실패 시 `defaultStore()` 반환 **금지** → throw 또는 `{ corrupt: true }` + HTTP 503 + **`.bak` 유지**.  
- **쓰기:** tmp + `renameSync` (programs/portfolio는 이미 적용).  
- **동시성:** `ops-file-dev-store.js` 와 동일 `chain()` per file (programs / portfolio / users 분리).

### 3.5 HTTP 인증 헬퍼 (신규 권장)

`server/route-guards.js` (이름 예시):

```js
export function requireAccessAdmin(req, res, next) { ... }
export function requireUserOrAdmin(req, res, next) { ... }  // picks tuning — admin만이면 admin만
```

- picks mutation: **`requireAccessAdmin`** (로그인만으로는 부족 — C-01 리스크).  
- feedback inbox GET: **`requireAccessAdmin`**.  
- telegram/sent GET: **`requireAccessAdmin`** 또는 동일 IP gate + admin.

### 3.6 접근 제어 기본값

```js
// access-control.js 의사코드
export function isAccessControlEnabled() {
  if (ACCESS_CONTROL_DISABLED) return false;
  if (ACCESS_CONTROL_ENABLED 명시) return 그 값;
  if (process.env.NODE_ENV === "production") return true;
  return false; // development 기본 OFF 유지
}
```

- **로컬:** 기존처럼 OFF 가능 (`ACCESS_CONTROL_DISABLED=1`).  
- **프로덕션:** env 누락 시 **자동 ON** — 배포 체크: `ACCESS_ADMIN_IPS` 또는 `ACCESS_ADMIN_TOKEN` 필수.

### 3.7 Bearer 비교 (H-06)

```js
function safeEqualBearer(a, b) {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}
```

---

## 4. 단계별 반영 계획 (PR/커밋 단위 권장)

### Phase 0 — 운영 (코드 없음)

- [ ] `server/.data` 전체 타임스탬프 백업  
- [ ] `live-trade-programs.json` / `portfolio.json` checksum 기록  
- [ ] 프로덕션 env: `ACCESS_CONTROL_ENABLED`, `ACCESS_ADMIN_IPS`, `ACCESS_ADMIN_TOKEN` 확인  

**롤백:** 백업 복원만.

---

### Phase 1 — 데이터 안전·테스트 격리 (회귀 낮음, 선행 필수)

| 작업 | 파일 | 회귀 방지 |
|------|------|-----------|
| `resolveServerDataDir` 전 store 적용 | `users-store`, `user-sessions-store`, `user-credentials-store`, `live-trade-buy-guard`, `live-trade-runner` ORPHAN_LOG, `live-trade-settings-migrate`, `feedback-inbox`, `picks-*`, `email-verification-store`, `ops-*` … | **한 PR**에 몰지 말고 store 5개씩 + `npm test` |
| `email-verification.test.js` → `mkdtemp` + `STOCK_DATA_DIR` | 테스트 | vitest 전역 `setup` 에 env 설정 검토 |
| programs/portfolio **parse 실패 시 throw** + `.corrupt` 백업 rename | 두 store | 배포 직후 corrupt 파일 있으면 **503** — 빈 목록보다 안전 |
| scripts: `STOCK_DATA_DIR` + `--dry-run` | `restore-*`, `assign-*`, `send-report-email` | 운영자 실수 방지 |

**검증**

```bash
STOCK_DATA_DIR=$(mktemp -d) npm test
node --test server/live-trade-history.test.js
# 이후 server/.data/live-trade-programs.json 개수/mtime unchanged 확인
```

**통과 기준:** 테스트 후 실 `.data` programs 개수 변화 없음.

---

### Phase 2 — 프로그램 소유권·러너 분리 (가장 중요, C-04 + C-05)

**순서 엄수:** 2a → 2b → 2c (2b 없이 2c 하면 러너 정지).

#### Phase 2a — runner/admin 경로 추가 (기존 `matchesUser` 유지)

| 변경 | 호출부 |
|------|--------|
| `listArmedLiveTradeProgramsForRunnerSync` | `live-trade-runner.js`, `live-trade-auto-sell.js`, `live-trade-exchange-sync.js` |
| `listSimActiveProgramsForRunnerSync` | 동일 |
| `getLiveTradeProgramForRunnerSync` | `touchLiveTradeProgramRunSync`, `live-trade-auto-sell.js`, `live-trade-settings-migrate.js` |
| `updateLiveTradeProgramForRunnerSync` | `touchLiveTradeProgramRunSync`, heal 함수 |
| `buildAdminLiveTradingRunningPayload` → **raw read** 또는 ForRunner + userId 필터 유지 | `access-admin-live-trading.js` |

**검증:** armed 프로그램 1개 이상일 때 스크리너 픽 → runner 로그에 buy 시도 유지 (모의/실거래 설정에 따름).

#### Phase 2b — migrate 정책 축소 + 1회화

| 변경 | |
|------|--|
| `resolveProgramAccountMigrationPatch` 에서 **341–343 분기 삭제** | |
| `migrateProgramsForAccountSync` — `list*` 에서 **호출 제거** | |
| `maybeMigrateLegacyLiveTradeDataSync` + 플래그 파일 | |
| backfill `ownerEmail` from `userId` — **신규 귀속 없이** 태깅만 (재귀속 트리거 아님) | |

**검증:** 사용자 A/B 동시 존재 시 B 로그인해도 A의 `userId` 프로그램 **변경 없음**.

#### Phase 2c — `matchesUser` 빈 uid deny (ForUser 경로만)

| 변경 | |
|------|--|
| `getLiveTradeProgramForUserSync` / `updateForUser` — deny | |
| `recordLiveTradeSellSync` — **항상 `userId` 인자 필수**; auto-sell에서 `program.userId` 전달 | |
| `tradesVisibleToUser` — uid 없으면 **[]** | |

**검증:**  
- 로그인 사용자 status/programs 목록 정상.  
- runner armed 매수 **Phase 2a 이후와 동일**하게 동작.  
- auto-sell 수동매도 감지 시 portfolio sell row 생성.

---

### Phase 3 — HTTP 표면 잠금 (C-01, C-02, C-07, H-05)

| 라우트 | 가드 |
|--------|------|
| `/api/picks/tech-weights/*`, `/api/picks/tech-models/*` | `requireAccessAdmin` |
| `GET /api/feedback/inbox` | `requireAccessAdmin` |
| `GET /api/telegram/sent` | `requireAccessAdmin` |
| `GET /api/ops/dev-queue-display` | `requireAccessAdmin` **또는** `isLoopbackDevQueueRequest` (IDE 유지) |

**IDE 큐 예외 (M-05, C-03 완화):**

```js
if (isLoopbackDevQueueRequest(req)) return next();
if (!isAccessAdminRequest(req)) return 403;
```

**검증:** 로컬 `127.0.0.1` Cursor hook → display 200. 외부 IP → 403. Bearer 토큰 → 200.

**스크립트 영향:** picks 가중치 자동화 있으면 `Authorization: Bearer $ACCESS_ADMIN_TOKEN` 문서화.

---

### Phase 4 — 접근 제어 기본값 (C-03, H-06)

- `isAccessControlEnabled` production 기본 ON.  
- `safeEqualBearer` 적용.  
- 배포 문서: OFF는 **개발만**.

**검증:** `NODE_ENV=production` + env 없음 → admin API 403 (IP/토큰 없을 때). `ACCESS_CONTROL_DISABLED=1` → 기존 로컬 동작.

---

### Phase 5 — JSON write chain + dedup (H-01, H-04, M-02)

| 파일 | chain |
|------|-------|
| `live-trade-programs-store.js` | `programsWriteChain` |
| `live-trade-portfolio-store.js` | `portfolioWriteChain` |
| `users-store.js`, `user-sessions-store.js` | 각각 (sessions는 **getSession 시 disk write 제거** — M-11 별도 커밋) |
| `live-trade-buy-guard.js` | dedup reload on tick 또는 mtime check; save 실패 **warn 로그** |

**검증:** 동시 status + runner tick 부하 시 programs.json **JSON parse 가능**, id 개수 보존.

---

### Phase 6 — 인증 강화·운영 (H-10, 낮은 우선)

- 로그인 IP rate limit (express-rate-limit 또는 in-memory sliding window).  
- `process-guards` — trading path rejection 시 **ops 로그 + 선택적 exit** (전역 exit는 신중).

---

## 5. 파일별 체크리스트 (구현자용)

### `live-trade-programs-store.js`

- [ ] ForUser / ForRunner / raw read 분리  
- [ ] migrate list에서 제거, login 1회 + 플래그  
- [ ] email 재귀속(타인 userId) 제거  
- [ ] write chain  
- [ ] parse fail → throw  

### `live-trade-portfolio-store.js`

- [ ] write chain  
- [ ] `recordLiveTradeSellSync` userId 필수  
- [ ] `tradesVisibleToUser` 빈 uid → []  

### `live-trade-runner.js` / `live-trade-auto-sell.js`

- [ ] ForRunner API만 사용  
- [ ] sell/touch에 `program.userId`  

### `create-app.js`

- [ ] picks/feedback/telegram/ops-display 가드  
- [ ] status — `listLiveTradeProgramsForUserSync` (migrate 없음)  

### `user-auth.js`

- [ ] login/register migrate 1회  

### `access-control.js`

- [ ] production default ON  
- [ ] safeEqualBearer  

### tests

- [ ] 모든 FS 테스트 `STOCK_DATA_DIR`  
- [ ] `access-admin-live-trading.test.js` — temp dir mock  
- [ ] 신규: `matchesUser` deny, ForRunner still lists armed  

---

## 6. 배포·모니터링

| 시점 | 확인 |
|------|------|
| Phase 1 직후 | `.data` mtime·programs count |
| Phase 2 직후 | runner 로그 buy/sell, armed count > 0 |
| Phase 3 직후 | 외부에서 picks POST → 403 |
| 24h | portfolio trades 증가, programs id stable |
| 알람 | programs.json parse error, migrate reclaimed count 로그 |

**로그 권장 (신규):**

```
[live-trade:migrate] userId=… migrated=… reclaimed=… (login only)
[live-trade:store] corrupt file=… backup=….
```

---

## 7. 수동 데이터 작업 (자동화 대체 불가)

| 상황 | 조치 |
|------|------|
| 테스트로 programs 삭제됨 | `restore-live-trade-programs-from-artifacts.mjs` + 백업 없으면 trades 복구 불가 안내 |
| 잘못된 userId에 묶임 | `assign-live-trade-program-owner.mjs <email> <id…>` — **자동 migrate는 건드리지 않음** |
| null userId 다계정 | ownerEmail 태그 후 로그인 1회 migrate 또는 assign 스크립트 |

---

## 8. 하지 말 것 (회귀 유발)

1. **`matchesUser`만 바꾸고 runner가 여전히 `listLiveTradeProgramsSync()` 무인자** — 전역 매매 중단.  
2. **migrate를 list/status에 다시 넣기** — 디스크 경합·재귀속 재발.  
3. **programs만 `STOCK_DATA_DIR` 옮기고 users/credentials는 실경로** — 로그인·키 분리.  
4. **picks API에 로그인만 걸고 admin은 안 걸기** — 일반 계정이 전역 picks 파괴.  
5. **parse 실패 시 빈 배열 반환 유지** — “전부 삭제” 오해·실매매 무장 해제.  
6. **UI 수정으로 API 403 보완** — 본 프로젝트 단계에서 UI는 범위 외; **API·스크립트·env** 로 해결.

---

## 9. PR 병합 순서 요약

```
Phase 0 backup
  → Phase 1 data-path + tests + parse safety
  → Phase 2a runner APIs
  → Phase 2b migrate policy
  → Phase 2c matchesUser ForUser only
  → Phase 3 HTTP guards
  → Phase 4 access control defaults
  → Phase 5 write chains
  → Phase 6 rate limit (optional)
```

각 Phase는 **독립 롤백** 가능해야 함 (특히 2a/2c 분리).

---

## 10. 완료 정의 (Definition of Done)

- [ ] 감사 Critical C-01~C-06 대응 코드 경로 존재 (C-06: 전 테스트 격리)  
- [ ] FIX_RISKS §3 C-04 시나리오(러너 0건) **재현 테스트 실패** → 통과해야 함  
- [ ] 실 `server/.data` 를 건드리는 테스트 0건  
- [ ] `npm test` + `node --test server/live-trade-history.test.js` green  
- [ ] 운영 runbook: 백업·restore·assign·env 체크리스트 문서화 (본 문서 §7)

---

## 11. 참고 — UI 제외 시 API 계약만 맞추면 되는 것

클라이언트·IDE·curl 소비자는 다음을 가정해야 한다 (UI 작업 없이).

| 변경 | 소비자 대응 |
|------|-------------|
| picks/feedback/telegram/ops-display 403 | Admin Bearer 또는 등록 IP |
| status programs 빈 배열 | migrate 1회 후에도 null 프로그램은 **수동 assign** |
| 503 on corrupt store | 관리자 백업 복원 |

---

*본 문서는 구현 설계만 포함하며 저장소 코드를 변경하지 않았습니다.*
