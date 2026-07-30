# Stock 서버 자가 개선 백로그

이 파일은 **서버가 돌면서** 스스로 발견한 문제·개선 아이디어를 적습니다.
에이전트에게 예: `@SERVER_IMPROVEMENTS.md` 열어서 열린 항목 반영해줘.

| 표시 | 의미 |
|------|------|
| **open** | 아직 미해결 |
| **muted** | 같은 id가 반복돼도 일시 무시 중 |

내부 상태: `server/.data/server-improvement-items.json` (git 제외)

---

## 열린 항목

### [ERROR] auto-git — 2026-07-30 18:32:32.919 KST

<!-- id:log-auto-git-2f32b6940f -->

**문제**: stash kept — resolve conflicts then run git stash drop

**개선 제안**: 로컬 git 상태·네트워크·원격 브랜치를 확인하고 auto-git fetch/pull 재시도·오류 알림을 보강하세요.

**근거**: server/.logs 접근 로그 INTERNAL auto-git

_재발 2회 (최초 2026-07-30 04:49:53.848 KST)_

---

### [ERROR] auto-git — 2026-07-30 18:32:32.915 KST

<!-- id:log-auto-git-3c4cf1d803 -->

**문제**: worktree: branch=main · conflicts=src/components/AccountRebalanceScheduleModal.tsx, src/i18n/ko.ts, src/lib/rebalancePlanSummary.test.ts

**개선 제안**: 해당 영역 코드·설정·로그를 따라가며 재발 방지 패치를 적용하세요.

**근거**: server/.logs 접근 로그 INTERNAL auto-git

---

### [ERROR] auto-git — 2026-07-30 18:32:32.648 KST

<!-- id:log-auto-git-18665c8e7d -->

**문제**: stash apply failed after pull (resolve conflicts manually): Auto-merging src/components/AccountRebalanceScheduleModal.tsx CONFLICT (content): Merge conflict in src/components/AccountRebalanceScheduleModal.tsx Auto-merging src/i18n/ko.ts CONFLICT (content): Merge conflict in src/i18n/ko.ts Auto-merging src/lib/rebalancePlanSummary.test.ts CONFLICT (content): Merge conflict in src/lib/rebalancePlanSummary.test.ts Auto-merging src/lib/rebalancePlanSummary.ts On branch main Your branch is up to date with 'origin/main'.  Changes to be committed:   (use "git restore --staged <file>..." to unstage) 	

**개선 제안**: 로컬 git 상태·네트워크·원격 브랜치를 확인하고 auto-git fetch/pull 재시도·오류 알림을 보강하세요.

**근거**: server/.logs 접근 로그 INTERNAL auto-git

---

### [ERROR] auto-git — 2026-07-30 04:49:53.846 KST

<!-- id:log-auto-git-b753567b90 -->

**문제**: worktree: branch=main · conflicts=src/components/AccountManageTab.tsx, src/components/AccountRebalanceScheduleModal.tsx, src/i18n/ko.ts · untracked=1

**개선 제안**: 해당 영역 코드·설정·로그를 따라가며 재발 방지 패치를 적용하세요.

**근거**: server/.logs 접근 로그 INTERNAL auto-git

---

### [ERROR] auto-git — 2026-07-30 04:49:53.578 KST

<!-- id:log-auto-git-e34444f53b -->

