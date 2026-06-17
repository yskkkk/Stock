관리자 «UI 기능» 탭 추가

요청
- 관리자 패널에 버튼(탭) 추가
- 사용자에게 안 보이게 끈 UI 기능 목록 관리
- 목록에서 켜기/끄기 토글
- 앞으로 비활성화 요청은 이 목록에 등록

구현
1. shared/ui-feature-catalog.js — UI 기능 SSOT (백엔드-only 항목 제외)
2. server/ui-feature-toggles.js — GET /api/ui-features, admin GET/POST set, server/.data/ui-feature-toggles.json 저장
3. src/contexts/UiFeatureToggleContext.tsx — useUiFeature(id) 런타임 반영
4. AccessAdminModal — «UI 기능» 탭, 켜기/끄기 버튼
5. .cursor/rules/ui-feature-toggles.mdc — 에이전트 메모(항상 적용)

현재 등록된 기능 (기본값)
- 수익률 모델 — 꺼짐
- 보유 근거 설명 행 — 꺼짐
- 개발 대기열 스트립 — 꺼짐
- 라이트/다크 테마 전환 — 켜짐
- 차트 광선 그리기 — 켜짐

사용법
- 관리자 → «UI 기능» 탭 → 항목별 켜기/끄기
- 토글 즉시 전체 클라이언트에 반영(폴링·focus·이벤트)

커밋: main push 완료
