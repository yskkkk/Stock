# 전체 프로젝트 버그 분석 보고서
작성일: 2026-05-25  
분석 범위: C:\Stock 전체 (서버 30+ 파일, 프론트엔드 11 파일)  
상태: **코드 미반영 — 수정은 명령 후 진행**

---

## 버그 요약

| 심각도 | 건수 |
|--------|------|
| CRITICAL | 11건 |
| HIGH | 14건 |
| MEDIUM | 16건 |
| LOW | 9건 |
| **합계** | **50건** |

---

## CRITICAL (즉시 수정 필요)

---

### CRIT-01 — UCS-1
**파일:** `server/user-credentials-store.js` 라인 211  
**문제 코드:**
```js
const out = {
  apiKey: decryptSecret(row.apiKeyEncrypted),
  secretKey: decryptSecret(row.secretEncrypted),
  liveOrdersEnabled: true,  // ← 항상 true
};
```
**설명:** `liveOrdersEnabled`가 DB 행 값이 아닌 하드코딩 `true`로 반환된다. 실매매 비활성화 플래그가 있어도 무시된다.  
**영향:** 실매매 비활성화된 계정에서도 실주문 발생 가능.

---

### CRIT-02 — AC-1
**파일:** `server/access-control.js` 라인 152–155  
**문제 코드:**
```js
function writeAccessStore(data) {
  ensureDir();
  fs.writeFileSync(STORE_FILE, JSON.stringify(data, null, 2), "utf8");
}
```
**설명:** 비원자 파일 쓰기. 크래시 시 `access-control.json` 손상 → 재기동 시 JSON.parse 오류 → `readAccessStore()` catch 블록이 빈 객체 반환 → **모든 허용 IP 소실**, 서비스 전체 403 잠금.  
**영향:** 운영 중 서버 다운 후 재기동 불가.

---

### CRIT-03 — AC-2
**파일:** `server/access-control.js` 라인 307, 401, 480  
**문제 코드:**
```js
const store = readAccessStore();      // (1)
store.allowed.push(newRow);           // (2)
writeAccessStore(store);              // (3) ← 락 없음
```
**설명:** `/api/access/admin/approve`, `/api/access/request`, `/api/access/admin/revoke` 모두 잠금 없는 read-modify-write. 동시 요청 시 이전 write가 덮어쓰여진다.  
**영향:** 동시 승인/거절 요청 시 허용 IP 목록 데이터 유실.

---

### CRIT-04 — CRED-1
**파일:** `server/credentials-crypto.js` 라인 10–17  
**문제 코드:**
```js
return crypto.createHash("sha256").update(raw, "utf8").digest(); // 약한 키 허용
```
**설명:** `CREDENTIALS_MASTER_KEY`에 짧은 문자열("password", "1234" 등)을 입력해도 SHA-256 해시를 거쳐 키로 사용된다. 최소 길이·복잡도 검증 없음.  
**영향:** 약한 마스터키 설정 시 빗썸·토스 API Key/Secret 전체 복호화 가능.

---

### CRIT-05 — EXCH-1
**파일:** `server/live-trade-bithumb-exchange-trades.js` 라인 140–206  
**문제 코드:**
```js
const store = readStoreSync();              // 루프 시작 전 1회 읽음
for (const symbol of symbols) {
  for (const o of orders) {
    recordLiveTradeSellSync(...);           // 파일 쓰기
    store.trades = readStoreSync().trades;  // ← catch 블록 내에서는 미실행
  }
}
```
**설명:** 루프 내 `buildPositionsFromTrades(store.trades, ...)` 가 오래된 스냅샷을 사용한다. 예외 발생 시 `store.trades` 업데이트가 스킵되어 다음 반복에서 이미 매도된 포지션을 다시 매도 가능으로 계산한다.  
**영향:** 동일 종목 연속 체결 시 이중 매도 기록, 포트폴리오 수량 음수 오염.

