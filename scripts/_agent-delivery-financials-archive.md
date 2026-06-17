# 재무제표 일일 아카이브 — 조사·구현

## 조사 결과 (이전)
- **디스크 보관 없음** — `stock-financials.js` / `stock-fundamentals.js`는 메모리 캐시(5분)만 사용
- 스캔 범위: `loadUniverse()` KR 300 + US 500 (스크리너와 동일)

## 구현
| 항목 | 내용 |
|------|------|
| 저장 | `server/.data/financials-archive/{SYMBOL}.json` (종목별) |
| 메타 | `financials-archive-meta.json` (시장별 마지막 실행) |
| 내용 | fundamentals + periods + 연간 4·분기 2 재무제표 상세 |
| 폴러 | `financials-archive` — 60초 tick, **하루 1회** |
| KR 시각 | **08:50 KST** (정규 09:00 10분 전) |
| US 시각 | **09:20 ET** (정규 09:30 10분 전) |
| 보출 | 장 시작 후 2시간까지 미실행 시 당일 1회 catch-up |

## 조회
- `loadFinancialPeriods` / `loadFinancialStatementDetail` / `loadStockFundamentals` → **디스크 우선**, 없으면 기존 API
- 아카이브 빌드 시 `forceLive`로 원격 fetch

## 설정
- `STOCK_FINANCIALS_ARCHIVE=0` — 비활성
- `STOCK_FINANCIALS_ARCHIVE_CONCURRENCY` (기본 3)
- `STOCK_FINANCIALS_ARCHIVE_BATCH_DELAY_MS` (기본 350)

## 테스트
`node --test server/stock-financials-archive-schedule.test.js` — 3/3 통과
