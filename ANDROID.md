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
