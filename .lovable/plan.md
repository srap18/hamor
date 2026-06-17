# خطة ربط Shopify بكل عروض اللعبة

## المرحلة 1: التحضير (قراءة وتجهيز)
1. جلب `SHOPIFY_STORE_PERMANENT_DOMAIN` و `SHOPIFY_STOREFRONT_TOKEN` وحفظهم في `.env` كـ `VITE_*`.
2. قراءة كامل `src/lib/store-catalog.ts` (666 سطر) لاستخراج كل العروض مع `id`, `label`, `priceUSD`, `reward`.

## المرحلة 2: إنشاء المنتجات في Shopify
3. لكل `StorePack` في الكاتالوج: إنشاء منتج في Shopify عبر `shopify--create_product` مع:
   - `title` = label
   - `body` = description
   - `tags` = `pack:{id}` (للربط مع الكاتالوج لاحقاً)
   - `variants[0]`:
     - `price` = priceUSD
     - `sku` = pack.id ← مفتاح الربط مع الجواهر/السفن
     - `requires_shipping: false`
     - `inventory_management: null` (digital)
     - `inventory_policy: continue`
4. حفظ `productId` و `variantId` (GID) في جدول جديد `shopify_products` يربط `pack_id ↔ shopify_variant_id`.

## المرحلة 3: قاعدة البيانات
5. Migration: إنشاء `shopify_products` (pack_id, variant_id_gid, product_id) + GRANTs + RLS.
6. Migration: إنشاء `shopify_orders` (order_id, user_id, pack_id, status, processed_at) لمنع مضاعفة الإكرام.

## المرحلة 4: كود الواجهة (Frontend)
7. إنشاء `src/lib/shopify-storefront.ts` — مساعد GraphQL للـ Storefront API.
8. إنشاء `src/lib/shopify-checkout.ts`:
   - دالة `buyPack(packId)`:
     - يجلب `variant_id_gid` من السوبر-بيس
     - ينشئ Cart عبر `cartCreate` مع:
       - line item (variantId, quantity:1)
       - `attributes: [{key:"user_id", value: auth.uid}, {key:"pack_id", value: packId}]`
       - `buyerIdentity.email` من البروفايل
     - يفتح `checkoutUrl` (مع `?channel=online_store`) في تبويب جديد
9. استبدال كل أزرار `paddleCheckout(...)` في:
   - `RechargePanel.tsx`
   - `ships-shop.tsx`
   - `vip.tsx` / `my-vip.tsx`
   - `cosmetics.tsx`, `backgrounds-shop.tsx`
   - أي مكان يستدعي `paddleCheckout`/`paddle-checkout.functions`
   بـ `buyPack(packId)`.

## المرحلة 5: Webhook لإكرام الجواهر
10. إنشاء `src/routes/api/public/webhooks/shopify/order-paid.ts`:
    - يتحقق من HMAC signature (`X-Shopify-Hmac-Sha256`)
    - يقرأ الطلب → يستخرج `user_id` و `pack_id` من `note_attributes`
    - يتحقق من `shopify_orders` (idempotency)
    - يطبّق reward (gems/coins/vipDays/items/phoenixShips) عبر `supabaseAdmin` ونفس منطق `paddle-claim`
    - يحفظ سجل الطلب
11. تسجيل webhook في Shopify admin (يدوي عند المستخدم) لـ URL: `https://hamor.lovable.app/api/public/webhooks/shopify/order-paid` event `orders/paid`.
12. حفظ `SHOPIFY_WEBHOOK_SECRET` كـ secret.

## المرحلة 6: تنظيف Paddle
13. حذف ملفات Paddle: `paddle.ts`, `paddle.server.ts`, `paddle-checkout.functions.ts`, `paddle-claim.functions.ts`, `paddle-reconcile.functions.ts`.
14. حذف جدول `paddle_purchases` (اختياري) أو إبقاؤه للأرشيف.
15. إزالة `PaymentTestModeBanner`, `AndroidPaymentBlock` إن لزم.

## المرحلة 7: التحقق
16. تجربة شراء جوهرة من البريفيو → نسوي طلب من خلال checkout → نتأكد الجواهر تنزل.

---

## ⚠️ تنبيهات
- **العميل يخرج من اللعبة** لتبويب checkout خارجي وقد يستغرق 10–30 ثانية يرجع.
- **Shopify يطلب بيانات فوترة** (إيميل + اسم + عنوان) حتى للرقمي.
- **عدد المنتجات في الكاتالوج كبير جداً** (50+ منتج) — إنشاؤها كلها قد يستغرق وقتاً ورسائل تأكيد متعددة.
- مدة التنفيذ المتوقعة: عدة جولات شات.
