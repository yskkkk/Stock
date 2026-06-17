# 10년 수익 말풍선 — 단위·호버 표

## 적용 내용

1. **입력 단위**
   - 현재 주가: USD / 원
   - 현재 EPS: USD/주 / 원/주
   - 평균 PER: 배
   - 성장률·배당성향·목표수익률: %
   - 투자 기간: 년

2. **라벨 호버(또는 포커스)**
   - 각 입력 라벨에 점선 밑줄 + `연도별 표 보기` 힌트
   - 마우스 올리면 **투자 기간**만큼(기본 10년) 연도별 표 표시
   - 열: 년, EPS, 배당, 누적 배당, 주가(PER)
   - 관련 라벨에 해당 열 하이라이트 (예: 현재 EPS → EPS 열)

3. **음수 EPS 등**
   - 하단 합산 결과가 없어도(예: INTC) 호버 표는 입력값 기준으로 계산·표시

## 커밋

`5559ce3` — feat(value-invest): 입력 단위·라벨 호버 10년 연도별 표

## 파일

- `src/contexts/ValueInvestBubbleContext.tsx`
- `src/lib/valueInvestReturnModel.ts` (`buildValueInvestYearlyProjection`)
- `src/value-invest-bubble.css`
- `src/i18n/ko.ts`
