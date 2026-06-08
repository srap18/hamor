# خطة التحسين الشاملة — أداء صامت + فخامة بصرية

الهدف: فتح فوري بدون شاشات "جاري التحميل"، وسلاسة 60fps، **دون أي تغيير على المظهر**.

---

## 1. شاشة ترحيب (Splash) فخمة

- إضافة `index.html` splash داخل `<body>` مباشرة (يظهر قبل تحميل React نفسه → فوري بصرياً).
- تصميم: خلفية بحرية متدرجة (نفس tokens اللعبة) + شعار "ملوك القراصنة" بخط ذهبي + توهج ناعم + spinner دقيق.
- تختفي بـ fade-out (400ms ease-out) بعد:
  1. `document.readyState === 'complete'`
  2. تحميل أصول core (شعار، خلفية رئيسية، أيقونات BottomNav، عملات).
- يتم إزالتها من DOM بعد الانتقال (لا تستهلك ذاكرة).

## 2. التحميل المسبق الصامت (Silent Preloading)

في `src/routes/__root.tsx` `head().links`:
- `<link rel="preload" as="image" fetchpriority="high">` لـ: أيقونات العملات (coin/gem/ruby)، أيقونات BottomNav الأساسية، الخلفية الافتراضية.
- `<link rel="prefetch">` لمسارات الـ tabs الأخرى (shop, friends, chat, fish-market) — موجود أصلاً عبر `router.preloadRoute` في `idle`، نضيف prefetch صريح للصور.
- إضافة `loading="eager"` + `fetchpriority="high"` على أيقونات `CurrencyIcon` (حالياً `loading="lazy"` — يسبب وميض).

## 3. جودة الموارد

- **لن نضغط** أي شيء lossy. نُبقي PNG للأوسمة الذهبية كما هي.
- نتحقق فقط أن أيقونات SVG الموجودة تُستخدم كـ inline (لا rasterization).
- لا تحويل WebP الآن — مخاطرة عالية على التدرجات الذهبية، والمكسب صغير مقارنة بالخطر.

## 4. التوافقية (Responsiveness)

- `dvh` مع fallback — **مُطبَّق مسبقاً** ✅
- `overflow-x: hidden` على `.mobile-frame-screen` — **مُطبَّق** ✅
- `max-w-full` — **مُطبَّق** ✅
- `mx-auto` — **مُطبَّق** ✅
- **رفض `transform: scale()` الديناميكي**: السبب موثّق في الذاكرة — يكسر `position: fixed` (modals, Paddle checkout, toasts, GiftPopup). البديل الحالي (`font-size` scaling للشاشات <360px) يعطي نفس النتيجة البصرية بدون أي أعراض جانبية. سأبقي عليه.

## 5. استقرار الأداء 60fps

- `will-change`, `backface-visibility`, `contain` — **مُطبَّقة مسبقاً** في styles.css ✅
- مراجعة سريعة لـ `useEffect` بدون cleanup في الملفات الساخنة (`__root.tsx`, `MobileFrame`, `BottomNav`) — موجود لها cleanup ✅
- التأكد أن SeamlessVideo يوقف التشغيل عند `visibilitychange: hidden` لتوفير GPU.

---

## الملفات التي ستتغيّر

1. `index.html` — إضافة splash markup + CSS مدمج + سكربت إخفاء.
2. `src/routes/__root.tsx` — إضافة `<link rel="preload">` للأصول الحرجة + استدعاء `window.__hideSplash()` بعد mount.
3. `src/components/CurrencyIcon.tsx` — `loading="eager"` + `fetchpriority="high"` + `decoding="async"`.
4. (اختياري) `src/components/SeamlessVideo.tsx` — pause عند `visibilitychange`.

---

## ما لن أفعله (لحماية التصميم)

- ❌ `transform: scale()` على الـ frame — يكسر modals.
- ❌ ضغط lossy للصور الذهبية.
- ❌ تحويل PNG → WebP للأوسمة (مخاطرة على التدرج).
- ❌ أي تعديل على ألوان/تخطيط/خطوط.

النتيجة: فتح فوري بشاشة splash فخمة، أصول حرجة جاهزة قبل أول render، ولا تغيير بصري واحد على اللعبة.
