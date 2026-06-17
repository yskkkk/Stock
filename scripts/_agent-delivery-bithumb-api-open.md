빗썸 「API 연동 열기」 버튼 수정

증상
- 「빗썸 API 연동되어 있지 않습니다」 카드의 「API 연동 열기」 클릭 시 API 키 입력 팝오버가 안 뜸
- 계좌 탭만 열리던 동작

원인
- LiveTradeApiNotConnectedNotice 가 dispatchLiveTradeDockOpenAccount() 만 호출
- AppLiveTradeSideDock 은 계좌 패널 탭만 전환하고, API 연동 UI는 LiveTradeDockApiRail 팝오버에 있음

수정
1. liveTradeDockEvents.ts — LIVE_TRADE_DOCK_OPEN_API_EVENT + dispatchLiveTradeDockOpenApi(exchange)
2. LiveTradeDockApiRail.tsx — 이벤트 수신 시 해당 거래소 API 팝오버 open
3. LiveTradeApiNotConnectedNotice.tsx — 「API 연동 열기」 클릭 시 dispatchLiveTradeDockOpenApi(exchange)

커밋: 247356f (main push 완료)

확인 방법
- 우측 실전매매 도크에서 빗썸 미연동 상태 → 「API 연동 열기」 → 도크 펼침 + 빗썸 API 키 입력 팝오버 표시