---

### CRIT-06 — EXCH-2
**파일:** `server/live-trade-bithumb-exchange-trades.js` 라인 42–43  
**문제 코드:**
```js
let atMs = Date.parse(String(order?.created_at ?? order?.createdAt ?? ""));
if (!Number.isFinite(atMs) || atMs <= 0) atMs = Date.now();  // ← NaN 시 현재 시각
```
**설명:** 빗썸이 Unix timestamp(초 단위 숫자)를 반환하면 `Date.parse`가 NaN 반환 → `atMs = Date.now()`. 모든 과거 체결이 현재 시각 타임스탬프를 받아 `sinceMs` 필터를 통과, 수개월 전 체결도 새 체결로 처리된다.  
**영향:** 거래소 동기화 시 오래된 체결 반복 재입력, 이중 매도 기록.

---

### CRIT-07 — TOSS-1
**파일:** `server/toss-trading-adapter.js` 라인 29–37  
**문제 코드:**
```js
export function getTossApiPhase() {
  if (!tossApiKey()) return "unconfigured";
  if (!tossAccountId()) return "configured";
  return "ready";   // ← TOSS_API_SECRET 미확인
}
```
**설명:** `TOSS_API_KEY`와 `TOSS_ACCOUNT_ID`만 있으면 `isTossTradingReady()` = true. Secret 없이 실주문 경로 진입 가능.  
**영향:** 토스 Secret 미설정 상태에서 실주문 API 호출 발생.

---

### CRIT-08 — POLL-1
**파일:** `src/hooks/useLiveTradingStatusPoll.ts` 라인 45–49  
**문제 코드:**
```ts
function ensurePoll() {
  if (pollStarted) return;
  pollStarted = true;
  window.setInterval(pollTick, POLL_MS);  // ← ID 저장 없음
}
```
**설명:** `setInterval` 반환값을 저장하지 않아 폴링을 절대 정리할 수 없다. HMR 환경에서 모듈 재로드 시 인터벌 누적.  
**영향:** 메모리 누수, 로그아웃 후에도 인증 API 계속 호출, 개발 환경 중복 폴링.

---

### CRIT-09 — POLL-2
**파일:** `src/hooks/useLiveTradingStatusPoll.ts` 라인 64–66  
**문제 코드:**
```ts
useEffect(() => {
  ensurePoll();
  void refreshLiveTradingStatusNow();  // ← 매 마운트마다 즉시 호출
}, []);
```
**설명:** 이 훅을 사용하는 모든 컴포넌트가 마운트될 때마다 동일 API를 병렬 호출한다.  
**영향:** 앱 초기 로드 시 동일 API N중 병렬 요청.

---

### CRIT-10 — AUTH-1
**파일:** `src/components/LiveTradeAuthAndCredentials.tsx` 라인 1586–1639  
**문제 코드:**
```ts
const submit = async () => {
  setBusy(true);  // ← 설정 전 두 번 진입 가능
  ...
};
```
**설명:** `submit()` 함수 자체에 early-return 가드가 없다. React 상태 업데이트 지연(다음 렌더 사이클) 동안 더블클릭 시 두 번 진입 가능.  
**영향:** 로그인/회원가입 API 중복 호출 가능.

---

### CRIT-11 — DOCK-1
**파일:** `src/components/AppLiveTradeSideDock.tsx` 라인 368–378  
**문제 코드:**
```ts
const handleLogout = useCallback(() => {
  void logoutAuth().then(() => {
    invalidateLiveTradingPrefetch();
    ...  // ← .catch() 없음
  });
}, [closePanel, persistOpen]);
```
**설명:** `logoutAuth()` 실패 시 `.catch()` 없어 unhandled rejection 발생, 이후 콜백들 미실행. UI가 로그인 상태로 고착.  
**영향:** 로그아웃 실패 시 UI 불일치, 인증 토큰 잔존으로 보안 문제.

---

