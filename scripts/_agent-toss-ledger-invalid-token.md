# `[toss-ledger] sync failed` — `유효하지 않은 토큰입니다` 분석

## 로그 의미

```
[2026-06-12 18:05:00 KST] [toss-ledger] sync failed ce4725e1-e1ee-4525-93a9-e48a77160e9b 유효하지 않은 토큰입니다
```

| 항목 | 내용 |
|------|------|
| 발생 위치 | `live-trade-toss-ledger.js` → `refreshTossLedgerSnapshotForUserAsync` |
| 사용자 | `ce4725e1-…` (로그인 세션 userId) |
| 트리거 | `toss-ledger-api` 폴링 (기본 **15초**마다 Open API로 잔고·주문가능 조회) |
| 에러 출처 | **토스증권 Open API** 응답 메시지 (앱 버그가 아님) |

이전에 보신 `요청 한도를 초과했습니다`(429)와 **다른 종류**입니다. 이번 건은 **인증·토큰** 문제입니다.

## 호출 흐름

1. 저장된 토스 API Key·Secret 복호화 (`user-credentials-store`)
2. `POST /oauth2/token` → access token 발급 (메모리 캐시)
3. `GET /api/v1/holdings`, `buying-power` 등 조회
4. 실패 시 경고 로그 + **이전 캐시가 있으면 stale**로 UI에 표시

## `유효하지 않은 토큰입니다` 가 나오는 대표 원인

### A. API Key / Secret 자체가 틀림 (가장 흔함)
- 토스 개발자센터에서 키 **재발급·폐기** 후 앱에 예전 Secret 미반영
- Secret만 바꿨는데 오타·공백 포함
- 이 경우 `oauth2/token` 단계에서도 같은 메시지가 날 수 있음 → **실거래 탭에서 연결 테스트**로 즉시 확인

### B. 만료·폐기된 access token을 캐시가 계속 사용
- 토스 access token 유효기간은 보통 **약 1시간**
- 서버는 `client_id`별로 토큰을 메모리 캐시
- Secret 변경·토스 측 토큰 무효화 후에도 캐시가 남으면 API 호출만 실패할 수 있음

### C. 환경·설정
- `TOSS_API_BASE_URL` 이 실제와 다름 (드묾)
- `CREDENTIALS_MASTER_KEY` 변경 시 복호화 실패 → 보통 다른 메시지 (이번 로그와는 다름)

## 서버 동작 (실패 후)

- `live-trade-toss-ledger.json`에 **예전 스냅샷**이 있으면 → `stale: true`로 마지막 잔고 유지
- 캐시가 없으면 → 토스 패널 `ready: false` + 동일 메시지

## 사용자 조치 (권장 순서)

1. **실거래 → 토스 API 연동**에서 Key·Secret **다시 저장** 후 «연결 테스트»
2. 토스증권 Open API 콘솔에서 키 상태·권한 확인 (폐기/만료 여부)
3. 테스트 성공 후에도 로그가 반복되면 서버 **재시작** (메모리 토큰 캐시 초기화)

## 코드 개선 (이번 반영)

| 항목 | 내용 |
|------|------|
| `withTossAccessToken` | 무효 토큰 시 캐시 삭제 후 **1회 재발급·재시도** |
| 토큰 TTL 기본값 | `expires_in` 없을 때 23시간 → **50분** (실제 만료에 맞춤) |
| 키 저장 시 | Secret/Key 변경하면 해당 client_id 캐시 **즉시 무효화** |
| 에러 메시지 | Toss `errorCode`(예: CE1000) 로그에 포함 |

**한도 초과(429)** 와 달리, 키가 완전히 잘못된 경우에는 재시도로도 해결되지 않으며 **키 재등록**이 필요합니다.
