/**
 * 사용자 UI에 노출되는 기능 카탈로그.
 * 사용자가 「비활성화 해달라」고 한 항목은 defaultEnabled: false.
 * 백엔드만 돌고 UI에 안 보이는 것은 여기에 넣지 않음.
 *
 * 새 항목 추가 시 .cursor/rules/ui-feature-toggles.mdc 도 갱신.
 */
export const UI_FEATURE_CATALOG = [
  {
    id: "profitModelButton",
    label: "수익률 모델",
    description:
      "스크리너·코인 탭의 「수익률 모델」 버튼, 상단 스트립, 모달",
    defaultEnabled: false,
  },
  {
    id: "holdingRationaleRow",
    label: "보유 근거 설명 행",
    description:
      "실전매매 보유 표 하단 진입 구조·가격 근거 설명 행",
    defaultEnabled: false,
  },
  {
    id: "opsDevQueueUi",
    label: "개발 대기열 스트립",
    description:
      "관리자 전용 상단 「개발 대기열」 스트립·폴링 UI",
    defaultEnabled: false,
  },
  {
    id: "themeModeToggle",
    label: "라이트/다크 테마 전환",
    description:
      "좌측 상단 테마 토글(버튼은 보이되 전환만 끌 수 있음)",
    defaultEnabled: true,
  },
  {
    id: "chartDrawRay",
    label: "차트 광선 그리기",
    description: "내장 차트 드로잉 툴바의 광선(ray) 도구",
    defaultEnabled: true,
  },
  {
    id: "footerSp500SectorLink",
    label: "S&P500 섹터 (하단 링크)",
    description: "사이트 하단 내비게이션의 「S&P500 섹터」 링크",
    defaultEnabled: false,
  },
  {
    id: "screenerTab",
    label: "스크리너 탭",
    description: "상단 「스크리너」 탭 · 픽 폴링 · 재스캔 · 신호 필터",
    defaultEnabled: false,
  },
  {
    id: "recommendationsTab",
    label: "주식 추천목록 탭",
    description: "상단 「주식 추천목록」 탭 · 추천 실적 프리페치",
    defaultEnabled: false,
  },
];

/** @type {Record<string, (typeof UI_FEATURE_CATALOG)[number]>} */
export const UI_FEATURE_CATALOG_BY_ID = Object.fromEntries(
  UI_FEATURE_CATALOG.map((f) => [f.id, f]),
);

export function isUiFeatureId(id) {
  return id != null && Object.prototype.hasOwnProperty.call(UI_FEATURE_CATALOG_BY_ID, id);
}
