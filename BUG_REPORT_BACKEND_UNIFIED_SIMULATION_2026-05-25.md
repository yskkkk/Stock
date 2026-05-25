# Stock 백엔드 — 통합 수정안·가상 반영·잔여 버그 최종 점검

| 항목 | 내용 |
|------|------|
| 작성일 | 2026-05-25 |
| 근거 | [BUG_REPORT_BACKEND_2026-05-25.md](./BUG_REPORT_BACKEND_2026-05-25.md) · [BUG_REPORT_BACKEND_FIX_RISKS_2026-05-25.md](./BUG_REPORT_BACKEND_FIX_RISKS_2026-05-25.md) · [BUG_REPORT_BACKEND_IMPLEMENTATION_PLAN_2026-05-25.md](./BUG_REPORT_BACKEND_IMPLEMENTATION_PLAN_2026-05-25.md) |
| 범위 | `server/**`, `scripts/**`, 테스트 — **UI(`src/**`) 완전 배제** |
| 상태 | **코드 미반영** — 사용자 지시 시에만 구현. 본 문서는 “반영했다”고 가정한 시뮬레이션·재점검 결과. |

---

## 1. Executive summary

세 보고서를 합친 **권장 최종 코드 방안**은 IMPLEMENTATION_PLAN의 Phase 0~6을 **한 릴리스 브랜치 안에서도 커밋 순서는 2a→2b→2c를 지켜** 묶는 것이다.  
**한 번에 커밋만 합치고 순서를 뒤바꾸면** (특히 C-04를 2a 없이 적용) **전 계정 자동매매 중단**이 재현된다.

가상 반영 **완료 후**에도 닫히지 않는 문제: **JSON 단일 프로세스 한계**, **programId↔userId 거래 고아**, **빗썸 계정과 프로그램 비연결**, **PM2 다중 프로세스**, **공개 GET /api/picks 계열 데이터 노출(IP 게이트 통과 시)**.  
원 감사 40건 + **추가 발견 12건(N-01~N-12)** — 아래 통합 표 참고.

---

## 2. 통합 코드 방안 (한 세트로 설계)

### 2.1 신규·변경 모듈 맵

| 구분 | 파일 | 역할 |
|------|------|------|
| SSOT | `server/data-path.js` | `resolveServerDataDir()` — **전 store** |
| 가드 | `server/route-guards.js` (신규) | `requireAccessAdmin`, `requireUserAuth` 조합 |
| 프로그램 | `server/live-trade-programs-store.js` | ForUser / ForRunner / raw read 분리, migrate 1회, write chain, corrupt 읽기 |
| 포트폴리오 | `server/live-trade-portfolio-store.js` | write chain, `recordLiveTradeSellSync` userId 필수, tradesVisible 빈 uid `[]` |
| 접근 | `server/access-control.js` | production 기본 ON, `safeEqualBearer`, **`isPathPublic`에서 inbox 제거** |
| 라우트 | `server/create-app.js` | picks/feedback/telegram/ops-display 가드, status는 ForUser만 |
| 인증 | `server/user-auth.js` | migrate 플래그 1회 |
| 러너 | `server/live-trade-runner.js`, `live-trade-auto-sell.js`, `live-trade-exchange-sync.js`, `live-trade-settings-migrate.js` | **ForRunner / program.userId** |
| 관리 | `server/access-admin-live-trading.js` | `readProgramsStoreSync` 기반 전역 armed |
| 테스트 | `server/**/*.test.js`, `vitest` setup | `STOCK_DATA_DIR` 강제 |
| 스크립트 | `scripts/restore-*`, `assign-*` | `resolveServerDataDir` + `--dry-run` |

### 2.2 프로그램 API 최종 형태 (핵심)

```
readProgramsStoreSync()                         // disk raw
migrateProgramsForAccountOnceSync(userId, email) // login/register + .live-trade-account-migrate-v2.json
listLiveTradeProgramsForUserSync(uid, email?)    // HTTP·portfolio — NO migrate in list
listArmedProgramsForRunnerSync()
listSimProgramsForRunnerSync()
get/update/delete/arm/... ForUser(id, uid)
get/updateLiveTradeProgramForRunnerSync(id)      // touch, heal, runner
```

**삭제·금지:** HTTP 핸들러에서 무인자 `listLiveTradeProgramsSync()` — grep CI 규칙 권장.

### 2.3 마이그레이션 최종 정책 (C-05 확정)

| 케이스 | 자동 처리 |
|--------|-----------|
| `userId == null` + (`ownerEmail` 일치 ∨ 단일 사용자) | 귀속 |
| orphan `userId` + (`ownerEmail` 일치 ∨ sole-Bithumb+crypto) | 귀속 |
| 살아있는 타인 `userId` | **자동 금지** |
| **`ownerEmail` 일치 + 타인 `userId` (현 341–343)** | **삭제** — 반드시 제거 |

