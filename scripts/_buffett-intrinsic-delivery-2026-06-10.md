# 버핏식 내재가치 — 실데이터 구현 완료

## 위치
- **재무제표 탭** → 종목 선택 시 **「버핏식 내재가치」** 패널 (지표 스냅샷 위)
- API: `GET /api/stock/:symbol/intrinsic-value`

## 실데이터만 사용 (가상값 없음)
| 항목 | 출처 |
|------|------|
| EPS(기준) | Naver/Yahoo fundamentals |
| 10년 국채 할인율 | KR: Naver `KR10YT=RR` / US: Yahoo `^TNX` |
| 연간 EPS 이력 | KR: Naver 연간 재무제표 EPS / US: Yahoo 손익계산서 당기순이익÷발행주식수 |
| 10년 성장률 | 연간 EPS 3개+ CAGR, 없으면 Forward÷Trailing EPS |
| 잔여 성장률 | Yahoo `revenueGrowth`만 (상한 5%), 없으면 잔여가치 생략 |
| 주당 순부채 | 연간 재무제표 총부채−현금 ÷ 발행주식수 (없으면 차감 생략) |

## 산출
- 단순 적정가: EPS ÷ r
- 10년 명시구간 PV + (가능 시) 잔여가치 PV − 순부채
- 안전마진(25%) 매수가·저평가/고평가 판정

## 스모크 (2026-06-10)
- **AAPL**: 연간 EPS 4개, 성장 ~3.9%, 내재가치 ~158원대(달러) — 잔여가치 포함
- **MCD**: 연간 EPS 4개, 성장 ~3.1%
- **005930.KS**: 연간 EPS 3개, 성장 ~75% (2023 저점 회복) — 경고 표시, KR은 revenueGrowth 없어 잔여가치 생략

## 주의
- 성장률·내재가치는 가정에 민감합니다. `missing`/`warnings`에 데이터 부족·극단 성장·EPS 변동이 표시됩니다.
- 투자 권유가 아닙니다.

## 테스트
`node --test server/buffett-intrinsic-value.test.js` — 3/3 통과
