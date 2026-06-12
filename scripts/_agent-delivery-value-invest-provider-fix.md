ValueInvestBubbleProvider 오류 — 원인·수정

증상
useValueInvestBubble must be used within ValueInvestBubbleProvider
→ 실적 말풍선 «버핏» 등에서 앱 전체 «로딩 중 오류»

원인
1. main.tsx에 Provider는 있으나, HMR·서비스워커 캐시 분할 시 Context 모듈이 이중 로드되면 createPortal(말풍선) 쪽 훅만 Provider를 못 찾음
2. StockHoverBubbleActions가 useValueInvestBubble()로 즉시 throw → ErrorBoundary가 전체 화면 차단

수정
1. valueInvestBubbleBridge.ts — Provider가 window 싱글톤에 API 등록, 훅은 Context 실패 시 브릿지 사용
2. Provider를 AppErrorBoundary 바깥(최상위)으로 이동
3. StockHoverBubbleActions — optional 훅 + 브릿지 없을 때 재무제표 탭 폴백(크래시 방지)
4. vite resolve.dedupe react/react-dom

사용자: 한 번 «캐시 삭제 후 재시도» 또는 강력 새로고침 권장(옛 main 청크 잔존 시)
