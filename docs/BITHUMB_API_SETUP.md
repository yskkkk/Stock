# 빗썸 API — YSTOCK 코인 실매매 (BYOK)

YSTOCK **실거래** 탭은 **로그인 계정마다** 빗썸 API Key·Secret을 저장하고, 그 키로만 KRW 시장가 매수가 나갑니다. 서버 `.env`의 `BITHUMB_*` 단일 키로 다른 사용자 주문은 하지 않습니다.

## 1. 서버 준비

`c:\Stock\.env` (복사: `Copy-Item .env.example .env`)

```env
CREDENTIALS_MASTER_KEY=64자리_hex_또는_긴_비밀문자열
BITHUMB_LIVE_ORDERS_ENABLED=0
```

- `CREDENTIALS_MASTER_KEY`: 사용자 API 키 암호화용. **Git에 올리지 마세요.**
- `BITHUMB_LIVE_ORDERS_ENABLED=0`: 서버 env 키로 실주문 금지(권장).
- 기존 `live-trade-programs.json`을 첫 로그인 계정에 붙이려면: `LIVE_TRADE_LEGACY_MIGRATE=1` 후 로그인 1회.

서버 재시작: `npm run dev`

## 2. 빗썸에서 API 발급

1. [빗썸](https://www.bithumb.com) 로그인
2. **마이페이지 → API 관리**
3. **조회·주문** 권한 (출금은 끄기)
4. IP 제한 시 **YSTOCK 서버 IP**만 허용

문서: https://apidocs.bithumb.com

## 3. 앱에서 연동

1. **실거래** 탭 → **로그인** (또는 회원가입 — `USER_REGISTRATION_ENABLED=1` 또는 최초 1계정)
2. **빗썸 API 연동** 카드 → API Key·Secret 저장
3. **연결 테스트**로 잔고 조회 확인
4. **실주문 허용** 체크 시에만 거래소에 실제 주문 (끄면 시뮬만 기록)
5. 프로그램 등록 → 코인 시장 → **빗썸 실매매 시작**

## 4. 동작 요약

| 항목 | 내용 |
|------|------|
| 인증 | httpOnly 세션 쿠키 (`stock_session`) |
| 키 저장 | `server/.data/user-exchange-credentials.json` (AES-GCM) |
| 프로그램·포트폴리오 | `userId`별 격리 |
| 매수 | 사용자 빗썸 credential + `liveOrdersEnabled` |
| 토스 BYOK 주문 | 다음 단계 (키 저장·연결 테스트만 가능) |

## 5. 주의

- API 키는 Git·스크린샷에 노출하지 마세요.
- 실주문 전 **실주문 허용**을 끄고 시뮬·arm 동작을 확인하세요.
- 빗썸 이용약관·API 정책을 준수해야 합니다.
