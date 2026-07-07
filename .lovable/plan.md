# أتمتة Google Play Billing عبر Publisher API

## نظرة عامة
ربط قاعدة بياناتك بـ Google Play Console بحيث أي إضافة/تعديل لمنتج داخل Supabase يُنعكس تلقائياً على Play Store عبر `androidpublisher.v3` API.

## 1. جدول المنتجات في Supabase

جدول جديد `play_products` يكون **مصدر الحقيقة الوحيد** (Single Source of Truth). سبب إنشاء جدول منفصل: `STORE_PACKS` الحالي كود ثابت في `src/lib/store-catalog.ts`، ولا يمكن تعديله من لوحة إدارة، ولا مزامنته حياً.

الحقول الأساسية:
- `sku` (فريد، مثل `gold_pack_500`) — مطابق لـ Play SKU.
- `title_ar` / `title_en` — العنوان المعروض.
- `description_ar` / `description_en`.
- `price_micros` (bigint) — السعر بالميكرو (1 دولار = 1,000,000).
- `default_currency` (مثل `USD`).
- `product_type`: `inapp` أو `subs`.
- `status`: `active` / `inactive`.
- `synced_at`, `sync_status` (`pending`/`ok`/`error`), `sync_error`.
- `rewards` (jsonb) — المكافآت داخل اللعبة (ذهب/جواهر/دروع).

RLS: قراءة عامة (anon) للحقول العرضية فقط عبر view، كتابة للأدمن فقط.

## 2. مسار المزامنة التلقائية

```text
INSERT/UPDATE على play_products
        │
        ▼
Postgres Trigger → pg_net.http_post
        │
        ▼
POST /api/public/hooks/play-sync (server route)
   - يتحقق من apikey (Supabase anon)
   - يقرأ الصف المُعدَّل
   - يستدعي Google Play API
        │
        ▼
تحديث play_products.sync_status
```

## 3. Google Play API — التنفيذ

**المكتبة:** `googleapis` (رسمية من Google، MIT License).

**Server Route:** `src/routes/api/public/hooks/play-sync.ts`
- يقرأ `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` من env.
- ينشئ `GoogleAuth` بصلاحية `androidpublisher`.
- لكل منتج:
  - `inapp` → `androidpublisher.inappproducts.patch` (مع `autoConvertMissingPrices: true`).
  - `subs` → `androidpublisher.monetization.subscriptions.patch`.
- `status: inactive` → `inappproducts.delete` أو `subscriptions.archive`.
- يسجّل النتيجة في `play_products.sync_status`.

**Server Function للأدمن:** `syncAllPlayProducts` — يعيد مزامنة كل المنتجات دفعة واحدة (زر طوارئ في لوحة الأدمن).

## 4. لوحة إدارة (بسيطة)

صفحة جديدة `src/routes/admin.play-products.tsx`:
- جدول بكل المنتجات مع `sync_status` ملوّن.
- أزرار: إضافة، تعديل، حذف، "مزامنة الآن".
- عمود يعرض آخر رسالة خطأ من Play API.

## 5. إرشادات المستخدم (خطوة بخطوة)

سأزودك بدليل مفصّل بالعربي:
1. فتح Google Cloud Console → إنشاء Service Account.
2. إضافة صلاحية `Service Account User`.
3. تنزيل JSON key.
4. في Play Console → Users & permissions → دعوة إيميل الـ Service Account مع صلاحية `Manage store presence` + `Manage orders and subscriptions`.
5. تفعيل `Google Play Android Developer API` في Cloud Console.
6. لصق JSON بالكامل في `add_secret` باسم `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`.
7. إضافة `GOOGLE_PLAY_PACKAGE_NAME` = `com.hamor.game`.

## التفاصيل التقنية

**الملفات الجديدة/المعدّلة:**
- `supabase/migrations/*_play_products.sql` — جدول + RLS + trigger.
- `src/routes/api/public/hooks/play-sync.ts` — webhook receiver.
- `src/lib/play-sync.functions.ts` — server functions للأدمن.
- `src/routes/admin.play-products.tsx` — UI الإدارة.
- `bun add googleapis` — تثبيت المكتبة.

**Secrets مطلوبة (سأطلبها منك بعد الموافقة على الخطة):**
- `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` (JSON كامل).
- `GOOGLE_PLAY_PACKAGE_NAME` = `com.hamor.game`.

**ملاحظات مهمة:**
- Play API لا يدعم إضافة منتج جديد بـ `POST insert` بشكل حقيقي — يستخدم `patch` مع `PATCH` semantics التي تنشئ إذا لم يوجد.
- الأسعار متعددة العملات تُحوَّل تلقائياً بـ `autoConvertMissingPrices`.
- المنتجات الجديدة تحتاج ~2-4 ساعات لتظهر في تطبيق العميل بعد النشر.
- الحذف من Play يعطّل المنتج فوراً للمستخدمين الجدد لكن لا يُلغي الاشتراكات الحالية.

هل أبدأ التنفيذ؟