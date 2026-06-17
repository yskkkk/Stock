hover 말풍선 잘림 수정 — body 포털

원인
- 말풍선이 value-invest-bubble(overflow:auto) 안에 absolute로 있어서 오른쪽이 잘림

수정
- FieldHoverPopPortal: document.body로 포털 + position:fixed (z-index 10100)
- 뷰포트 안으로 left/top 클램프
- scroll/resize 시 위치 재계산
- 라벨→말풍선 이동 시 120ms hide delay

커밋: 5a069bc
