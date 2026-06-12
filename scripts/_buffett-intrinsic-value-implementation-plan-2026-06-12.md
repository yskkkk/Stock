# 버핏식 미래이익 할인(내재가치) — 구현 준비 계획서

**작성일:** 2026-06-12  
**참고 자료:** `새 폴더 (2)` 카카오톡 촬영 11장 (도서 pp.166~176)  
**범위:** 분석·계획만 — **코드 구현 없음**

---

## 0. 요약 (Executive Summary)

촬영본은 **워렌 버핏의 가치투자 전략** 중 **「미래이익 할인법」** 장입니다. 핵심은:

> 주식 = 채권과 비교 가능한 **현금(이익) 수취권**  
> → 미래 EPS(또는 이익)를 **할인율(허들 레이트)** 로 현재가치 합산 → **내재가치**  
> → 시장가 대비 **안전마진** 있을 때만 매수

Stock 서버에는 **PER·EPS·재무제표·기간별 밸류에이션** 인프라가 이미 있으나, **DCF/내재가치/잔여가치/국채 할인율** 모듈은 **없습니다**.  
구현 시 **재무 탭 확장 + 신규 `server/buffett-intrinsic-value.js`** 조합이 가장 자연스럽고, 기존 `stock-fundamentals.js`·`stock-financials.js`·`stock-financial-period-valuation.js`를 **데이터 공급층**으로 재사용할 수 있습니다.

**전략 자체**는 장기 가치투자·교육·스크리닝 보조로 **괜찮은 방법**이나, 단기 매매·박스권·기술적 시그널과는 **목적이 다르며**, 성장률·할인율 가정에 **민감**하므로 UI에 **가정·한계**를 반드시 노출해야 합니다.

---

## 1. 참고 이미지(책) 내용 정리

| 페이지 | 주제 | 핵심 메시지 |
|--------|------|-------------|
| 166 | 미래이익 할인법 도입 | 이익 예측 가능성 = 경영 위험. 순환·예측 어려운 기업 회피 |
| 167 | 기회비용·채권 비교 | CD/채권 수익 대비 주식은 더 높은 수익 요구. 주식=연간 이익 수취권 |
| 168 | 표 9-3 | 5년 균일 이익 $10k, 할인율 15% → PV 합 **$33,522** |
| 169 | Microsoft 예 | 내재가치 $75 vs 시장가 $50 → 15% 허들 대비 매력. **허들 레이트** 정의 |
| 170 | 할인율 선택 | 버핏: **10년 장기 국채 수익률**을 할인율로 (단순·일관). 채권보다 못 벌면 주식 안 삼 |
| 171 | 위험 정의 | 변동성 ≠ 위험. **이익 예측 불가**가 위험. 예측 쉬우면 국채 수준 할인율 |
| 172 | 표 9-4 맥도널드 | 10년 EPS 성장 12%, 이후 5%, 할인 10%, 잔여가치+부채차감 → **내재가치 $53.92** |
| 173 | 채권 vs 성장 | EPS $2.50, 6% 채권 → 적정가 ~$40. 성장 가정 시 표 9-4로 확장 |
| 174~175 | 고성장·PER 함정 | PER 100·30% 성장 10년 가정의 비현실성. 미래만 보면 오류 |
| 176 | 안전마진 | 내재가치는 주관적·변동. 그레이엄 **안전마진** — 보수적 가치 이하에서만 매수 |

---

## 2. 전략 정의 — 「버핏식 미래이익 할인」이란?

### 2.1 한 줄 정의

**앞으로 벌 이익(EPS)의 현재가치 합**이 **현재 주가 + 요구 수익(허들)** 을 만족하는지 본다.

### 2.2 전략의 논리 구조 (3단)

```
[1] 이익 예측 가능?  → 아니면 제외(순환·불확실)
[2] 미래 EPS 궤적 가정 → 연도별 PV 합산 + 잔여가치(terminal)
[3] 내재가치 vs 시장가 → 허들 수익·안전마진 판단
```

### 2.3 채권 비유 (책의 직관)

| 채권 | 주식(책 모델) |
|------|----------------|
| 액면·쿠폰 이자 | 연간 EPS(주당 순이익) |
| 시장 금리 | 할인율 = 허들 레이트 |
| 채권 가격 | 주식 시장가 |
| 적정가 | EPS / 할인율 (성장 0 단순식) |

### 2.4 버핏이 강조하는 것 vs 일반 애널리스트

