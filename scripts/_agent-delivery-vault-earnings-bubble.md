종목 보관함 호버 말풍선 — 실적 레일과 동일

요청
- 마우스 올리면 버핏(10년 수익) 말풍선이 먼저 뜨지 말 것
- 기업실적발표 아이콘 레일과 같은 재무 요약 말풍선을 먼저

변경
1. StockEarningsHoverBubbleBody — 실적 레일과 동일 본문(재무 API·PER·동종·차트/재무/버핏)
2. StockVaultRowBubble — 위 컴포넌트 사용, 실적 레일 스타일(earnings-icon-rail__bubble)
3. StockVaultTab — 행 전체 호버 시 말풍선, «10년 수익» 행 버튼 제거(버핏은 말풍선 «버핏»만)
4. EarningsUpcomingIconRail — 동일 본문 컴포넌트로 통합

버핏 식 계산 말풍선은 말풍선 안 «버핏» 버튼 클릭 시에만 열립니다.
