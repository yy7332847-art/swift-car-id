# دليل بناء تطبيق PlateCheck على Android بدون شاشة بيضاء

هذا الدليل يستخدم **npm / npx فقط**. سبب الشاشة البيضاء الأساسي كان أن بناء الويب العادي لا يخرج `index.html` ثابتًا يصلح لـ Capacitor؛ لذلك نستخدم `dist-capacitor/` المخصص لتطبيق Android.

## المتطلبات

- Node.js 20 أو أعلى
- npm
- Java JDK 21
- Android Studio حديث
- Android SDK API 36

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
npm run android:sync
npm run android:doctor
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
npm run android:fix
npm run android:doctor
```

هذا يفحص JDK/SDK/Gradle، توافق حزم Capacitor Native Bridge، إعدادات Kotlin/R8، ويتأكد أن `capacitor.config.ts` يستخدم `webDir: "dist-capacitor"` ولا يحتوي على `server.url`، ويتأكد أن `index.html` يستخدم مسارات نسبية `./assets/...` وليس `/assets/...` حتى لا تظهر الشاشة البيضاء داخل Android WebView.

## بعد أي تعديل

```bash
npm run android:sync
```

لو Android Studio أظهر أخطاء Kotlin Metadata / D8 / R8 مثل:

```text
Unexpected error during rewriting of Kotlin metadata
Should never be called
GeolocationPlugin
```

شغّل:

```bash
npm run android:fix
npx cap sync android
```

الأمر يثبت إعدادات Android المتوافقة: Gradle 8.14.3، AGP 8.13.0، Kotlin 2.2.20، SDK 36، ويعطّل R8 full mode لتجنب انهيار D8 مع Metadata الخاصة بإضافات الموقع.

أو للبناء والمزامنة وفتح Android Studio مباشرة:

```bash
npm run android:open
```

## ضبط Gradle عند الحاجة

لو ظهر خطأ Gradle Sync، راجع:

`android/variables.gradle`:

```gradle
ext {
    minSdkVersion = 24
    compileSdkVersion = 36
    targetSdkVersion = 36
    androidxActivityVersion = '1.11.0'
    androidxAppCompatVersion = '1.7.1'
    androidxCoreVersion = '1.17.0'
    androidxWebkitVersion = '1.14.0'
    kotlin_version = '2.2.20'
    kotlinxCoroutinesVersion = '1.10.2'
    playServicesLocationVersion = '21.3.0'
}
```

`android/build.gradle`:

```gradle
classpath 'com.android.tools.build:gradle:8.13.0'
```

`android/gradle/wrapper/gradle-wrapper.properties`:

```properties
distributionUrl=https\://services.gradle.org/distributions/gradle-8.14.3-all.zip
```

`android/gradle.properties` يجب أن يحتوي:

```properties
android.useAndroidX=true
android.enableJetifier=true
android.enableR8.fullMode=false
android.javaCompile.suppressSourceTargetDeprecationWarning=true
kotlin.jvm.target.validation.mode=warning
org.gradle.jvmargs=-Xmx4096m -Dfile.encoding=UTF-8
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
npm run offline:audit
npm run android:preflight
npm run android:fix
npx cap sync android
npx cap open android
```

أثناء تشغيل APK:

```bash
adb logcat | grep -iE "capacitor|platecheck|chromium|crash|error"
```

ما تم منعه جذريًا:
- لا نستخدم `dist/` مباشرة؛ Android يستخدم `dist-capacitor/` وفيه `index.html`.
- لا نستخدم مسارات `/assets/...` المطلقة؛ Android يستخدم `./assets/...` النسبية.
- لا يوجد `server.url` في الإنتاج.
- Leaflet CSS محلي وليس CDN.
- كل الأوامر `npm` و `npx`.
- أخطاء Kotlin Metadata / D8 الخاصة بإضافات الموقع تعالج عبر `npm run android:fix`.