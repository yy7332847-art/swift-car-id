# تشخيص نظام التسجيل على الموبايل + خطة تنفيذ 22 تحسين

## أولاً: التشخيص (لماذا الموبايل أضعف من الكمبيوتر؟)

بعد مراجعة `src/routes/_authenticated/record.tsx` و `src/lib/audio-recorder.ts` و `src/routes/api/transcribe.ts`، الأسباب الجذرية لضعف الموبايل:

1. **Web SpeechRecognition على الموبايل ضعيف جوهرياً** — على Android Chrome يعمل بجودة أقل، وعلى iOS Safari لا يعمل أصلاً. النظام يعتمد عليه كمصدر أساسي فوري، فيسقط أول/آخر مقطع من الجملة.
2. **Highpass 95Hz + Compressor -48dB** يقطعان أصوات صامتة خفيفة (خصوصاً بداية الحروف مثل "ع" و "أ") في بيئة السيارة.
3. **الميكروفون الأمامي للموبايل بعيد عن الفم** — RMS ينزل تحت العتبة فيُتجاهل المقطع (`onChunkSkipped: silent`).
4. **ScriptProcessorNode 4096 على الموبايل** يسبب drop للعينات عند انشغال الـ main thread (rendering الخريطة، Leaflet، confetti…).
5. **STT chunks متتابعة تولّد 429** من Gateway → backoff → يبدو للمستخدم أن النظام "توقف بعد لوحتين".
6. **دمج SpeechRecognition + STT** بدون فاصل أولوية: لو STT رد متأخر بنسخة أطول، يتجاهله dedup cooldown ولا يُصلح النقص.
7. **لا يوجد VAD حقيقي** — التقطيع زمني ثابت (chunkSeconds)، فيقطع الكلمة في منتصفها.
8. **iOS Safari** لا يدعم `SpeechRecognition` نهائياً؛ التطبيق يبدو "أبكم" تماماً هناك.
9. **AudioContext يُعلّق في الخلفية** عند قفل الشاشة/تبديل التطبيق → لا يستأنف حتى بعد الرجوع.
10. **لا يوجد قياس لبُعد الميكروفون** ولا تنبيه للمستخدم لتقريبه.

## ثانياً: 22 تحسين — سأنفذها كلها

### طبقة الصوت (Audio Capture)
1. **AudioWorklet بدل ScriptProcessor** على الأجهزة الداعمة → لا drops عند انشغال UI.
2. **VAD (Voice Activity Detection)** بسيط بـ RMS + zero-crossing → قطع المقاطع عند الصمت الحقيقي بدل كل 1.05s.
3. **خفض Highpass إلى 60Hz على الموبايل** والاحتفاظ بـ AGC → لا نقطع بدايات الحروف الحلقية.
4. **تليين Compressor** (threshold -35dB, ratio 3) → لا يهرس الديناميكية.
5. **رفع gain برمجياً** (GainNode ×2.5) قبل التسجيل على الموبايل.
6. **قياس RMS مستمر وعرض "قرّب الميكروفون"** عند انخفاض مستمر > 3s.
7. **استئناف AudioContext تلقائياً** عند `visibilitychange` و `focus`.

### طبقة التعرف (Recognition)
8. **إسقاط SpeechRecognition نهائياً على iOS** والاعتماد على STT فقط (streaming).
9. **جعل STT هو المصدر الأساسي على كل الموبايلات**، و SpeechRecognition مساعد فقط.
10. **Streaming STT الحالي + عرض delta فوري** في البطاقة (partial rendering).
11. **إرسال آخر 2.5s overlap مع كل chunk** → يمنع فقدان بداية اللوحة التالية.
12. **Queue بحد أقصى 2 requests متوازية** + backoff ذكي على 429 (jitter).
13. **إرسال prompt STT معزّز بحروف اللوحات السعودية** ("أ ب ح د ر س ص ط ع ق ك ل م ن هـ و ي") ليحسّن التمييز.
14. **إعادة إرسال المقطع بنموذج `gpt-4o-transcribe`** (بدل mini) عند فشل الاستخراج.

### طبقة التحليل (Parsing)
15. **دمج SpeechRecognition + STT في buffer واحد موحّد** واختيار الأطول/الأكثر ثقة.
16. **إعادة تحليل آخر 12s كل مرة** بدل جملة واحدة → استعادة اللوحات المقطوعة.
17. **auto-complete من ملف Excel** موجود (تم) → توسيعه ليقبل مطابقة الأرقام فقط.
18. **قاموس عامي موسّع**: "اتنين/تنين=2، تلاتة=3، أربعة/ربعة=4، خمسة، ستة، سبعة، تمنية، تسعة، عشرة، عشرين، تلاتين، أربعين، خمسين، ستين، سبعين، تمانين، تسعين، مية، ميتين، تلتمية…" (موجود جزئياً، سنكمله).
19. **أسماء الحروف**: "ألف=أ، باء=ب، جيم=ج، عين=ع، ميم=م، لام=ل…" (موجود، سنوسّعه).

### طبقة الموثوقية والتشخيص
20. **Watchdog محسّن**: يعيد تشغيل AudioContext + SpeechRecognition + Queue إذا لم يصل chunk خلال 4s.
21. **Wake Lock API** أثناء التسجيل → الشاشة لا تُقفل → AudioContext لا يُعلَّق.
22. **مؤشر حي "أسمعك؟" أعلى الشاشة** يومض مع كل RMS peak → المستخدم يعرف فوراً لو الميكروفون لا يلتقطه.

## ثالثاً: خطوات التنفيذ

1. تعديل `src/lib/audio-recorder.ts`:
   - Highpass 60Hz للموبايل، Compressor أخف، GainNode ×2.5، VAD flush، AudioWorklet مع fallback، استئناف AudioContext على `visibilitychange`.
2. تعديل `src/routes/_authenticated/record.tsx`:
   - إسقاط SpeechRecognition على iOS، جعل STT المصدر الأساسي على الموبايل، Queue بحد أقصى 2، backoff+jitter، overlap 2.5s، Wake Lock، مؤشر "قرّب الميكروفون"، إعادة تحليل آخر 12s، توسيع القاموس العامي، prompt محسّن.
3. تعديل `src/routes/api/transcribe.ts`:
   - Prompt يضم قائمة الحروف السعودية الرسمية، وخيار model=`gpt-4o-transcribe` (بدل mini) للمقاطع المهمة.
4. اختبار build + typecheck + preflight يدوي على `/record`.

## ملاحظات مهمة
- كل التعديلات في `src/` فقط، بدون تغيير schema أو backend.
- لن نضيف مكتبة native جديدة؛ سنستخدم Web APIs موجودة (AudioWorklet, Wake Lock, VAD يدوي).
- بعد التنفيذ: اختبار حقيقي على موبايل يظل مسؤولية المستخدم — سنوفر زر Diagnostics لتصدير اللوج إن ظهرت مشكلة متبقية.
