종목 호버 말풍선 — 동시 1개만

증상
- 실적 레일(좌측 아이콘)과 종목보관 행 호버 말풍선이 동시에 2개 뜸

원인
- EarningsUpcomingIconRail·StockVaultRowBubble 이 각각 독립 state로 portal 렌더

수정
- stockHoverBubbleSingleton.ts — 열릴 때 이벤트 브로드캐스트, 다른 owner 는 즉시 close
- 실적 레일·종목보관 모두 연동

커밋: main push 완료