**문제**: stash apply failed after pull (resolve conflicts manually): Auto-merging src/components/AccountManageTab.tsx CONFLICT (content): Merge conflict in src/components/AccountManageTab.tsx Auto-merging src/components/AccountRebalanceScheduleModal.tsx CONFLICT (content): Merge conflict in src/components/AccountRebalanceScheduleModal.tsx Auto-merging src/components/account-rebalance-schedule-modal.css Auto-merging src/i18n/ko.ts CONFLICT (content): Merge conflict in src/i18n/ko.ts On branch main Your branch is up to date with 'origin/main'.  Changes to be committed:   (use "git restore --staged <file>

**개선 제안**: 로컬 git 상태·네트워크·원격 브랜치를 확인하고 auto-git fetch/pull 재시도·오류 알림을 보강하세요.

**근거**: server/.logs 접근 로그 INTERNAL auto-git

---

### [ERROR] auto-git — 2026-07-30 01:35:10.982 KST

<!-- id:log-auto-git-4ed933128f -->

**문제**: worktree: branch=main

**개선 제안**: 해당 영역 코드·설정·로그를 따라가며 재발 방지 패치를 적용하세요.

**근거**: server/.logs 접근 로그 INTERNAL auto-git

---

### [ERROR] auto-git — 2026-07-30 01:35:09.619 KST

<!-- id:log-auto-git-1bfa034554 -->

**문제**: pull failed: From github.com:yskkkk/Stock  * branch            main       -> FETCH_HEAD warning: fetch updated the current branch head. fast-forwarding your working tree from commit 70e64743f67af77555eb9cc190269d4d7694fc23. error: Your local changes to the following files would be overwritten by merge: 	src/components/AccountManageTab.tsx 	src/components/AccountRebalanceScheduleModal.tsx 	src/components/account-manage-tab.css 	src/components/account-rebalance-schedule-modal.css 	src/i18n/ko.ts Please commit your changes or stash them before you merge. Aborting fatal: Cannot fast-forward your w

**개선 제안**: 로컬 git 상태·네트워크·원격 브랜치를 확인하고 auto-git fetch/pull 재시도·오류 알림을 보강하세요.

**근거**: server/.logs 접근 로그 INTERNAL auto-git

---

### [ERROR] process — 2026-07-30 01:34:26.236 KST

<!-- id:process-unhandledRejection -->

**문제**: unhandledRejection: WritableIterable is closed

**개선 제안**: 비동기 오류를 await/catch로 처리하고, 폴링·훅 tick에서 throw가 밖으로 나가지 않게 방어하세요.

**근거**: 누적 1회

_재발 153회 (최초 2026-06-17 01:16:33.055 KST)_

---

### [ERROR] auto-git — 2026-07-28 07:47:56.972 KST

<!-- id:log-auto-git-980b43e036 -->

**문제**: stash pop failed after pull (resolve conflicts manually): Command failed: git stash pop

**개선 제안**: 로컬 git 상태·네트워크·원격 브랜치를 확인하고 auto-git fetch/pull 재시도·오류 알림을 보강하세요.

**근거**: server/.logs 접근 로그 INTERNAL auto-git

_재발 2회 (최초 2026-07-28 07:27:48.452 KST)_

---

### [ERROR] auto-git — 2026-07-28 07:46:49.019 KST

<!-- id:log-auto-git-93b2d9dc1e -->

**문제**: stash failed: Command failed: git stash push -m auto-git-sync pre-pull

**개선 제안**: 로컬 git 상태·네트워크·원격 브랜치를 확인하고 auto-git fetch/pull 재시도·오류 알림을 보강하세요.

**근거**: server/.logs 접근 로그 INTERNAL auto-git

_재발 32회 (최초 2026-07-28 07:34:19.167 KST)_

---

### [ERROR] process — 2026-07-13 05:37:11.106 KST

<!-- id:process-uncaughtException -->

**문제**: uncaughtException: 데이터 파일을 읽을 수 없습니다: C:\Stock\server\.data\granville-scan-state.json (Unexpected token '﻿', "﻿{}" is not valid JSON)

**개선 제안**: 비동기 오류를 await/catch로 처리하고, 폴링·훅 tick에서 throw가 밖으로 나가지 않게 방어하세요.

**근거**: 누적 1회

_재발 17619회 (최초 2026-05-27 07:14:23.020 KST)_

---

### [WARN] virtual-user — 2026-07-30 23:21:35.665 KST

<!-- id:logfreq-d708c2d972 -->

**문제**: 오늘 로그에서 반복 오류: explore tick fail EPERM (3회)

**개선 제안**: 해당 영역 코드·설정·로그를 따라가며 재발 방지 패치를 적용하세요.

**근거**: server/.logs 오늘 INTERNAL 3회

_재발 24회 (최초 2026-07-30 07:34:04.764 KST)_

---

### [WARN] auto-git — 2026-07-30 18:32:28.388 KST

<!-- id:log-auto-git-dcc7d905cf -->

**문제**: remote origin/main overlaps dirty: src/components/AccountRebalanceScheduleModal.tsx, src/i18n/ko.ts, src/lib/rebalancePlanSummary.test.ts, src/lib/rebalancePlanSummary.ts · branch=main · dirty=13 tracked — stash then pull (VU/agent sync; pop may need manual resolve)

**개선 제안**: 로컬 git 상태·네트워크·원격 브랜치를 확인하고 auto-git fetch/pull 재시도·오류 알림을 보강하세요.

**근거**: server/.logs 접근 로그 INTERNAL auto-git

---

### [WARN] auto-git — 2026-07-30 04:49:49.170 KST

<!-- id:log-auto-git-e763e8c069 -->

**문제**: remote origin/main overlaps dirty: src/components/AccountManageTab.tsx, src/components/AccountRebalanceScheduleModal.tsx, src/components/account-rebalance-schedule-modal.css, src/i18n/ko.ts · branch=main · dirty=5 tracked · untracked=1 — stash then pull (VU/agent sync; pop may need manual resolve)

**개선 제안**: 로컬 git 상태·네트워크·원격 브랜치를 확인하고 auto-git fetch/pull 재시도·오류 알림을 보강하세요.

**근거**: server/.logs 접근 로그 INTERNAL auto-git

---

### [WARN] auto-git — 2026-07-30 03:26:44.995 KST

<!-- id:log-auto-git-95e03a64d8 -->

**문제**: remote origin/main touches locally modified files — skip pull to avoid stash conflict: server/box-range/catalog-scan-schedule.js, server/box-range/catalog-store.js, server/box-range/crypto-scan-runner.js, server/box-range/kr-scan-runner.js, server/box-range/runner.js, server/box-range/sp500-scan-runner.js, server/box-range/store.js, server/live-trade-buy-guard.js, server/live-trade-portfolio-store.js, server/users-store.js · branch=main · dirty=18 tracked

**개선 제안**: 로컬 git 상태·네트워크·원격 브랜치를 확인하고 auto-git fetch/pull 재시도·오류 알림을 보강하세요.

**근거**: server/.logs 접근 로그 INTERNAL auto-git

_재발 31회 (최초 2026-07-30 02:56:43.367 KST)_

---

### [WARN] auto-git — 2026-07-30 02:54:08.991 KST

<!-- id:log-auto-git-de0792fb0e -->

**문제**: remote origin/main touches locally modified files — skip pull to avoid stash conflict: server/box-range/catalog-scan-schedule.js, server/box-range/catalog-store.js, server/box-range/crypto-scan-runner.js, server/box-range/kr-scan-runner.js, server/box-range/runner.js, server/box-range/sp500-scan-runner.js, server/box-range/store.js, server/live-trade-buy-guard.js, server/live-trade-portfolio-store.js, server/users-store.js · branch=main · dirty=17 tracked

**개선 제안**: 로컬 git 상태·네트워크·원격 브랜치를 확인하고 auto-git fetch/pull 재시도·오류 알림을 보강하세요.

**근거**: server/.logs 접근 로그 INTERNAL auto-git

---

### [WARN] auto-git — 2026-07-30 02:53:46.665 KST

<!-- id:log-auto-git-070bb2259d -->

**문제**: remote origin/main touches locally modified files — skip pull to avoid stash conflict: server/box-range/catalog-scan-schedule.js, server/box-range/catalog-store.js, server/box-range/crypto-scan-runner.js, server/box-range/kr-scan-runner.js, server/box-range/runner.js, server/box-range/sp500-scan-runner.js, server/box-range/store.js, server/live-trade-buy-guard.js, server/live-trade-portfolio-store.js, server/users-store.js · branch=main · dirty=13 tracked

**개선 제안**: 로컬 git 상태·네트워크·원격 브랜치를 확인하고 auto-git fetch/pull 재시도·오류 알림을 보강하세요.

**근거**: server/.logs 접근 로그 INTERNAL auto-git

_재발 23회 (최초 2026-07-30 02:49:18.739 KST)_

---

### [WARN] ops-agent — 2026-07-30 02:48:50.753 KST

<!-- id:log-ops-agent-5ad672f46b -->

**문제**: 클라우드 실행 후 로컬 동기화 실패(git pull --ff-only): Command failed: git pull --ff-only origin main — 에이전트 결과는 성공으로 처리

**개선 제안**: 해당 영역 코드·설정·로그를 따라가며 재발 방지 패치를 적용하세요.

**근거**: server/.logs 접근 로그 INTERNAL ops-agent

_재발 5회 (최초 2026-07-28 07:27:03.665 KST)_

---

### [WARN] auto-git — 2026-07-30 02:35:19.633 KST

<!-- id:log-auto-git-80b1ee19e9 -->

**문제**: remote origin/main touches locally modified files — skip pull to avoid stash conflict: src/lib/stockVaultTabSession.test.ts, src/lib/stockVaultTabSession.ts · branch=main · dirty=6 tracked

**개선 제안**: 로컬 git 상태·네트워크·원격 브랜치를 확인하고 auto-git fetch/pull 재시도·오류 알림을 보강하세요.

**근거**: server/.logs 접근 로그 INTERNAL auto-git

_재발 2회 (최초 2026-07-30 02:35:13.594 KST)_

---

### [WARN] auto-git — 2026-07-30 02:34:48.476 KST

<!-- id:log-auto-git-a2f3011691 -->

**문제**: remote origin/main touches locally modified files — skip pull to avoid stash conflict: src/i18n/ko.ts, src/lib/stockVaultTabSession.test.ts, src/lib/stockVaultTabSession.ts · branch=main · dirty=9 tracked

**개선 제안**: 로컬 git 상태·네트워크·원격 브랜치를 확인하고 auto-git fetch/pull 재시도·오류 알림을 보강하세요.

**근거**: server/.logs 접근 로그 INTERNAL auto-git

---

### [WARN] auto-git — 2026-07-30 02:34:16.281 KST

<!-- id:log-auto-git-8a54a008ef -->

**문제**: remote origin/main touches locally modified files — skip pull to avoid stash conflict: src/i18n/ko.ts, src/lib/stockVaultTabSession.test.ts, src/lib/stockVaultTabSession.ts · branch=main · dirty=7 tracked

**개선 제안**: 로컬 git 상태·네트워크·원격 브랜치를 확인하고 auto-git fetch/pull 재시도·오류 알림을 보강하세요.

**근거**: server/.logs 접근 로그 INTERNAL auto-git

_재발 154회 (최초 2026-07-30 01:43:01.254 KST)_

---

### [WARN] auto-git — 2026-07-30 01:34:44.843 KST

<!-- id:log-auto-git-3ec72337be -->

**문제**: remote origin/main touches locally modified files — skip pull to avoid stash conflict: src/components/AccountManageTab.tsx, src/components/account-manage-tab.css, src/i18n/ko.ts · branch=main · dirty=8 tracked

**개선 제안**: 로컬 git 상태·네트워크·원격 브랜치를 확인하고 auto-git fetch/pull 재시도·오류 알림을 보강하세요.

**근거**: server/.logs 접근 로그 INTERNAL auto-git

_재발 5회 (최초 2026-07-30 01:33:36.632 KST)_

---

### [WARN] auto-git — 2026-07-30 00:18:17.801 KST

<!-- id:log-auto-git-6bec63bd8b -->

**문제**: fetch origin main failed (attempt 1/3): kex_exchange_identification: read: Software caused connection abort  banner exchange: Connection to 20.200.245.247 port 22: Software caused connection abort  fatal: Could not read from remote repository.  Please make sure you have the correct access rights and the repository exists. — Command failed: git fetch origin main kex_exchange_identification: read: Software caused connection abort  banner exchange: Connection to 20.200.245.247 port 22: Software caused connection abort  fatal: Could not read from remote repository.  Please make sure you have the c

**개선 제안**: 로컬 git 상태·네트워크·원격 브랜치를 확인하고 auto-git fetch/pull 재시도·오류 알림을 보강하세요.

**근거**: server/.logs 접근 로그 INTERNAL auto-git

_재발 3회 (최초 2026-07-28 08:40:48.350 KST)_

---

### [WARN] auto-git — 2026-07-29 23:20:26.319 KST

<!-- id:log-auto-git-99344c603b -->

**문제**: remote origin/main touches locally modified files — skip pull to avoid stash conflict: server/store-json.js · branch=main · dirty=11 tracked · untracked=1

**개선 제안**: 로컬 git 상태·네트워크·원격 브랜치를 확인하고 auto-git fetch/pull 재시도·오류 알림을 보강하세요.

**근거**: server/.logs 접근 로그 INTERNAL auto-git

---

### [WARN] auto-git — 2026-07-29 23:19:09.799 KST

<!-- id:log-auto-git-0bbf59b48c -->

**문제**: remote origin/main touches locally modified files — skip pull to avoid stash conflict: server/store-json.js · branch=main · dirty=8 tracked

**개선 제안**: 로컬 git 상태·네트워크·원격 브랜치를 확인하고 auto-git fetch/pull 재시도·오류 알림을 보강하세요.

**근거**: server/.logs 접근 로그 INTERNAL auto-git

_재발 10회 (최초 2026-07-29 23:08:31.301 KST)_

---

### [WARN] auto-git — 2026-07-29 23:07:48.792 KST

<!-- id:log-auto-git-0131670813 -->

**문제**: remote origin/main touches locally modified files — skip pull to avoid stash conflict: server/store-json.js · branch=main · dirty=3 tracked

**개선 제안**: 로컬 git 상태·네트워크·원격 브랜치를 확인하고 auto-git fetch/pull 재시도·오류 알림을 보강하세요.

**근거**: server/.logs 접근 로그 INTERNAL auto-git

_재발 11회 (최초 2026-07-29 23:02:43.412 KST)_

---

### [WARN] auto-git — 2026-07-29 04:43:05.250 KST

<!-- id:log-auto-git-d6a73dfb1b -->

**문제**: remote origin/main touches locally modified files — skip pull to avoid stash conflict: server/create-app.js · branch=main · dirty=8 tracked

**개선 제안**: 로컬 git 상태·네트워크·원격 브랜치를 확인하고 auto-git fetch/pull 재시도·오류 알림을 보강하세요.

**근거**: server/.logs 접근 로그 INTERNAL auto-git

---

### [WARN] auto-git — 2026-07-29 04:42:05.276 KST

<!-- id:log-auto-git-0ce60febcc -->

**문제**: remote origin/main touches locally modified files — skip pull to avoid stash conflict: server/create-app.js · branch=main · dirty=5 tracked

**개선 제안**: 로컬 git 상태·네트워크·원격 브랜치를 확인하고 auto-git fetch/pull 재시도·오류 알림을 보강하세요.

**근거**: server/.logs 접근 로그 INTERNAL auto-git

_재발 52회 (최초 2026-07-29 03:48:42.257 KST)_

---

### [WARN] auto-git — 2026-07-29 03:45:22.993 KST

<!-- id:log-auto-git-64857f3c0a -->

**문제**: remote origin/main touches locally modified files — skip pull to avoid stash conflict: server/create-app.js · branch=main · dirty=4 tracked

**개선 제안**: 로컬 git 상태·네트워크·원격 브랜치를 확인하고 auto-git fetch/pull 재시도·오류 알림을 보강하세요.

**근거**: server/.logs 접근 로그 INTERNAL auto-git

_재발 9회 (최초 2026-07-29 03:43:36.136 KST)_

---

### [WARN] auto-git — 2026-07-29 03:43:13.892 KST

<!-- id:log-auto-git-4ea38edb09 -->

**문제**: remote origin/main touches locally modified files — skip pull to avoid stash conflict: server/create-app.js · branch=main · dirty=2 tracked

**개선 제안**: 로컬 git 상태·네트워크·원격 브랜치를 확인하고 auto-git fetch/pull 재시도·오류 알림을 보강하세요.

**근거**: server/.logs 접근 로그 INTERNAL auto-git

_재발 19회 (최초 2026-07-29 03:38:39.619 KST)_

---

### [WARN] auto-git — 2026-07-28 23:11:56.299 KST

<!-- id:logfreq-93b2d9dc1e -->

**문제**: 오늘 로그에서 반복 오류: stash failed (8회)

**개선 제안**: 로컬 git 상태·네트워크·원격 브랜치를 확인하고 auto-git fetch/pull 재시도·오류 알림을 보강하세요.

**근거**: server/.logs 오늘 INTERNAL 8회

_재발 187회 (최초 2026-07-28 07:38:41.013 KST)_

---

### [WARN] ops-agent — 2026-07-28 15:00:10.412 KST

<!-- id:logfreq-5ad672f46b -->

**문제**: 오늘 로그에서 반복 오류: 클라우드 실행 후 로컬 동기화 실패(git pull --ff-only) (3회)

**개선 제안**: 해당 영역 코드·설정·로그를 따라가며 재발 방지 패치를 적용하세요.

**근거**: server/.logs 오늘 INTERNAL 3회

_재발 88회 (최초 2026-07-28 07:43:50.552 KST)_

---

### [WARN] ops-agent — 2026-07-28 11:20:14.407 KST

<!-- id:log-ops-agent-dfde8cef3a -->

**문제**: instruction policy reject (API run) code=INSTRUCTION_POLICY_CONTROL id=b9eb9e48-2992-4d06-84f8-d2ca504557bb

**개선 제안**: 해당 영역 코드·설정·로그를 따라가며 재발 방지 패치를 적용하세요.

**근거**: server/.logs 접근 로그 INTERNAL ops-agent

---

### [WARN] ops-agent — 2026-07-28 11:20:13.368 KST

<!-- id:log-ops-agent-e51cb265ea -->

**문제**: instruction policy reject (API run) code=INSTRUCTION_POLICY_CONTROL id=82ddd135-50e5-44dc-9c1c-72a9866c726d

**개선 제안**: 해당 영역 코드·설정·로그를 따라가며 재발 방지 패치를 적용하세요.

**근거**: server/.logs 접근 로그 INTERNAL ops-agent

---

### [WARN] ops-agent — 2026-07-28 10:32:18.623 KST

<!-- id:log-ops-agent-2912dc9ade -->

**문제**: instruction policy reject (API run) code=INSTRUCTION_POLICY_CONTROL id=a3b20ee7-2526-48b0-8801-0647a22ecb56

**개선 제안**: 해당 영역 코드·설정·로그를 따라가며 재발 방지 패치를 적용하세요.

**근거**: server/.logs 접근 로그 INTERNAL ops-agent

---

### [WARN] ops-agent — 2026-07-28 10:32:18.163 KST

<!-- id:log-ops-agent-523a99692b -->

**문제**: instruction policy reject (API run) code=INSTRUCTION_POLICY_CONTROL id=81e4a9b5-9cef-43bc-9738-ace35e2b5c3f

**개선 제안**: 해당 영역 코드·설정·로그를 따라가며 재발 방지 패치를 적용하세요.

**근거**: server/.logs 접근 로그 INTERNAL ops-agent

---

### [WARN] ops-agent — 2026-07-28 10:32:17.900 KST

<!-- id:log-ops-agent-1b5c44b3db -->

**문제**: instruction policy reject (API run) code=INSTRUCTION_POLICY_CONTROL id=e4eee844-9a4e-46eb-9320-4d92623fb445

**개선 제안**: 해당 영역 코드·설정·로그를 따라가며 재발 방지 패치를 적용하세요.

**근거**: server/.logs 접근 로그 INTERNAL ops-agent

---

### [WARN] ops-agent — 2026-07-28 10:32:16.754 KST

<!-- id:log-ops-agent-f2263d642b -->

**문제**: instruction policy reject (API run) code=INSTRUCTION_POLICY_CONTROL id=79b5cdd9-f684-4761-aa75-1cc709f8ba08

**개선 제안**: 해당 영역 코드·설정·로그를 따라가며 재발 방지 패치를 적용하세요.

**근거**: server/.logs 접근 로그 INTERNAL ops-agent

---

### [WARN] auto-git — 2026-07-28 09:47:16.569 KST

<!-- id:log-auto-git-d319b64db1 -->

**문제**: remote origin/main touches locally modified files — skip pull to avoid stash conflict: server/virtual-user.test.js · branch=main · dirty=3 tracked

**개선 제안**: 로컬 git 상태·네트워크·원격 브랜치를 확인하고 auto-git fetch/pull 재시도·오류 알림을 보강하세요.

**근거**: server/.logs 접근 로그 INTERNAL auto-git

---

### [WARN] ops-agent — 2026-07-28 09:42:23.443 KST

<!-- id:log-ops-agent-3b63aad91e -->

**문제**: instruction policy reject (API run) code=INSTRUCTION_POLICY_CONTROL id=b2d1dc25-25de-4e12-8ea9-6814bf24c151

**개선 제안**: 해당 영역 코드·설정·로그를 따라가며 재발 방지 패치를 적용하세요.

**근거**: server/.logs 접근 로그 INTERNAL ops-agent

---

### [WARN] ops-agent — 2026-07-28 09:42:22.332 KST

<!-- id:log-ops-agent-18f1796ba6 -->

**문제**: instruction policy reject (API run) code=INSTRUCTION_POLICY_CONTROL id=fd603d7c-92f3-4c00-b207-495e4d171828

**개선 제안**: 해당 영역 코드·설정·로그를 따라가며 재발 방지 패치를 적용하세요.

**근거**: server/.logs 접근 로그 INTERNAL ops-agent

---

### [WARN] ops-agent — 2026-07-28 09:42:21.204 KST

<!-- id:log-ops-agent-2435a21854 -->

**문제**: instruction policy reject (API run) code=INSTRUCTION_POLICY_CONTROL id=91304a49-915c-41a0-b596-e9117a97d815

**개선 제안**: 해당 영역 코드·설정·로그를 따라가며 재발 방지 패치를 적용하세요.

**근거**: server/.logs 접근 로그 INTERNAL ops-agent

---

### [WARN] ops-agent — 2026-07-28 09:42:20.105 KST

<!-- id:log-ops-agent-314eba5d3e -->

**문제**: instruction policy reject (API run) code=INSTRUCTION_POLICY_CONTROL id=ec08a6b3-163e-48ec-845f-2509e0c45b84

**개선 제안**: 해당 영역 코드·설정·로그를 따라가며 재발 방지 패치를 적용하세요.

**근거**: server/.logs 접근 로그 INTERNAL ops-agent

---

### [WARN] ops-agent — 2026-07-28 09:26:55.483 KST

<!-- id:log-ops-agent-2518ce42c6 -->

**문제**: instruction policy reject (API run) code=INSTRUCTION_POLICY_CONTROL id=342392c1-4a06-4ca3-99a9-6d8fc2f28e0d

**개선 제안**: 해당 영역 코드·설정·로그를 따라가며 재발 방지 패치를 적용하세요.

**근거**: server/.logs 접근 로그 INTERNAL ops-agent

---

### [WARN] ops-agent — 2026-07-28 09:26:53.852 KST

<!-- id:log-ops-agent-9343395c2d -->

**문제**: instruction policy reject (API run) code=INSTRUCTION_POLICY_CONTROL id=2cfeadee-8737-4bdd-bdaa-2885a717dc65

**개선 제안**: 해당 영역 코드·설정·로그를 따라가며 재발 방지 패치를 적용하세요.

**근거**: server/.logs 접근 로그 INTERNAL ops-agent

---

### [WARN] ops-agent — 2026-07-28 09:26:51.232 KST

<!-- id:log-ops-agent-93bf981442 -->

**문제**: instruction policy reject (API run) code=INSTRUCTION_POLICY_CONTROL id=afddc642-6026-4c28-8652-d8960d0f12cf

**개선 제안**: 해당 영역 코드·설정·로그를 따라가며 재발 방지 패치를 적용하세요.

**근거**: server/.logs 접근 로그 INTERNAL ops-agent

---

### [WARN] ops-agent — 2026-07-28 09:13:14.277 KST

<!-- id:log-ops-agent-a9bb4f2071 -->

**문제**: instruction policy reject (API run) code=INSTRUCTION_POLICY_CONTROL id=70569bb3-0708-48ab-9b32-e44db6008a07

**개선 제안**: 해당 영역 코드·설정·로그를 따라가며 재발 방지 패치를 적용하세요.

**근거**: server/.logs 접근 로그 INTERNAL ops-agent

---

### [WARN] ops-agent — 2026-07-28 05:56:31.284 KST

<!-- id:log-ops-agent-effa7b0fea -->

**문제**: instruction policy reject (API run) code=INSTRUCTION_POLICY_CONTROL id=82439a7f-8e14-4a6f-979c-86e1875e0754

**개선 제안**: 해당 영역 코드·설정·로그를 따라가며 재발 방지 패치를 적용하세요.

**근거**: server/.logs 접근 로그 INTERNAL ops-agent

---

### [WARN] auto-git — 2026-07-25 23:58:24.637 KST

<!-- id:logfreq-710018c2f7 -->

**문제**: 오늘 로그에서 반복 오류: fetch origin main failed (4회)

**개선 제안**: 로컬 git 상태·네트워크·원격 브랜치를 확인하고 auto-git fetch/pull 재시도·오류 알림을 보강하세요.

**근거**: server/.logs 오늘 INTERNAL 4회

_재발 251회 (최초 2026-07-25 01:06:17.532 KST)_

---

### [WARN] telegram — 2026-07-25 08:43:11.945 KST

<!-- id:telegram-stock-send-error -->

**문제**: 종목 알림 전송 오류: fetch failed

**개선 제안**: 텔레그램 API 응답·rate limit·메시지 포맷을 점검하세요.

**근거**: 0분 전 status ?

_재발 49회 (최초 2026-06-16 16:21:41.545 KST)_

---

### [WARN] telegram — 2026-07-25 08:43:11.920 KST

<!-- id:env-ops-telegram-probe-fail -->

**문제**: ops 텔레그램 연결 검증 실패: fetch failed

**개선 제안**: 봇 토큰·채팅 ID·봇 초대 여부를 확인하세요.

**근거**: fetch failed

_재발 49회 (최초 2026-06-16 16:21:41.526 KST)_

---

### [WARN] auto-git — 2026-07-25 01:10:27.224 KST

<!-- id:log-auto-git-710018c2f7 -->

**문제**: fetch origin main failed: Command failed: git fetch origin main

**개선 제안**: 로컬 git 상태·네트워크·원격 브랜치를 확인하고 auto-git fetch/pull 재시도·오류 알림을 보강하세요.

**근거**: server/.logs 접근 로그 INTERNAL auto-git

_재발 14회 (최초 2026-05-27 21:08:34.715 KST)_

---

### [WARN] screener — 2026-06-25 03:14:07.371 KST

<!-- id:screener-stale-results -->

**문제**: 마지막 스캔 결과가 43분 전입니다.

**개선 제안**: startScreening·타이머·오류 로그를 확인해 자동 재스캔이 멈추지 않게 하세요.

**근거**: 분석 완료 · 매수 후보 1개

_재발 9회 (최초 2026-06-25 02:34:37.492 KST)_

---

### [WARN] telegram — 2026-06-23 18:29:24.784 KST

<!-- id:ops-dev-notify-pending-stale -->

**문제**: 개발 완료 텔레그램 pending이 10분 이상 디스크에 남아 있습니다.

**개선 제안**: flushOpsDevNotifyPendingFromDisk·coalesce 타이머·프로세스 재기동 경로를 점검하세요.

**근거**: pending since 2026-06-23 18:15:47.502 KST

_재발 33회 (최초 2026-05-28 07:59:33.276 KST)_

---

## 최근 자동 점검

2026-07-31 00:50:55.266 KST — probes 완료 · 열린 54건 · 이번 기록 0건
