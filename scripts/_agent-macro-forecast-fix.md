# 주요 지표 발표 — 예상치 로딩 수정

## 원인
- `FINNHUB_API_KEY` 미설정 시 Finnhub 컨센서스 병합이 스킵됨
- 첫 API 응답이 enrich 전 fast payload를 반환해 카드에「발표 전」만 표시
- 실적 카드(MU 등)는 일정만 가져오고 EPS 예상치 미포함

## 수정
1. **서버** `macro-consensus.js` — Finnhub → Forex Factory(XML) 순으로 예상치 병합
2. **FF XML** `ff_calendar_thisweek.xml` — JSON 429 시에도 동작, 72h 매칭
3. **캐시** — `/api/macro-events`가 enrich 완료 후 5분 캐시 반환
4. **실적** — Yahoo `earningsTrend` EPS 컨센서스 → 카드 `예상치` (예: MU $19.66)
5. **클라이언트** — enrich 미완료 시 4초 간격 재조회(최대 8회)

## 검증 (로컬)
- PPI: `0.7%` 표시 확인
- MU: `$19.66` EPS 예상치 확인
- FOMC·차주 이후 지표: FF는 이번 주만 제공 → Finnhub 키 있으면 보강, 없으면「발표 전」 유지 가능

## 선택 사항
`.env`에 `FINNHUB_API_KEY` 추가 시 차주·FOMC 등 범위 확대
