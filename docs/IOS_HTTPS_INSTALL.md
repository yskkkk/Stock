# iPhone IPA 설치 — HTTPS·인증서 (IP 주소 불가)

Apple OTA(`itms-services://`)는 **유효한 공인 HTTPS 인증서**가 붙은 **도메인**에서만 동작합니다.  
`https://182.219.226.49` 처럼 **IP만** 쓰거나 **자가서명·만료 인증서**면  
「인증서가 유효하지 않기 때문에 응용 프로그램을 설치할 수 없습니다」가 납니다.

## 1. 도메인 연결

1. 보유 도메인(예: `stock.example.com`) DNS **A 레코드** → 서버 공인 IP `182.219.226.49`
2. 방화벽·공유기에서 **443(HTTPS)** 포트 개방

## 2. 서버 `.env`

```env
APP_PUBLIC_BASE_URL=https://stock.example.com
CAPACITOR_SERVER_URL=https://stock.example.com

# Node가 직접 443을 받을 때 (nginx/Caddy 앞단이면 생략 가능)
STOCK_TLS_CERT_PATH=C:/path/to/fullchain.pem
STOCK_TLS_KEY_PATH=C:/path/to/privkey.pem
HTTPS_PORT=443
```

## 3. 인증서 발급

### Windows (win-acme)

[win-acme](https://www.win-acme.com/)로 IIS 또는 standalone 검증 후 PEM 경로를 위 env에 지정.

### Linux

```bash
sudo certbot certonly --standalone -d stock.example.com
# fullchain.pem / privkey.pem → STOCK_TLS_*_PATH
```

### Caddy / nginx 리버스 프록시

프록시가 443에서 TLS를 끝내면 Node는 `PORT=3456` HTTP만 두고,  
프록시가 `https://stock.example.com` → `http://127.0.0.1:3456` 으로 전달하면 됩니다.  
`X-Forwarded-Proto: https` 필요.

## 4. IPA·manifest

Mac에서:

```bash
npm run ipa:build
```

`public/downloads/stock-dashboard.ipa` 배포. manifest는 서버가  
`APP_PUBLIC_BASE_URL` 기준으로 **동적 생성**합니다.

## 5. iPhone에서 설치

Safari에서 **`https://stock.example.com/install-ios.html`** 만 사용  
(IP 주소 URL로는 IPA 설치 버튼이 나와도 Apple이 거부합니다).

PWA만 필요하면 같은 HTTPS 주소에서 「홈 화면에 추가」.

## 점검

```bash
node scripts/check-ios-ota-ready.mjs
```
