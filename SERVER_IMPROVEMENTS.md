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

### [ERROR] auto-git — 2026-05-23 03:28:46.074 KST

<!-- id:log-auto-git-980b43e036 -->

**문제**: stash pop failed after pull (resolve conflicts manually): Command failed: git stash pop

**개선 제안**: 로컬 git 상태·네트워크·원격 브랜치를 확인하고 auto-git fetch/pull 재시도·오류 알림을 보강하세요.

**근거**: server/.logs 접근 로그 INTERNAL auto-git

_재발 2회 (최초 2026-05-23 03:18:14.315 KST)_

---

### [ERROR] auto-git — 2026-05-23 03:18:34.495 KST

<!-- id:log-auto-git-93b2d9dc1e -->

**문제**: stash failed: Command failed: git stash push -m auto-git-sync pre-pull

**개선 제안**: 로컬 git 상태·네트워크·원격 브랜치를 확인하고 auto-git fetch/pull 재시도·오류 알림을 보강하세요.

**근거**: server/.logs 접근 로그 INTERNAL auto-git

---

### [ERROR] restart — 2026-05-23 03:18:31.461 KST

<!-- id:log-restart-ee04393083 -->

**문제**: httpServer.close 실패: Server is not running.

**개선 제안**: 해당 영역 코드·설정·로그를 따라가며 재발 방지 패치를 적용하세요.

**근거**: server/.logs 접근 로그 INTERNAL restart

_재발 5회 (최초 2026-05-22 20:07:19.419 KST)_

---

### [ERROR] process — 2026-05-22 17:38:04.799 KST

<!-- id:process-unhandledRejection -->

**문제**: unhandledRejection: Object not disposable.

**개선 제안**: 비동기 오류를 await/catch로 처리하고, 폴링·훅 tick에서 throw가 밖으로 나가지 않게 방어하세요.

**근거**: 누적 1회

_재발 11회 (최초 2026-05-22 17:38:04.779 KST)_

---

### [WARN] auto-git — 2026-05-23 03:56:05.378 KST

<!-- id:logfreq-7d669592b2 -->

**문제**: 오늘 로그에서 반복 오류: npm ci failed, falling back to npm install (5회)

**개선 제안**: 해당 영역 코드·설정·로그를 따라가며 재발 방지 패치를 적용하세요.

**근거**: server/.logs 오늘 INTERNAL 5회

_재발 614회 (최초 2026-05-22 16:58:17.982 KST)_

---

### [WARN] auto-git — 2026-05-23 03:29:03.479 KST

<!-- id:log-auto-git-38f5374cb1 -->

**문제**: npm run build failed — will still restart after pull

**개선 제안**: 해당 영역 코드·설정·로그를 따라가며 재발 방지 패치를 적용하세요.

**근거**: server/.logs 접근 로그 INTERNAL auto-git

_재발 2회 (최초 2026-05-23 03:18:31.457 KST)_

---

### [WARN] auto-git — 2026-05-23 03:28:47.955 KST

<!-- id:log-auto-git-7d669592b2 -->

**문제**: npm ci failed, falling back to npm install

**개선 제안**: 해당 영역 코드·설정·로그를 따라가며 재발 방지 패치를 적용하세요.

**근거**: server/.logs 접근 로그 INTERNAL auto-git

_재발 12회 (최초 2026-05-22 20:06:58.902 KST)_

---

### [WARN] auto-git — 2026-05-23 03:18:31.462 KST

<!-- id:log-auto-git-c127d9bef9 -->

**문제**: 재시작이 완료되지 않았습니다. 서버는 계속 동작하며 auto-git 폴링을 재개합니다.

**개선 제안**: 로컬 git 상태·네트워크·원격 브랜치를 확인하고 auto-git fetch/pull 재시도·오류 알림을 보강하세요.

**근거**: server/.logs 접근 로그 INTERNAL auto-git

_재발 5회 (최초 2026-05-22 20:07:19.421 KST)_

---

### [WARN] auto-git — 2026-05-22 23:55:26.573 KST

<!-- id:logfreq-710018c2f7 -->

**문제**: 오늘 로그에서 반복 오류: fetch origin main failed (16회)

**개선 제안**: 로컬 git 상태·네트워크·원격 브랜치를 확인하고 auto-git fetch/pull 재시도·오류 알림을 보강하세요.

**근거**: server/.logs 오늘 INTERNAL 16회

_재발 609회 (최초 2026-05-22 16:58:17.983 KST)_

---

### [WARN] telegram — 2026-05-22 20:24:46.836 KST

<!-- id:telegram-stock-send-error -->

**문제**: 종목 알림 전송 오류: fetch failed

**개선 제안**: 텔레그램 API 응답·rate limit·메시지 포맷을 점검하세요.

**근거**: 0분 전 status ?

_재발 5회 (최초 2026-05-22 20:07:45.748 KST)_

---

### [WARN] telegram — 2026-05-22 20:24:46.819 KST

<!-- id:env-ops-telegram-probe-fail -->

**문제**: ops 텔레그램 연결 검증 실패: fetch failed

**개선 제안**: 봇 토큰·채팅 ID·봇 초대 여부를 확인하세요.

**근거**: fetch failed

_재발 5회 (최초 2026-05-22 20:07:45.731 KST)_

---

### [WARN] auto-git — 2026-05-22 20:08:48.970 KST

<!-- id:log-auto-git-710018c2f7 -->

**문제**: fetch origin main failed: Command failed: git fetch origin main

**개선 제안**: 로컬 git 상태·네트워크·원격 브랜치를 확인하고 auto-git fetch/pull 재시도·오류 알림을 보강하세요.

**근거**: server/.logs 접근 로그 INTERNAL auto-git

_재발 3회 (최초 2026-05-22 17:39:58.154 KST)_

---

### [WARN] telegram — 2026-05-22 16:58:17.894 KST

<!-- id:env-ops-telegram-disabled -->

**문제**: 개발 완료·운영 알림용 TELEGRAM_OPS_BOT_TOKEN / TELEGRAM_OPS_CHAT_ID 가 비어 있습니다.

**개선 제안**: .env에 ops 전용 봇·채팅 ID를 넣고 probeOpsTelegramSetup으로 연결을 확인하세요.

**근거**: isOpsTelegramNotifyEnabled() === false

---

### [INFO] env — 2026-05-22 16:58:17.959 KST

<!-- id:env-cursor-api-key-missing -->

**문제**: CURSOR_API_KEY 가 비어 있어 웹 운영 에이전트를 쓸 수 없습니다.

**개선 제안**: 운영 탭 Cursor 에이전트를 쓸 때 .env에 키를 설정하세요.

---

### [INFO] telegram — 2026-05-22 16:58:17.958 KST

<!-- id:env-stock-telegram-disabled -->

**문제**: 종목 추천 알림(TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID)이 꺼져 있습니다.

**개선 제안**: 추천 알림이 필요하면 주식 봇 환경 변수를 설정하세요.

---

## 최근 자동 점검

2026-05-23 03:56:05.380 KST — probes 완료 · 열린 15건 · 이번 기록 1건
