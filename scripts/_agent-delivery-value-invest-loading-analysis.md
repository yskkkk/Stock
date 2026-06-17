# 「실데이터 불러오는 중…」 지연 원인 분석 (MU 예시)

## 어떤 UI인가

스크린샷의 MU 실적 말풍선에서 **「버핏」** 버튼을 누르면 `ValueInvestBubble`(10년 수익·적정가)이 열리며, 그때 `ko.valueInvest.loading` = **「실데이터 불러오는 중…」** 이 표시됩니다.

- 클라이언트: `src/contexts/ValueInvestBubbleContext.tsx` → `fetchValueInvestReturn(symbol)`
- API: `GET /api/stock/:symbol/value-invest-return`
- 서버: `server/value-invest-return-input.js` → `loadValueInvestReturn()`

## 서버가 하는 일 (MU 기준)

`loadValueInvestReturn`은 **두 갈래를 병렬**로 돌립니다.

| 갈래 | 함수 | Yahoo 호출 |
|------|------|------------|
| 재무 기초 | `loadStockFundamentals` | quoteSummary 1회 (price·PER·EPS·배당 등) |
| EPS 이력 | `loadAnnualEpsHistory` | `loadFinancialPeriods` → quoteSummary 1회 (손익·재무제표 히스토리) + 연간 6개 기간 detail 파싱(캐시 후 메모리) |

**콜드 캐시 시 Yahoo API 최소 2회**가 필요하고, 둘 다 `queueYahooRequest()`(공유 큐)를 탑니다.

## 실측

### 단독 Node (백그라운드 부하 없음)
- `loadStockFundamentals('MU')` → **약 1.2초** 성공
- `loadAnnualEpsHistory('MU')` → **약 0.16초** (이번엔 EPS 이력 빈 배열)
- 정상이면 **1~2초 내** 응답 가능

### dev 서버 경유 API (현재 환경)
`http://127.0.0.1:5173/api/stock/MU/value-invest-return` 3회 측정:
- 1회차: 1.1초 → **502 `{"error":"rate"}`**
- 2·3회차: **약 9초** → 동일 rate limit 오류

평균 **약 6.4초** 후 실패. 로딩 문구는 API가 끝날 때까지 유지됩니다.

## 핵심 원인 (우선순위)

### 1. Yahoo Finance rate limit (429) — **주원인**
- `server/yahoo.js`: 429 / "too many requests" → `Error("rate")`, code `RATE_LIMIT`
- `server/yahoo-queue.js`: rate limit 시 **전역 8초 백오프** (`markRateLimited`)
- 같은 프로세스의 다른 작업과 **Yahoo 큐를 공유** → 대기 + 백오프가 겹치면 **6~10초+** 체감

### 2. 백그라운드 대량 Yahoo 호출 — **촉발 요인**
터미널 로그 기준 동시에 돌고 있던 작업:
- `[ma-align:intraday] start { market: 'us', items: 255 }` — 보관함 ma_align **255종목** `loadStock(..., { live: true })`
- 배치 8종목 병렬 × 종목당 Yahoo 차트/일봉 등 **수백 회** 큐 적재
- 이후 WAB, GOOGL, TXN 등 **「종목 데이터를 가져올 수 없습니다」** 다수 → 큐·rate limit 악화 신호

버핏 버블 2회 호출이 **255종목 스캔 뒤**에 들어가면, 큐 대기만으로도 수 초 지연됩니다.

### 3. 재무 디스크 아카이브 없음 — **매번 라이브**
- `server/.data/financials-archive/` 디렉터리 **자체가 없음**
- `readArchivedFundamentals` / `readArchivedFinancialPeriods` 폴백 불가 → **항상 Yahoo 라이브**
- MU 포함 아카이브 JSON 0건

### 4. (부차) EPS 이력 순차 처리
`value-invest-eps-history.js`에서 연간 최대 6기간 `loadFinancialStatementDetail`을 **for 루프 순차** 호출.
다만 Yahoo bundle은 1회 캐시 후 메모리라 **2번째 요청부터는 가벼움**(단독 측정 0.16초). 콜드일 때도 2번째 병목은 rate limit·큐 쪽이 더 큼.

## 왜 MU에서 특히 느려 보이나

MU 자체 버그라기보다 **타이밍** 문제입니다.
- 실적 레일 아이콘 호버 → 버핏 클릭 시점에 **intraday MA 스캔·다른 Yahoo 소비**가 겹치기 쉬움
- 아카이브 없어 **캐시 미스 시 무조건 라이브 2회**
- 실패 시 UI에 `rate` 영문만 노출(한글 안내 없음) — 사용자는 「계속 로딩」으로만 느낄 수 있음

## 개선 방향 (참고)

**즉시 체감**
1. intraday ma_align 등 **백그라운드 스캔과 사용자 요청 Yahoo 우선순위 분리** 또는 스캔 간격·배치 축소
2. `YAHOO_REQUEST_GAP_MS` 상향 / `YAHOO_MAX_CONCURRENT` 하향 (다른 폴링·스캔과 경합 완화)
3. rate limit 시 사용자 메시지 한글화 + 짧은 자동 재시도 1회

**구조**
4. `financials-archive`에 MU 등 자주 보는 종목 **사전 아카이브** → 라이브 호출 0~1회로 축소
5. `loadStockFundamentals` + `loadFinancialPeriods` **quoteSummary 모듈 통합** (한 번에 받아 나눠 쓰기) → Yahoo 2회 → 1회
6. 실적 말풍선 **호버 시 value-invest-return 프리페치** (버핏 클릭 전 데이터 준비)

## 요약

| 항목 | 내용 |
|------|------|
| 현상 | 버핏(10년 수익) 버블에서 「실데이터 불러오는 중…」 6~10초+ |
| 직접 원인 | `/value-invest-return`이 Yahoo 2회 호출, **429 rate limit + 8초 백오프** |
| 배경 부하 | US ma_align intraday **255종목** live `loadStock`이 동일 Yahoo 큐 점유 |
| 캐시 | 재무 아카이브 디렉터리 없음 → **매 요청 라이브** |
| 정상 시 | 부하 없으면 **약 1~2초**면 충분 |

수정 작업은 요청 주시면 우선순위대로 진행할 수 있습니다.
