# 백엔드 수정안 적용 시 부작용·회귀 위험 점검

| 항목 | 내용 |
|------|------|
| 작성일 | 2026-05-25 |
| 전제 | [BUG_REPORT_BACKEND_2026-05-25.md](./BUG_REPORT_BACKEND_2026-05-25.md) 권장 수정을 **적용한다고 가정** |
| 범위 | `server/**`, `scripts/**` — **UI(`src/**`) 제외·미검토** |
| 목적 | 수정으로 새로 생길 수 있는 장애·운영 리스크 (코드 변경 없음, 분석만) |

---

## 1. 요약

감사 보고서의 수정안은 방향은 맞지만, **일괄 적용 시 실매매 러너 정지·로컬 개발 차단·레거시 데이터 고착** 같은 2차 사고가 날 수 있습니다. 특히 **`matchesUser` 빈 `userId` 차단**과 **`listArmedLiveTradeProgramsSync` 전역 열거**는 설계 분리 없이 하면 **모든 계정 자동매매가 멈춥니다**.  
이미 반영된 수정(`ownerEmail` 귀속, `STOCK_DATA_DIR` programs/portfolio, 테스트 격리)도 **부작용이 남아 있음** — 아래 §2 참고.

---

## 2. 이미 반영된 수정(7f63326, d52e48e) — 적용 후 남는 문제

| 변경 | 의도 | 적용 후에도 남는·새로 생긴 리스크 |
|------|------|-----------------------------------|
| `ownerEmail` + `migrateProgramsForAccountSync` | 계정별 프로그램 귀속 | **341–343행**: `ownerEmail`만 같으면 **다른 `userId` 프로그램을 빼앗음**. 잘못 백필된 `ownerEmail`이면 영구 오귀속. |
| status/list 시마다 migrate | 레거시 복구 | **매 폴링마다 디스크 RMW** → H-01과 합쳐 파일 경합·지연. sole-Bithumb orphan reclaim은 **두 번째 빗썸 사용자 추가 시** 이미 잘못 귀속된 뒤면 되돌리기 어려움. |
| null `userId` 다계정에서 미일괄 귀속 | 타 계정 탈취 방지 | **의도적으로 안 보이는** null 프로그램 증가 → “다 날아감” 체감. `restore-live-trade-programs-from-artifacts.mjs` 수동 필요. |
| `STOCK_DATA_DIR` (programs/portfolio만) | 테스트 덮어쓰기 방지 | **users/credentials/dedup/sim-feedback는 여전히 고정 `.data`** → 테스트·스크립트가 **다른 파일은 계속 오염** 가능. |
| `resolveServerDataDir` 런타임 경로 | 테스트 격리 | 모듈이 **import 순서·캐시**에 민감한 코드 추가 시 env 변경이 **일부 호출에만** 반영될 수 있음(현재는 함수 호출마다 resolve — 양호). |

---

## 3. Critical 수정안별 — 적용 시 예상 문제

### C-01 · Picks tech-weights/models API에 인증·관리자 요구

| 부작용 | 설명 |
|--------|------|
| **로컬·CI 스크립트 단절** | `scripts/`·외부 curl이 무인증으로 `POST /api/picks/tech-weights/*` 쓰던 경우 전부 401. |
| **서버 내부 호출 없음** | 가중치 변경은 HTTP로만 가능한 구조 — 배치 튜닝 시 **서비스 토큰·세션 쿠키** 설계 필요. |
| **관리자만 허용 시** | `ACCESS_CONTROL_ENABLED=0` 로컬에서 `isAccessAdminRequest`가 true라 통과하지만, **프로덕션 ON 후** IP/토큰 없으면 **가중치 조정 불가** → picks 품질 고착. |
| **로그인만 요구 시** | 일반 사용자도 전역 picks에 영향 — **악의·실수로 전체 스크리너 훼손** (관리자만이 안전). |

**완화:** `requireUserAuth` + `isAccessAdminRequest` 병행; breaking change 릴리스 노트; 기존 자동화에 `ACCESS_ADMIN_TOKEN` Bearer 문서화.

---

### C-02 · `GET /api/feedback/inbox` 관리자 전용

| 부작용 | 설명 |
|--------|------|
| **백엔드 API 계약 변경** | inbox JSON을 **다른 서버·스크립트**가 읽고 있었다면 403 (UI 미검토, 외부 연동만 해당). |
| **운영 불편** | 모바일/공유 PC에서 관리자 IP·토큰 없으면 **피드백 확인 불가**. |
| **POST /api/feedback** 유지 | 스팸·PII 수집은 그대로 — inbox만 막아도 **저장 자체는 공개**. |

