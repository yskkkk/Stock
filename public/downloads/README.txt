Android APK 배포 위치
=====================

빌드 후 APK를 이 폴더에 다음 이름으로 복사하세요:

  stock-dashboard.apk

웹 다운로드: /mobile-app.html → "APK 다운로드" 링크

한 줄 빌드·배포 (PC에 JDK 21 권장):

  npm run apk:build

  → public/downloads/stock-dashboard.apk 생성
  → 웹 «앱 받기» / /downloads/stock-dashboard.apk 로 바로 다운로드

Android Studio 수동: npm run build:mobile → npm run cap:android
  → Build → APK → 위 파일명으로 복사
