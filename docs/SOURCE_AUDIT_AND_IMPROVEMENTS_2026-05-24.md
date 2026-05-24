# 소스코드 감사·개선 후보 목록 (2026-05-24)

코드 수정 없이 전체 탐색 기준으로 정리. **매매(실거래·시뮬·자동매도) 로직을 우선**으로 표기.  
심각도: `치명` | `높음` | `중간` | `낮음` | `개선`(기능·UX 제안)

---

## A. 매매·실거래 로직 (우선 검토)

| # | 심각도 | 제목 | 관련 파일(라인) | 설명 | 개선 방향 |
|---|--------|------|-----------------|------|-----------|
| A1 | 치명 | 거래소 매수 후 포트폴리오 한도 검사 | `server/live-trade-runner.js` 132–151, `server/live-trade-portfolio-store.js` 321–331 | `liveBuyForProgram`이 빗썸/토스 주문을 먼저 실행하고, `maxOpenPositions`는 `recordLiveTradeBuySync`에서만 검사. 기록 단계에서 throw 시 **거래소에는 이미 체결**된 상태 가능 | 주문 전 오픈 포지션·한도 선검사; 체결 후 기록 실패 시 `orderId` 기반 자동 reconcile |
| A2 | 치명 | 수동 매도 API는 장부만 갱신 | `server/create-app.js` 826–844, `server/live-trade-portfolio-store.js` 458+ | `POST /api/live-trading/trades/sell`은 `recordLiveTradeSellSync`만 호출. `simulated: false`여도 빗썸/토스 매도 없음 | sim/live 엔드포인트 분리; live는 거래소 체결 → 체결가·수량으로만 기록 |
| A3 | 치명 | 자동매도 폴링 중복 실행(이중 매도) | `server/live-trade-auto-sell.js` 377–409, 391–405 | `setInterval(run, POLL_MS)`에 in-flight 락 없음. 느린 tick이 겹치면 동일 포지션 **연속 매도** 가능 | tick 단일 실행 보장; 매도 전 “pending” 마킹 |
| A4 | 높음 | 중복 매수 dedupe 레이스 | `server/live-trade-runner.js` 59–71, 125 | 메모리 `Map` read-check-set. 동시 호출 시 둘 다 통과 가능 | 키별 single-flight / 원자적 dedupe |
| A5 | 높음 | dedupe가 실패 주문도 6시간 차단 | `server/live-trade-runner.js` 59–71 | 주문 **전**에 타임스탬프 기록. 실패해도 `DEDUPE_MS` 동안 재시도 불가 | 성공 시에만 dedupe, 또는 attempt/filled 키 분리 |
| A6 | 높음 | 라이브 매수가 텔레그램 성공에 의존 | `server/screener.js` 196–201, 220–238; `server/telegram-notify.js` 1119–1133 | `screenSymbol`은 `{ type: "picks" }`만 반환 → `applyScreenResult`의 `type: "pick"` 분기(238, `onHighScorePickForLiveTrading`) **사실상 미사용**. 라이브 매수는 텔레그램 전송 성공 후에만 `onHighScorePickForLiveTrading` 호출 | 스크리너 고득점 픽 루프에서 텔레그램과 무관하게 라이브 훅 호출 |
| A7 | 높음 | 무장(armed) KR 자동매도는 시뮬만 | `server/live-trade-auto-sell.js` 245–349, 315+ | `isArmed && crypto`만 `executeBithumbLiveSellOrder`. 그 외는 `recordLiveTradeSellSync(..., simulated: true)` | 토스 매도 어댑터 또는 KR armed 시 자동매도 비활성·UI 명시 |
| A8 | 높음 | 빗썸 체결 수량 vs 장부 수량 불일치 | `server/bithumb-trading-adapter.js` 318–322, `server/live-trade-portfolio-store.js` 318–319 | 매수 기록 시 `quantityFromOrderAmount` 사용, `executed_volume` 미반영 | 폴링 결과의 실제 체결량·체결금액으로 기록 |
| A9 | 높음 | 체결 폴링 1회·2초만 | `server/bithumb-trading-adapter.js` 424–439 | `pollBithumbOrderFill` 단일 2초 대기. 지연/부분 체결 시 null → 시세 추정가로 기록 | 백오프 재시도, 부분 체결 처리, live는 fill 미확인 시 fail-closed |
| A10 | 높음 | 포트폴리오 JSON 동시 쓰기 | `server/live-trade-portfolio-store.js` 119–135, 321–376, 474–514 | rename은 원자적이나 read-modify-write 사이에 락 없음. runner·auto-sell·reconcile·API가 경합 | 파일 락, 단일 writer 큐, 또는 DB 트랜잭션 |
| A11 | 중간 | UI 매도는 항상 시뮬 | `src/components/LiveTradePortfolioPanel.tsx` 228–237, `src/api.ts` `simulateLiveTradeSell` | 보유 UI가 `simulateLiveTradeSell`만 호출. armed/crypto도 장부만 | armed·crypto → 서버 live 매도(거래소 후 기록) |
| A12 | 중간 | API 매도가 클라이언트 가격 신뢰 | `server/create-app.js` 838–839 | `price: Number(req.body?.price)` 그대로 PnL 반영 | sim은 서버 시세; live는 체결가만 |
| A13 | 중간 | reconcile 유령 포지션·누락 청산 | `server/live-trade-bithumb-reconcile.js` 59–67, 117–127, 172 | `EXCHANGE_ZERO_RATIO`, ±60s fill 검색 한계; `sellPrice == null`이면 기록 스킵 while 거래소는 0 | fill 검색 확장, 수동 청산 경로, 자산별 dust 규칙 |
| A14 | 중간 | 거래소 잔고를 잘못된 프로그램에 귀속 | `server/live-trade-bithumb-holdings.js` 32–62, 114–115 | `pickArmedProgramForSymbol` 휴리스틱. 무장 프로그램 복수 시 오배정 | orderId/시간 매칭, 모호 시 미배정 |
| A15 | 중간 | 자동매도가 장부 수량만 사용 | `server/live-trade-auto-sell.js` 261–264; `scripts/bithumb-sell-holdings.mjs` 93–96 | `pos.quantity`만 매도. locked/가용 잔고 미반영 → 반복 실패 | 매도 전 계좌 조회, `min(장부, 가용)` |
| A16 | 중간 | 토스 arm 검증 vs 실행 자격 불일치 | `server/live-trade-arm-gate.js` 66–75; `server/toss-trading-adapter.js` 14–28 | 사용자 BYOK로 arm 통과 가능하나 `executeLiveBuyOrder`는 서버 `TOSS_*` env만 사용 | BYOK를 매수 경로에 연결 또는 서버 키 없으면 arm 거부 |
| A17 | 중간 | 최소 주문금액 불일치 | `scripts/bithumb-test-order.mjs` 29–34; `src/constants/liveTradeOrder.ts` 4; `server/live-trade-market.js` 9 | 스크립트 5천 vs 서버/UI 1만 원 | 공통 상수 SSOT |
| A18 | 중간 | 시세 없으면 손절·익절 미평가 | `server/live-trade-sell-strategy.js` 478–480; `server/live-trade-auto-sell.js` 227–231 | `currentPrice == null`이면 `null` 반환 → auto-sell `continue` | 최대 age 있는 last price 또는 crypto 티커 fallback |
| A19 | 중간 | 동일 심볼 다회 매수 시 목표가는 마지막 buy만 | `server/live-trade-portfolio-store.js` 556–583 | aggregated position이 `lastBuy`의 target/stop/boughtAt 사용 | FIFO lot, 가중 목표, lot별 매도 |
| A20 | 중간 | 자동매도 기록 시 userId 미전달 | `server/live-trade-auto-sell.js` 277–298 | 내부 `recordLiveTradeSellSync`에 userId 없음. `matchesUser` 빈 userId는 allow-all | `program.userId` 항상 전달, API와 동일 권한 모델 |
| A21 | 낮음 | 수수료 캐시 갱신 없이 매도 판단 | `server/exchange-trading-fees.js` 107–121; `server/live-trade-auto-sell.js` 77–83 | auto-sell tick에서 `ensureUserTradingFeesFreshAsync` 미호출 | 폴링 주기마다 또는 armed 매도 전 갱신 |
| A22 | 낮음 | dedupe 파일 쓰기 실패 무시 | `server/live-trade-runner.js` 43–49 | `saveDedupState` empty catch | 로깅·내구 저장소 |
| A23 | 낮음 | 체결 후 장부 실패 시 프로그램 error | `server/live-trade-programs-store.js` 459–468; `server/live-trade-runner.js` 152–166 | 거래소 포지션은 있는데 `error` 상태 | “ledger sync” vs “order error” 분리, 자동 reconcile |
| A24 | 낮음 | bithumb-sell-holdings 스크립트 중복 구현 | `scripts/bithumb-sell-holdings.mjs` 28–68 | 어댑터와 JWT/계좌 로직 이중화 → drift | 어댑터 재사용 |

