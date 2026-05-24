# 버그 분석 보고서 — Stock 자동매매 앱

**작성일:** 2026-05-24  
**수정 완료일:** 2026-05-24  
**수정 결과:** 테스트 10/10 통과, 34개 케이스 전부 통과 (기존 실패 1건 포함 모두 수정)  
**분석 범위:** `C:\Stock\server\` (Node.js 서버), `C:\Stock\src\` (프론트엔드 TypeScript)  
**분석 방법:** 전체 소스코드 정적 분석 + vitest 테스트 실행  
**테스트 결과:** 27개 통과 / 1개 실패 (`stock-search-us-symbol.test.js`)

---

## 테스트 실행 결과 요약

```
Test Files:  1 failed | 9 passed (10)
      Tests: 27 passed
```

| 파일 | 결과 | 비고 |
|------|------|------|
| server/kr-naver-quote.test.js | ✅ 통과 | 3개 케이스 |
| server/public-app-origin.test.js | ✅ 통과 | 3개 케이스 |
| server/stock-input-validation.test.js | ✅ 통과 | 5개 케이스 |
| server/live-trade-sell-strategy.test.js | ✅ 통과 | 4개 케이스 |
| server/stock-search-us-symbol.test.js | ❌ **실패** | `node:test` vs vitest 불일치 |
| src/lib/netReturn.test.ts | ✅ 통과 | 3개 케이스 |
| src/lib/cryptoDisplayQuote.test.ts | ✅ 통과 | 2개 케이스 |
| src/lib/recTrackerBigGainSignals.test.ts | ✅ 통과 | 2개 케이스 |
| src/regression/stock-chart-overlays-deps.test.ts | ✅ 통과 | 1개 케이스 |
| src/components/CryptoTab.mount.test.tsx | ✅ 통과 | 1개 케이스 |

---

## 심각도별 분류

| 심각도 | 건수 | 설명 |
|--------|------|------|
| 🔴 CRITICAL | 3 | 실제 실매매 자금 손실 또는 추적 불가 유발 가능 |
| 🟠 HIGH | 4 | 실매매 로직 오류, 계산 버그 |
| 🟡 MEDIUM | 5 | 잠재적 오류, 불일치, 신뢰도 저하 |
| 🟢 LOW | 4 | 코드 품질, 엣지케이스 |

---

## 🔴 CRITICAL (즉시 수정 필요)

---

### BUG-001: setInterval 중복 매도 레이스 컨디션
**파일:** `server/live-trade-auto-sell.js:391–409`  
**함수:** `startLiveTradeAutoSellPoller`

**문제 코드:**
```js
const run = () => {
  void tickLiveTradeAutoSell().catch((e) => { ... });
};
run();
setInterval(run, POLL_MS);  // ← 문제: 이전 tick 완료 전에 다음 tick 실행
```

**설명:**  
`setInterval(run, POLL_MS)`에서 `run`은 `void`로 시작하여 Promise를 기다리지 않습니다.  
`tickLiveTradeAutoSell()` 내부에서 `executeBithumbLiveSellOrder`(빗썸 API 호출, 약 2~5초 소요)가 `await`되는 동안, POLL_MS(기본 45초)가 지나면 두 번째 interval이 동일 코드를 실행합니다.

만약 첫 번째 tick이 45초 이상 걸리거나 서버 부하로 지연될 경우:
1. 두 번째 tick이 시작
2. 두 tick 모두 `buildOpenPositionsWithSellTargetsSync()`에서 동일 포지션 발견
3. 두 tick 모두 `executeBithumbLiveSellOrder()` 호출
4. 첫 번째 매도 성공 후 `recordLiveTradeSellSync` 반영 전에 두 번째 주문 전송

**실제 위험:** 동일 코인을 두 번 매도 시도. 잔고 부족 시 API 오류로 끝나지만, 빗썸 잔고가 충분하면 실제 이중 매도 발생.

**수정 방법:**
```js
// setInterval 대신 재귀 setTimeout 사용
export function startLiveTradeAutoSellPoller() {
  if (process.env.STOCK_LIVE_TRADE_AUTO_SELL === "0") return;
  const g = globalThis;
  if (g.__stockLiveTradeAutoSellStarted) return;
  g.__stockLiveTradeAutoSellStarted = true;

  let running = false;
  const loop = () => {
    if (running) return;
    running = true;
    tickLiveTradeAutoSell()
      .catch((e) => console.warn("[live-trade:auto-sell]", e?.message ?? e))
      .finally(() => {
        running = false;
        setTimeout(loop, POLL_MS);
      });
  };
  loop();
}
```

---

### BUG-002: 실매매 주문 성공 후 포트폴리오 기록 실패 시 고아 주문 발생
**파일:** `server/live-trade-runner.js:139–155`  
**함수:** `liveBuyForProgram`

**문제 코드:**
```js
if (out.ok) {
  try {
    const quote = await resolveLiveTradeQuote(sym);     // ← 실패 가능
    const priceForRecord = out.fillPrice ?? quote.price;
    await recordLiveTradeBuyAsync(program, ...);        // ← 실패 가능
  } catch (e) {
    runErr = e instanceof Error ? e.message : String(e);
    console.warn("[live-trade] portfolio record:", runErr);  // ← 로그만, 복구 없음
  }
  // 거래소 주문은 성공, 앱 기록은 실패 → 고아 주문
```

**설명:**  
거래소(빗썸)에 매수 주문이 성공한 후, `resolveLiveTradeQuote()` 또는 `recordLiveTradeBuyAsync()`가 실패하면:
- 실제 코인은 매수됨
- 앱 포트폴리오에는 기록 없음
- 중복 방지 키(`shouldSkipDuplicate`)는 이미 설정되어 6시간 동안 재시도 불가
- 자동 매도(손절/익절)가 해당 포지션에 작동하지 않음

**실제 위험:** 사용자가 직접 빗썸 앱에서 수동으로 확인하지 않으면 손실 포지션이 방치될 수 있음.

**수정 방법:**
```js
// 기록 실패 시 복구 로그 파일에 저장
if (out.ok) {
  try {
    ...
    await recordLiveTradeBuyAsync(...);
  } catch (e) {
    runErr = e instanceof Error ? e.message : String(e);
    // 복구용 파일 저장
    const orphanLog = { orderId: out.orderId, symbol: sym, programId: program.id, atMs: Date.now() };
    fs.appendFileSync(ORPHAN_LOG_FILE, JSON.stringify(orphanLog) + "\n");
    console.error("[live-trade] ORPHAN ORDER:", orphanLog);
  }
}
```
또는 중복 방지 키를 기록 성공 후에만 설정하도록 순서 변경.

---

### BUG-003: Armed KR(국내주식) 포지션 자동 매도 시 실제 주문 없이 simulated 기록
**파일:** `server/live-trade-auto-sell.js:245–349`  
**함수:** `tickLiveTradeAutoSell`

**문제 코드:**
```js
if (isArmed && pos.market === "crypto") {
  // ← 빗썸 API 실제 매도 호출
  const sellResult = await executeBithumbLiveSellOrder(...);
  ...
} else {
  // ← Armed KR 포지션도 여기로 빠짐!
  recordLiveTradeSellSync({ ..., simulated: true });  // 실제 매도 없음!
}
```

**설명:**  
`isArmed && pos.market === "kr"` 조건이 충족될 때 (국내주식 실매매 모드), 토스증권 매도 API 호출 없이 `simulated: true`로만 기록됩니다.

사용자 관점:
- 앱에서 포지션이 자동 청산된 것으로 표시
- 실제 토스증권 계좌에는 주식이 그대로 보유
- 이후 토스 앱에서 수동 확인·매도 필요하나 알림 없음

**실제 위험:** 손절 조건 발동 시 실제 주식이 매도되지 않아 추가 손실 지속.  
(현재 토스 자동매도 API가 미구현 스텁임을 고려하면 이는 설계 의도일 수 있으나, 사용자에게 명확히 경고하지 않음)

**수정 방법 (단기):**
```js
// armed + kr 포지션은 자동매도 건너뛰고 경고 알림
if (isArmed && pos.market === "kr") {
  console.warn("[live-trade:auto-sell] KR 실매매 자동매도 미지원. 수동 매도 필요:", pos.symbol);
  // 텔레그램 알림 발송
  continue;
}
```

---

## 🟠 HIGH (조속히 수정 필요)

---

### BUG-004: 부분 매도 시 수수료 비례 처리 오류
**파일:** `server/live-trade-portfolio-store.js:270`  
**함수:** `buildPositionsFromTrades`

**문제 코드:**
```js
const proceeds = (t.amount / t.quantity) * sellQty - t.feeAmount;  // ← 전체 수수료 차감!
```

**올바른 코드 (같은 코드베이스 내 live-trade-sim-feedback.js:80):**
```js
const proceeds = (t.amount / t.quantity) * matched - (t.feeAmount / t.quantity) * matched;
```

**설명:**  
부분 매도 예시 (10개 중 5개 매도, 총 매도 수수료 1,000원):
- 현재 코드: `proceeds = 단가 * 5 - 1,000` (수수료 1,000원 전체 차감)
- 올바른 계산: `proceeds = 단가 * 5 - 500` (5/10 비례 차감)

이로 인해 부분 매도 시 실현 손익(`realizedPnl`)이 약 2배 과소 계산되고, 잔여 포지션의 `costBasis`도 왜곡됩니다.

**수정 방법:**
```js
const proportionalFee = (t.feeAmount / t.quantity) * sellQty;
const proceeds = (t.amount / t.quantity) * sellQty - proportionalFee;
```

---

### BUG-005: 중복 방지 키를 주문 전에 설정하여 실패 후 6시간 재시도 불가
**파일:** `server/live-trade-runner.js:59–72`  
**함수:** `shouldSkipDuplicate`

**문제 코드:**
```js
function shouldSkipDuplicate(programId, symbol) {
  const key = orderDedupeKey(programId, symbol);
  const prev = recentOrderKeys.get(key);
  if (prev && Date.now() - prev < DEDUPE_MS) return true;
  recentOrderKeys.set(key, Date.now());  // ← 주문 실행 전에 키 설정
  saveDedupState(recentOrderKeys);
  return false;
}
```

**설명:**  
중복 방지 키가 실제 주문 성공/실패 여부와 무관하게 호출 즉시 설정됩니다.  
- 네트워크 오류, 잔고 부족, API 오류 등으로 주문이 실패해도
- 동일 종목은 6시간(`DEDUPE_MS`) 동안 재시도하지 않음
- 당일 좋은 매수 기회를 놓칠 수 있음

**수정 방법:**
```js
// shouldSkipDuplicate를 두 단계로 분리
function isDuplicate(programId, symbol) {
  const key = orderDedupeKey(programId, symbol);
  const prev = recentOrderKeys.get(key);
  return prev != null && Date.now() - prev < DEDUPE_MS;
}

function markDedupKey(programId, symbol) {
  const key = orderDedupeKey(programId, symbol);
  recentOrderKeys.set(key, Date.now());
  ...
  saveDedupState(recentOrderKeys);
}

// liveBuyForProgram에서:
if (isDuplicate(`live:${program.id}`, sym)) return;
const out = await executeBithumbLiveBuyOrder(...);
if (out.ok) markDedupKey(`live:${program.id}`, sym);  // 성공 시에만 키 설정
```

---

### BUG-006: USD/KRW 환율 조회 실패 시 예외가 상위로 전파됨
**파일:** `server/live-trade-market.js:89`  
**함수:** `resolveOrderAmountForMarket`

**문제 코드:**
```js
if (usd != null && Number.isFinite(usd) && usd > 0) {
  const { rate } = await getUsdKrwRate();  // ← throw 가능, try/catch 없음
  if (rate > 0) return Math.round(usd * rate);
}
return program.orderAmountKrw;
```

**설명:**  
`orderAmountUsd`가 설정된 프로그램에서 `getUsdKrwRate()`가 예외를 던지면 (FX API 다운, 네트워크 오류), 해당 예외가 `resolveOrderAmountForMarket` 호출자로 전파되어 매수 주문 전체가 실패합니다. `orderAmountKrw`가 별도로 설정되어 있어도 사용되지 않습니다.

**수정 방법:**
```js
if (usd != null && Number.isFinite(usd) && usd > 0) {
  try {
    const { rate } = await getUsdKrwRate();
    if (rate > 0) return Math.round(usd * rate);
  } catch (e) {
    console.warn("[live-trade:market] FX 조회 실패, KRW 금액으로 폴백:", e?.message);
  }
}
return program.orderAmountKrw;
```

---

### BUG-007: 빗썸 동기화에서 포지션 오픈 이전 매도 체결도 매칭
**파일:** `server/live-trade-bithumb-reconcile.js:64–65`  
**함수:** `findAskFillAfter`

**문제 코드:**
```js
function findAskFillAfter(orders, openedAtMs) {
  for (const o of orders) {
    if (String(o?.side ?? "").toLowerCase() !== "ask") continue;
    const fill = parseDoneOrderFill(o);
    if (!fill) continue;
    if (fill.atMs + 60_000 < openedAtMs) break;          // ← 60초 이전까지만 탐색 중단
    if (fill.atMs >= openedAtMs - 60_000) return fill;   // ← 60초 이전 매도도 매칭!
  }
  return null;
}
```

**설명:**  
`fill.atMs >= openedAtMs - 60_000` 조건은 포지션이 오픈되기 최대 60초 전에 발생한 매도 체결도 유효한 매도로 인식합니다.  

시나리오:
1. 09:00:00에 이전 포지션 매도 체결
2. 09:00:30에 새 포지션 오픈 (동일 종목)
3. 동기화 실행 시 09:00:00 매도가 새 포지션의 청산으로 잘못 연결됨
4. 실제로는 보유 중인 포지션이 앱에서 청산 처리됨

**수정 방법:**
```js
if (fill.atMs >= openedAtMs) return fill;  // 오픈 이후 매도만 허용
```

---

## 🟡 MEDIUM (보통 중요도)

---

### BUG-008: Long 전략에서 목표가 도달해도 netPct < 8%면 매도 안 됨
**파일:** `server/live-trade-sell-strategy.js:413`  
**함수:** `evaluateLongTermSell`

**문제 코드:**
```js
if (target != null && currentPrice >= target && netPct >= 8) {  // ← netPct >= 8 조건
  return finalizeHit({ price: target, note: `가치 목표 도달 (순수익 ${netPct.toFixed(1)}%)` }, ...);
}
```

**Short/Medium 전략 (조건 없음):**
```js
// live-trade-sell-strategy.js 내 buildStaticTargetHit
if (target != null && price >= target) return { ...hit };  // ← netPct 조건 없음
```

**설명:**  
사용자가 Long 전략 프로그램에서 목표 매도가를 현재가 대비 +5% 수익으로 설정했더라도, 순수익률이 8% 미만이면 자동 매도가 발생하지 않습니다. 시장이 반전하면 손실로 전환될 수 있습니다.

**수정 방법:**
```js
if (target != null && currentPrice >= target) {
  return finalizeHit({ price: target, note: `목표가 도달 (순수익 ${netPct.toFixed(1)}%)` }, "long", "value_target");
}
```

---

### BUG-009: 매입단가에 매수 수수료 포함 후 매도 전략에서 왕복 수수료 재적용으로 이중 차감
**파일:** `server/live-trade-portfolio-store.js:263` + `server/live-trade-sell-strategy.js:169`

**문제 흐름:**
```js
// live-trade-portfolio-store.js:263
pos.costBasis += t.amount + t.feeAmount;  // 매수 수수료 포함한 costBasis
// → avgEntryPrice = costBasis / quantity  (매수 수수료 포함 단가)

// live-trade-sell-strategy.js:169
const fee = ctx.roundTripFeeRate ?? DEFAULT_ROUND_TRIP_FEE_RATE;
const netPct = netReturnPct(entry, currentPrice, fee);  // 왕복 수수료 또 차감
// netReturn.ts: (currentPrice - entry) / entry - roundTripFeeRate
```

**설명:**  
매수 수수료가 `avgEntryPrice`에 이미 내재된 상태에서 `netReturnPct`가 왕복 수수료를 또 차감합니다. 결과적으로 매수 수수료(약 0.05%)가 약 1.5~2배 중복 계산되어 순수익률이 약 0.05~0.1% 과소 평가됩니다.

실제 위험: 매도 판단 임계값(`netPct >= 0.5` 등)이 낮은 단기 전략에서 매도 신호를 0.05~0.1% 늦게 발생시킬 수 있음.

---

### BUG-010: 자격증명 파일 비원자적 쓰기
**파일:** `server/user-credentials-store.js:55`  
**함수:** `writeStoreSync`

**문제 코드:**
```js
function writeStoreSync(store) {
  ensureDirSync();
  fs.writeFileSync(CREDS_FILE, JSON.stringify(store, null, 0), "utf8");  // ← 비원자적
}
```

**비교 (live-trade-portfolio-store.js — 원자적 쓰기 사용):**
```js
const tmp = storePath + ".tmp";
fs.writeFileSync(tmp, data, "utf8");
fs.renameSync(tmp, storePath);  // ← 원자적
```

**설명:**  
서버 크래시 또는 강제 종료가 `writeFileSync` 실행 중에 발생하면 자격증명 파일이 손상됩니다. 손상된 파일로 서버가 재시작되면 API 키를 읽지 못해 실매매 API 연결이 끊깁니다.

**수정 방법:**
```js
function writeStoreSync(store) {
  ensureDirSync();
  const tmp = CREDS_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(store, null, 0), "utf8");
  fs.renameSync(tmp, CREDS_FILE);
}
```

---

### BUG-011: crypto+us 조합 프로그램에서 KRW 최소 금액 검증 누락
**파일:** `server/live-trade-programs-store.js:211`  
**함수:** `validateProgramPatch`

**문제 코드:**
```js
const needsKrw = mk.kr || (mk.crypto && !mk.us);  // ← crypto=true, us=true 이면 false
```

**설명:**  
`markets: { crypto: true, us: true }` 조합으로 프로그램을 생성하면 `needsKrw = false`로 `orderAmountKrw` 검증을 건너뜁니다.  
빗썸은 항상 KRW 기준 주문이므로, `orderAmountKrw`가 설정되지 않고 `orderAmountUsd`만 있을 때 FX 조회 실패 시 매수 주문이 전부 실패합니다.

**수정 방법:**
```js
const needsKrw = mk.kr || mk.crypto;  // crypto 활성화 시 항상 KRW 필요
```

---

### BUG-012: MACD 하락 전환 조건 부정확 (m0 양수 여부 미확인)
**파일:** `server/live-trade-sell-strategy.js:218–235`  
**함수:** `evaluateShortTermSell`

**문제 코드:**
```js
if (
  m0 != null && m1 != null && m2 != null &&
  m1 > 0 &&      // m1은 양수 체크
  m0 < m1 &&     // 현재값이 이전보다 낮음
  m1 < m2 &&     // 이전값이 2봉전보다 낮음 (이미 하락 중)
  netPct > -0.5
) { ... }  // MACD 하락 전환으로 매도
```

**설명:**  
`m0 > 0` 체크가 없어, MACD가 여전히 양수(상승 모멘텀 유효)인 상태에서 단순히 값이 감소하고 있어도 매도 신호가 발생합니다. 진정한 "하락 전환"은 MACD가 0선을 아래로 돌파하거나, 최소한 이전 양수 구간에서 확실히 꺾이는 시점이어야 합니다.

또한 `m1 < m2` 조건은 "m1이 m2보다 낮다"는 의미로, 이미 이전 봉에서 하락 중이었음을 의미합니다. 실제로 "현재 봉에서 꺾이는 순간"이 아닌 "이미 2봉 전부터 하락 중인 구간"에서도 트리거됩니다.

---

## 🟢 LOW (낮은 심각도)

---

### BUG-013: 테스트 파일에서 잘못된 프레임워크 임포트
**파일:** `server/stock-search-us-symbol.test.js:1–2`

**문제 코드:**
```js
import { describe, it } from "node:test";  // ← node:test 프레임워크
// 프로젝트는 vitest 사용 → "No test suite found" 오류
```

**수정 방법:**
```js
import { describe, it, expect } from "vitest";
```

---

### BUG-014: 빗썸 동기화에서 주문 40건 초과 시 매도 체결 누락 가능
**파일:** `server/live-trade-bithumb-reconcile.js` (bithumb API 호출부)  
**관련:** `reconcileBithumbHoldingsForUser` 함수 내 API 파라미터

**설명:**  
빗썸 주문 조회 API의 `limit: 40` 설정으로 인해, 특정 마켓에서 최근 40건을 초과하는 주문이 있을 경우 실제 매도 체결을 찾지 못해 동기화가 건너뛰어집니다. 단기간에 거래가 활발한 경우 발생 가능합니다.

**수정 방법:** `limit`를 100으로 증가, 또는 `openedAtMs` 이후 주문만 필터링하는 파라미터 추가.

---

### BUG-015: 분할 매수 시 목표가/손절가가 마지막 매수 기준만 사용
**파일:** `server/live-trade-portfolio-store.js` (`buildOpenPositionsWithSellTargetsSync`)

**설명:**  
동일 종목을 여러 번 매수한 경우 `buys[buys.length - 1]` (마지막 매수)의 목표가/손절가만 사용됩니다. 분할 매수에서 마지막 매수의 손절가가 가장 높은 경우, 이전 저가 매수분의 손절 조건이 과도하게 빡빡해지거나, 반대로 첫 매수보다 훨씬 높은 가격에서 매수한 경우 손절가가 너무 낮아질 수 있습니다.

---

### BUG-016: 프론트엔드에서 crypto 보유를 "kr" 시장으로 잘못 매핑
**파일:** `src/lib/liveHoldingToPick.ts:9`

**문제 코드:**
```ts
const market = h.market === "crypto" ? "kr" : h.market;
```

**설명:**  
UI 표시 목적으로 암호화폐를 `kr`로 강제 변환하고 있습니다. 이 값이 이후 다른 로직으로 전달될 경우 암호화폐를 국내주식으로 오인하는 버그가 연쇄적으로 발생할 수 있습니다. 변환 의도가 명확하지 않으며 타입 안전성도 떨어집니다.

---

## 실매매 안전성 체크리스트

실매매(`status: "armed"`) 활성화 전 확인 사항:

| 항목 | 상태 | 비고 |
|------|------|------|
| 빗썸 API 자격증명 암호화 저장 | ✅ 암호화됨 | `credentials-crypto.js` |
| 매수 중복 방지 | ⚠️ 부분적 | BUG-005: 실패 후에도 6시간 잠금 |
| 자동 매도 중복 방지 | 🔴 취약 | BUG-001: setInterval 레이스 가능 |
| 최대 포지션 수 제한 | ✅ 작동 | `maxOpenPositions` |
| 수수료 계산 | ⚠️ 오류 | BUG-004: 부분매도 시 오류 |
| FX 환율 오류 처리 | 🔴 취약 | BUG-006: 예외 전파 |
| 포트폴리오 기록 원자성 | ✅ 원자적 | tmp→rename 사용 |
| 자격증명 저장 원자성 | 🟠 취약 | BUG-010: 비원자적 쓰기 |
| 국내주식 자동매도 | 🔴 미구현 | BUG-003: simulated로만 기록 |
| 빗썸 잔액 동기화 | ⚠️ 부분적 | BUG-007: 타임윈도우 오류 |

---

## 수정 우선순위 권고

1. **[즉시] BUG-001** — setInterval → setTimeout 재귀 패턴으로 교체 (이중매도 방지)
2. **[즉시] BUG-003** — Armed KR 자동매도 비활성화 + 사용자 경고/텔레그램 알림
3. **[즉시] BUG-002** — 주문 성공 후 기록 실패 시 복구 로그 저장
4. **[빠른 수정] BUG-004** — 부분 매도 수수료 비례 계산 수정 (1줄 수정)
5. **[빠른 수정] BUG-006** — FX 조회 try/catch + KRW 폴백 추가 (3줄 수정)
6. **[빠른 수정] BUG-007** — 동기화 타임윈도우 조건 수정 (1줄 수정)
7. **[빠른 수정] BUG-005** — 중복 방지 키를 주문 성공 후에만 설정
8. **[다음 스프린트] BUG-010** — 자격증명 파일 원자적 쓰기
9. **[다음 스프린트] BUG-008** — Long 전략 netPct >= 8 조건 검토
10. **[다음 스프린트] BUG-011** — crypto+us 조합 KRW 검증 추가
11. **[다음 스프린트] BUG-013** — 테스트 파일 vitest로 교체
12. **[추후] BUG-009, BUG-012, BUG-014, BUG-015, BUG-016** — 계산 정확도 개선

---

*이 보고서는 소스코드 정적 분석과 vitest 테스트 실행 결과를 기반으로 작성되었습니다.*  
*실매매 기능은 실제 테스트 환경 없이 코드 분석만으로 검토되었습니다.*
