# Stock iOS (Swift · WKWebView)

Android APK와 같이 **고정 Stock 서버 URL**을 WebView로 여는 네이티브 앱입니다.

## 빌드 (macOS + Xcode)

1. `.env`에 `CAPACITOR_SERVER_URL`(또는 `APP_PUBLIC_BASE_URL`) 설정
2. Apple Developer **Team ID**를 `.env`에 `IOS_DEVELOPMENT_TEAM=XXXXXXXXXX`
3. 저장소 루트에서:

```bash
npm run ipa:build
```

4. 결과: `public/downloads/stock-dashboard.ipa`, `public/downloads/ios-manifest.plist`

## iPhone에 설치

- 서버 HTTPS에서 `/install-ios.html` → **네이티브 앱(IPA)** 안내
- Ad Hoc/Development 서명 IPA는 **등록된 기기**에서만 설치 가능 (App Store 없이)
- 서명·프로비저닝은 Xcode 또는 Apple Developer에서 관리

## Xcode에서 직접

```bash
open ios-native/StockDashboard/StockDashboard.xcodeproj
```

Signing & Capabilities에서 Team 선택 후 Run.

## Capacitor iOS (대안)

플러그인(뒤로가기 등)이 필요하면 `npm run cap:ios` — `ios/App` 프로젝트.