## HIGH (빠른 수정 권장)

---

### HIGH-01 — APP-1
**파일:** `server/create-app.js` 라인 773  
**문제 코드:**
```js
app.get("/api/live-trading/quotes", asyncRoute(async (req, res) => {
  // ← requireUserAuth 없음
```
**설명:** 다른 실매매 API와 달리 인증 없이 접근 가능. 심볼 수 제한도 없어 외부 API 할당량 소진 남용 가능.  
**영향:** 인증 없는 실시간 시세 API 남용.

---

### HIGH-02 — APP-2
**파일:** `server/create-app.js` 라인 980  
**문제 코드:**
```js
app.post("/api/picks/refresh", (_req, res) => {
  res.json(forceRescreen());  // ← 인증/권한 체크 없음
});
```
**설명:** 스크리닝 강제 재실행이 누구나 호출 가능.  
**영향:** 외부 요청으로 CPU/메모리 급증, API 쿼터 소진.

---

### HIGH-03 — APP-3
**파일:** `server/create-app.js` 라인 1778, 1944  
**문제 코드:**
```js
const symbol = req.params.symbol.toUpperCase();  // ← 검증 없음
```
**설명:** `symbol` 파라미터에 `../`, `%2F` 등 포함 시 내부 경로로 사용되면 Path Traversal 취약점.  
**영향:** 서버 내부 파일 접근 가능성.

---

### HIGH-04 — PG-1
**파일:** `server/process-guards.js` 라인 20–23  
**문제 코드:**
```js
process.on("uncaughtException", (err) => {
  logProcessError("uncaughtException", err);
  recordProcessRuntimeIssue("uncaughtException", err);
  // ← process.exit(1) 없음
});
```
**설명:** Node.js 공식 문서에 따르면 `uncaughtException` 이후 프로세스 상태는 신뢰할 수 없다. 계속 실행 시 메모리 누수, 불일치 상태 유발.  
**영향:** 크래시 후 손상된 상태에서 계속 실행.

---

### HIGH-05 — UCR-1
**파일:** `server/user-credentials-routes.js` 라인 96  
**문제 코드:**
```js
input.apiKey = String(body.apiKey ?? "");  // ← trim() 없음
input.secretKey = String(body.secretKey ?? "").trim();  // ← secretKey만 trim
```
**설명:** `apiKey`에 앞뒤 공백이 포함된 채로 저장된다. 복붙 입력 시 빗썸 인증 실패.  
**영향:** 공백 포함 API Key 저장 시 빗썸 연동 인증 실패.

---

### HIGH-06 — OPEN-1
**파일:** `server/live-trade-bithumb-open-orders.js` 라인 170–178  
**문제 코드:**
```js
await cancelBithumbOrderWithCredentials(orderId, credentials);  // ← liveOrdersEnabled 미확인
```
**설명:** 매수 주문과 달리 취소 주문은 `liveOrdersEnabled` / `BITHUMB_LIVE_ORDERS_ENABLED` 확인 없이 실거래소에 전송된다.  
**영향:** 시뮬레이션/개발 환경에서 실거래소 주문 취소 발생.

---

### HIGH-07 — BHLD-1
**파일:** `server/live-trade-bithumb-holdings.js` 라인 192–193  
**문제 코드:**
```js
openedAtMs: Date.now(),  // ← 매 호출마다 현재 시각
lastAtMs: Date.now(),
```
**설명:** 거래소 오버레이 보유 행의 `openedAtMs`/`lastAtMs`가 10초 폴링마다 현재 시각으로 리셋된다. 실제 매수 체결 시각(`fill.atMs`)을 사용해야 한다.  
**영향:** 보유 기간 항상 0, 시간 기반 자동 매도 로직 오작동 가능.

---

