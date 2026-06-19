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

### [ERROR] process — 2026-06-19 00:54:40.564 KST

<!-- id:process-uncaughtException -->

**문제**: uncaughtException: EPERM: operation not permitted, rename 'C:\Stock\server\.data\live-trade-toss-ledger.json.16848.1781798080540.tmp' -> 'C:\Stock\server\.data\live-trade-toss-ledger.json'

**개선 제안**: 비동기 오류를 await/catch로 처리하고, 폴링·훅 tick에서 throw가 밖으로 나가지 않게 방어하세요.

**근거**: 누적 1회

_재발 17618회 (최초 2026-05-27 07:14:23.020 KST)_

---

### [ERROR] process — 2026-06-17 02:49:13.098 KST

<!-- id:process-unhandledRejection -->

**문제**: unhandledRejection: fetch failed

**개선 제안**: 비동기 오류를 await/catch로 처리하고, 폴링·훅 tick에서 throw가 밖으로 나가지 않게 방어하세요.

**근거**: 누적 6회

_재발 110회 (최초 2026-06-17 01:16:33.055 KST)_

---

### [WARN] telegram — 2026-06-18 22:52:39.184 KST

<!-- id:telegram-stock-send-error -->

**문제**: 종목 알림 전송 오류: fetch failed

**개선 제안**: 텔레그램 API 응답·rate limit·메시지 포맷을 점검하세요.

**근거**: 0분 전 status ?

_재발 43회 (최초 2026-06-16 16:21:41.545 KST)_

---

### [WARN] telegram — 2026-06-18 22:52:39.169 KST

<!-- id:env-ops-telegram-probe-fail -->

**문제**: ops 텔레그램 연결 검증 실패: fetch failed

**개선 제안**: 봇 토큰·채팅 ID·봇 초대 여부를 확인하세요.

**근거**: fetch failed

_재발 43회 (최초 2026-06-16 16:21:41.526 KST)_

---

### [WARN] telegram — 2026-06-17 19:09:00.552 KST

<!-- id:ops-dev-notify-pending-stale -->

**문제**: 개발 완료 텔레그램 pending이 10분 이상 디스크에 남아 있습니다.

**개선 제안**: flushOpsDevNotifyPendingFromDisk·coalesce 타이머·프로세스 재기동 경로를 점검하세요.

**근거**: pending since 2026-06-17 17:00:34.030 KST

_재발 32회 (최초 2026-05-28 07:59:33.276 KST)_

---

### [WARN] auto-git — 2026-06-13 21:16:24.120 KST

<!-- id:log-auto-git-710018c2f7 -->

**문제**: fetch origin main failed: Command failed: git fetch origin main

**개선 제안**: 로컬 git 상태·네트워크·원격 브랜치를 확인하고 auto-git fetch/pull 재시도·오류 알림을 보강하세요.

**근거**: server/.logs 접근 로그 INTERNAL auto-git

_재발 6회 (최초 2026-05-27 21:08:34.715 KST)_

---

## 최근 자동 점검

2026-06-19 10:48:39.565 KST — probes 완료 · 열린 6건 · 이번 기록 0건
