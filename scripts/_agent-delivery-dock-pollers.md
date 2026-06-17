# 도크 폴링 관리 UI

## 추가
- 도크 하단 **폴링** 아이콘 → 서버 백그라운드 폴링 목록 카드
- 카드 클릭 → 동작 설명 말풍선 (descriptionKo)
- **실행/중지** → 관리자 비밀번호(ACCESS_ADMIN_TOKEN) 말풍선 입력 후 토글
- 2초마다 상태 갱신 (주기·마지막 tick·running)

## API
- `GET /api/pollers/status` (로그인)
- `POST /api/admin/pollers/:id/toggle` `{ enabled, password }`

## 서버
- `server/poller-registry.js` — 카탈로그 + `poller-runtime-overrides.json`
- 주요 폴러 tick에 `pollerGuard*` 연동

## env-only (런타임 토글 불가)
- macro-telegram, auto-git-sync 등

## 커밋
(이번 push)