### HIGH-08 — KRW-1
**파일:** `server/bithumb-krw.js` 라인 170–187  
**문제 코드:**
```js
case "15m": return "10m";  // ← 빗썸 15m 미지원, 10m으로 대체 (aggregate 없음)
```
**설명:** 15m 타임프레임 요청 시 10m 캔들을 받아 aggregate 처리 없이 그대로 반환. 15m으로 표시하지만 실제 10m 봉.  
**영향:** 15분 기술 지표가 10분 봉 기준으로 계산 → 매수/매도 신호 오발신.

---

### HIGH-09 — SELL-1
**파일:** `server/live-trade-sell-target.js` 라인 40–42  
**문제 코드:**
```js
// stopLossPriceFromPct — 손절가 계산
const mult = (1 + pct / 100) / (1 - fee);  // ← (1-fee)로 나눔 (잘못된 방향)
```
**설명:** 손절 매도가는 수수료를 제한 뒤 순손실이 `pct`%에 도달하는 가격이어야 한다. 올바른 공식은 `entry * (1 + pct/100) * (1 - fee)` 이지만 `(1 - fee)`로 나누고 있어 손절선이 의도보다 더 낮게(공격적으로) 설정된다.  
**영향:** 실손실이 목표 손절%를 초과.

---

### HIGH-10 — EXCH-3
**파일:** `server/live-trade-bithumb-exchange-trades.js` 라인 179–181  
**문제 코드:**
```js
if (fill.side !== "sell") continue;  // ← 매수 체결 무시
```
**설명:** 빗썸에서 수동 매수한 경우 앱 포트폴리오에 기록되지 않는다. 이후 수동 매도 시 `pos.quantity <= 0`으로 예외 → catch에서 무시 → 매도 기록 누락. 앱에는 계속 보유 중으로 표시.  
**영향:** 수동 매수 후 수동 매도 시 포트폴리오 불일치, 없는 포지션에 자동 매도 주문 발생 가능.

---

### HIGH-11 — POLL-3
**파일:** `src/components/LiveTradePortfolioPanel.tsx` 라인 472–477  
**문제 코드:**
```ts
useEffect(() => {
  setLoading(true);
  void load();
  const id = window.setInterval(() => void load(), 30_000);
  return () => window.clearInterval(id);
}, [load]);  // ← load 참조 변경마다 재등록
```
**설명:** `feeByMarket` 재생성 시 `load` 참조가 바뀌어 인터벌 재등록, 진행 중인 비동기 완료 후 stale 클로저 데이터 쓰기 가능.  
**영향:** 포트폴리오 데이터 경쟁 조건, 구 응답이 신 응답을 덮어쓸 수 있음.

---

### HIGH-12 — AUTH-2
**파일:** `src/components/LiveTradeAuthAndCredentials.tsx` 라인 266–290  
**문제 코드:**
```ts
void fetchAuthMe().then((me) => applyAuth(Boolean(me.user)));
// ← 컴포넌트 언마운트 후 applyAuth 호출 시 setState 경고
```
**설명:** cleanup 함수에 비행 중인 Promise 취소(cancelled 플래그) 없음. 언마운트 후 setState 호출.  
**영향:** React 경고 및 메모리 누수.

---

### HIGH-13 — AUTH-3
**파일:** `src/components/LiveTradeAuthAndCredentials.tsx` 라인 1499–1505  
**문제 코드:**
```ts
useEffect(() => {
  if (sendCooldownSec <= 0) return;
  const id = window.setInterval(() => {
    setSendCooldownSec((s) => (s <= 1 ? 0 : s - 1));
  }, 1000);
  return () => window.clearInterval(id);
}, [sendCooldownSec]);  // ← 매 초마다 재등록
```
**설명:** 빠른 재렌더 시 기존 인터벌 cleanup 전 tick 발생 → `setSendCooldownSec` 두 번 호출 → 초당 2씩 감소.  
**영향:** 이메일 인증 쿨다운 60초가 실제보다 빠르게 소진.

---

