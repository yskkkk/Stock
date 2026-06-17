# 폴링 버튼 미동작 + 종목 데이터 오류 분석

## 1. 폴링 버튼이 안 눌리던 이유

### A. 버튼이 아예 안 보임 (스크린샷 케이스)

카드 하단에 **중지/다시 기동 버튼 대신 env 문자열만** 보이던 경우:

| 상태 | 원인 | UI 동작(수정 전) |
|------|------|------------------|
| **부팅 off** | `STOCK_BOX_RANGE_DETECT≠1` 등 env 미충족 | `bootEnabled=false` → 버튼 숨김, env만 표시 |
| **중지됨** + env만 표시 | 서버 기동 시 폴러 루프가 안 올라감 (`bootStarted=false`) | `canToggle`에 `bootStarted` 필수 → 버튼 숨김 |

예: **박스권 FSM 러너** — `STOCK_BOX_RANGE_RUNNER=0`이면 `startBoxRangeRunnerPoller()`가 즉시 return, `markPollerBootStarted` 미호출 → 상태는 “중지됨”인데 버튼 없음.

**S&P500 박스권 스캔** — `STOCK_BOX_RANGE_DETECT=1` 아니면 `isBootEnabled()` false → “부팅 off”, 런타임 토글 불가.

### B. 버튼이 보여도 클릭이 안 됨

폴링 팝오버 `z-index: 120`이 도크 레일(`140`)·차트 오버레이보다 낮아, **보이는 영역 위에 다른 레이어가 클릭을 가로챔**.

### 수정 내용 (이번 커밋)

1. 폴링 팝오버 `z-index: 10050` + `pointer-events: auto`
2. `bootStarted` 없어도 `bootEnabled`이면 **다시 기동** 표시
3. **부팅 off**일 때 비활성 “다시 기동” + “env 설정 후 서버 재기동” 안내
4. 서버: `다시 기동` 시 `tryLazyStartPoller()` — 등록된 `start*Poller()` 재호출로 루프 기동

---

## 2. “종목 데이터를 가져올 수 없습니다” 원인 분석

### 오류 발생 위치

`server/stock-data.js` → `loadStock()`:

```
fetchRemote() 실패 AND 디스크/메모리 stale 캐시 없음
→ throw new Error(`종목 데이터를 가져올 수 없습니다: ${sym}`)
```

US/KR 주식(암호화폐 제외)은 **Yahoo Finance API** (`yahoo.js` + `yahoo-queue.js`) 경유.

### 서버 로그 패턴 (2026-06-12 15:02~15:03 KST)

```
[ma-align:scan] CMI 1d 종목 데이터를 가져올 수 없습니다: CMI
[golden-cross:scan] CMI 1d 종목 데이터를 가져올 수 없습니다: CMI
… (US 500종목 스캔 중 동일 심볼이 두 폴러에서 연속 실패)
```

특징:

- **ma-align:scan** 과 **golden-cross:scan** 이 동시에 US 500종목 일봉 요청
- 약 **6종목씩 8~9초 간격**으로 묶여 실패 → Yahoo **rate limit / 큐 포화** 전형적 패턴
- 같은 시각 KR intraday(`ma-align:intraday`)는 **126종목 정상 완료** → KR은 Naver 시세 경로, US만 Yahoo 병목

### Yahoo 단건 테스트 (동일 서버)

```
getYahooSession() OK, AAPL 1d → 295.63 정상
```

→ API 키/세션 자체는 살아 있음. **대량 동시 스캔** 시 일시 실패.

### Yahoo 큐 설정 (기본값)

| env | 기본 | 의미 |
|-----|------|------|
| `YAHOO_MAX_CONCURRENT` | 4 | 동시 요청 상한 |
| `YAHOO_REQUEST_GAP_MS` | 250 | 요청 최소 간격 |

스캐너 2개 × 500종목 = 초당 수십 요청 시도 → 큐 대기·429·파싱 실패 누적 → 캐시 없는 심볼은 위 오류.

### 박스권과의 관계

- `STOCK_BOX_RANGE_DETECT≠1` 이면 박스권 카탈로그 스캔 폴러 **부팅 off** (의도된 동작)
- FSM 러너도 env off면 tick 없음 → 차트/박스권 데이터 갱신 안 됨
- 종목 데이터 오류 자체는 **골든크로스·MA정렬 US 스캔** 쪽이 주원인

### 권장 조치

1. **즉시**: 스캔 부하 완화 — `YAHOO_REQUEST_GAP_MS=500`~`800`, `YAHOO_MAX_CONCURRENT=2`
2. **구조**: US full scan을 ma-align / golden-cross가 **동시에 돌지 않게** 스태거(이미 vaultScanRunning 플래그 일부 있으나 cross-poller 중복은 남음)
3. **캐시**: 한번 성공한 종목은 5분 fresh / 7일 stale 캐시 사용 — 재스캔 전 warm-up 또는 실패 심볼 백오프
4. **박스권 사용 시**: `.env`에 `STOCK_BOX_RANGE_DETECT=1`, 필요 시 `STOCK_BOX_RANGE_RUNNER` unset, **서버 재기동** 후 폴링 패널에서 상태 확인

---

## 확인 방법

1. 앱 새로고침 → 폴링 패널 → 카드 **다시 기동** 클릭(관리자 비밀번호)
2. 부팅 off 카드는 비활성 버튼 + 재기동 안내 확인
3. 터미널에서 US 스캔 중 오류 빈도 감소 여부 확인
