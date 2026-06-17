# 토스 거래내역 — 수정

## 원인
토스 Open API `GET /orders?status=CLOSED` 호출 시 **`from`만 넣으면 0건** 반환. `to`(오늘)를 함께 넘겨야 체결 목록이 내려옴.

## 수정
- `fetchAllTossClosedOrdersRaw`: `from` + `to`(당일) 함께 전달
- `FILLED`/`PARTIALLY_FILLED`만 거래내역에 포함
- live-toss 이력 병합에 toss 전용 merge 함수 사용

## 검증
로컬 API 테스트 — IONL 포함 182건 체결 조회 확인.

## 커밋
`c07a7e4`

페이지 새로고침 후 토스·잔고 → 거래내역 확인.
