# YSTOCK 사용법

국내·미국·코인 스크리닝, 추천 실적 추적, 시뮬/실매매를 한 화면에서 쓰는 **YSTOCK** 웹·모바일 앱 가이드입니다.

상세 설정은 아래 문서를 함께 보세요.

| 문서 | 내용 |
|------|------|
| [MOBILE_APP.md](./MOBILE_APP.md) | Android APK · iOS IPA · PWA |
| [BITHUMB_API_SETUP.md](./BITHUMB_API_SETUP.md) | 빗썸 BYOK · 실주문 |
| [IOS_HTTPS_INSTALL.md](./IOS_HTTPS_INSTALL.md) | iPhone OTA · HTTPS |
| [OPENDART_SETUP.md](./OPENDART_SETUP.md) | OpenDART 공시 API |

---

## 1. 빠른 시작

### 1.1 설치

```powershell
cd c:\Stock
Copy-Item .env.example .env
npm install
```

`.env`에 최소 **`CREDENTIALS_MASTER_KEY`**(실매매·API 키 암호화용)를 넣습니다.  
선택: `OPENDART_API_KEY`, `TELEGRAM_*`, 접근 제어 등 — [.env.example](../.env.example) 주석 참고.

### 1.2 실행

```powershell
npm run dev
```

브라우저에서 **http://localhost:5173** (또는 PC LAN IP:5173) 로 접속합니다.  
개발 모드에서는 Vite가 **UI와 `/api/*`를 같은 포트**에서 제공합니다.

| 명령 | 용도 |
|------|------|
| `npm run dev` | 개발 서버 (포트 5173) |
| `npm run dev:guard` | dev 프로세스 감시·자동 재기동 |
| `npm run build` | 프로덕션 빌드 (`dist/`) |
| `npm run preview` | 빌드 결과 + API(3456) 동시 미리보기 |
| `node server/index.js` | API만 단독 (기본 포트 **3456**, `PORT`로 변경) |

서버가 꺼져 있으면 앱이 `/server-offline.html`로 안내됩니다.

---

## 2. 화면 구성

### 2.1 상단 탭 (일반 사용자)

탭 순서: **종목 검색 → 주식 추천목록 → 실거래 → 스크리너 → 코인**

| 탭 | 하는 일 |
|----|---------|
| **스크리너** | KOSPI/KOSDAQ·나스닥·코인 유니버스 자동 스캔. 고득점 종목 목록, 신호 필터, 차트·뉴스, «상승 근거», 전체 재분석, 일자별 추천 이력 |
| **종목 검색** | 임의 종목 검색·기술 분석·차트. 미국 주식 원화 표시 토글 |
| **주식 추천목록** | 과거 추천(텔레그램 등) 승률·모델·점수·신호별 통계, 일자·시장 필터 |
| **실거래** | 로그인, 거래소 API, 프로그램 등록, 시뮬/실매매, 보유·체결·수익 (§4) |
| **코인** | 빗썸 기준 코인 목록·차트·KRW/USD 시세 |

### 2.2 좌측 열 · 상단 · 하단

- **좌측**: 다크/라이트 테마, 주요지수, 환율 계산기, (로그인 시) 빗썸 계좌·가동 중 실매매 요약
- **상단**: 매크로 일정, 실매매 상태 띠, (관리자) 개발 대기열
- **하단**: 불편 접수, **갤럭시 APK / 아이폰 설치** 링크, (관리자) 운영·서버 재시작

### 2.3 운영 탭 (관리자)

상단 탭에는 없고 **관리자 푸터**에서만 들어갑니다. Cursor 에이전트 실행·개발 큐·실행 이력 (`CURSOR_API_KEY` 필요).

---

## 3. 스크리너 · 추천 · 알림

### 3.1 자동 스캔

- 서버가 약 **60초** 간격으로 유니버스(국내 약 300 · 미국 나스닥 약 500 · 코인)를 재분석합니다.
- **전체 재분석** 버튼으로 즉시 스캔을 돌릴 수 있습니다.
- Yahoo 등 시세 + 기술 모델(가중치·신호)로 점수를 매깁니다.

### 3.2 텔레그램 (선택)

`.env`에 `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` 설정 시 고득점 종목을 봇으로 보냅니다.  
관리자는 알림 **발송 이력** 조회·초기화가 가능합니다.

### 3.3 추천목록 탭

발송·기록된 추천의 **승률·수익률**을 모델·점수·신호 단위로 봅니다. 종목을 누르면 스크리너 워크스페이스로 이동합니다.

---

## 4. 실거래 · 시뮬레이션

실거래 탭 기능은 **로그인 후** 사용합니다. 프로그램·체결·API 키는 **계정(userId)별**로 분리됩니다.

### 4.1 계정

