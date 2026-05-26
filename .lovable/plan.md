
## 1) إصلاح تمرير الـ /admin على الجوال
- في `src/routes/admin.tsx`: المشكلة أن `<main className="flex-1 overflow-y-auto">` داخل `min-h-screen flex-col` على الجوال يحبس التمرير.
- الحل: استخدام `md:h-screen md:overflow-hidden` على الحاوية الخارجية، و`overflow-y-auto` على `main` فقط في الـ md+. على الجوال نخلي الصفحة تمرّر طبيعياً.
- إضافة sticky topbar للجوال + زر "خروج" و"العودة للعبة" يظهرون على الجوال أيضاً (حالياً مخفيين بـ `hidden md:block`).

## 2) لوحة تحكم شاملة للترقيات/السفن/الأسعار
سننشئ تبويب جديد في `/admin/content` اسمه **"الاقتصاد"** (`economy`) يحتوي على:

### أ) تحرير ترقيات سوق السمك وسوق السفن
- جدولين قابلين للتحرير: سعة كل مستوى + تكلفة الترقية لكل مستوى.
- يُحفظ في جدول جديد `economy_settings` (key/value JSON) بدلاً من ثوابت الكود.
- `src/lib/ships.ts` يتم تحديثه لقراءة القيم من Supabase عبر hook + كاش، مع fallback للقيم الحالية.

### ب) تحرير السفن (سعر/قوة/سعة/مدة صيد/HP/درع)
- جدول قابل للتحرير لكل المستويات 1-30 (السعر، storage، fishingMinutes، maxHp formula override، fishPool).
- يُحفظ في جدول جديد `ship_overrides` (level PK + jsonb).
- `buildShip()` في `ships.ts` يدمج القيم المخصصة فوق الافتراضيات.

### ج) تحرير أسعار الشحن/المتجر
- يدير `client_item_prices` و `lootbox_types` و `items_catalog` الموجودة فعلاً (موجودة جزئياً في تبويبات أخرى، نضيف رابط مباشر).
- إضافة قسم لأسعار حزم الشحن (`recharge_packs` جدول جديد إذا غير موجود).

## 3) تسعير السمك حسب مستوى السفينة (تحديث ساعي)
المنطق:
- كل ساعة UTC، نولّد سعر لكل سمكة عشوائياً بين `min_price` و `max_price`.
- `min/max` للسمكة تُحسب من **مستوى أعلى سفينة فيها هذه السمكة في fishPool**:
  - سفينة مستوى 1 (سردين): النطاق 0.80 → 1.03
  - سفينة مستوى 30: أقصى max = 36
  - بين 1-30: تدرّج خطي (`min` و `max` ينموان معاً).
  - داخل نفس مستوى السفينة: نقسم حسب الندرة (rarity tier: common < uncommon < rare < epic < legendary < mythic) — الأندر يأخذ القيمة الأعلى من النطاق.
- pg_cron job كل ساعة يحدّث `fish_market_prices.current_price` لكل سمكة عشوائياً بين min/max الجديدين.

### خطوات الـ DB:
1. ترحيل (migration) ينشئ:
   - `economy_settings` (key text PK, value jsonb)
   - `ship_overrides` (level int PK, overrides jsonb)
   - دالة `recompute_fish_prices()` تحدّث `fish_market_prices` بناءً على المنطق أعلاه.
   - cron job ساعي يستدعي الدالة.
2. seed `fish_market_prices` بـ min/max المحسوبة لكل سمكة.

## ملاحظات
- العمل كبير ومُتعدّد الملفات. سأنفذه على دفعات صغيرة بعد الموافقة.
- ملف `ships.ts` سيحتاج تحويل من ثوابت ثابتة إلى hook async لقراءة الـ overrides — سيؤثر على عدة شاشات (ship-market, fleet, إلخ).
