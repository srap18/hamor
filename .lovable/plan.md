# تسريع استجابة الميناء على الجوالات الضعيفة

## التشخيص

بعد فحص `src/routes/index.tsx`:
- **3789 سطر** في مكوّن واحد (الميناء كامل) — أي تغيير state يعيد رسم الصفحة كاملة.
- **54 hook حالة** (useState/useMemo/useCallback) + **31 useEffect/timer**.
- **7 قنوات Realtime** تشتغل بالتوازي على نفس الصفحة (`my-ships`, `home-badges`, `harbor`, `my-inv`, `my-market`, `raids`, `leaderboard-live`).
- منطق "إيقاف الصيد" أصلاً يستخدم **optimistic update** (السطر 1142-1143) — يعني المشكلة **ليست شبكية**، بل **render thread محشور**.

على الجوال الضعيف: كل ضغطة تنتظر الـ JS thread يخلّص شغل القنوات والـ effects → الضغط يحس "متأخر" أو "معلّق".

## الخطة (4 تحسينات بدون تغيير بصري)

### 1. عزل ضغط السفن في handler خفيف (الأولوية الأعلى)
- استخدام `startTransition` من React لتأجيل الـ state updates غير الحرجة بعد ضغطة "إيقاف الصيد".
- نقل الـ optimistic update إلى `flushSync` للجزء البصري فقط (السفينة ترجع للميناء فوراً)، والباقي في transition.
- النتيجة: حتى لو الصفحة مشغولة، الضغطة تتسجل وتعطي feedback فوري.

### 2. تقليل عدد الـ Realtime channels المتزامنة
المشكلة: 7 قنوات = 7 WebSocket subscriptions + 7 سلاسل re-render مستقلة.
- دمج `home-badges` + `harbor` + `my-market` في قناة واحدة `home:${uid}` تستمع لعدة جداول.
- تأخير اشتراك `leaderboard-live` حتى يفتح اللاعب تبويب المتصدرين (lazy subscribe).
- النتيجة: تقليل الضغط على main thread خصوصاً عند الجوالات الضعيفة.

### 3. إيقاف الـ subscriptions لما الصفحة مخفية
- إضافة listener لـ `document.visibilitychange`: إذا `hidden` → `channel.unsubscribe()`، عند العودة → resubscribe.
- يحل مشكلة "صغّرت الصفحة ورجعت تعلّقت" اللي ذكرتها سابقاً.

### 4. تخفيف re-renders للسفن
- لف بطاقة كل سفينة (`ShipCard`) في `React.memo` مع مقارنة على `id, progress, fishing, hp` فقط.
- الآن تغيير حالة سفينة واحدة يعيد رسم كل السفن. بعد التعديل: السفينة المتأثرة فقط تعيد الرسم.

### 5. (في الوضع الخفيف فقط) تقليل تكرار تحديث الـ progress bar
- بدل تحديث كل 1s، نحدّث كل 2s إذا `isLowPerfMode === true`.
- يقلل re-renders بمقدار النصف على الأجهزة الضعيفة بدون فقدان دقة محسوسة.

## الملفات المتأثرة

1. `src/routes/index.tsx`:
   - حقن `startTransition` + `flushSync` في handler إيقاف الصيد (~السطر 1140).
   - دمج قنوات Realtime (~الأسطر 462, 501, 559, 805).
   - إضافة visibility listener للقنوات.
   - استخراج `ShipCard` كمكوّن منفصل مع `React.memo` (أو لفّ موجود).
   - شرط `isLowPerfMode` على فاصل tick الـ progress.

2. لا تعديل بصري، لا تغيير على الـ tokens، لا تغيير على schema قاعدة البيانات.

## القياس بعد التطبيق

- قبل: ضغطة "إيقاف الصيد" على جوال ضعيف ~400-800ms تأخير محسوس.
- متوقع بعد: <100ms (feedback فوري عبر `flushSync`).
- قياس فعلي عبر `browser--performance_profile` على viewport جوال بعد التطبيق.

## ما لن أفعله

- ❌ لن أقسّم `index.tsx` إلى ملفات منفصلة (تغيير ضخم محفوف بالمخاطر).
- ❌ لن أغيّر منطق RPC أو schema الـ DB.
- ❌ لن أغيّر أي شيء بصري.