**백필:** `ownerEmail`만 `userId`→users 이메일로 채움, **재귀속 트리거 아님**.

### 2.4 HTTP·접근 제어 (C-01~03, H-05~07)

| 엔드포인트 | 가드 | 추가 |
|------------|------|------|
| `POST/PATCH/DELETE /api/picks/tech-*` | `requireAccessAdmin` | |
| `GET /api/picks/tech-*` | IP 게이트만(현状) — **선택: admin read** 별도 과제 | |
| `GET /api/feedback/inbox` | `requireAccessAdmin` | **`isPathPublic` 165행 제거 필수** |
| `GET /api/telegram/sent` | `requireAccessAdmin` | |
| `GET /api/ops/dev-queue-display` | `requireAccessAdmin` **OR** `isLoopbackDevQueueRequest` | |
| `isAccessControlEnabled()` | `NODE_ENV===production` → default **true** | |

**중요:** C-02를 `create-app`만 막고 `access-control.js` `isPathPublic`을 놔두면, **ACCESS_CONTROL_ENABLED=1 이어도 IP만 허용된 클라이언트는 inbox 전체 조회 가능** — 이중 수정 필요(N-01).

### 2.5 데이터·동시성 (H-01, H-02, M-12)

1. 전 store → `resolveServerDataDir()`  
2. programs / portfolio / users / sessions → 각각 `writeChain`  
3. `readStoreSync` parse 실패 → `.bak` 보존 + `StoreCorruptError` → `create-app` error middleware에서 **503 + code**  
4. sessions: **getSession 시 disk prune 제거** → 주기 타이머 또는 write 시만 prune (M-11)

### 2.6 구현 시 신규 export·import 일괄 변경 목록

| 파일 | 변경 요약 |
|------|-----------|
| `live-trade-runner.js` | `listArmed*` / `listSim*` → ForRunner |
| `live-trade-auto-sell.js` | 동일 + `recordLiveTradeSellSync(..., program.userId)` |
| `live-trade-bithumb-reconcile.js` | `listForUser(uid)` 유지 |
| `live-trade-settings-migrate.js` | `getForRunner`, DATA_DIR → resolve |
| `live-trade-history.js` | `listForUser` |
| `live-trade-sim-feedback.js` | 이미 userId — 유지 |
| `access-admin-live-trading.js` | `readProgramsStoreSync` for running payload |
| `create-app.js` | 모든 `listLiveTradeProgramsSync(userId)` → `ForUser`; picks 가드 |
| `healStuckSimProgramErrorsSync` | `updateForRunner` 또는 `p.userId` 필수 (null이면 skip) |

---

## 3. “한 번에” 반영 시나리오 시뮬션

### 3.1 올바른 원샷 (단일 PR, 커밋 순서 내부 준수)

| 단계 | 내용 | 가상 결과 |
|------|------|-----------|
| T0 | `.data` 백업 | — |
| T1 | data-path 전 store + tests + scripts dry-run | 테스트가 실 `.data` 안 건드림 ✓ |
| T2a | ForRunner 추가, runner 전환 | armed 매수 유지 ✓ |
| T2b | migrate 1회, 341–343 제거, list에서 migrate 제거 | 타인 프로그램 안 빼앗음 ✓; null은 로그인 때만 귀속 ✓ |
| T2c | ForUser deny 빈 uid | 사용자 API 정상 ✓; runner T2a 덕에 유지 ✓ |
| T3 | route-guards + isPathPublic 수정 | inbox picks mutation 막힘 ✓ |
| T4 | production access default ON | 로컬 `ACCESS_CONTROL_DISABLED=1` 없으면 admin 403 ⚠ |
| T5 | write chain | 지연↑, 단일 프로세스 torn write ↓ ✓ |
| T6 | rate limit | NAT 429 가능 ⚠ |

### 3.2 잘못된 원샷 (실무에서 흔한 실수)

| 실수 | 시뮬레이션 결과 |
|------|-----------------|
| **2c만 먼저 머지** | `listArmed`→빈 목록 → **픽 알림 와도 매매 0** 🔴 |
| **3만 적용, isPathPublic 유지** | IP 허용 VPN/프록시에서 **inbox 여전히 유출** 🔴 |
| **4만 프로덕션 배포, ADMIN_IPS 비움** | **관리 API 전면 봉쇄**, picks 튜닝 불가 🔴 |
| **1 parse throw, 미들웨어 없음** | corrupt 파일 시 **프로세스 500 연쇄** 🔴 |
| **2b 없이 7f63326 유지** | email 재귀속·status migrate **재발** 🔴 |
| **data-path만, 파일 미이전** | 빈 users/credentials → **로그인 불가** 🔴 |
| **write chain + migrate in list 유지** | status 폴링마다 chain 대기열 **지연 폭증** 🟠 |

