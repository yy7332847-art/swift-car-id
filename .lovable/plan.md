# وضع "بدون إنترنت" (Offline Mode)

هدف: تسجيل جلسات كامل بدون إنترنت مع مزامنة تلقائية عند رجوع الاتصال.

## المكونات

### 1. طبقة تخزين محلية (IndexedDB)
ملف جديد `src/lib/offline-store.ts` باستخدام `idb`:
- **stores**: `sessions` (drafts), `plates` (detected queue), `audio_chunks` (blobs للـ STT المؤجّل), `plates_cache` (نسخة كاملة من قاعدة لوحات المستخدم للمطابقة المحلية).
- API: `enqueuePlate`, `enqueueSession`, `getPending`, `markSynced`, `cachePlatesDB`, `matchPlateOffline`.

### 2. مطابقة محلية للوحات
- عند أول اتصال بعد الدخول: تنزيل قاعدة لوحات المستخدم من `plates` إلى IndexedDB (chunks 5K).
- أثناء التسجيل: المطابقة تتم محلياً أولاً من الكاش، ثم تتأكد من السيرفر عند المزامنة.

### 3. STT بدون إنترنت (Fallback)
- الأساسي: Web Speech API (`webkitSpeechRecognition`) الموجود فعلاً — يعمل offline على أجهزة Android/Chrome.
- Whisper يُعطَّل تلقائياً عند offline؛ الصوت لا يُخزّن (توفير مساحة) إلا لو المستخدم فعّل "أعد النسخ عند الاتصال" في الإعدادات، وقتها نخزّن chunks لرفعها لاحقاً.

### 4. Sync Queue
ملف جديد `src/lib/sync-queue.ts`:
- عند `online` event أو كل 30 ثانية: يرفع الجلسات ثم اللوحات ثم مسار GPS.
- Idempotency: كل عنصر له `client_id` (uuid) + عمود `client_id` جديد في الجداول لمنع التكرار.
- استراتيجية: batches بـ 100 لوحة، exponential backoff عند الفشل.

### 5. مؤشر حالة الاتصال
مكوّن `src/components/ConnectivityIndicator.tsx` في `MobileShell`:
- 3 حالات: 🟢 متصل ومتزامن / 🟡 عناصر في الانتظار (رقم) / 🔴 بدون إنترنت.
- Sheet عند الضغط: عدد العناصر المعلّقة، آخر مزامنة، زر "مزامنة الآن"، زر "تنزيل قاعدة اللوحات للاستخدام offline".

### 6. تعديلات صفحة التسجيل
`src/routes/_authenticated/record.tsx`:
- كل كتابة تذهب إلى `enqueuePlate` أولاً، ثم Supabase (أو تتخطى Supabase إذا offline).
- المطابقة تستخدم `matchPlateOffline` عندما `!navigator.onLine`.
- شارة صغيرة "محفوظ محلياً — بانتظار المزامنة" على البطاقات غير المتزامنة.

### 7. قاعدة البيانات
Migration واحدة تضيف:
- `detected_plates.client_id text unique` (لكل مستخدم مع partial index).
- `recognition_sessions.client_id text unique`.
- سياسات RLS تبقى كما هي (upsert on client_id).

### 8. Service Worker (خفيف)
- **لا** نضيف vite-plugin-pwa الكامل — نستخدم manifest فقط + SW صغير جداً محصور برفض التشغيل في preview/dev (حسب قواعد Lovable).
- الغرض الوحيد: `background sync` API عند دعمها لإعادة محاولة الرفع بعد إغلاق التطبيق.
- في preview: لا يُسجَّل إطلاقاً؛ ملف SW يعيش في `public/sw.js` مع kill-switch على `?sw=off`.
- إن كانت هذه الطبقة معقّدة على المشروع الحالي، نبدأ بدون SW ونعتمد على `online` event + interval فقط (يعمل ما دام التطبيق مفتوح).

## ما لن يتغيّر
- تنسيق التقارير، الخريطة الحرارية، نظام التكرار، الاشتراكات، صفحات الإدارة — كلها تبقى كما هي.

## تفاصيل تقنية موجزة
- مكتبة: `idb` (~1KB).
- تشفير: لا حاجة، البيانات على جهاز المستخدم فقط.
- حدود: نحذّر عند تجاوز 500 عنصر معلّق ("مساحة كبيرة بدون مزامنة").
- تعارض: server-wins على الحقول الوصفية، client-wins على `is_matched` و `duplicate_decision`.

## خطة التنفيذ (بالترتيب)
1. Migration للـ `client_id`.
2. `offline-store.ts` + `sync-queue.ts`.
3. تعديل `record.tsx` لاستخدام الطابور.
4. مؤشر الاتصال + sheet.
5. تنزيل كاش لوحات المستخدم.
6. (اختياري لاحقاً) Service Worker مع kill-switch.

هل أبدأ التنفيذ بهذا الشكل، أم تفضّل تخطّي Service Worker من البداية والاكتفاء بالمزامنة أثناء فتح التطبيق فقط؟
