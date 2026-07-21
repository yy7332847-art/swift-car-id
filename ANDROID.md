# دليل بناء تطبيق PlateCheck على Android بدون شاشة بيضاء

هذا الدليل يستخدم **npm / npx فقط**. سبب الشاشة البيضاء الأساسي كان أن بناء الويب العادي لا يخرج `index.html` ثابتًا يصلح لـ Capacitor؛ لذلك نستخدم `dist-capacitor/` المخصص لتطبيق Android.

## المتطلبات

- Node.js 20 أو أعلى
- npm
- Java JDK 17
- Android Studio حديث
- Android SDK API 34 أو 35

تحقق:

```bash
node -v
npm -v
java -version
echo $ANDROID_HOME
```

## أول تشغيل من الصفر

```bash
npm install
npm run build:android
npx cap add android
npx cap sync android
npx cap open android
```

تأكد أن مخرج Android موجود:

```bash
test -f dist-capacitor/index.html && echo "OK: Android web build جاهز"
```

إذا لم يظهر `OK` لا تفتح Android Studio قبل إصلاح البناء.

## فحص قبل Android Studio

```bash
npm run android:preflight
npm run offline:audit
```

هذا يفحص JDK/SDK/Gradle، ويتأكد أن `capacitor.config.ts` يستخدم `webDir: "dist-capacitor"` ولا يحتوي على `server.url` الذي يسبب شاشة بيضاء.

## بعد أي تعديل

```bash
npm run android:sync
```

أو للبناء والمزامنة وفتح Android Studio مباشرة:

```bash
npm run android:open
```

## ضبط Gradle عند الحاجة

لو ظهر خطأ Gradle Sync، راجع:

`android/variables.gradle`:

```gradle
ext {
    minSdkVersion = 23
    compileSdkVersion = 35
    targetSdkVersion = 35
    androidxActivityVersion = '1.9.2'
    androidxAppCompatVersion = '1.7.0'
    androidxCoreVersion = '1.13.1'
    androidxWebkitVersion = '1.12.1'
}
```

`android/build.gradle`:

```gradle
classpath 'com.android.tools.build:gradle:8.7.2'
```

`android/gradle/wrapper/gradle-wrapper.properties`:

```properties
distributionUrl=https\://services.gradle.org/distributions/gradle-8.11.1-all.zip
```

بعد أي تعديل:

```bash
npx cap sync android
```

## الأذونات المطلوبة

تأكد من وجودها في `android/app/src/main/AndroidManifest.xml`:

```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_BACKGROUND_LOCATION" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_LOCATION" />
<uses-permission android:name="android.permission.RECORD_AUDIO" />
<uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />
<uses-permission android:name="android.permission.WAKE_LOCK" />
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
```

## بناء APK

من Android Studio:

1. انتظر Gradle Sync.
2. Build → Clean Project.
3. Build → Rebuild Project.
4. Build → Build Bundle(s) / APK(s) → Build APK(s).

المسار غالبًا:

```bash
android/app/build/outputs/apk/debug/app-debug.apk
```

تثبيت مباشر:

```bash
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

لو ظهر `INSTALL_FAILED_UPDATE_INCOMPATIBLE`:

```bash
adb uninstall app.platecheck.mobile
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

## تشغيل بدون إنترنت

أول مرة يحتاج التطبيق إنترنت لتسجيل الدخول وتحميل بيانات اللوحات، وبعدها يستخدم التخزين المحلي وطابور المزامنة ويرفع البيانات عند رجوع الشبكة.

```bash
npm run build:android
npm run offline:audit
```

## تشخيص الشاشة البيضاء

```bash
npm run build:android
test -f dist-capacitor/index.html || echo "ERROR: missing Android index.html"
npm run android:preflight
npx cap sync android
npx cap open android
```

أثناء تشغيل APK:

```bash
adb logcat | grep -iE "capacitor|platecheck|chromium|crash|error"
```

ما تم منعه جذريًا:
- لا نستخدم `dist/` مباشرة؛ Android يستخدم `dist-capacitor/` وفيه `index.html`.
- لا يوجد `server.url` في الإنتاج.
- Leaflet CSS محلي وليس CDN.
- كل الأوامر `npm` و `npx`.