---

## B. 인증·자격증명·서버 API

| # | 심각도 | 제목 | 관련 파일 | 설명 | 개선 방향 |
|---|--------|------|-----------|------|-----------|
| B1 | 높음 | 세션 쿠키 Max-Age vs 서버 TTL 불일치 | `server/user-auth.js` ~125; `server/user-sessions-store.js` 41–44 | 쿠키 30일 고정, `USER_SESSION_TTL_DAYS`와 불일치 가능 | `sessionTtlMs()`와 쿠키 동기화 |
| B2 | 높음 | Cookie 파싱 URIError | `server/user-auth.js` 77–87 | `decodeURIComponent` 예외 미처리 | try/catch, malformed cookie 무시 |
| B3 | 높음 | `liveOrdersEnabled` 문자열 `"false"` → true | `server/user-credentials-routes.js` 90–91 | `Boolean("false") === true` | 명시적 boolean 파싱 |
| B4 | 높음 | Naver KR 스냅샷이 항상 `.KS` | `server/kr-naver-quote.js` 30–35, 84–87 | `.KQ` 요청도 `yahooSymbol`을 `.KS`로 저장 | 입력 suffix 보존 |
| B5 | 중간 | 로그인 시 기존 세션 미폐기 | `server/user-auth.js`; `user-sessions-store.js` 98–102 | `deleteSessionsForUserSync` 미사용 | 로그인/비밀번호 변경 시 전 세션 revoke |
| B6 | 중간 | 세션 store read마다 쓰기 | `server/user-sessions-store.js` 79–87 | `getSessionSync`가 prune 후 매번 파일 쓰기 | 읽기 전용 get / 주기적 prune |
| B7 | 중간 | credentials DELETE/TEST exchange 화이트리스트 누락 | `server/user-credentials-routes.js` 103–128 | GET/PUT과 불일치 | 동일 whitelist |
| B8 | 중간 | Toss 키를 Bithumb 규칙으로 검증 | `server/user-credentials-store.js` 243–251 | 모든 exchange에 `validateBithumbCredentialPair` | exchange별 검증·테스트 |
| B9 | 중간 | Toss 인라인 테스트 가짜 성공 | `server/user-credentials-store.js` 391–399 | apiKey만 있으면 OK | 실제 검증 또는 “미구현” 명시 |
| B10 | 중간 | crypto 검색 쿼리 길이 제한 없음 | `server/crypto-live-search.js` 11–27 | 긴 `q`로 watchlist 전체 필터 → CPU | `stock-search.js`처럼 max length |
| B11 | 중간 | Naver 실패 시 negative cache | `server/kr-naver-quote.js` 167–170 | `quote: null`을 full TTL 캐시 | 짧은 실패 TTL 또는 retry |
| B12 | 중간 | 재시작 비밀번호 타이밍 공격 | `server/server-restart-auth.js` 13–18 | `===` 비교 | `timingSafeEqual` |
| B13 | 낮음 | 재시작 비밀번호 = ACCESS_ADMIN_TOKEN fallback | `server/server-restart-auth.js` 4–8 | 비밀 분리 약화 | 전용 env만 허용 |
| B14 | 낮음 | credentials/users JSON 동시 쓰기 | `server/user-credentials-store.js`, `users-store.js` | read-modify-write 락 없음 | 파일 락 또는 DB |

