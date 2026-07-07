# خطة التنفيذ الشاملة

سأنفّذ كل شيء في نفس التحديث بالترتيب المطلوب، بدون حذف أي ميزة موجودة أو تعديل أي منطق شغّال.

---

## 🔴 المرحلة 1 — الإصلاحات الحرجة

### 1. الأرينا: زر رجوع دائم حتى بلا محاولات
**الملف:** `src/routes/battle.tsx`
- التأكد أن `BackButton` يظهر دائمًا في أعلى الصفحة بغض النظر عن حالة المحاولات.
- إن كانت شاشة "لا توجد محاولات" تخفي كل شيء، أضيف زر رجوع واضح فوقها.

### 2. زر إرسال الشات مقصوص على أندرويد
**الملف:** `src/routes/chat.tsx`
- إضافة `padding-bottom: env(safe-area-inset-bottom)` لصندوق الكتابة.
- التأكد من `viewport-fit=cover` في `__root.tsx`.
- استخدام `100dvh` بدل `100vh` للحاوية.

### 3. زر الإغلاق في الترتيب مغطّى بشريط أندرويد
**الملف:** الشاشات ذات زر "إغلاق" السفلي (الترتيب/leaderboard في `index.tsx` أو صفحة منفصلة).
- رفع الزر بـ `paddingBottom: max(1rem, env(safe-area-inset-bottom))`.

### 4. إزالة الدرع مع بقاء الصياد الذهبي
**الحالي:** `drop_my_protection` RPC — أفحص إن كان يحذف الصياد الذهبي أيضًا.
- إذا كانت العملية تلمس `golden_fisher_until`، أعدّلها لتقتصر على `protection_until` فقط.
- التأكد من الواجهة (`ShieldBadge.tsx`) أنها ما تلمس الصياد.

---

## 🟡 المرحلة 2 — تحسين السفن (رقم 5)

**الملف:** `src/routes/index.tsx` (منطقة السفن على السطح)
- زيادة التباعد الرأسي بين السفن (`gap` أو `marginBottom`).
- تصغير صور الطاقم (`crew`) بنسبة ~20-25%.
- زيادة hitbox الضغط ليطابق السفينة نفسها فقط (بدون تداخل).
- تصغير خط الأرقام أو نقلها لتفادي التداخل البصري.

---

## 🟢 المرحلة 3 — الميزات الجديدة

### 6. محادثة خاصة مع غير الأصدقاء (طلب قبول)
**قاعدة البيانات (migration جديد):**
```sql
ALTER TABLE messages ADD COLUMN IF NOT EXISTS request_status text 
  CHECK (request_status IN ('pending','accepted','declined'));
-- عمود لتمييز أول رسالة تحتاج قبول
```
أو أفضل: جدول `dm_requests(from_user, to_user, status, created_at)`.

**المنطق:**
- عند إرسال DM لغير صديق: إذا ما فيه سجل قبول سابق، تُنشأ request بحالة pending، وتُعرض للمستلم في تبويب "طلبات".
- بعد القبول → المحادثة تفتح عادي.
- بعد الرفض → تُحذف الطلبات ولا يمكن الإرسال ثانية إلا بعد فترة.

**الواجهة:** تبويب جديد "📩 طلبات" في `chat.tsx` تحت تبويب "خاص".

### 7. جوجل يفتح كروم بدل WebView
**الملف:** `src/routes/login.tsx` + `signup.tsx` + كود جوجل الحالي.
- استخدام `@capacitor/browser` بدل الفتح الافتراضي على أندرويد.
- تثبيت الحزمة: `bun add @capacitor/browser`.
- عند اكتشاف Capacitor Native، استخدام `Browser.open({ url })` مع رجوع بـ deep link.

### 8. Immersive Mode لإخفاء شريط أندرويد
- تثبيت `@capacitor-community/immersive-mode` أو استخدام plugin موجود.
- تفعيله عند بدء التطبيق في `src/lib/native-shell.ts`.
- إن لم تتوفر الحزمة، أضيف كود Java مباشر في `MainActivity.java` باستخدام `WindowInsetsController.hide(navigationBars())`.

---

## 🔧 المرحلة 4 — فحص السخونة (تشخيص شامل)

**سأفحص:**
1. **`src/routes/index.tsx` (المحيط):** بحث عن `setInterval`/`requestAnimationFrame` غير محدودة، فيديوهات خلفية بدون تحسين.
2. **`src/routes/chat.tsx`:** تأكيد أن ChatComposer معزول (تم سابقًا)، فحص realtime subscriptions.
3. **`src/routes/battle.tsx` + `boss.tsx`:** فحص re-renders في timers.
4. **`src/routes/arena.tsx`:** تحديث `now` كل دقيقة (جيد).
5. **الخلفيات المتحركة:** `bg-motion.ts` — تقليل معدل الإطارات على الأجهزة الضعيفة.

**الإصلاحات المتوقعة:**
- تقليل `setInterval` إلى `useServerTick` مركزي واحد.
- استخدام `IntersectionObserver` لإيقاف الفيديوهات خارج الشاشة.
- إضافة `will-change: transform` فقط عند الحاجة (يستهلك GPU إذا فُعّل دائمًا).
- تفعيل `power-saver.ts` تلقائيًا عند اكتشاف battery API < 20%.
- تقليل عدد الـ realtime channels المفتوحة في نفس الوقت.

---

## ⚠️ ضمانات

- **لا حذف** لأي ميزة موجودة (VIP، الأرينا، القبائل، الصياد الذهبي، الدعوات، إلخ).
- **لا تعديل** لأي RPC شغّال إلا `drop_my_protection` (لفصل الصياد عن الدرع).
- **Migration واحد فقط** للمحادثات (إضافة عمود/جدول جديد بدون كسر القديم).
- **كل التعديلات UI/CSS** لا تلمس منطق اللعبة.
- **اختبار مرئي** بعد كل مرحلة عبر screenshot.

---

## ترتيب التنفيذ الفعلي

1. قراءة الملفات المؤثرة (chat.tsx, battle.tsx, index.tsx, arena.tsx, ShieldBadge, drop_my_protection RPC).
2. تنفيذ 1→2→3→4 (إصلاحات).
3. تنفيذ 5 (سفن).
4. تنفيذ Migration للمحادثات + UI (رقم 6).
5. تثبيت الحزم لجوجل + immersive وتفعيلها (7 + 8).
6. فحص الأداء وتطبيق الإصلاحات (السخونة).
7. build check + التحقق النهائي.

هل أبدأ التنفيذ؟