### HIGH-14 — ORDERS-1
**파일:** `src/components/LiveTradeOpenOrdersPanel.tsx` 라인 85–96  
**문제 코드:**
```ts
void cancelBithumbOpenOrder(orderId)
  .then((res) => { setData(res); ... })   // ← 언마운트 후 실행 가능
  .catch((e) => setErr(...))
  .finally(() => setCancelId(null));
```
**설명:** 컴포넌트 언마운트 후 취소 API 응답 도착 시 setState 시도. 취소 플래그 없음.  
**영향:** 언마운트 후 setState 경고, 주문 취소 후 목록 깜빡임.

---

## MEDIUM (계획된 수정 권장)

---

### MED-01 — AC-3
**파일:** `server/access-control.js` 라인 118  
**문제 코드:**
```js
crypto.timingSafeEqual(Buffer.from(bearer), Buffer.from(token))
```
**설명:** 길이가 다를 경우 `ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH` 예외 발생. 길이 검사 없음.  
**영향:** 길이 불일치 Bearer 토큰으로 서버 500 오류 유발 가능.

---

### MED-02 — AC-4
**파일:** `server/access-control.js` 라인 75  
**문제 코드:**
```js
/** 기본값: 접근 제한 없음(로컬·개인 서버) */
return false;
```
**설명:** `ACCESS_CONTROL_ENABLED` 미설정 시 모든 API 공개. Secure-by-default 원칙에 반함.  
**영향:** 배포 시 설정 실수로 전체 API 무방비 노출.

---

### MED-03 — ETF-1
**파일:** `server/exchange-trading-fees.js` 라인 100  
**설명:** `refreshBithumbFeesForUserAsync` 내 `writeBithumbFeesOnRowSync`와 `upsertUserCredentialSync`가 동시 실행 시 race condition → 수수료 데이터 소실 가능.  
**영향:** 수수료 데이터 소실 → 잘못된 수수료로 손익 계산.

---

### MED-04 — LTM-1
**파일:** `server/live-trade-market.js` 라인 47  
**문제 코드:**
```js
return "kr";  // ← market/symbol 미지정 시 기본값
```
**설명:** market 미지정 시 암묵적으로 KR 시장 처리 → 크립토 종목이 KR 수수료로 계산될 수 있음.  
**영향:** market 미지정 시 잘못된 수수료율 적용.

---

### MED-05 — NR-1
**파일:** `server/net-return.js` 라인 44  
**문제 코드:**
```js
const ratio = current / entry;  // ← entry=0 시 Infinity
```
**설명:** `entry = 0` 시 `Infinity` 반환. `netReturnPct` 자체에 가드 없음.  
**영향:** entry 0 입력 시 Infinity 전파 → 손익 계산 파괴.

---

### MED-06 — LTE-1
**파일:** `server/live-trade-exit-scenario.js` 라인 396  
**문제 코드:**
```js
let targetRaw = Math.max(
  ...tpCandidates.filter((x) => Number.isFinite(x) && x > 0 && x > entry * 1.004),
);  // ← 공배열 시 -Infinity → targetRaw *= adj.targetBoost → Infinity
```
**설명:** `tpCandidates` 필터링 후 공배열 시 `Math.max()` = `-Infinity`, 이후 boostBoost 연산으로 Infinity 전파.  
**영향:** 목표가 Infinity 설정 → 자동 매도 영구 미실행.

---

### MED-07 — BHLD-2
**파일:** `server/live-trade-bithumb-holdings.js` 라인 280, 350  
**문제 코드:**
```js
snap.summary.totalPnl = snap.summary.realizedPnl + unrealizedPnl;
// ← realizedPnl이 undefined면 NaN
```
**설명:** `snap.summary.realizedPnl` 존재 보장 없음. undefined + number = NaN.  
**영향:** 포트폴리오 총 손익 / 수익률 NaN 표시.

---

