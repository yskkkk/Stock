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

### [ERROR] process — 2026-05-24 15:43:38.651 KST

<!-- id:process-uncaughtException -->

**문제**: uncaughtException: EPIPE: broken pipe, write

**개선 제안**: 비동기 오류를 await/catch로 처리하고, 폴링·훅 tick에서 throw가 밖으로 나가지 않게 방어하세요.

**근거**: 누적 35322회

_재발 192060회 (최초 2026-05-24 15:16:48.726 KST)_

---

### [WARN] auto-git — 2026-05-25 02:55:05.597 KST

<!-- id:logfreq-7d669592b2 -->

**문제**: 오늘 로그에서 반복 오류: npm ci failed, falling back to npm install (3회)

**개선 제안**: 해당 영역 코드·설정·로그를 따라가며 재발 방지 패치를 적용하세요.

**근거**: server/.logs 오늘 INTERNAL 3회

_재발 125회 (최초 2026-05-24 15:21:48.651 KST)_

---

### [WARN] auto-git — 2026-05-25 01:53:23.300 KST

<!-- id:log-auto-git-7d669592b2 -->

**문제**: npm ci failed, falling back to npm install

**개선 제안**: 해당 영역 코드·설정·로그를 따라가며 재발 방지 패치를 적용하세요.

**근거**: server/.logs 접근 로그 INTERNAL auto-git

_재발 6회 (최초 2026-05-24 16:00:51.097 KST)_

---

### [WARN] auto-git — 2026-05-24 23:56:46.992 KST

<!-- id:logfreq-38f5374cb1 -->

**문제**: 오늘 로그에서 반복 오류: npm run build failed — will still restart after pull (3회)

**개선 제안**: 해당 영역 코드·설정·로그를 따라가며 재발 방지 패치를 적용하세요.

**근거**: server/.logs 오늘 INTERNAL 3회

_재발 103회 (최초 2026-05-24 16:03:44.849 KST)_

---

### [WARN] telegram — 2026-05-24 18:05:25.048 KST

<!-- id:ops-dev-notify-pending-stale -->

**문제**: 개발 완료 텔레그램 pending이 10분 이상 디스크에 남아 있습니다.

**개선 제안**: flushOpsDevNotifyPendingFromDisk·coalesce 타이머·프로세스 재기동 경로를 점검하세요.

**근거**: pending since 2026-05-24 16:45:46.769 KST

_재발 14회 (최초 2026-05-24 17:00:25.037 KST)_

---

### [WARN] auto-git — 2026-05-24 16:01:10.592 KST

<!-- id:log-auto-git-38f5374cb1 -->

**문제**: npm run build failed — will still restart after pull

**개선 제안**: 해당 영역 코드·설정·로그를 따라가며 재발 방지 패치를 적용하세요.

**근거**: server/.logs 접근 로그 INTERNAL auto-git

---

## 최근 자동 점검

2026-05-25 02:55:05.600 KST — probes 완료 · 열린 6건 · 이번 기록 1건
