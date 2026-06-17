토스 계좌 종합 수익률 + 지수 벨트(---) 수정 완료

## 1. 토스 계좌 평가손익·수익률 종합 합산

**증상**: 계좌 요약이 KRW 종목(레인보우로보틱스) 손익만 표시, USD 종목(IONL) 미포함.

**원인**:
- USD 보유 시 환율(`useUsdKrwRate`)이 null이면 `tossHoldingsNetProfitLossKrw`가 KRW만 반환
- UI가 `summary.profitLossKrw`(토스 API 원화만)로 폴백
- US 종목 currency 미지정 시 KRW로 잘못 분류될 수 있음

**수정**:
- `computeTossAccountCombinedPnl()` — 보유 합산 + API summary(원·달러) 환율 환산 폴백
- `TossAccountSnapshotCard` — KRW-only summary 폴백 제거, 종합 계산만 사용
- `tossSnapshotLiveQuotes` — 동일 종합 로직 적용
- `toss-accounts-summary.js` — US market → currency USD 추론
- `fx-usd-krw.js` — 09:00 KST 실패 시 KRW=X 스팟 시세 폴백 (`basis: spot`)

## 2. 지수 표시 벨트 전부 `—`

**원인**: Yahoo rate limit 시 스냅샷 전부 null → 20초 캐시에 빈 결과 저장 → 복구 후에도 `—` 유지

**수정** (`market-indices.js`):
- `loadChartQuoteSnapshotWithRetry` — RATE_LIMIT 시 최대 3회 재시도
- 전 항목 null이면 기존 유효 캐시 유지(덮어쓰지 않음)
- 가격 있는 결과만 캐시 갱신

## 검증
- vitest: `tossHoldingPnl.test.ts`, `tossSnapshotLiveQuotes.test.ts` 통과
- 서버 재기동 후 `/api/fx/usd-krw`, `/api/market-indices` 확인 권장

## 변경 파일
- server/toss-accounts-summary.js
- server/fx-usd-krw.js
- server/market-indices.js
- src/lib/tossHoldingPnl.ts
- src/components/TossAccountSnapshotCard.tsx
- src/lib/tossSnapshotLiveQuotes.ts
- src/lib/tossHoldingPnl.test.ts
- src/lib/tossSnapshotLiveQuotes.test.ts