**완화:** admin 전용 + 별도 요약 webhook; rate limit 강화는 별도 과제.

---

### C-03 · 프로덕션에서 `ACCESS_CONTROL_ENABLED` 기본 ON

| 부작용 | 설명 |
|--------|------|
| **로컬 첫 기동 403 폭탄** | env 없이 습관적으로 쓰던 환경에서 **admin·feedback admin·telegram reset·ops 일부** 막힘. |
| **`ACCESS_ADMIN_IPS` 미설정** | ON인데 IP 목록 비면 `isAccessAdminIp` false — **토큰 없는 관리자 완전 봉쇄**. |
| **Cursor/IDE dev-queue** | `isLoopbackDevQueueRequest` 등 **예외 경로와 충돌** 가능 — IP 게이트 + access ON이면 **에이전트 큐 API 실패** (M-05). |
| **`/api/config`의 accessAdmin** | OFF일 때 true, ON 후 false — **클라이언트가 관리 기능 숨김** (UI 제외 범위이나 API 소비자는 영향). |

**완화:** `NODE_ENV=production`에서만 기본 ON; 로컬은 명시 `ACCESS_CONTROL_DISABLED=1`; 배포 체크리스트에 IP·토큰.

---

### C-04 · `matchesUser`: 빈 `userId` → deny + 내부 호출에 `userId` 전달

| 부작용 | 설명 |
|--------|------|
| **🔴 전역 실매매·시뮬 러너 정지** | `listArmedLiveTradeProgramsSync` / `listSimActiveProgramsSync` → `listLiveTradeProgramsSync()` **인자 없음** → 현재는 빈 uid로 **전 프로그램 매칭**. deny 시 **armed/sim 목록 0건** → `onHighScorePickForLiveTrading` 무의미, **모든 계정 자동매매 중단**. |
| **auto-sell 매도 기록 실패** | `recordLiveTradeSellSync` without `userId` (auto-sell 313, 463, 501) → `getLiveTradeProgramSync(programId, undefined)` null → **"프로그램을 찾을 수 없습니다"** → 수동매도 감지·청산 기록 누락, 포지션·거래소 불일치. |
| **touchLiveTradeProgramRunSync** | runner가 `lastError`/`error` 상태 갱신 실패 → **armed 프로그램이 error로 안 바뀌거나** lastRun만 stale. |
| **settings-migrate / auto-sell getLiveTradeProgramSync(id)** | `live-trade-settings-migrate.js` 112, auto-sell 191 등 — 마이그레이션·청산 로직 **부분 중단**. |
| **admin `listLiveTradeProgramsSync()`** | `access-admin-live-trading.js` 59 — 전 사용자 armed 뷰 **빈 배열**. |

**필수 선행 설계:** `listLiveTradeProgramsForRunnerSync()` 등 **시스템 열거 전용 API**(소유권 검사 없음, HTTP 미노출)와 **사용자 API** 분리. deny만 하면 회귀 확정.

---

### C-05 · 프로그램 마이그레이션: null/orphan만, 로그인 1회, email 재귀속 금지

| 부작용 | 설명 |
|--------|------|
| **잘못 귀속된 데이터 고착** | 이미 A `userId`에 붙은 채로 B가 써야 하는 프로그램 → **자동 복구 안 됨** → `assign-live-trade-program-owner.mjs` 수동. |
| **null 프로그램 영구 미노출** | 다계정에서 `userId` null + `ownerEmail` 없음 → **어느 계정 목록에도 없음** (의도적이나 운영 혼란). |
| **로그인 1회만 migrate** | 그 이후 수동 JSON 수정·복구 스크립트 결과가 **다음 로그인까지 API에 안 반영** (list에서 migrate 제거 시). |
| **orphan만 reclaim** | `user-hist-1` + 빗썸 2계정 → **자동 reclaim 불가** (현재 로직과 동일). |
| **거래 내역과 불일치** | program `userId`만 바꾸고 portfolio trades는 programId만 키 → **다른 사용자 portfolio API**에서 여전히 trades 노출 가능(trades는 programId 필터, userId는 programs 목록으로 필터). userId 바꾸면 **이전 계정에선 trades 사라지고 새 계정에 나타남** — 의도 확인 필요. |

