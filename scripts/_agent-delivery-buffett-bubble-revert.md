버핏 버튼 — 말풍선 복원

요청: 재무제표 탭 이동 대신 최초 구현(가치투자 말풍선)으로

변경
- StockHoverBubbleActions «버핏» 클릭 → showValueInvestBubble (ValueInvestBubbleContext)
- 재무제표 탭 scrollTo:buffett 호출 제거
- 실적 레일·보관함 호버 말풍선 모두 동일

재무제표 탭 내 BuffettIntrinsicPanel은 그대로(탭에서 직접 열 때만)