1. 실거래 탭 → 이메일·비밀번호 **로그인** 또는 **회원가입**
2. 첫 사용자는 가입이 자동 허용됩니다. 이후 가입은 `.env`의 `USER_REGISTRATION_ENABLED=1` 필요
3. 세션은 httpOnly 쿠키(`stock_session`)로 유지됩니다

로그인 전에 만들어 둔 프로그램은 첫 로그인·상태 조회 시 **현재 계정에 자동 귀속**됩니다.

### 4.2 거래소 API (BYOK)

서버 `.env`에 **`CREDENTIALS_MASTER_KEY`** 가 있어야 앱에서 키를 저장할 수 있습니다.

| 거래소 | 용도 | 앱에서 할 일 |
|--------|------|----------------|
| **빗썸** | 코인 실매매·시뮬 | API Key/Secret 저장 → 연결 테스트 → «실주문 허용» |
| **토스** | 국내 주식 실매매 | API Key/Secret 저장 → 연결 테스트 → «실주문 허용» |

- **실주문 허용 끔**: 체결 기록만 시뮬로 남김 (연습·검증용)
- **실주문 허용 켬**: 조건 충족 시 거래소에 실제 주문

자세한 빗썸 설정: [BITHUMB_API_SETUP.md](./BITHUMB_API_SETUP.md)

### 4.3 프로그램 등록

**새 프로그램**에서 다음을 정합니다.

- 이름, **기술 분석 모델** (추천 탭·스크리너와 동일 계열)
- 시장: 국내 / 미국 / 코인 (복수 선택 가능)
- 최소 점수 비율, 1회 매수 금액(KRW/USD), 최대 동시 보유 종목 수
- 시뮬 자동 매수, 목표가·손절 자동 매도, 매도 구간(단기·중기·장기)

등록 후 **프로그램 목록**에서:

| 버튼 | 의미 |
|------|------|
| **시뮬 자동 시작** | 스크리너/텔레그램 고득점 픽에 맞춰 **가상 매수** |
| **빗썸 / 토스 실매매 시작** | 해당 채널 **실주문** (키·실주문 허용 필요) |
| **시뮬 중지 / 실매매 중지** | 자동 매매만 멈춤 (프로그램 설정은 유지) |
| **수정** | 규칙 변경 |
| **삭제** | **해당 프로그램만** 제거 (다른 시뮬·실매매·체결은 유지) |

가동 중인 프로그램은 **실행 현황** 패널(시뮬 / 실매매 구역)에서 보유·체결·수익을 봅니다.

### 4.4 자동 매매가 도는 조건

1. 프로그램 상태가 **시뮬** 또는 **실매매(armed)** 일 것
2. 스크리너가 고득점 종목을 찾고, 선택한 **모델·최소 점수·시장**에 맞을 것
3. (실매매) 거래소 연결·실주문 허용·한도·중복 매수 방지 등 서버 검증 통과

### 4.5 포트폴리오

- **전체** 또는 **프로그램별** 필터로 보유·체결·요약 수익 확인
- 시뮬 패널에서 수동으로 종목 검색 후 가상 매수 가능
- 보유 종목에서 차트·매도(시뮬) 가능

---

## 5. 코인 탭

- 거래대금 상위 코인 리스트·1분봉 차트
- KRW / USD 시세 전환
- 스크리너·실거래에서 넘어온 심볼 포커스 지원

---

## 6. 모바일 앱

웹과 **동일한 `src/` UI**입니다. API 호출은 앱 내 `withApiBase()` 경유(직접 `/api` 호출 금지).

### 6.1 APK (Android)

1. `.env`에 **`CAPACITOR_SERVER_URL=https://(브라우저와 같은 서버 주소)`**
2. `npm run apk:build` → `public/downloads/stock-dashboard.apk`
3. 앱 또는 `/mobile-app.html`에서 설치

### 6.2 iPhone

- **PWA**: Safari → «홈 화면에 추가» (`/install-ios.html` 안내)
- **IPA OTA**: 공인 HTTPS **도메인** 필수 — [IOS_HTTPS_INSTALL.md](./IOS_HTTPS_INSTALL.md), `npm run ipa:build`

### 6.3 개발용 로컬 번들

`CAPACITOR_SERVER_URL` 없이 `npm run build:mobile` 후, 앱 첫 실행 시 **LAN 서버 URL** 입력(MobileServerGate).

---

## 7. 접근 제어 · 관리자

### 7.1 IP 허용제 (공개 서버용)

| 변수 | 의미 |
|------|------|
| `ACCESS_CONTROL_ENABLED=1` | 미등록 IP는 `/access-gate.html`에서 신청 |
| `ACCESS_CONTROL_DISABLED=1` | 제한 끔 (기본·개인 서버) |
| `ACCESS_ADMIN_TOKEN` | 관리자 API·UI 토큰 |
| `ACCESS_BOOTSTRAP_IPS` | 최초 허용 IP |