| 항목 | 일반 | 책 속 버핏 |
|------|------|------------|
| 위험 | 베타·변동성 | **이익 예측 난이도(경영 위험)** |
| 할인율 | 종목마다 복잡 조정 | **10년 국채 수익률** 등 단순 기준 |
| 성장 | 공격적 장기 가정 | **보수적·검증 가능한 성장**만 |
| 매수 | NPV>0 근사 | **안전마진** (보수적 내재가치 이하) |

---

## 3. 계산식 — 심플 정리

### 3.1 기본 PV (연도 t 이익)

```
PV_t = E_t / (1 + r)^t
```

- `E_t` : t년차 주당 이익(EPS)  
- `r` : 할인율(연, 소수. 예: 10% → 0.10)

### 3.2 N년 균일 이익 (표 9-3형)

```
내재가치 ≈ Σ_{t=1..N} E / (1+r)^t
```

예: E=10,000, r=15%, N=5 → **33,522**

### 3.3 성장 EPS (표 9-4형, 명시적 단계)

```
E_1 = E_0 × (1+g_1)
E_t = E_{t-1} × (1+g_1)   (t = 1..N)

PV_명시 = Σ_{t=1..N} E_t / (1+r)^t
```

### 3.4 잔여가치 (Gordon / continuation, 책 표 9-4)

```
E_{N+1} = E_N × (1 + g_∞)
Terminal = E_{N+1} / (r - g_∞)        ← r > g_∞ 필수
PV_Terminal = Terminal / (1+r)^N
```

책 예 (N=10, E_10=6.93, g_∞=5%, r=10%):

```
E_11 = 6.93 × 1.05 = 7.2765
Terminal = 7.2765 / (0.10 - 0.05) = 145.53
PV_Terminal = 145.53 / (1.10)^10 ≈ 56.1
(책 표기 59.92 — 반올림·EPS 경로 차이 가능)
```

### 3.5 부채·주당 조정 (책 맥도널드)

```
주당_내재가치 = PV_명시 + PV_Terminal - 주당순부채
```

- `주당순부채` = (총부채 - 현금성자산) / 발행주식수 (엔터프라이즈→에쿼티 변환 시)

### 3.6 초간단 허들 비교 (성장 0)

```
적정주가_단순 = EPS / r
현재_수익률 = EPS / 시장가
매력 여부 = 현재_수익률 > r  (또는 시장가 < 적정주가)
```

예: EPS 2.50, r=6% → 적정가 ≈ 41.7. 시장가 50 → 수익률 5% → 채권 대비 불리.

### 3.7 안전마진

```
매수_상한 = 내재가치_보수 / (1 + 마진%)
```

예: 내재가치 80~100 불확실 → 마진 25% → **60 이하**에서만 매수(웰스파고 예시).

---

## 4. 계산식 — 상세·구현 시 주의

### 4.1 EPS vs FCF vs 당기순이익

- **책:** 주로 **EPS(주당순이익)** 기준 서술.  
- **실무 DCF:** 잉여현금흐름(FCF)이 더 정석.  
- **Stock 현재 데이터:** `stock-fundamentals`에 **EPS·forwardEps** 있음. FCF는 Yahoo cashflow에서 **추출 가능**하나 미구현.  
- **권장 1단계:** EPS 기반(책 충실). 2단계 옵션: FCF 토글.

### 4.2 성장률 g 추정

| 방법 | 설명 | Stock 활용 |
|------|------|------------|
| 사용자 입력 | 10년 g₁, 이후 g∞ | UI 슬라이더/입력 |
| 과거 CAGR | 최근 5~10년 EPS CAGR | `stock-financials` 연간 EPS 행 |
| 컨센서스 | forwardEps / trailingEps | `stock-fundamentals.forwardEps` |
| 업종 기본값 | 업종별 보수적 g | `stock-vault-meta` 업종 + 설정 JSON |

**책 경고:** 고성장(30~40%×10년) 가정은 Oracle·닷컴 버블 교훈 — UI에 **상한 캡**(예: 15~20%) 권장.

### 4.3 할인율 r (허들)

| 소스 | US | KR |
|------|----|----|
| 책 권장 | 10년 **미 국채** 수익 | 동일 논리 → **한국 10년 국고채** |
| Stock 현재 | **없음** | **없음** |
| 구현 후보 | Yahoo `^TNX` (10Y yield) | ECOS/한국은행 API, 또는 수동 env 기본값 |

**버핏식 단순화:** 종목별 r 조정 대신 **시장 단일 r** + **경영위험 플래그**(순환·EPS 변동성 높으면 경고만, r은 올리지 않거나 사용자 고급 모드).

