# Stock 모바일 앱 (Android · iPhone)

**브라우저에서 쓰는 Stock 웹**을 그대로 네이티브 앱(APK · IPA · PWA)으로 씁니다.  
앱 안 UI는 서버에 올라간 웹과 동일하고, 별도 “앱 전용 화면”을 따로 두지 않습니다.

## 고정 URL로 APK 만들기 (갤럭시 등)

1. `.env`에 **브라우저에서 접속하는 주소**를 넣습니다.

```env
CAPACITOR_SERVER_URL=https://your-stock-server.example.com
```

(`.env.mobile.example` 참고)

2. APK 빌드:

```bash
npm run apk:build
```

3. 결과: `public/downloads/stock-dashboard.apk` — 웹 「갤럭시」 링크로 배포

앱 실행 시 **위 URL을 WebView로 바로 엽니다.** 서버 주소 입력 화면은 없습니다.

## iPhone — Swift 네이티브 앱 (IPA)

소스: `ios-native/StockDashboard/` (SwiftUI + WKWebView)

1. `.env`에 고정 URL + Apple Team ID:

```env
CAPACITOR_SERVER_URL=https://your-stock-server.example.com
IOS_DEVELOPMENT_TEAM=XXXXXXXXXX
```

2. **Mac**에서 IPA 빌드:

```bash
npm run ipa:build
```

3. 결과:
   - `public/downloads/stock-dashboard.ipa`
   - `public/downloads/ios-manifest.plist` (OTA 설치용)

4. iPhone: Safari → **`/install-ios.html`** → 「앱 설치」 또는 PWA 「홈 화면에 추가」

| 방식 | 요구 |
|------|------|
| **IPA (Swift)** | Mac, Xcode, Apple Developer, HTTPS, 기기 등록(Development/Ad Hoc) |
| **PWA** | Safari, 같은 고정 HTTPS URL |

Xcode만 열기: `npm run ios:open` (macOS)

## iPhone (PWA만, Mac 없이)

- Safari → **`/install-ios.html`** → 홈 화면에 추가
- App Store·IPA 빌드 없이 설치 가능

## 개발·로컬 테스트

- PC `npm run dev`만 쓸 때: `.env`에 LAN URL을 넣거나 `npm run build:mobile`(로컬 번들) 사용
- APK/IPA 배포용은 반드시 **공개/고정 `CAPACITOR_SERVER_URL`**

## 요구 사항

- JDK 17+, Android SDK (`npm run apk:build`가 `.android-sdk` 설치 시도 가능)
- iOS IPA: **macOS + Xcode 15+**, Apple Developer **Team ID**
- iOS 네이티브(대안): `npm run cap:ios` — Capacitor `ios/App`

## 명령

| 명령 | 설명 |
|------|------|
| `npm run apk:build` | 고정 URL 필수, Android WebView APK |
| `npm run ipa:build` | 고정 URL + Team ID, Swift WebView IPA (Mac) |
| `npm run ios:open` | Xcode에서 Swift 프로젝트 열기 (Mac) |
| `npm run build:mobile` | 로컬 dist + cap sync (개발) |
| `npm run cap:android` | Android Studio |
| `npm run cap:ios` | Capacitor iOS (Xcode) |
