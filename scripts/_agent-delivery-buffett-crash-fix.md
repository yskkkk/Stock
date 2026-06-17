버핏 클릭 시 화면 전체 사라짐 — 수정

원인
- hover 포털 위치 계산에 FIELD_HOVER_PAD 상수가 누락(ReferenceError)
- ValueInvestBubbleProvider가 AppErrorBoundary 바깥이라 말풍선 렌더 오류 시 앱 전체 unmount

수정
- FIELD_HOVER_PAD = 8 복구
- 포털 hover 클릭 시 말풍선 닫힘 방지
- main.tsx: AppErrorBoundary가 ValueInvestBubbleProvider를 감싸도록 변경

조치: 페이지 새로고침 후 버핏 다시 테스트

커밋: 314fc25
