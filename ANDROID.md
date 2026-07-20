# دليل بناء تطبيق PlateCheck على Android (شامل من الصفر)

هذا الدليل يمشي معك خطوة بخطوة من لحظة تنزيل المشروع حتى تثبيت ملف APK يعمل على جهازك بدون إنترنت وبدون شاشة بيضاء.

---

## 0) المتطلبات (مرة واحدة على جهازك)

| الأداة | الإصدار المطلوب | ملاحظات |
|---|---|---|
| Node.js | 20 أو أعلى | `node -v` |
| Bun | الأحدث | `curl -fsSL https://bun.sh/install \| bash` |
| Java JDK | **17** بالضبط | Capacitor 8 يحتاج JDK 17 (ليس 11 ولا 21) |
| Android Studio | Hedgehog 2023.1.1 أو أحدث | من [developer.android.com/studio](https://developer.android.com/studio) |
| Android SDK | API 34 أو 35 | من داخل Android Studio → SDK Manager |
| Android SDK Build-Tools | 34.0.0 | نفس المكان |

تأكد بعد التثبيت:
```bash
java -version         # يجب أن يظهر 17
echo $ANDROID_HOME    # يجب أن يشير لمجلد Android SDK
node -v && bun -v
```

على macOS/Linux أضف لملف `~/.zshrc` أو `~/.bashrc`:
```bash
export JAVA_HOME=$(/usr/libexec/java_home -v 17)   # macOS فقط
export ANDROID_HOME=$HOME/Library/Android/sdk       # macOS
# export ANDROID_HOME=$HOME/Android/Sdk              # Linux
export PATH=$PATH:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator
```

---

## 1) تجهيز المشروع (بعد أول تنزيل)

نفّذ الأوامر بالترتيب من مجلد المشروع:

```bash
# 1. تثبيت الحزم
bun install

# 2. بناء الويب (ينتج مجلد dist/)
bun run build

# 3. إضافة منصة Android لأول مرة فقط
bunx cap add android

# 4. نسخ ملفات الويب داخل مشروع Android
bunx cap sync android
```

> إذا ظهر خطأ `webDir "dist" does not exist` → تأكد أن `bun run build` انتهى بنجاح وأن `dist/index.html` موجود.

---

## 2) ضبط توافق الإصدارات (خطوة حاسمة لتفادي فشل البناء)

Android Studio عندك غالبًا أحدث من الإصدار الافتراضي الذي أنشأ Capacitor به المشروع. عدّل الملفات التالية **قبل** فتح Android Studio:

### أ. `android/variables.gradle`
```gradle
ext {
    minSdkVersion = 23
    compileSdkVersion = 35
    targetSdkVersion = 35
    androidxActivityVersion = '1.9.2'
    androidxAppCompatVersion = '1.7.0'
    androidxCoordinatorLayoutVersion = '1.2.0'
    androidxCoreVersion = '1.13.1'
    androidxFragmentVersion = '1.8.4'
    coreSplashScreenVersion = '1.0.1'
    androidxWebkitVersion = '1.12.1'
    junitVersion = '4.13.2'
    androidxJunitVersion = '1.2.1'
    androidxEspressoCoreVersion = '3.6.1'
    cordovaAndroidVersion = '10.1.1'
}
```

### ب. `android/build.gradle` (أعلى الملف)
```gradle
buildscript {
    dependencies {
        classpath 'com.android.tools.build:gradle:8.7.2'
        classpath 'com.google.gms:google-services:4.4.2'
    }
}
```

### ج. `android/gradle/wrapper/gradle-wrapper.properties`
```properties
distributionUrl=https\://services.gradle.org/distributions/gradle-8.11.1-all.zip
```

### د. `android/app/capacitor.build.gradle` (تحقق فقط)
يجب أن يستخدم Java 17:
```gradle
android {
    compileOptions {
        sourceCompatibility JavaVersion.VERSION_17
        targetCompatibility JavaVersion.VERSION_17
    }
}
```

بعد أي تعديل في هذه الملفات، أعِد المزامنة:
```bash
bunx cap sync android
```

---

## 3) منع الشاشة البيضاء بعد التثبيت

الشاشة البيضاء عادة سببها أن التطبيق يحاول تحميل من الإنترنت أو أن مسارات الملفات نسبية بشكل غير صحيح. تأكد من التالي:

### أ. `capacitor.config.ts` (موجود بالفعل — للتأكيد فقط)
```ts
const config: CapacitorConfig = {
  appId: "app.platecheck.mobile",
  appName: "PlateCheck",
  webDir: "dist",
  android: { allowMixedContent: false },
  server: {
    androidScheme: "https",   // مهم لتشغيل الـ SPA offline
    // لا تضع "url" هنا — إذا أضفتها سيحاول التطبيق التحميل من الإنترنت
  },
};
```

### ب. تحقق أن الروابط في `dist/index.html` تبدأ بـ `/` أو `./` وليس `http://localhost`.

### ج. لا تفعّل Live Reload في الإنتاج (`cap run android -l` هو للـ dev فقط).

---

## 4) الأذونات (تُضاف تلقائيًا لكن تأكد منها)

افتح `android/app/src/main/AndroidManifest.xml` وتأكد من وجود:

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

---

## 5) فتح Android Studio وبناء APK

```bash
bunx cap open android
```

من داخل Android Studio:

1. انتظر **Gradle Sync** ينتهي (شريط سفلي أخضر).
2. لو ظهر تنبيه "Update Gradle Plugin" → **اضغط Don't remind me** (لأننا ضبطناه يدويًا).
3. من الأعلى: **Build → Clean Project**.
4. ثم: **Build → Rebuild Project**.
5. أخيرًا: **Build → Build Bundle(s) / APK(s) → Build APK(s)**.
6. عند الانتهاء يظهر إشعار **"APK(s) generated successfully"** → اضغط **locate** لفتح المجلد.

مسار الملف عادةً:
```
android/app/build/outputs/apk/debug/app-debug.apk
```

---

## 6) تثبيت APK على الجهاز

### طريقة 1: عبر USB (الأسرع)
```bash
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

### طريقة 2: نقل يدوي
- انسخ الملف على الجوال (WhatsApp، Google Drive، USB).
- افتحه من مدير الملفات → اسمح بـ "التثبيت من مصادر غير معروفة".

---

## 7) بعد أي تعديل في الكود

```bash
bun run build && bunx cap sync android
```
ثم من Android Studio: **Build → Build APK(s)** فقط (لا تحتاج Clean في كل مرة).

---

## 8) حل المشاكل الشائعة

| المشكلة | الحل |
|---|---|
| `Unsupported Java version` | ثبّت JDK 17 واضبط `JAVA_HOME` |
| `SDK location not found` | أنشئ `android/local.properties` وأضف `sdk.dir=/path/to/Android/sdk` |
| `Gradle sync failed` | احذف مجلد `android/.gradle` و `~/.gradle/caches` ثم افتح Studio مجددًا |
| شاشة بيضاء بعد التثبيت | تأكد من قسم (3) أعلاه، وشغّل `adb logcat \| grep -i capacitor` لرؤية الخطأ |
| `INSTALL_FAILED_UPDATE_INCOMPATIBLE` | أزل النسخة القديمة: `adb uninstall app.platecheck.mobile` |
| الميكروفون/GPS لا يعملان | من إعدادات الجوال → التطبيقات → PlateCheck → الأذونات → فعّل الكل |
| بطء أول تشغيل | طبيعي أول مرة (تهيئة IndexedDB وذاكرة اللوحات). التشغيلات التالية سريعة |

---

## 9) تشغيل بدون إنترنت (Offline)

التطبيق يعمل بدون إنترنت بشكل كامل بفضل:
- **IndexedDB** يخزن جلساتك ولوحاتك محليًا.
- **Sync Queue** يرفع البيانات تلقائيًا عند رجوع الإنترنت.
- **Plates Cache** يحمّل قاعدة لوحاتك (55 ألف لوحة) للمطابقة الفورية دون سيرفر.

> عند أول تشغيل **يجب** أن يكون هناك إنترنت لتسجيل الدخول ولتحميل قاعدة اللوحات. بعدها يعمل التطبيق بالكامل بدون شبكة.

---

## 10) إصدار Release موقّع (اختياري)

لبناء APK للنشر على المتاجر:

```bash
cd android
./gradlew assembleRelease
```

ستحتاج ملف keystore. أنشئه مرة واحدة:
```bash
keytool -genkey -v -keystore platecheck-release.keystore \
  -alias platecheck -keyalg RSA -keysize 2048 -validity 10000
```

ثم أضف في `android/app/build.gradle` قسم `signingConfigs` وأشِر إليه من `buildTypes.release`.

---

## ملخص الأوامر السريعة (نسخ ولصق)

```bash
# أول مرة
bun install && bun run build && bunx cap add android && bunx cap sync android
bunx cap open android

# بعد كل تعديل
bun run build && bunx cap sync android

# تثبيت مباشر على جهاز موصول
adb install -r android/app/build/outputs/apk/debug/app-debug.apk

# إلغاء تثبيت النسخة القديمة
adb uninstall app.platecheck.mobile

# رؤية سجل الأخطاء أثناء التشغيل
adb logcat | grep -iE "capacitor|platecheck|chromium"
```

بالتوفيق 🚀
