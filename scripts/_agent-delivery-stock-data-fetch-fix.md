# 「종목 데이터를 가져올 수 없습니다」 분석·수정

## 원인
1. **Yahoo Finance rate limit** — US 종목보관 intraday(255종)가 `loadStock(..., { live: true })`로 **60초마다** 전 종목 재요청
2. Yahoo 공유 큐(동시 4·간격 250ms) 포화 → 429 → 캐시 없는 심볼은 `종목 데이터를 가져올 수 없습니다: SYM` 로그
3. 골든크로스·MA정렬 **일일 full scan**과 intraday가 같은 Yahoo 큐 경합

## 수정
| 항목 | 변경 |
|------|------|
| intraday 재검증 | `VAULT_RESCAN_LOAD_OPTS` = 캐시 5분 + 2y 일봉 (live:false, scan:true) |
| US intraday 배치 | 기본 4종 병렬, 배치 간 280ms |
| intraday 주기 | 재스캔 60s→**180s**, tick 60s→**90s** (env로 조정 가능) |
| Yahoo 큐 기본값 | 동시 3, 간격 400ms, rate limit 백오프 12s |
| loadStock | RATE_LIMIT 시 최대 3회 재시도, 오류 메시지에 원인(rate 등) 포함 |

## 확인
터미널에서 `[ma-align:intraday] SYM 종목 데이터…` 빈도 감소. 재스캔은 최대 3분 간격.