**완화:** 재귀속 전 `programs.json` 백업; migrate 결과 audit log; 복구 runbook.

---

### C-06 · 모든 FS 테스트 → `STOCK_DATA_DIR` temp

| 부작용 | 설명 |
|--------|------|
| **테스트 커버리지 환상** | 격리되면 통과해도 **실경로 stores(users, credentials)와 통합 시**仍 실패. |
| **Vitest + node:test 혼재** | `live-trade-history.test.js`는 node:test, `email-verification.test.js`는 vitest — **실행기마다 env 상속 다름**. |
| **CI env 누락** | `STOCK_DATA_DIR` 미설정 시 일부 테스트仍 실 `.data` (stores 미전환 모듈). |

**완화:** 전 store `resolveServerDataDir` 후 테스트 통일; CI에 `STOCK_DATA_DIR=$RUNNER_TEMP` 강제.

---

## 4. High 수정안별 — 적용 시 예상 문제

### H-01 · JSON 스토어 원자 쓰기 + write chain / lock

| 부작용 | 설명 |
|--------|------|
| **처리량 저하** | runner tick + status + portfolio 기록이 **직렬화** → 고빈도 종목에서 **매수·매도 지연**. |
| **데드락·교착** | 같은 프로세스에서 `readStore` 중 nested `writeStore` 호출 시 **self-deadlock** (chain 구현 실수 시). |
| **parse 실패 시 백업 유지** | 디스크는 살아있는데 **서비스는 빈 배열 반환**하면 여전히 “프로그램 0개” — **알람·읽기 거부** 정책 별도 필요. |
| **멀티 프로세스** | 파일 lock 없이 chain만으로는 **두 node 프로세스**에 무력 — PM2 cluster 시 **여전히 RMW 경합**. |

---

### H-02 · `resolveServerDataDir` 전 모듈 일원화

| 부작용 | 설명 |
|--------|------|
| **배포 경로 실수** | Docker/ NAS에서 `STOCK_DATA_DIR`만 programs 옮기고 **users/credentials 미이전** → **로그인 불가·키 분리**. |
| **기존 상대 경로 스크립트** | `scripts/*` 하드코딩 `../server/.data` — **서버는 env, 스크립트는 실경로** 이중 구조 지속. |
| **마이그레이션 플래그 파일** | `live-trade-settings-migrate` 고정 `.data` — 일원화 시 **플래그 재실행** → sell 설정 **재덮어쓰기** 가능. |

---

### H-03 · settings-migrate 경로 일치

| 부작용 | 설명 |
|--------|------|
| **1회 마이그레이션 재트리거** | 플래그 파일 경로 변경 시 `ensureLiveTradeSellSettingsMigratedOnce` **다시 실행** → armed 프로그램 **takeProfit/stopLoss 일괄 변경**. |

---

### H-04 · buy-guard dedup 경로·에러 로깅·reload

| 부작용 | 설명 |
|--------|------|
| **dedup 파일 이전 누락** | 경로 변경 시 **기존 dedup 무시** → 짧은 시간 **중복 실매매 매수** burst. |
| **에러 시 throw** | save 실패를 삼키지 않으면 runner tick **전체 중단** 가능 — 정책 선택 필요. |
| **reload 비용** | 매 tick disk read → IO 부하. |

---

### H-05 · dev-queue-display에 `isAccessAdminRequest`

| 부작용 | 설명 |
|--------|------|
| **IDE 미러 끊김** | 로컬 Cursor hook이 **admin 토큰 없이** display 읽으면 403 — **웹 큐 표시만** 막히고 메모리 큐는 동작할 수 있어 **표시/실행 불일치**. |

---

### H-06 · Bearer `timingSafeEqual` 수정

| 부작용 | 설명 |
|--------|------|
| **잘못된 토큰 → 401 vs 500** | 동작 변경 — 모니터링 알람 규칙 수정. |
| **해시 비교 도입 시** | 토큰 로그에 **해시만** 남기도록 주의(평문 로그 금지). |

---

### H-07 · `/api/telegram/sent` 인증

| 부작용 | 설명 |
|--------|------|
| **외부 모니터링 스크립트** | 무인증 GET 쓰던 경우 중단. |
| **로그인 필수 시** | 세션 없는 헬스체크 불가 — **admin IP 또는 별도 read token** 필요. |

---

### H-08 · status 폴링에서 migrate 제거