### 4.4 잔여가치 민감도

- `r - g_∞` 가 1~2%p면 Terminal이 **폭발** → 내재가치 신뢰도 급락.  
- UI: `r - g_∞ < 3%p` 이면 **경고 배지** 필수.  
- 대안: **10년만 합산, Terminal 생략** 보수 모드.

### 4.5 KR 데이터 단위

- Naver EPS: **원/주** (`stock-fundamentals` `parseNaverMoneyValue`).  
- 재무제표: **억원** 단위 행 다수 → 주식수로 나눠 EPS 산출 시 **단위 검증** 필수.  
- US Yahoo EPS: 통화 USD, `trailingEps` 사용.

### 4.6 주당 부채

- Yahoo balance: `totalLiab`, `cash`, `longTermDebt` 등 (`stock-financials.js` 라벨 맵 존재).  
- 발행주식수: `defaultKeyStatistics.sharesOutstanding` (US) — KR은 Naver/재무에서 보완 필요.

---

## 5. 이 전략, 괜찮은 방법인가?

### 5.1 장점 (Stock에 넣을 가치)

1. **재무 탭과 정합** — 이미 PER·EPS·제무제표를 보여주므로 「왜 이 PER인가」에 답하는 층.  
2. **교육·의사결정 프레임** — 단기 차트와 **다른 시간축** 제공.  
3. **스크리닝 확장** — 종목보관·골든크로스와 병행 시 「저평가 + 기술적 신호」 필터 가능.  
4. **책 레퍼런스와 1:1** — 사용자가 준 자료와 UI 라벨 일치 가능.

### 5.2 한계·리스크

1. **가정 의존** — g, r 조금만 바꿔도 내재가치 2배 변동.  
2. **EPS ≠ 현금** — 한국 회계·일회성 이익 왜곡.  
3. **금리·국채 데이터** — KR 10년물 자동화 없으면 r이 **고정 상수**에 머무름.  
4. **Yahoo 병목** — 대량 스크리닝 시 기존 `ma-align`/`golden-cross`와 **동일 rate-limit** 충돌.  
5. **자동매매 연동 위험** — 박스권·실매매 FSM에 바로 넣으면 **시간스케일 불일치** (DCF는 연 단위, 박스권은 분·일).  
6. **법적·면책** — 「투자 권유」 아님 문구·가정 공개 필요.

### 5.3 종합 판단

| 용도 | 적합도 |
|------|--------|
| 재무 탭 보조·종목 단위 계산기 | **◎ 매우 적합** |
| 종목보관 저평가 랭킹 | **○ 적합** (배치·캐시 필요) |
| 실매매/박스권 진입 신호 | **△ 비권장** (별도 검증 전제) |
| 완전 자동 버핏 봇 | **× 단독으로 부적합** |

---

## 6. Stock 서버 — 이미 있는 것 (재사용 맵)

### 6.1 데이터·밸류에이션 계층

| 모듈 | 경로 | 제공 데이터 | 버핏 DCF 활용 |
|------|------|-------------|---------------|
| **재무 스냅샷** | `server/stock-fundamentals.js` | price, eps, forwardEps, per, pbr, roe, 배당 | **E₀, 시장가, forward 성장 힌트** |
| **재무제표 기간** | `server/stock-financials.js` | KR Naver / US Yahoo 손익·재무·CF 이력 | **과거 EPS CAGR, 부채·현금, 주식수** |
| **기간별 PER/EPS** | `server/stock-financial-period-valuation.js` | 공시 시점 주가·EPS로 PER | **과거 이익 안정성·순환 판단** |
| **기간 지표 추출** | `server/stock-financial-period-metrics.js` | EPS, BPS, ROE, PER 행 파싱 | **E₀·품질 지표** |
| **재무 AI 의견** | `server/stock-financials-analysis.js` | YoY, 동종 PER 비교 | **경영위험 서술 보강** |
| **시세** | `server/stock-data.js` | 차트·현재가 | **시장가, stale 캐시** |
| **Yahoo 큐** | `server/yahoo-queue.js` | rate limit | **모든 US 호출 공통** |
| **업종** | `server/stock-vault-meta.js`, `kr-naver-industry.js` | industry 탭·라벨 | **업종 기본 성장률(옵션)** |
| **환율** | `server/fx-usd-krw.js` | USD/KRW | **US 종목 KRW 환산 표시** |

### 6.2 API (이미 존재)

