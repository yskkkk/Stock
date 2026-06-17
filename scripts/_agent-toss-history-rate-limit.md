# 토스 거래내역 `요청 한도를 초과했습니다` 분석·개선

## 원인
로그 `[live-trade:toss-history] page failed` 는 **토스 Open API**가 CLOSED 주문 **2페이지 이후** 요청 한도(429)에 걸렸을 때 납니다.

1. **연속 페이지 조회** — 최대 50페이지×100건, 페이지 사이 간격 없음
2. **동시 호출** — 잔고 폴마(15초)·거래내역 `all: true`가 같은 API를 병렬 사용
3. **캐시 없음** — 탭 열 때마다 5년치 전량 재조회
4. **잔고 API** — holdings + buying-power 2통화를 `Promise.all`로 동시 호출

첫 페이지는 성공하고 이후만 실패하므로 **일부 체결만 표시**되고 서버에 경고만 남습니다.

## 개선 (이번 반영)
| 항목 | 내용 |
|------|------|
| `toss-api-queue.js` | 요청 직렬화(기본 400ms 간격), 한도 오류 시 최대 3회 백오프 재시도 |
| `toss-openapi.js` | 모든 GET/POST/DELETE·토큰 발급을 큐 경유 |
| 거래내역 캐시 | 사용자별 5분 TTL + inflight 공유(중복 fetch 방지) |
| 조회 범위 | 기본 5년→**2년**, max pages 50→**30** (env로 조정 가능) |
| 로그 | 한도 초과 시「N건까지 사용」으로 부분 성공 명시 |

## 환경변수 (선택)
- `TOSS_API_REQUEST_GAP_MS` — 요청 간격 (기본 400)
- `STOCK_TOSS_HISTORY_CACHE_MS` — 거래내역 캐시 (기본 300000)
- `STOCK_TOSS_HISTORY_LOOKBACK_DAYS` — 조회 일수 (기본 730)
- `STOCK_TOSS_HISTORY_MAX_PAGES` — 최대 페이지 (기본 30)

## 남는 한계
토스 측 한도가 매우 타이트하면 **오래된 체결**은 여전히 누락될 수 있습니다. 그때는 lookback·max pages를 줄이거나 캐시 TTL을 늘리세요.
