토스 · 잔고 보유 목록 스크롤·컴팩트

증상
- 종목이 많은데 화면에 2개 정도만 보임
- 아래로 스크롤/드래그 불가

수정
1. LiveAccountHoldingsTossCards — 보유 카드 목록을 toss-my-stock-card-list-scroll 로 감싸고 useNestedVerticalScroll 적용(휠·드래그)
2. LiveAccountTradesMainPanel — trade-history-main-workspace__holdings-pane 으로 잔고 영역 flex 레이아웃
3. ui-toss.css — trade-history-main-workspace 전용 컴팩트 카드(패딩·글자·행 간격 축소), 스크롤 영역 max-height

확인
- 거래내역 탭 → 토스 · 잔고 → 종목 여러 개일 때 목록 내부 스크롤, 카드 높이 감소