```
GET /api/stock/:symbol/fundamentals          → loadStockFundamentals
GET /api/stock/:symbol/financials/periods
GET /api/stock/:symbol/financials/periods/:id
GET /api/stock/:symbol/financials/periods/:id/analysis
```

### 6.3 UI (이미 존재)

| 화면 | 파일 | 연결 |
|------|------|------|
| **재무** 탭 | `src/components/FinancialsTab.tsx` | fundamentals + periods + analysis |
| 종목보관 | `StockVaultTab.tsx` | `openFinancialsTab` 이벤트로 재무 이동 |
| 실적 아이콘 | `EarningsUpcomingIconRail.tsx` | 동일 |

### 6.4 없는 것 (신규 필요)

| 항목 | 비고 |
|------|------|
| DCF/내재가치 계산 엔진 | **신규** |
| 10년 국채 수익률 피드 | **신규** (`^TNX`, KR 소스) |
| 잔여가치·안전마진 파라미터 저장 | **신규** |
| 내재가치 API 엔드포인트 | **신규** |
| 유니버스 일괄 스크리닝 job | **선택** (폴러·캐시) |

---

## 7. 제안 아키텍처 — 어디에 어떻게 넣을지

### 7.1 서버 (권장 파일 배치)

```
server/
  buffett-intrinsic-value.js      ← 순수 계산 (PV, terminal, margin) — 테스트 용이
  buffett-intrinsic-input.js      ← fundamentals + financials 조립 → 입력 DTO
  risk-free-rate.js               ← ^TNX / env / KR 수동 (Phase 1)
  create-app.js                   ← GET /api/stock/:symbol/intrinsic-value
  buffett-intrinsic-value.test.js ← 표 9-3, 9-4 숫자 회귀
```

**의존 방향 (단방향):**

```
buffett-intrinsic-value.js  (순수 함수, 외부 API 없음)
        ↑
buffett-intrinsic-input.js  → stock-fundamentals, stock-financials, risk-free-rate
        ↑
create-app.js route
```

### 7.2 API 초안 (구현 시)

```
GET /api/stock/:symbol/intrinsic-value
  ?discountRate=0.10        (optional, default=국채10Y)
  ?growth10y=0.12           (optional)
  ?growthTerminal=0.05
  ?years=10
  ?marginOfSafety=0.25
  ?mode=simple|full         simple=EPS/r, full=표9-4형
```

**Response 예시 필드:**

```ts
{
  symbol, currency, market,
  inputs: { eps0, price, discountRate, growth10y, growthTerminal, years, debtPerShare },
  outputs: {
    simpleFairPrice,           // EPS/r
    explicitPhasePv,
    terminalPv,
    intrinsicPerShare,
    marginOfSafetyPrice,
    impliedYieldAtMarket,      // EPS/price
    hurdleSpread,              // impliedYield - r
  },
  quality: {
    epsVolatility,             // 과거 EPS CV
    cyclicalFlag,
    terminalGapWarning,        // r - g∞ < 3%p
  },
  assumptions: string[],       // 면책·가정 문구
  sources: { eps: "...", rate: "...", debt: "..." },
}
```

### 7.3 UI 배치 (권장)

| 위치 | 이유 |
|------|------|
| **1순위: `FinancialsTab` 하단 패널** | 종목·EPS·기간 이미 로드됨. 「버핏식 내재가치」접이 카드 |
| 2순위: `StockVaultRowBubble` 링크 | 보관 종목에서 한 번에 내재가치 요약 |
| 3순위: 신규 상단 탭 | 탭 과다 — **비권장** |

**UI 요소:**

- 할인율(기본=국채, 수정 가능)
- 10년 성장률 / 잔여 성장률 (슬라이더 + forwardEps 힌트)
- 모드: **단순(EPS÷r)** / **전체(10년+잔여−부채)**
- 결과: 내재가치, 시장가, 괴리%, 안전마진 매수가
- 표: 연도별 E_t, PV_t (표 9-3·9-4 재현)
- 경고: 순환·terminal 민감·데이터 출처

### 7.4 기존 모듈 활용 상세

#### A) `loadStockFundamentals(symbol)`

```javascript
// buffett-intrinsic-input.js 의사코드
const f = await loadStockFundamentals(symbol);
const eps0 = f.forwardEps ?? f.eps;      // E₀
const price = f.price;
const impliedGrowth = f.forwardEps && f.eps
  ? (f.forwardEps / f.eps - 1) : null;  // UI 기본값 힌트
```

#### B) `loadFinancialPeriods` + `extractPeriodMetricsFromDetail`