---

## 4. 가상 반영 후 버그 상태 — 통합 추적표

**범례:** ✅ 닫힘 · 🟡 부분·조건부 · 🔴 잔존 · ⚠️ 수정으로 신규

| ID | 원문 | 가상 반영 후 | 비고 |
|----|------|--------------|------|
| C-01 | picks 무인증 변경 | ✅ | admin만; 스크립트 Bearer 필요 |
| C-02 | inbox 공개 | ✅ | **isPathPublic 동시 수정 필수** |
| C-03 | access 기본 OFF | 🟡 | production ON; 로컬은 env |
| C-04 | matchesUser 빈 uid | ✅ | ForRunner 분리 전제 |
| C-05 | migrate 재귀속 | ✅ | 341–343 제거·1회 migrate |
| C-06 | 테스트 .data | ✅ | 전 테스트 STOCK_DATA_DIR |
| H-01 | RMW·비원자 | 🟡 | chain; **멀티 프로세스 🔴** |
| H-02 | DATA_DIR 분열 | ✅ | 일원화 시 |
| H-03 | settings-migrate 경로 | ✅ | 플래그 경로 주의 ⚠ 재실행 |
| H-04 | dedup | 🟡 | reload; throw 정책 선택 |
| H-05 | dev-queue-display | ✅ | loopback 예외 |
| H-06 | timingSafeEqual | ✅ | 401 |
| H-07 | telegram/sent | ✅ | admin |
| H-08 | status migrate | ✅ | list 제거 |
| H-09 | scripts 경로 | ✅ | dry-run |
| H-10 | login rate limit | 🟡 | Phase 6 선택 |
| M-01~M-12 | medium | 🟡/✅ | M-10 UI 제외·API만; M-12→503 |
| **N-01** | **isPathPublic inbox** | ✅ | C-02 누락 방지 |
| **N-02** | **GET /api/picks 전체 공개(IP 통과 시)** | 🔴 | 별도 인증 정책 미정 |
| **N-03** | **heal `p.userId ?? undefined`** | ✅ | ForRunner/skip null |
| **N-04** | **create-app 일부 list에 email 생략** | ✅ | uid→findUser 이메일 |
| **N-05** | **delete/matchesUser 빈 uid** | ✅ | ForUser만 delete |
| **N-06** | **migrate write ⊂ read chain 데드락** | ⚠️ | migrate를 list 밖·login만 |
| **N-07** | **7f63326 이미 배포된 오귀속** | 🔴 | assign 스크립트 수동 |
| **N-08** | **portfolio trades programId만 키** | 🔴 | userId 이전 시 거래 따라 이동 |
| **N-09** | **armed+userId null 프로그램** | 🟡 | runner skip+error 메시지(현재도) |
| **N-10** | **auto-git-sync vs chain** | 🟡 | 동시 .data git pull 충돌 |
| **N-11** | **ensureScreening on every /api/picks** | 🟡 | 부하·side effect (기존) |
| **N-12** | **sim-feedback.json 고정 .data** | 🟡 | H-02 시 같이 이전 |

---

## 5. 가상 반영 후에도 남는 문제 (의도적·구조적)

### 5.1 닫을 수 없거나 이번 범위 밖

1. **다중 Node 프로세스** — file chain은 프로세스 간 무효. PM2 `instances > 1` 금지 또는 Redis 큐 SSOT.  
2. **프로그램 ↔ 빗썸 sub-account** — `userId`만으로 BYOK; 한 로그인에 여러 빗썸 계정 구분 불가.  
3. **거래소↔portfolio 완전 동기** — reconcile·manual sell 감지는 best-effort; 네트워크·API 실패 시 drift.  
4. **GET /api/picks·tracker·daily-history** — IP 게이트 뒤에도 **무인증 전량 노출**(N-02). 스크리너 비밀 전략이면 `requireUserAuth` 또는 admin read 별도 설계.  
5. **백업 없는 체결 복구** — programs 복구 스크립트는 **portfolio trades 복구 안 함**(이미 발생 사고).  
6. **UI 미수정** — API 403·503은 **브라우저/IDE 소비자**가 그대로 받음; 본 문서 범위 외.

### 5.2 운영·배포 리스크 (가상 반영 직후)

