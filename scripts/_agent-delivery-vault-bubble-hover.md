종목보관 말풍선 hover 끊김 수정

## 원인
카드와 말풍선 사이 10px 공백 + 120ms 닫힘 지연 → 마우스가 말풍선에 닿기 전에 사라짐

## 수정
- 닫힘 지연 120ms → 420ms
- 카드-말풍선 간격 10px → 2px
- 말풍선에 투명 hover 브릿지(::after 16px) 추가 — 카드 쪽으로 겹쳐 마우스 경로 유지
- 포커스가 말풍선으로 이동할 때 onBlur로 닫히지 않도록 처리

## 파일
- src/components/StockVaultRowBubble.tsx
- src/components/StockVaultTab.tsx
- src/components/EarningsUpcomingIconRail.tsx (동일 지연)
- src/index.css