---

## C. 프론트엔드·실시간 UI·모바일

| # | 심각도 | 제목 | 관련 파일 | 설명 | 개선 방향 |
|---|--------|------|-----------|------|-----------|
| C1 | 높음 | 실현손익 통화 혼합을 KRW로 표시 | `server/live-trade-portfolio-store.js` 237–272; `LiveTradePortfolioPanel.tsx` 198–201 | USD+KRW 실현손익 합산 후 KRW 포맷 | 통화별 분리 또는 환산 |
| C2 | 높음 | 포트폴리오 reload 시 구 시세 병합 | `LiveTradePortfolioPanel.tsx` 444–451; `LiveSimRunningPanel.tsx` 613–620 | `extractQuotesFromPortfolio(prev)`가 신규 스냅샷 위에 덮음 | full fetch 시 시세 교체 |
| C3 | 높음 | Live Trading 탭 vs 전역 status 이중화 | `LiveTradingTab.tsx` 141–201; `useLiveTradingStatusPoll.ts` | 탭 자체 poll, 헤더/레일은 싱글톤 hook | 탭도 shared hook 사용 |
| C4 | 높음 | crypto 보유 15s quote poll 갱신 안 됨 | `livePortfolioLiveQuotes.ts`; `picks-live-quotes.js` | crypto는 Yahoo 경로 부적합, overlay 가격만 | crypto 전용 quote API 또는 portfolio 주기 단축 |
| C5 | 중간 | 포트폴리오·quote 이중 폴링 | `LiveSimRunningPanel.tsx`, `LiveTradePortfolioPanel.tsx` | 동시 20s/30s portfolio + 15s quotes | 탭 단일 context |
| C6 | 중간 | 시뮬 카드 총수익 vs 포트폴리오 순수익 정의 불일치 | `LiveSimRunningPanel.tsx` 79–88, 131–184 | gross vs net | 동일 지표·수수료 주석 |
| C7 | 중간 | 좌측 레일 프로그램 시세 지연 | `LiveTradingLeftRailPanel.tsx` 348–374 | 22s portfolio만, minute poll 없음 | shared polled snapshot |
| C8 | 중간 | `cryptoDisplayQuote` 미사용 | `src/lib/cryptoDisplayQuote.ts` | dead code, changePercent 미변환 | 연동 또는 삭제 |
| C9 | 중간 | `useSymbolLiveQuotes` stale 키 누적 | `useSymbolLiveQuotes.ts` 33 | merge만 하고 prune 없음 | symbolsKey 변경 시 replace |
| C10 | 중간 | 시뮬 검색 vs 포트폴리오 quote API 상이 | `LiveTradeSimPanel.tsx` vs portfolio | picks 60s vs live-trading 15s | 동일 엔드포인트 |
| C11 | 중간 | status poll 마운트마다 즉시 refresh | `useLiveTradingStatusPoll.ts` 45–48, 64–66 | 구독자마다 burst 요청 | App 단일 마운트 + context |
| C12 | 중간 | Capacitor에서도 SW 등록 | `main.tsx`, `registerPwa.ts` | 네이티브 WebView stale shell | `!isNativeApp()` 가드 |
| C13 | 중간 | PWA 캐시·업데이트 UX 부재 | `registerPwa.ts`, `public/sw.js` | `stock-pwa-v1`, silent fail | 빌드 bump, update 배너 |
| C14 | 중간 | 모바일 back handler마다 pushState | `mobileBackStack.ts`, `App.tsx` | synthetic history 깊어짐 | 단일 sentinel + 우선순위 스택 |
| C15 | 낮음 | 백그라운드 탭에서도 poll 지속 | 여러 `use*Poll` hooks | 배터리·트래픽 | `visibilitychange` pause |
| C16 | 낮음 | `mergeLiveQuotesIntoPortfolio` 항상 `updatedAtMs` 갱신 | `livePortfolioLiveQuotes.ts` 159 | 가격 동일해도 timestamp 변경 | 실제 변경 시만 |
| C17 | 낮음 | status poll 실패 시 stale armed 표시 | `useLiveTradingStatusPoll.ts` 31–42 | degraded UI 없음 | 오류·재시도 상태 표시 |

