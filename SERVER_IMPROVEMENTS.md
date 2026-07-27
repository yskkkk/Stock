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

### [ERROR] process — 2026-07-13 05:37:11.106 KST

<!-- id:process-uncaughtException -->

**문제**: uncaughtException: 데이터 파일을 읽을 수 없습니다: C:\Stock\server\.data\granville-scan-state.json (Unexpected token '﻿', "﻿{}" is not valid JSON)

**개선 제안**: 비동기 오류를 await/catch로 처리하고, 폴링·훅 tick에서 throw가 밖으로 나가지 않게 방어하세요.

**근거**: 누적 1회

_재발 17619회 (최초 2026-05-27 07:14:23.020 KST)_

---

### [ERROR] process — 2026-07-06 02:31:45.046 KST

<!-- id:process-unhandledRejection -->

**문제**: unhandledRejection: fetch failed

**개선 제안**: 비동기 오류를 await/catch로 처리하고, 폴링·훅 tick에서 throw가 밖으로 나가지 않게 방어하세요.

**근거**: 누적 1회

_재발 114회 (최초 2026-06-17 01:16:33.055 KST)_

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

2026-07-28 01:54:55.056 KST — probes 완료 · 열린 8건 · 이번 기록 0건