| 부작용 | 설명 |
|--------|------|
| **복구 타이밍 지연** | 로그인 시 1회만 migrate로 바꾸면 **로그인 없이** artifacts 복구 후 **첫 status 전까지** 목록 빈 상태. |
| **list에서 migrate 제거 시** | `listLiveTradeProgramsSync`만 쓰는 내부 경로는 **migrate 안 탐** — 일관성 검증 필요. |

---

### H-09 · 복구 스크립트 `STOCK_DATA_DIR` + dry-run

| 부작용 | 설명 |
|--------|------|
| **dry-run 미구현 시** | 운영자가 **잘못된 이메일**로 실행 → programs **영구 이전**. |
| **env와 실경로 혼동** | dry-run 출력만 보고 실제 경로 착각. |

---

### H-10 · 로그인 rate limit

| 부작용 | 설명 |
|--------|------|
| **NAT·가족 공유 IP** | 정상 사용자 **429**. |
| **비밀번호 분실** | 재시도 + 이메일 인증 cooldown **중첩** → 복구 시간 증가. |
| **분산 공격** | IP limit만으로 **분산 IP 우회** — 계정별 limit 병행 필요. |

---

## 5. Medium 수정안 — 적용 시 짧은 메모

| ID | 수정 시 주의 |
|----|----------------|
| M-01 | `tradesVisibleToUser` 빈 uid deny → **내부 snapshot 빌더** 전부 `userId` 필수 점검 (C-04와 동일 계열). |
| M-02 | ops queue write 실패 전파 → **IDE 큐 stuck** 노출; 자동 재시도 폭주. |
| M-03 | display lock → **다중 dev 에이전트** mirror 지연. |
| M-04 | admin payload 축소 → **운영 가시성 감소** (의도적 trade-off). |
| M-05 | loopback 예외 축소 → **Cursor hook 403** (C-03과 중복). |
| M-06 | unhandledRejection exit → **프로세스 재시작**으로 armed 상태·주문 **일시 중단**. |
| M-11 | session prune 디스크 쓰기 감소 → **만료 세션 메모리 잔류** 증가(재시작 전). |
| M-12 | parse fail 시 읽기 거부 → **503 vs 빈 목록** 정책 — 빈 목록이면 여전히 “전부 삭제” 오해. |

---

## 6. 수정 적용 순서 권장 (회귀 최소화)

1. **데이터 백업** — `server/.data/*.json` 전체 (적용 전 필수).  
2. **C-04** — runner/admin **전역 열거 API** 먼저 추가한 뒤 `matchesUser` deny.  
3. **C-05** — email 재귀속 제거 + migrate 1회화; **수동 assign 스크립트** 준비.  
4. **C-06 + H-02** — store 경로 일원화와 테스트 격리 **한 커밋에 묶기**.  
5. **C-01, C-02, C-03, H-07** — 인증·access (배포 env 체크리스트 동반).  
6. **H-01, H-04** — lock/dedup (성능·중복 매수 모니터링).  
7. **H-08, H-10** — 마이그레이션 빈도·rate limit.

---

## 7. UI 제외 범위에서의 API·데이터 계약 변화 요약

| API/동작 | 수정 후 클라이언트·연동 측 (UI 외) |
|----------|-----------------------------------|
| `POST /api/picks/tech-weights/*` | 401/403 — Bearer·세션 필요 |
| `GET /api/feedback/inbox` | 403 — admin만 |
| `GET /api/telegram/sent` | 401/403 가능 |
| `GET /api/live-trading/status` | programs 개수·migrate 타이밍 변경 |
| `GET /api/ops/dev-queue-display` | 403 가능 |
| Runner (내부) | C-04 미분리 시 **pick→매매 0건** |

---

## 8. 결론

- 감사 보고서 수정안을 **그대로 한꺼번에** 넣으면 **실매매 전멸 중단(C-04)** 과 **로컬·IDE 워크플로 차단(C-03, H-05)** 가능성이 가장 큽니다.  
- **이미 들어간 ownerEmail/migrate** 는 “탈취 방지”와 “복구 안 됨” 트레이드오프가 있으며, **데이터 덮어쓰기 사고**는 테스트 격리로만 재발 방지됩니다.  
- UI는 검토하지 않았으므로, **API 403/401 증가**는 별도 클라이언트·스크립트 점검이 필요합니다.

---

*코드 변경 없음. 정적 분석·호출 그래프 기준.*
