# Pine MA 교차 vs 서버 탐색 — 비교·정렬 결과

## Pine (`pine-daily-weekly-ma-cross.pine`)

| 항목 | 내용 |
|------|------|
| SMA | `ta.sma(close, N)` — 종가 단순이평 |
| 일봉 | `request.security(..., "D", ...)` |
| 주봉 | `request.security(..., "W", ...)` |
| 교차 쌍 | **5↔20**, **20↔120** |
| 골든 | `ta.crossover(fast, slow)` → fast가 slow 상향 돌파 |
| 데드 | `ta.crossunder(fast, slow)` → fast가 slow 하향 이탈 |
| MA 기간(선) | 5, 20, 60, 120 |
| 교차 마커 | 5-20 교차 시 ma5 위치, 20-120 교차 시 ma20 위치 |

## 변경 전 서버 (`golden-cross-detect.js`)

| 항목 | Pine 대비 |
|------|-----------|
| SMA | 동일 (종가 SMA) |
| 주봉 | 주봉 캔들에 동일 함수 적용 — 일치 |
| 교차 쌍 | **5→20, 5→60, 5→120** 만 (MA5가 각 slow 상향) |
| 데드 | **없음** |
| 20↔120 | **없음** |

→ **불일치**: 교차 정의·쌍이 Pine과 달랐음.

## 변경 후 서버 (Pine SSOT)

- `detectMaCrosses()` — Pine과 동일 4종: `5>20`, `5<20`, `20>120`, `20<120`
- `isGoldenCrossBar` = `ta.crossover`, `isDeadCrossBar` = `ta.crossunder`
- 구 스캔 데이터 호환: `5>60`, `5>120` 레거시 라벨 유지
- 정배열(`ma-align-detect`)은 별도 — Pine 지표 범위 밖, 변경 없음

## 남는 미세 차이

1. **분봉 차트**: Pine은 `request.security`로 상위 TF 값이 봉마다 계단형; 서버 스캔은 해당 TF 마지막 봉 기준.
2. **결측 종가**: 서버만 `buildDailyClosesIndex`로 NaN close 스킵.
3. **앱 차트 MA 오버레이** (`StockChart.tsx` ma20/ma50): 본 Pine 지표와 무관 — 미변경.

## 수정 파일

- `server/golden-cross-detect.js` (핵심)
- `server/golden-cross-tradable.js`, `stock-vault-store.js`, `golden-cross-history-store.js`
- `server/golden-cross-telegram.js`, `notifications/golden-cross-scan-email.js`
- `src/types.ts`, `src/lib/stockVaultMaDisplay.ts`, `src/lib/stockVaultHistory.ts`, `src/i18n/ko.ts`
