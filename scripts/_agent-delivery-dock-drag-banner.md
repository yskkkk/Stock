도크 드래그 + 토스 시뮬 배너

## 도크 드래그
- label이 드래그 스크롤 영역 전체를 막고 있었음 → label 제외
- pointerdown preventDefault, 스크롤 가능할 때 grab 커서

## 배너
- 문구: «실주문 허용»을 켜세요. (서버 TOSS_LIVE_ORDERS… 삭제)
- 표시: 토스 API «실주문 허용» 꺼진 사용자만 (서버 env만 off면 미표시)

커밋: d8aff4d