---

## D. 기능·UX 개선 제안 (신규·보강)

| # | 유형 | 제목 | 근거 | 제안 |
|---|------|------|------|------|
| D1 | 개선 | 라이브 매도 원클릭(armed crypto) | A11, A2 | 포트폴리오 행에서 “실매도” 확인 모달 → 서버 live sell |
| D2 | 개선 | 매수/매도·reconcile 감사 로그 UI | A1, A10, A13 | 프로그램별 `orderId`, exchange vs ledger diff 타임라인 |
| D3 | 개선 | 자동매도 tick 상태 패널 | A3, A18 | 마지막 tick 시각, in-flight, 실패 심볼 목록 |
| D4 | 개선 | 텔레그램 없이 라이브 arm 동작 표시 | A6 | 설정 화면에 “알림 전송 성공 시에만 자동매수” 경고 |
| D5 | 개선 | KR armed 자동매도 비활성 배너 | A7 | 무장 KR 프로그램에 “자동매도는 장부 시뮬만” 고지 |
| D6 | 개선 | 빗썸 reconcile 원클릭 + diff 미리보기 | A13, A14 | dry-run 결과를 UI 테이블로 |
| D7 | 개선 | 좌측 레일 빗썸 보유 코인 요약 | C10, `BithumbAccountSnapshotCard` rail variant | “보유 N종” 펼침 |
| D8 | 개선 | 실현/평가 손익 통화 탭 | C1 | KRW / USD / crypto 각각 |
| D9 | 개선 | 로그인 시 “다른 기기 세션 끊기” | B5 | 선택 옵션 |
| D10 | 개선 | BYOK 테스트 exchange별 실제 ping | B8, B9 | Bithumb balance, Toss (준비 시) |
| D11 | 개선 | 포트폴리오 polling 단일화 설정 | C5 | `STOCK_UI_PORTFOLIO_POLL_MS` 등 |
| D12 | 개선 | PWA “새 버전 사용” 배너 | C13 | controllerchange 후 reload |
| D13 | 개선 | 시뮬 피드백이 `maxOpenPositions` 자동 조정 | `live-trade-sim-feedback.js` 234–238 | UI에서 제안 accept/reject |
| D14 | 개선 | 최소 주문·locked 잔고 사전 검증 | A15, A17 | 매도/매수 버튼 비활성 + 사유 |
| D15 | 개선 | 다중 무장 프로그램 심볼 충돌 경고 | A14 | 동일 crypto 심볼 armed 2개 이상 시 경고 |
| D16 | 개선 | admin 서버 재시작 2FA 또는 IP allowlist | B12 | 운영 강화 |
| D17 | 개선 | crypto search rate limit | B10 | IP당 분당 N회 |
| D18 | 개선 | Naver `.KQ` 라벨 수정 후 차트/검색 일관성 | B4 | 전체 quote 파이프라인 회귀 테스트 |
| D19 | 개선 | 통합 E2E: screener pick → sim buy → auto-sell | A6, A3 | 텔레그램 mock 포함 integration test |
| D20 | 개선 | `bithumb-test-order`를 prod 상수와 동기화 | A17 | CI에서 shared constant import |

---

## E. 교차 테마 요약

1. **거래소 ↔ 장부 순서**: 매수는 거래소 먼저(A1), 매도 API·UI는 장부만(A2, A11).  
2. **동시성**: dedupe(A4), auto-sell(A3), portfolio JSON(A10).  
3. **sim / live 경계**: API `simulated` body, KR auto-sell(A7), UI simulate only(A11).  
4. **데이터 정합**: fill poll(A9), 수량(A8), reconcile(A13), 프로그램 배정(A14).  
5. **관측 가능성**: 텔레그램 게이트(A6), status poll(C17), PWA(C13).

---

## F. 권장 수정 우선순위 (구현 시 참고)

1. A3 자동매도 single-flight  
2. A2 + A11 live 매도 경로 일원화  
3. A1 + A8 + A9 체결·기록·한도 순서  
4. A6 라이브 매수 트리거 decouple  
5. A10 포트폴리오 동시성  
6. C2, C3 프론트 상태 SSOT  
7. B3, B4, B1 인증·시세 기초 버그  

---

*생성: 2026-05-24 · 코드 변경 없음 · 항목 수: 매매 24 + 서버 14 + 프론트 17 + 기능 제안 20 = **75** (중복 테마는 섹션 E에서 통합 설명)*
