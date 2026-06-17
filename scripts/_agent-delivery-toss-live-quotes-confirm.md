토스 잔고 — 현재가 실시간 갱신 여부

질문: 도크 «토스 · 잔고» 보유 표에서도 실시간 가격 갱신되는지?

답: 맞습니다. 다만 틱 단위가 아니라 1분봉 시세를 1초마다 다시 받아 반영합니다.

구조
1. 현재가·등락·평가손익
   - TossAccountSnapshotCard → useTossSnapshotLiveQuotes
   - fetchLiveTradingMinuteQuotes (실매매·추천과 동일 1분봉 API)
   - 주기: 1초 (TOSS_SNAPSHOT_QUOTE_POLL_MS)

2. 잔고·수량·매입가 (토스 Open API)
   - useTossAccountSnapshot (도크에서 토스 탭 열려 있을 때 poll)
   - 캐시 읽기: 1초
   - 토스 API 강제 갱신: 15초 (ACCOUNT 1TPS 보호)

정리
- 화면의 «현재가» «등락»은 1초마다 분봉 시세로 갱신됩니다.
- 보유 수량·현금은 최대 15초마다 토스에서 맞춥니다.
- 초단위 호가·체결 틱은 아닙니다.

관련 파일
- src/hooks/useTossSnapshotLiveQuotes.ts
- src/components/TossAccountSnapshotCard.tsx
- src/hooks/useTossAccountSnapshot.ts
