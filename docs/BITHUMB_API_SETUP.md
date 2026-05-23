# 빗썸 API — YSTOCK 코인 실매매

YSTOCK **실거래** 탭에서 **코인** 시장을 켠 프로그램은, 스크리너·텔레그램 고득점 알림 시 **빗썸 KRW 시장가 매수** 파이프라인으로 연결됩니다. (국내 주식은 토스 API)

## 1. 빗썸에서 API 발급

1. [빗썸](https://www.bithumb.com) 로그인
2. **마이페이지 → API 관리** (또는 [API 관리](https://www.bithumb.com/react/api-support/management-api))
3. **API Key / Secret Key** 발급
4. 권한: **조회**, **주문** (출금 권한은 필요 없으면 끄기)
5. IP 제한이 있으면 **YSTOCK 서버 IP**만 허용

공식 문서: https://apidocs.bithumb.com

## 2. 서버 `.env` 설정

### 입력 파일 경로 (실제로 읽는 파일)

| 용도 | 경로 |
|------|------|
| **여기에 API 값 입력** | `c:\Stock\.env` |
| 복사용 템플릿 (Git에 포함) | `c:\Stock\.env.example` |

`.env` 가 없으면 PowerShell에서:

```powershell
cd c:\Stock
Copy-Item .env.example .env
notepad .env
```

이미 `.env` 가 있으면, 아래 **빗썸 블록만** 붙여 넣거나 값을 채우면 됩니다.

```env
BITHUMB_API_KEY=발급받은_API_KEY
BITHUMB_SECRET_KEY=발급받은_SECRET_KEY
BITHUMB_LIVE_ORDERS_ENABLED=0
```

실주문을 켜려면 `BITHUMB_LIVE_ORDERS_ENABLED=1` 로 바꾼 뒤 서버 재시작.

서버 **재시작** 후 **실거래** 탭에서 «빗썸 API 연동» 카드가 **준비됨**인지 확인합니다.

## 3. 앱에서 사용

1. **실거래** → 프로그램 등록
2. 시장에서 **코인** 체크, **1회 매수 금액(원)** 입력 (빗썸 최소 주문 약 5,000원 이상 권장)
3. **실매매 시작** — 코인만 선택한 경우 빗썸 연동만 필요
4. `BITHUMB_LIVE_ORDERS_ENABLED=0` 이면 체결은 **시뮬**로만 기록됩니다

## 4. 동작 요약

| 항목 | 내용 |
|------|------|
| 시세·차트 | 빗썸 **공개 API** (기존과 동일) |
| 실매매 매수 | 빗썸 **Private API** `POST /v1/orders` 시장가(원화 금액) |
| 심볼 | 앱 `BTC-USDT` → 빗썸 `KRW-BTC` |
| 자동 매도(실매매) | 아직 시뮬 자동매도만 — 실매매 매도는 추후 확장 |

## 5. 주의

- API 키는 **절대 Git에 커밋하지 마세요.**
- 실주문 전 `BITHUMB_LIVE_ORDERS_ENABLED=0` 으로 한 번 동작을 확인하세요.
- 빗썸 이용약관·API 정책을 준수해야 합니다.
