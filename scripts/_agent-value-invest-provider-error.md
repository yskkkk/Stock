# useValueInvestBubble Provider 오류 — 원인 분석

## 증상
- 화면: `로딩 중 오류`
- 메시지: `useValueInvestBubble must be used within ValueInvestBubbleProvider`
- UI 출처: `src/main.tsx`의 `renderFatal()` (부트 직후 `window.__STOCK_BOOT < 2` 구간에서 잡힌 동기 렌더 오류)

## 직접 원인
`useValueInvestBubble()` 훅이 React Context 값이 `null`인 컴포넌트 트리 안에서 호출됨.

```ts
// src/contexts/ValueInvestBubbleContext.tsx
const ctx = useContext(ValueInvestBubbleContext);
if (!ctx) {
  throw new Error("useValueInvestBubble must be used within ValueInvestBubbleProvider");
}
```

Context는 `ValueInvestBubbleProvider`가 감싸줄 때만 채워짐.

## 현재 코드 기준 Provider 위치 (정상 구조)
`src/main.tsx`:

```
AppErrorBoundary
  └ LiveTradeCardSidePanelProvider
       └ ValueInvestBubbleProvider   ← 여기서 context 제공
            └ MobileServerGate
                 └ App
```

즉 **소스 기준으로는** `App` 이하 모든 탭·모달이 Provider 안에 있어야 정상 부트됨.

## 훅을 쓰는 컴포넌트 (부트 직후 터질 수 있는 곳)
| 파일 | 호출 시점 |
|------|-----------|
| `StockSearchHotRow.tsx` | 인기종목 행 렌더 시 |
| `StockSearchTab.tsx` (`StockSearchPickRow`) | 검색 결과 행 렌더 시 |
| `PickList.tsx` (`PickListRow`) | 스크리너 종목 행 렌더 시 |
| `RecommendationsTab.tsx` (`RecTrackerRow`) | 추천 탭 테이블 행 |
| `InvestorFlowTab.tsx` | 소식 탭 행 |
| `StockVaultTab.tsx` | 보관함 행 |
| `PicksHistoryModal.tsx` | 모달 열림 + 이력 행 |

**기본 탭**은 `useMainTabWithPreview("stockLookup")` → `StockSearchTab` → 인기종목 로드 후 `StockSearchHotRow`가 먼저 훅을 호출할 가능성이 큼.

## 왜 Provider가 있는데도 터지나? (실제 원인 후보)

### 1) Dev HMR / 세션 불일치 (가장 유력 — 오늘 로그와 일치)
터미널에 다음이 반복됨:
```
hmr invalidate ... ValueInvestBubbleContext.tsx
Could not Fast Refresh ("useOptionalValueInvestBubble" export is incompatible)
page reload src/contexts/ValueInvestBubbleContext.tsx
```

시나리오:
1. 앱이 **Provider 추가 전** `main.tsx` 트리로 이미 마운트된 상태
2. 이후 `PickList` / `StockSearchHotRow` 등만 HMR로 갱신되어 `useValueInvestBubble()` 호출 추가
3. **실행 중인 React 트리에는 `ValueInvestBubbleProvider`가 없음** → 첫 렌더에서 throw
4. `main.tsx` 전체 리로드가 끝나기 전이거나, HMR만으로는 루트 Provider가 안 붙은 채 자식만 갱신되면 동일 증상

→ **강력 새로고침(Ctrl+Shift+R) 또는 dev 서버 재시작** 후 재현 여부 확인.

### 2) PWA / Service Worker 캐시 청크 불일치 (배포·모바일)
Vite 청크 분리 시:
- 새 번들: 컴포넌트에 훅 추가
- 옛 캐시: `main` 청크에 Provider 없음

→ 화면의 **「캐시 삭제 후 재시도」** 버튼이 정확히 이 케이스용 (`stockClearCacheAndReload`).

### 3) 테스트/단독 마운트 (개발자용)
`App.mount.test.tsx`는 `<App />`만 렌더하고 Provider 없음.  
다만 picks/hot이 비어 있으면 훅까지 안 가서 테스트는 통과할 수 있음 (현재 1테스트 통과).

## Provider 바깥에서 쓰는 코드는 없음
- `useValueInvestBubble` 사용처는 모두 `App` 하위 컴포넌트
- `LiveTradeCardSidePanelProvider` 본문·포털 호스트는 훅 미사용
- Portal(`createPortal`)은 React context를 유지하므로 Provider 안에서 띄우면 문제 없음

## 결론
**구조적 버그(Provider 누락)** 라기보다,
- **개발 중 HMR로 자식만 갱신된 옛 React 트리**, 또는
- **캐시된 옛 `main` 번들**

과 **오늘 추가된 value-invest 훅**이 맞물린 **런타임 트리/번들 불일치**가 원인.

## 권장 조치 (우선순위)
1. 브라우저 **강력 새로고침** 또는 「캐시 삭제 후 재시도」
2. dev 서버 **재시작** (`npm run dev`)
3. 계속되면 시크릿 창에서 동일 URL 접속 (캐시 배제)
4. 재발 방지(코드): HMR 시 `ValueInvestBubbleContext` 변경은 full reload 유도 중 — `useOptionalValueInvestBubble` export가 Fast Refresh 비호환이라는 점은 dev 시 전체 리로드가 자주 필요함을 의미

## 참고 커밋
`4b923a6` — 10년 기대수익 말풍선 기능과 동시에 `main.tsx`에 Provider 추가됨.  
해당 커밋 이후 **완전한 새로고침** 없이 dev 세션만 이어가면 위 HMR 시나리오 가능.
