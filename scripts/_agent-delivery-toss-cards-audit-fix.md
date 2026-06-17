# 새 구현 기능 버그 점검·수정 보고 (2026-06-12)

## 점검 범위
최근 커밋 기준 주요 신규/변경 기능:
- 토스 내주식 카드형 거래내역·보유 UI (7a59aa5)
- 거래내역 연·월 필터 (143bb30)
- 말풍선 클릭 위치 기준 배치 (a882528)
- 토스 계좌 KRW+USD 종합 손익·지수 벨트 (9451aca)
- 토스 보유 수수료 반영 손익 (7301efb)
- 국내 수급 컬럼·보유 말풍선 (83ca4d2)
- 가치투자·버핏 말풍선 연동

---

## 발견된 문제 (의도 대비 미구현·버그)

### 1. [치명] 수수료·세금 토글 — UI만 있고 동작 없음
- **증상**: «수수료·세금» 버튼이 보이지만 클릭해도 아무 변화 없음
- **의도(토스 앱)**: 토글 ON 시 수수료·세금 예상 행 표시, OFF 시 숨김
- **조치**: 카드별 `useState` 토글 + pill/check 스타일, `feeTaxRows` 분리 렌더

### 2. [버그] 보유 카드 손익·수익률 불일치
- **증상**: 총 수익 금액은 `mv - cost`(총액 기준)인데 %는 매도 수수료 반영 순수익률
- **조치**: `holdingNetUnrealizedPnl` 도입, 금액·% 모두 매도 수수료 반영

### 3. [누락] 보유 종목 차트 열기
- **증상**: 테이블→카드 전환 시 `onOpenHoldingChart` 연결 끊김
- **조치**: 카드 제목 클릭 → 차트 열기 복원

### 4. [TS 오류] LiveAccountTradesMainPanel
- 삭제된 `LiveAccountHoldingsTable` 타입 참조
- `onOpenHoldingChart` 미사용
- `scenario === "sim"` 불가능 분기
- **조치**: 모두 수정

### 5. [TS 오류] LiveTradeHistoryTossCards
- `??` 와 `||` 혼용 구문 오류
- **조치**: 괄호 추가

### 6. [TS 오류] RecommendationsTab 키보드 이벤트
- `onKeyDown`에서 `e.clientX` 접근 (KeyboardEvent에 없음)
- **조치**: `pointerFromElementCenter` 사용

### 7. [경미] 라이트 테마
- 카드 배경 `#1b1e23` 고정 → 라이트 모드에서 어색
- **조치**: CSS 변수 + `data-theme="light"` 오버라이드

### 8. [경미] tossHoldingsAsLiveTrade 타입
- `grossChangePct`, `openedAtMs`, `lastAtMs` 누락
- **조치**: 필드 추가

### 9. [미적용 범위 — 의도 확인]
- **도크(우측) 거래내역**: `workspaceMode` 없어 기존 테이블 유지 (본문 거래내역 탭만 카드형)
- **시뮬·프로그램 거래**: 프로그램 워크스페이스는 카드형 적용됨 (`workspaceMode`)

### 10. [알려진 한계·미수정]
- 세금 예상치: 토스 앱 5,080원 vs 우리 5,070원 (0.2% 고정률 반올림 차)
- 도크 토스 잔고(`TossAccountSnapshotCard`)는 리스트형 — «내 주식» 상세 카드와 별 UI
- `useTossAccountSnapshot` / `tossSnapshotLiveQuotes` 등 기존 TS 경고 일부는 별도 정리 필요

---

## 이번 턴 수정 파일
- src/components/TossMyStockSummaryCard.tsx
- src/components/LiveAccountHoldingsTossCards.tsx
- src/components/LiveTradeHistoryTossCards.tsx
- src/components/LiveAccountTradesMainPanel.tsx
- src/components/RecommendationsTab.tsx
- src/lib/livePortfolioPnl.ts
- src/lib/tossTradeCardEstimates.ts
- src/lib/tossHoldingsAsLiveTrade.ts
- src/lib/tossTradeCardEstimates.test.ts
- src/ui-toss.css

## 검증
- vitest: tossTradeCardEstimates, bubblePointerAnchor 통과

## 확인 방법
1. 거래내역 탭 → 토스/빗썸 → 보유 카드 제목 클릭 시 차트
2. «수수료·세금» 토글 ON/OFF → 수수료·세금 행 표시/숨김
3. 보유 총 수익 금액·%가 같은 기준(매도 수수료 반영)인지 확인
4. 라이트 테마에서 카드 가독성