| 증상 | 원인 | 조치 |
|------|------|------|
| 로그인 OK, programs `[]` | null·오귀속·migrate 1회 이미 소진 | assign/restore 스크립트 |
| armed인데 매수 없음 | userId null / credentials / dedup | 로그·meta 확인 |
| 503 STORE_CORRUPT | parse fail 정책 작동 | `.bak` 복원 |
| IDE 큐 표시만 빔 | display 403, memory 큐는 동작 | loopback 예외·토큰 |
| picks 튜닝 403 | production ON | ADMIN_TOKEN |

---

## 6. 가상 QA — 반영 검증 시나리오 (코드 없이 체크리스트)

구현 요청 후 **반드시** 수행:

```text
[데이터]
□ npm test 전후 server/.data/live-trade-programs.json 바이트/개수 동일
□ node --test server/live-trade-history.test.js 동일

[러너 — C-04 회귀]
□ armed+crypto 프로그램 1+, userId 있음, 빗썸 ready
□ 스크리너 고점수 픽 → [live-trade] 로그 매수 시도
□ onHighScorePick 후 programs lastRunAtMs 갱신

[소유권 — C-05]
□ 사용자 A 프로그램 존재, B 로그인 → A.userId 불변
□ orphan id + ownerEmail B → B 로그인 1회만 귀속

[auto-sell — C-04]
□ 수동매도 감지 시 recordLiveTradeSell 성공(동일 userId)

[HTTP — C-01~03]
□ 무토큰 POST tech-weights/reset → 403
□ 무토큰 GET feedback/inbox → 403 (ACCESS on)
□ isPathPublic 제거 확인: IP allow + 비admin → inbox 403

[access]
□ NODE_ENV=production, ACCESS 미설정 → admin 없으면 403
□ ACCESS_CONTROL_DISABLED=1 로컬 → 기존 개발 동작

[corrupt — M-12]
□ programs.json 깨진 JSON → status 503, .bak 존재, 빈 배열 아님

[부하 — H-01]
□ status 1초 폴링 + runner 동시 programs.json valid JSON
```

---

## 7. 권장 작업 순서 (사용자 “반영해줘” 지시 시)

```
1. Phase 0 백업
2. Phase 1  (data-path + tests + corrupt + scripts) — 단독 배포 가능
3. Phase 2a (ForRunner) — 단독 배포 가능, 필수 선행
4. Phase 2b (migrate 정책)
5. Phase 2c (ForUser deny)
6. Phase 3  (HTTP + isPathPublic N-01)
7. Phase 4  (access production + safeEqualBearer)
8. Phase 5  (write chain + sessions prune)
9. Phase 6  (rate limit, optional)
10. 수동: N-07 오귀속 데이터 assign/restore
```

**한 PR에 모두 포함 가능하나, 리뷰·bisect는 위 커밋 단위 유지.**

---

## 8. 3개 보고서 대비 본 문서 역할

| 문서 | 역할 |
|------|------|
| BUG_REPORT (1) | **무엇이 버그인가** |
| FIX_RISKS (2) | **고치면 무엇이 깨지는가** |
| IMPLEMENTATION_PLAN (3) | **어떻게 나눠 넣는가** |
| **본 문서 (4)** | **한 세트로 넣었을 때 최종 상태·잔여·QA·추가 N항목** |

---

## 9. 구현 Go/No-Go (반영 전)

| # | 조건 |
|---|------|
| 1 | `server/.data` 백업 완료 |
| 2 | 프로덕션 `ACCESS_ADMIN_IPS` 또는 `ACCESS_ADMIN_TOKEN` 확인 |
| 3 | ForRunner(2a) 커밋이 2c보다 먼저 머지됨을 리뷰로 확인 |
| 4 | `isPathPublic` inbox 제거가 Phase 3에 포함됨을 확인 |
| 5 | 오귀속 프로그램(N-07) 수동 assign 계획 |
| 6 | PM2 instances=1 또는 다중 프로세스 미사용 확인 |

**No-Go:** 2a 없이 2c만 배포; production access ON without admin env.

---

## 10. 결론

- 세 보고서의 수정을 **통합 적용하면** 감사 Critical·High의 **대부분은 닫히나**, **N-02(picks 읽기 공개)·멀티 프로세스·거래 고아·수동 데이터(N-07)** 는 남는다.  
- **가장 위험한 실수는 C-04만 적용하는 것** — 시뮬레이션상 **즉시 전역 매매 중단**.  
- **C-02는 라우트 + `isPathPublic` 이중 수정** 없으면 반쯤만 고친 상태다.  
- **코드는 아직 반영하지 않음** — 위 Go/Go-Go 충족 후 구현 지시 시 Phase 순서대로 진행.

---

*UI 미검토. 런타임 부하·침투 테스트 미포함. 가상 반영은 정적 호출 그래프·기존 3문서 교차 검증.*