### MED-08 — SYNC-1
**파일:** `server/live-trade-exchange-sync.js` 라인 95  
**문제 코드:**
```js
const g = globalThis;
if (g.__stockLiveTradeExchangeSyncStarted) return;
g.__stockLiveTradeExchangeSyncStarted = true;
```
**설명:** HMR/Vite 모듈 재로드 환경에서 `globalThis` 유지 보장 없음 → 폴러 중복 시작 → 동시 `recordLiveTradeSellSync` 경합.  
**영향:** 개발 환경에서 이중 매도 동기화 루프.

---

### MED-09 — BKRW-1
**파일:** `server/bithumb-krw.js` 라인 52–65  
**문제 코드:**
```js
if (allTickerCache.data && now - allTickerCache.at < ALL_TICKER_CACHE_MS) {
  return allTickerCache.data;
}
const data = await bithumbPublic("/ticker/ALL_KRW");  // ← await 사이 동시 진입
```
**설명:** 캐시 만료 직후 여러 비동기 호출이 `if` 통과 → `bithumbPublic` 중복 호출 → API 레이트 리밋.  
**영향:** 빗썸 API 레이트 리밋 초과 시 시세 조회 전면 실패.

---

### MED-10 — ACCT-1
**파일:** `server/bithumb-accounts-summary.js` 라인 103–106  
**문제 코드:**
```js
returnPercent = ((price - h.avgBuyPrice) / h.avgBuyPrice) * 100;
// ← 수수료 미반영 (다른 곳은 netReturnPct 사용)
```
**설명:** 빗썸 연결 테스트 화면 수익률이 수수료 미반영으로 다른 화면보다 높게 표시.  
**영향:** 수익률 표시 불일치, 실제보다 낙관적으로 표시.

---

### MED-11 — PICKS-1
**파일:** `server/picks-live-persist.js` 라인 108–126  
**문제 코드:**
```js
fs.writeFileSync(FILE, JSON.stringify({...}), "utf8");  // ← tmp+rename 없음
```
**설명:** `writeLastScanSnapshotSync`가 비원자 쓰기. 크래시 시 스캔 결과 파일 손상.  
**영향:** 서버 재기동 시 스크리너 결과 복원 실패.

---

### MED-12 — APP-1 (FE)
**파일:** `src/App.tsx` 라인 327–332  
**설명:** `picks?.running` 변경 시 인터벌 해제/재등록 → 진행 중 요청과 경쟁 조건 가능.  
**영향:** 스캔 상태 전환 순간 경쟁 조건.

---

### MED-13 — APP-2 (FE)
**파일:** `src/App.tsx` 라인 835–845  
**문제 코드:**
```ts
} catch {
  /* poll shows state */  // ← 오류 완전 무시
}
```
**설명:** `refreshPicks()` 실패 시 사용자에게 아무 피드백 없음.  
**영향:** 스캔 재시작 실패 시 사용자 피드백 없음.

---

### MED-14 — SIM-2
**파일:** `src/components/LiveSimRunningPanel.tsx` 라인 353–354  
**문제 코드:**
```tsx
<td>{h.quantity}</td>  // ← 포맷 없음
```
**설명:** `LiveTradePortfolioPanel`은 `formatLiveTradeQuantity()`를 사용하지만 `LiveSimRunningPanel`은 날것으로 표시.  
**영향:** 코인 수량 소수점 8자리 날것 표시, 표시 불일치.

---

### MED-15 — MONEY-1
**파일:** `src/lib/livePortfolioMoneyDisplay.tsx` 라인 89–122  
**설명:** `LivePortfolioSignedMoney`에 null/NaN 체크 없음. 런타임에 API에서 null이 오면 "NaN원" 표시.  
**영향:** PnL 컬럼 NaN 표시 가능성.

---

### MED-16 — BITHUMB-1
**파일:** `src/components/BithumbAccountSnapshotCard.tsx` 라인 39–47  
**설명:** `updatedAtMs = 0` 시 "1970년 1월 1일 09:00:00" 표시.  
**영향:** 초기화 미완료 상태에서 잘못된 시간 표시.

