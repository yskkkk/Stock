# 시뮬레이터 카드 — 실행/정지/삭제 버튼 추가

## 변경
자동매매 도크 **시뮬레이터** 카드(`RailProgramCard`) 요약 영역 아래에 액션 버튼을 추가했습니다.

| 상태 | 버튼 |
|------|------|
| paused / draft / error | **시뮬 자동 시작** + **삭제** |
| sim (실행 중) | **시뮬 중지** + **삭제** |
| armed (실매매) | **실매매 중지** + **삭제** |

- 삭제 시 기존과 동일하게 확인 대화상자 표시
- 실행 중 삭제 시 자동으로 중지 후 삭제
- 처리 중 해당 카드 버튼 비활성화
- 상태 배지 `paused` → **중지** 한글 표시

## 파일
- `src/components/LiveTradingLeftRailPanel.tsx`
- `src/index.css`

## 커밋
`0239357` — feat(live-trade): add run/stop/delete actions on dock simulator cards
