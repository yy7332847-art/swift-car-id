# تحويل PlateCheck إلى تطبيق Android (Capacitor)

المشروع مضبوط مسبقًا. اتبع الخطوات بالترتيب:

## 1) تجهيز مشروع Android (لمرة واحدة)

```bash
bun install
bun run build            # يبني الويب داخل dist/
npx cap add android      # يضيف مجلد android/ (لمرة واحدة فقط)
```

## 2) بعد أي تغيير في الكود

```bash
bun run build
npx cap sync android     # ينسخ الملفات إلى المشروع الأصلي
```

## 3) فتح Android Studio لبناء APK

```bash
npx cap open android
```

من داخل Android Studio:
- انتظر انتهاء Gradle sync.
- من القائمة: **Build → Build Bundle(s)/APK(s) → Build APK(s)**.
- سيظهر مسار ملف الـ APK — ثبّته على الجهاز.

## 4) أذونات مطلوبة (تُطلب تلقائيًا عند أول تشغيل)

- **الموقع الجغرافي (GPS)** — يستخدمه تتبع المسار أثناء الجلسة.
- **الميكروفون** — للتسجيل الصوتي.

الأذونات معرّفة داخل `AndroidManifest.xml` تلقائيًا بواسطة `@capacitor/geolocation`. إذا رفض المستخدم، تظهر شاشة داخل التطبيق ترشده لتفعيلها من إعدادات الجهاز.

## 5) تتبع الموقع في الخلفية (اختياري لكنه موصى به)

عند إغلاق الشاشة أثناء التسجيل، يوقف Android محدد الموقع العادي. لتشغيله كخدمة أمامية:

```bash
bun add @capacitor-community/background-geolocation
npx cap sync android
```

بعد المزامنة سيُضاف تلقائيًا لـ `AndroidManifest.xml`:
`ACCESS_FINE_LOCATION`, `ACCESS_BACKGROUND_LOCATION`, `FOREGROUND_SERVICE_LOCATION`.

عند بدء الجلسة سيظهر إشعار "PlateCheck — تسجيل جلسة" ويستمر GPS بالعمل حتى مع إغلاق الشاشة.

## 6) رفع دقة GPS

- إعدادات Android ← الموقع ← الوضع = "**دقة عالية**".
- فعّل **Google Location Accuracy** إن ظهر (يستعمل GPS + Wi-Fi + شبكات).
- عطّل "توفير البطارية" للتطبيق حتى لا يقلل معدل تحديثات الموقع.
