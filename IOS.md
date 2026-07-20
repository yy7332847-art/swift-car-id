# PlateCheck — iOS build & background location

## Prereqs
- macOS with Xcode installed
- CocoaPods (`sudo gem install cocoapods`)
- Node modules installed (`npm install`)

## First-time setup
```bash
npm run build
npx cap add ios
npx cap sync ios
npx cap open ios
```

## Info.plist keys (added automatically on first open — verify)
Open `ios/App/App/Info.plist` in Xcode and ensure the following keys exist:

```xml
<key>NSLocationWhenInUseUsageDescription</key>
<string>يستخدم التطبيق موقعك لتسجيل مسار الجلسة على الخريطة.</string>
<key>NSLocationAlwaysAndWhenInUseUsageDescription</key>
<string>يحتاج التطبيق للموقع في الخلفية لمواصلة تتبع مسار الجلسة أثناء إغلاق الشاشة.</string>
<key>NSLocationAlwaysUsageDescription</key>
<string>يحتاج التطبيق للموقع في الخلفية لمواصلة تتبع مسار الجلسة أثناء إغلاق الشاشة.</string>
<key>NSMicrophoneUsageDescription</key>
<string>يستخدم التطبيق الميكروفون لتحويل صوتك إلى نص لوحات فوري.</string>
<key>UIBackgroundModes</key>
<array>
  <string>location</string>
  <string>fetch</string>
  <string>processing</string>
</array>
```

## Runtime permission flow (already implemented)
1. On record screen the app calls `runGeoPreflight()` which triggers
   `requestPermissions({ permissions: ["location"] })`.
2. iOS shows the "When In Use" prompt first; the code additionally calls the
   background plugin which prompts for **Always** access.
3. If the user picks "When In Use only", background tracking will pause when
   the app is backgrounded — the record screen shows an explanation sheet
   and a deep-link to Settings via `Capacitor.openSettings()`.

## Build IPA
Product → Archive in Xcode, then Distribute App → Ad Hoc / TestFlight.
