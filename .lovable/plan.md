## نظرة عامة

طاقم جديد ذهبي يُفعَّل لمدة 24 ساعة، يقوم خلالها بـ:
- ✅ تشغيل الصيد على السفن الـ3 تلقائياً، وكل ما تخلص دورة الصيد يجمع السمك ويعيد إطلاقها — حتى لو اللاعب أوف لاين.
- ✅ حماية كاملة من الهجوم والسرقة طوال الفترة.
- ✅ حماية السمك المتجمَّع كذلك (لا يسرَق).

**التسعير:** متوفر فقط في الشحن (Paddle). الباقة الوحيدة: **2 طاقم بـ $20** — غير قابلة للشراء بالذهب أو الجواهر.

---

## ملخص الخطوات

1. **Paddle**: إنشاء سعر `cr_golden_fisher_2pack` بسعر $20.
2. **قاعدة البيانات (migration)**:
   - عمود جديد في `profiles`: `golden_fisher_until timestamptz`.
   - RPC `activate_golden_fisher()` — يستهلك 1 طاقم من المخزون ويضيف 24 ساعة.
   - RPC `golden_fisher_tick(_user uuid)` — لكل سفينة تبع المستخدم: لو وقت الصيد خلص، يجمع السمك تلقائياً ويعيد إطلاقها (نسخة من `collect_fishing_reward` لكن بدون `auth.uid()`، تأخذ `_user` صراحةً).
   - حماية: تحديث `record_attack` و `start_steal_mission` ليرفضا الهدف إذا `golden_fisher_until > now()`.
   - منع بيع/سرقة السمك أثناء التفعيل (تحديث `steal_fish`).
3. **Cron Job**: كل دقيقتين يتم استدعاء `/api/public/hooks/golden-fisher-tick` التي تجلب كل المستخدمين النشطين وتنادي `golden_fisher_tick` لكل واحد.
4. **Catalog**: إضافة الباقة في `store-catalog.ts` تحت `crew`. صورة ذهبية للطاقم.
5. **Crews UI**: إضافة الطاقم في `crews.ts` (للعرض فقط — بدون سعر بيع داخلي).
6. **زر تفعيل**: في `index.tsx` عند الضغط على الطاقم → استدعاء `activate_golden_fisher` ويظهر عدّاد تنازلي ذهبي 24h.
7. **عداد + شارة**: شارة ذهبية بجانب الـShield تبيّن باقي الوقت.

---

## تفاصيل تقنية

### Paddle
- نُنشئ منتج `crew_golden_fisher_pack` وسعر واحد فقط `cr_golden_fisher_2pack` = $20 (quantity_min=1, quantity_max=1).
- `STORE_PACKS`: `priceUSD: 20`, `reward: { items: [{ itemType: "crew", itemId: "golden_fisher", qty: 2 }] }`.

### قاعدة البيانات

```sql
-- 1. عمود التفعيل
ALTER TABLE profiles ADD COLUMN golden_fisher_until timestamptz;

-- 2. تفعيل طاقم واحد (يستهلك من inventory_items)
CREATE FUNCTION activate_golden_fisher() RETURNS jsonb ...
-- يتحقق من توفر 1 على الأقل، يقلل العدد، ويضيف 24h فوق وقت التفعيل الحالي
-- (لو فيه تفعيل ساري يتراكم على الباقي).

-- 3. tick: ينفّذ دورة صيد كاملة لكل سفينة جاهزة
CREATE FUNCTION golden_fisher_tick(_user uuid) RETURNS jsonb ...
-- لكل ship في ships_owned تبع المستخدم:
--   - لو fishing_started_at + duration <= now() → جمع المكافأة، insert في fish_caught/user_fish_market
--   - أعد ضبط fishing_started_at = now() لبدء دورة جديدة
-- يستخدم نفس منطق collect_fishing_reward لكن SECURITY DEFINER بدون auth.uid().

-- 4. حماية الهجوم والسرقة
-- تعديل record_attack و start_steal_mission و steal_fish:
--   IF (SELECT golden_fisher_until FROM profiles WHERE id = _target) > now() THEN
--      RAISE EXCEPTION 'هذا اللاعب محمي بطاقم الصياد الذهبي';
--   END IF;
```

### Cron
- مسار: `src/routes/api/public/hooks/golden-fisher-tick.ts`
- كل دقيقتين (pg_cron) → POST بدون body → يجلب `SELECT id FROM profiles WHERE golden_fisher_until > now()` ويستدعي `golden_fisher_tick(id)` لكل واحد.

### واجهة المستخدم
- في صفحة الطواقم (`index.tsx`): الطاقم الذهبي يظهر فوق القائمة بتصميم مميز (إطار ذهبي + لمعان).
- زر "تفعيل 24 ساعة" → يستدعي `activate_golden_fisher`.
- لو التفعيل ساري: عدّاد تنازلي كبير + شارة ذهبية ثابتة في الـHUD.
- في `RechargePanel` / `shop`: يظهر تحت تبويب "طواقم".

### الحفاظ على الفخامة
- صورة طاقم ذهبية جديدة (`/src/assets/crews/golden-fisher.png`) — تُولَّد عبر imagegen.
- شارة ذهبية متحركة بلمعان خفيف في الـHUD.

---

## الملفات

**جديدة:**
- `supabase/migrations/<ts>_golden_fisher.sql`
- `src/routes/api/public/hooks/golden-fisher-tick.ts`
- `src/assets/crews/golden-fisher.png` (imagegen)
- `src/lib/golden-fisher.functions.ts` — `activateGoldenFisher` serverFn

**معدَّلة:**
- `src/lib/store-catalog.ts` — إضافة الباقة
- `src/lib/crews.ts` — إضافة الطاقم (للعرض)
- `src/routes/index.tsx` — زر التفعيل + العداد
- `src/components/ShieldBadge.tsx` (أو شارة جديدة) — لإظهار حالة التفعيل

---

## التحقق

1. شراء وهمي (test mode) → 2 طاقم في المخزون.
2. تفعيل → `golden_fisher_until` يتحدّث + شارة ذهبية تظهر.
3. هجوم/سرقة من حساب آخر → رفض برسالة "محمي بطاقم الصياد الذهبي".
4. انتظار دورة صيد → تشغيل الـcron يدوياً → السمك يتجمَّع بدون لمس اللعبة.
5. بعد 24h → الشارة تختفي والحماية تنتهي.

هل تعتمد الخطة؟