- 최근 5~10 **연간** EPS 추출 → CAGR, 표준편차 → `cyclicalFlag`  
- `findPriorPeriod` 패턴은 `stock-financials-analysis.js`에 이미 있음 → **복제하지 말고 export 재사용 검토**

#### C) `buildHistoricalPeriodMetrics` (`stock-financial-period-valuation.js`)

- 기간별 PER·EPS 이력 — **이익 예측 가능성** 점수에 활용

#### D) `queueYahooRequest` / Naver

- US 부채·주식수: `quoteSummary` modules `balanceSheetHistory` + `defaultKeyStatistics`  
- **한 번의 fundamentals 호출로 부족** → input 빌더에서 **추가 1회** quoteSummary 허용 (캐시 30분)

#### E) `risk-free-rate.js` (신규)

```javascript
// Phase 1
US: Yahoo chart 또는 ^TNX yield
KR: process.env.KR_10Y_BOND_YIELD_DEFAULT ?? 0.035
// Phase 2: ECOS/금융감독원
```

---

## 8. 구현 단계 (로드맵) — 아직 착수 안 함

### Phase 0 — 준비 (현재 문서)

- [x] 책 내용·식 정리  
- [x] 기존 코드 인벤토리  
- [ ] 사용자 확인: KR only / US 포함, FCF 여부, 스크리닝 범위

### Phase 1 — 순수 엔진 + 단위 테스트

- `buffett-intrinsic-value.js`: `calcSimpleFairPrice`, `calcFullIntrinsic`  
- 테스트: 표 9-3 ($33,522), 맥도널드 표 9-4 (±2% 허용)

### Phase 2 — 입력 조립 + API 1종목

- `buffett-intrinsic-input.js`  
- `GET /api/stock/:symbol/intrinsic-value`  
- `risk-free-rate` US만 자동

### Phase 3 — 재무 탭 UI

- `FinancialsTab` 패널 + i18n  
- 가정·면책·출처 표시

### Phase 4 — 품질·스크리닝 (선택)

- EPS 변동성·순환 플래그  
- stock-vault 배치: 내재가치/시장가 비율 상위 N  
- **별도 폴러** + JSON 스냅샷 (Yahoo 부하 분산)

### Phase 5 — 고급 (선택)

- FCF DCF 토글  
- KR 10년 국고채 자동  
- 실매매 연동 **하지 않음** (원칙)

---

## 9. Yahoo / 운영 리스크

| 리스크 | 영향 | 대응 |
|--------|------|------|
| Rate limit | 종목별 intrinsic 호출 시 429 | 사용자 요청 1종목씩 + 30분 캐시 |
| KR EPS 누락 | 계산 불가 | fundamentals 실패 시 UI 비활성 + 이유 |
| forwardEps 과대 | 성장률 기본값 왜곡 | 기본값 = min(CAGR, forward implied, 12%) |
| Terminal 폭발 | 비현실적 고평가 | gap 경고 + 보수 모드 |
| 국채 r 고정 | 금리 변동 미반영 | r 출처·갱신 시각 표시 |

---

## 10. 열린 결정 사항 (구현 전 확인)

1. **시장 범위:** KR만 / US 포함 / 둘 다?  
2. **이익 정의:** trailing EPS만 / forward 혼합 / FCF 옵션?  
3. **할인율:** US `^TNX` 자동 + KR 수동 env로 시작할지?  
4. **UI 위치:** 재무 탭만 vs 종목보관 요약도?  
5. **스크리닝:** 300종 일괄 vs 사용자 요청 시만?  
6. **안전마진 기본값:** 25%? 사용자 조절?

---

## 11. 결론

- 촬영본은 **EPS 기반 할인현금흐름(간이 DCF)** + **국채 허들** + **안전마진** 가치투자 프레임.  
- Stock은 **재무 데이터 파이프라인은 70% 갖춤**, **DCF 엔진 0%**.  
- **가장 효율적 경로:** 신규 순수 계산 모듈 + 기존 `stock-fundamentals`/`stock-financials` 입력 조립 + **재무 탭 UI**.  
- **좋은 전략인가:** 장기·교육·저평가 스크리닝에는 **유효**. 단기 트레이딩·자동매매 단독 신호로는 **부적합**.  
- **구현은 하지 않음** — 본 문서 승인·열린 결정 확정 후 Phase 1부터 진행 권장.

---

*본 문서는 투자 권유가 아니며, 계산 결과는 가정에 따라 크게 달라집니다.*
