토스 고정 수수료 0.2% + 수익률 표기 반영

## 적용 내용

토스 수수료를 API 조회값과 무관하게 **고정 왕복 0.2%** (`TOSS_FIXED_ROUND_TRIP_FEE_RATE = 0.002`)로 통일했습니다.

수익률·손익 표시 시 매도 수수료(왕복의 절반)를 반영한 **순수익률**로 계산합니다.

## 변경 범위

- `server/net-return.js`, `src/lib/netReturn.ts` — `TOSS_FIXED_ROUND_TRIP_FEE_RATE` 상수
- `server/exchange-trading-fees.js` — 토스 API 수수료 무시, 고정 0.2% 반환·라벨 «고정 왕복 0.2%»
- `src/lib/tossHoldingFeeRates.ts` — `tossRoundTripForHolding` 등 항상 고정값
- `src/lib/liveTradeFeeByMarket.ts` — 토스 kr/us 왕복 0.2%
- `src/lib/tossSnapshotLiveQuotes.ts` — 실시간 시세 반영 시 `returnPercent`도 순수익률
- `src/lib/tossHoldingsAsLiveTrade.ts` — 거래내역 탭 `changePct`·`unrealizedPnl` 수수료 반영
- `src/components/TossHoldingManageModal.tsx` — 보유 관리 모달 수익률 순수익률

## 계산 방식

- 왕복 0.2% → 매도 시 0.1% 차감 후 평가
- 종목 수익률(%) = (순평가액 − 매입원가) / 매입원가 × 100

## 검증

- vitest: `tossHoldingFeeRates`, `tossHoldingPnl`, `tossSnapshotLiveQuotes` 8건 통과

## 확인 포인트

1. 좌측 토스 계좌 패널 — 종목·계좌 합산 수익률이 API 원값보다 약 0.1%p 낮게(매도 수수료 반영)
2. 수수료 라벨 «고정 왕복 0.2%»
3. 거래내역 탭 토스 보유 카드 — 총 수익 %와 금액 기준 일치