### 7.2 관리자가 할 수 있는 일

- IP 접속 **승인·거절·메모·위임**
- **불편 접수함** 답변·삭제
- 텔레그램 알림 **이력·초기화**
- **서버 재시작** (비밀번호 또는 관리자 토큰)
- **운영 탭**: Cursor 에이전트·개발 큐

관리자 진입: 등록 IP에서 상단 «관리자» 또는 `AccessAdminModal`.

---

## 8. 환경 변수 요약

`.env`는 Git에 올리지 않습니다. 키 **이름**만 정리합니다.

### 필수·실매매

- `CREDENTIALS_MASTER_KEY` — 사용자 API 키 암호화 (실거래 탭 저장 필수)
- `USER_REGISTRATION_ENABLED` — 회원가입 허용(1)
- `LIVE_TRADE_LEGACY_MIGRATE` — 예전 프로그램 계정 귀속(1)

### 데이터·알림

- `OPENDART_API_KEY` — 국내 공시
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` — 추천 알림
- `TELEGRAM_OPS_BOT_TOKEN`, `TELEGRAM_OPS_CHAT_ID` — 운영·개발 알림

### 거래소 (서버 레거시·스크립트용)

- `BITHUMB_*`, `TOSS_*`, `*_LIVE_ORDERS_ENABLED`

### 서버·모바일

- `PORT`, `HTTPS_PORT`, `STOCK_TLS_CERT_PATH`, `STOCK_TLS_KEY_PATH`
- `CAPACITOR_SERVER_URL`, `APP_PUBLIC_BASE_URL`

### Ops·자동화

- `CURSOR_API_KEY`, `AUTO_GIT_SYNC`, `AUTO_GIT_SYNC_INTERVAL_MS` 등

전체 목록·주석: [.env.example](../.env.example)

---

## 9. 데이터 저장 위치

| 경로 | 내용 |
|------|------|
| `server/.data/` | 프로그램, 체결, 사용자, 세션, 추천 이력 등 (Git 제외) |
| `server/.logs/` | 접근·서버 로그 |
| 브라우저 `localStorage` | 테마, 차트 그리기, (모바일) API 베이스 URL 등 |

백업·이전 시 `server/.data/` 와 `.env`를 함께 챙기세요.

---

## 10. 자주 쓰는 npm 스크립트

| 스크립트 | 설명 |
|----------|------|
| `npm test` | 단위 테스트 (Vitest) |
| `npm run verify:api-smoke` | API 스모크 테스트 |
| `npm run icons:gen` | PWA·앱 아이콘 재생성 |
| `npm run i18n:gen` | `src/i18n/ko.ts` 재생성 |
| `npm run cap:android` / `cap:ios` | Android Studio / Xcode 열기 |

### 운영자 CLI (`scripts/`)

- `bithumb-test-order.mjs` — `.env` 빗썸 키로 주문 스모크
- `send-one-stock-pick-telegram.mjs` — 추천 1건 텔레그램 발송
- `telegram-list-chat-ids.mjs` — 봇 chat_id 확인

---

## 11. 문제 해결

| 증상 | 확인 |
|------|------|
| 실거래 탭 API 키 저장 안 됨 | `.env`에 `CREDENTIALS_MASTER_KEY` → **서버 재시작** |
| 로그인해도 프로그램 안 보임 | 같은 계정인지, 실거래 탭에서 로그인 후 새로고침 |
| 삭제했는데 다른 프로그램도 사라짐 | 최신 버전 반영 후 **해당 프로그램만** 삭제되는지 확인 (포트폴리오 필터 «전체») |
| 모바일에서 API 실패 | `CAPACITOR_SERVER_URL` 또는 MobileServerGate URL이 PC와 **같은 origin**인지 |
| iPhone IPA 설치 실패 | IP가 아닌 **HTTPS 도메인** — [IOS_HTTPS_INSTALL.md](./IOS_HTTPS_INSTALL.md) |
| 401 / access-gate | `ACCESS_CONTROL_ENABLED` 및 IP 승인 상태 |

---

## 12. 아키텍처 (참고)

```
브라우저 / Capacitor WebView
        │
        ▼
  React (src/)  ── fetchJson / withApiBase
        │
        ▼
  Express API (server/create-app.js)
        │
        ├── screener, picks, quotes
        ├── live-trading (programs, portfolio, BYOK)
        ├── auth, access-control
        └── ops (Cursor agent, dev queue)
        │
        ▼
  server/.data/*.json
```

개발: Vite 플러그인이 API를 **5173**에 붙입니다.  
프로덕션: `dist/` 정적 파일 + Express SPA fallback.

---

*문서 버전: 저장소 `docs/USAGE.md` — 기능 추가 시 `.env.example`·각 주제별 `docs/*.md`와 함께 갱신하세요.*
