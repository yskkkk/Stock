120선 상·하단 접근 필터 0건 수정

## 원인
120선 근처 143종목인데 하단/상단 접근이 모두 0으로 나온 이유:

1. detectMaApproach가 「120선에 더 가까워지는 중」이 아니면 전부 flat 반환
2. resolveMa120Approach가 flat을 그대로 신뢰해 하단/상단 카운트·필터에서 제외
3. 로컬 스냅샷·이력에 ma120Approach가 flat 또는 없는 항목 다수

## 수정
- detectMaApproach: 접근 속도가 둔해도 현재가 vs 120선 위·아래로 from_below/from_above 분류
- ma120-near 스캔: ma120Side 저장, flat이면 side로 approach 보정
- resolveMa120Approach: flat 무시 → ma120Side → 차트 insight side → 현재가 vs ma120 순 폴백
- StockVaultTab: 카운트·필터·배지에 quotes 시세 전달

## 확인
- 120선 근처 선택 시 하단+상단 접근 합이 전체(143)에 근접하는지
- 하단/상단 각각 클릭 시 목록이 비지 않는지
- 다음 스캔 후 ma120Side가 스냅샷에 저장되는지

기존 스냅샷도 ma120+시세만 있으면 즉시 분류됩니다. 시세 로딩 전 잠깐 0일 수 있습니다.