---

## LOW (시간 날 때 수정)

---

### LOW-01 — APP-4
**파일:** `server/create-app.js` 라인 1958  
**설명:** `setTimeout(() => scheduleRecommendationSignalBackfill(), 5000)` 핸들 미저장 → 서버 종료 시 타이머 정리 불가.

---

### LOW-02 — UA-1
**파일:** `server/user-auth.js` 라인 48  
**설명:** JSDoc `@param (password, saltHex)` vs 실제 `(userId, password)` 불일치.

---

### LOW-03 — PG-2
**파일:** `server/process-guards.js` 라인 15  
**설명:** `unhandledRejection` 핸들러 내부 `recordProcessRuntimeIssue` 실패 시 오류 조용히 소실.

---

### LOW-04 — LTQ-1
**파일:** `server/live-trade-quote.js` 라인 20  
**설명:** `quotedAtMs` 없을 때 `Date.now()` 폴백 → 오래된 캐시 데이터를 최신 시세로 오인.

---

### LOW-05 — AUTH-4
**파일:** `src/components/LiveTradeAuthAndCredentials.tsx` 라인 680  
**문제 코드:**
```ts
const w = Math.min(maxW, Math.max(minW, minW));  // ← Math.max(minW, minW) = minW
```
**설명:** 팝오버 너비가 항상 `minW`(172px)로 고정.

---

### LOW-06 — AUTH-5
**파일:** `src/components/LiveTradeAuthAndCredentials.tsx` 라인 526  
**설명:** `useEffect` 의존성에 `title`(불변 상수) 포함 → 불필요한 탭 재등록.

---

### LOW-07 — FEE-1
**파일:** `src/lib/liveTradeFeeByMarket.ts` 라인 38–42  
**설명:** 왕복 수수료를 `rt/2`로 균등 분배 표시. 빗썸은 매수/매도 수수료가 다를 수 있음.

---

### LOW-08 — LOG-1
**파일:** `server/live-trade-log.js` 라인 9–16  
**설명:** `tag = undefined` 전달 시 로그에 `[timestamp] undefined` 출력.

---

### LOW-09 — TEST-1
**파일:** `server/live-trade-threshold.test.js` (커버리지 누락)  
**설명:** `executeLiveBuyOrder`, `recordLiveTradeSellSync`, `persistBithumbExchangeTradesForUser`, `stopLossPriceFromPct` 핵심 경로 단위 테스트 없음.

---

## 수정 우선순위 요약

### 즉시 (실매매 안전 관련 CRITICAL)
1. **CRIT-01 (UCS-1)** — liveOrdersEnabled 하드코딩 수정
2. **CRIT-05 (EXCH-1)** — 거래소 동기화 이중 매도 race condition
3. **CRIT-06 (EXCH-2)** — 타임스탬프 NaN 폴백 → 과거 체결 재입력
4. **CRIT-07 (TOSS-1)** — Secret 없이 실주문 가능
5. **HIGH-09 (SELL-1)** — 손절가 수수료 방향 오류

### 빠르게 (서버 안정성 CRITICAL)
6. **CRIT-02 (AC-1)** — access-control 비원자 쓰기
7. **CRIT-03 (AC-2)** — access-control 잠금 없는 read-modify-write
8. **CRIT-04 (CRED-1)** — 약한 마스터키 허용

### 빠르게 (프론트엔드 기능 CRITICAL)
9. **CRIT-08 (POLL-1)** — 폴링 정리 불가 메모리 누수
10. **CRIT-11 (DOCK-1)** — 로그아웃 오류 미처리

### 계획적 수정 (HIGH 나머지)
- HIGH-01~14 순서대로

---

*이 보고서는 코드 분석 전용입니다. 수정 명령을 주시면 버그 ID 기준으로 진행합니다.*
