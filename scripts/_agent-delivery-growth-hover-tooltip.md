예상 이익 성장률 hover 말풍선 추가

동작
- 가치투자 말풍선에서 "예상 이익 성장률" 라벨에 마우스를 올리면 서버 산출 과정 표시
- EPS CAGR: 구간·시작/종료 EPS·식·결과 %
- 폴백(revenueGrowth, Forward÷Trailing)도 각각 설명 라인 제공

변경 파일
- server/value-invest-growth.js — growthDetail 반환
- server/value-invest-return-input.js — API payload에 growthDetail 포함
- src/contexts/ValueInvestBubbleContext.tsx — InputField sourceDetail hover
- src/types.ts, src/i18n/ko.ts, src/value-invest-bubble.css

검증: vitest server/value-invest-growth.test.js 12 passed
